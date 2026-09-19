// Decompose a finite non-negative double into m * 2^e exactly.
function decompose(v: number): { m: bigint; e: number } {
  if (v === 0) return { m: 0n, e: 0 };
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, v);
  const bits = buf.getBigUint64(0);
  const expBits = Number((bits >> 52n) & 0x7ffn);
  const frac = bits & 0xfffffffffffffn;
  if (expBits === 0) return { m: frac, e: -1074 };
  return { m: frac | (1n << 52n), e: expBits - 1075 };
}

// round-half-even(v * 10^k) as a BigInt, exact.
function roundScaled(v: number, k: number): bigint {
  const { m, e } = decompose(v);
  let num = m;
  let den = 1n;
  if (e >= 0) num <<= BigInt(e);
  else den <<= BigInt(-e);
  if (k >= 0) num *= 10n ** BigInt(k);
  else den *= 10n ** BigInt(-k);
  const q = num / den;
  const r = num % den;
  const twice = r * 2n;
  if (twice > den || (twice === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// Digits (p+1 of them) and decimal exponent of v in e style.
function eDigits(v: number, p: number): { ds: string; x: number } {
  if (v === 0) return { ds: '0'.repeat(p + 1), x: 0 };
  let x = Math.floor(Math.log10(v));
  if (!Number.isFinite(x)) x = 0;
  const lo = 10n ** BigInt(p);
  const hi = lo * 10n;
  for (let i = 0; i < 10; i++) {
    const n = roundScaled(v, p - x);
    if (n >= hi) x++;
    else if (n < lo) x--;
    else return { ds: n.toString(), x };
  }
  throw new Error('exponent search failed');
}

function fixedStr(v: number, p: number, alt: boolean): string {
  const n = roundScaled(v, p);
  const s = n.toString().padStart(p + 1, '0');
  if (p === 0) return alt ? s + '.' : s;
  return s.slice(0, s.length - p) + '.' + s.slice(s.length - p);
}

function expStr(ds: string, x: number, p: number, alt: boolean, upper: boolean, strip: boolean): string {
  let frac = ds.slice(1);
  if (strip) frac = frac.replace(/0+$/, '');
  let mant = ds[0];
  if (frac.length > 0 || alt) mant += '.' + frac;
  const ax = Math.abs(x);
  const e = (upper ? 'E' : 'e') + (x < 0 ? '-' : '+') + (ax < 10 ? '0' + ax : String(ax));
  return mant + e;
}

function stripFixed(s: string): string {
  if (!s.includes('.')) return s;
  return s.replace(/0+$/, '').replace(/\.$/, '');
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let out = '';
  let ai = 0;
  let i = 0;
  while (i < fmt.length) {
    const ch = fmt[i];
    if (ch !== '%') {
      out += ch;
      i++;
      continue;
    }
    i++;
    if (fmt[i] === '%') {
      out += '%';
      i++;
      continue;
    }
    let minus = false, plus = false, space = false, zero = false, alt = false;
    for (; i < fmt.length; i++) {
      const f = fmt[i];
      if (f === '-') minus = true;
      else if (f === '+') plus = true;
      else if (f === ' ') space = true;
      else if (f === '0') zero = true;
      else if (f === '#') alt = true;
      else break;
    }
    let width = 0;
    while (i < fmt.length && fmt[i] >= '0' && fmt[i] <= '9') width = width * 10 + Number(fmt[i++]);
    let prec: number | undefined;
    if (fmt[i] === '.') {
      i++;
      prec = 0;
      while (i < fmt.length && fmt[i] >= '0' && fmt[i] <= '9') prec = prec * 10 + Number(fmt[i++]);
    }
    const conv = fmt[i++];
    const arg = args[ai++];

    let sign = '';
    let prefix = '';
    let body = '';
    let canZero = false;

    switch (conv) {
      case 'd':
      case 'i':
      case 'x':
      case 'X':
      case 'o': {
        let n = BigInt(arg as number | bigint);
        const neg = n < 0n;
        if (neg) n = -n;
        const radix = conv === 'x' || conv === 'X' ? 16 : conv === 'o' ? 8 : 10;
        let digits = n.toString(radix);
        if (conv === 'X') digits = digits.toUpperCase();
        if (prec !== undefined) {
          if (prec === 0 && n === 0n) digits = '';
          digits = digits.padStart(prec, '0');
        }
        if (radix === 10) {
          sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        } else if (alt) {
          if (conv === 'o') {
            if (digits[0] !== '0') digits = '0' + digits;
          } else if (n !== 0n) {
            prefix = conv === 'x' ? '0x' : '0X';
          }
        }
        body = digits;
        canZero = prec === undefined;
        break;
      }
      case 'e':
      case 'E':
      case 'f':
      case 'F':
      case 'g':
      case 'G': {
        const v = arg as number;
        const upper = conv === 'E' || conv === 'F' || conv === 'G';
        if (Number.isNaN(v)) {
          body = upper ? 'NAN' : 'nan';
          break;
        }
        const neg = v < 0 || Object.is(v, -0);
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        const a = Math.abs(v);
        if (a === Infinity) {
          body = upper ? 'INF' : 'inf';
          break;
        }
        canZero = true;
        const lc = conv.toLowerCase();
        if (lc === 'f') {
          body = fixedStr(a, prec ?? 6, alt);
        } else if (lc === 'e') {
          const p = prec ?? 6;
          const { ds, x } = eDigits(a, p);
          body = expStr(ds, x, p, alt, upper, false);
        } else {
          const P = prec === undefined ? 6 : Math.max(prec, 1);
          const { ds, x } = eDigits(a, P - 1);
          if (P > x && x >= -4) {
            const s = fixedStr(a, P - 1 - x, alt);
            body = alt ? s : stripFixed(s);
          } else {
            body = expStr(ds, x, P - 1, alt, upper, !alt);
          }
        }
        break;
      }
      case 's': {
        let s = arg as string;
        if (prec !== undefined) s = s.slice(0, prec);
        body = s;
        break;
      }
      case 'c':
        body = arg as string;
        break;
      default:
        throw new Error('bad conversion');
    }

    const len = sign.length + prefix.length + body.length;
    if (len >= width) out += sign + prefix + body;
    else if (minus) out += sign + prefix + body + ' '.repeat(width - len);
    else if (zero && canZero) out += sign + prefix + '0'.repeat(width - len) + body;
    else out += ' '.repeat(width - len) + sign + prefix + body;
  }
  return out;
}
