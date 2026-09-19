const f64 = new Float64Array(1);
const u64 = new BigUint64Array(f64.buffer);

function decompose(v: number): { m: bigint; e: number } {
  f64[0] = v;
  const bits = u64[0];
  const ex = Number((bits >> 52n) & 0x7ffn);
  const frac = bits & ((1n << 52n) - 1n);
  if (ex === 0) return { m: frac, e: -1074 };
  return { m: frac | (1n << 52n), e: ex - 1075 };
}

// round(m * 2^e * 10^k), ties to even
function roundScaled(m: bigint, e: number, k: number): bigint {
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

function fixed(v: number, p: number, alt: boolean): string {
  const { m, e } = decompose(v);
  let d = roundScaled(m, e, p).toString();
  if (d.length < p + 1) d = '0'.repeat(p + 1 - d.length) + d;
  const ip = d.slice(0, d.length - p);
  const fp = d.slice(d.length - p);
  return p > 0 ? ip + '.' + fp : alt ? ip + '.' : ip;
}

function sci(v: number, P: number): { digits: string; X: number } {
  if (v === 0) return { digits: '0'.repeat(P), X: 0 };
  const { m, e } = decompose(v);
  let X = Math.floor(Math.log10(v));
  for (let i = 0; i < 10; i++) {
    const D = roundScaled(m, e, P - 1 - X);
    const s = D.toString();
    if (s.length > P) X++;
    else if (s.length < P) X--;
    else return { digits: s, X };
  }
  throw new Error('unreachable');
}

function expStr(X: number, upper: boolean): string {
  const a = Math.abs(X).toString().padStart(2, '0');
  return (upper ? 'E' : 'e') + (X < 0 ? '-' : '+') + a;
}

function fmtE(v: number, p: number, alt: boolean, upper: boolean, strip: boolean): string {
  const { digits, X } = sci(v, p + 1);
  let mant = digits[0];
  let frac = digits.slice(1);
  if (strip) frac = frac.replace(/0+$/, '');
  if (frac.length > 0) mant += '.' + frac;
  else if (alt) mant += '.';
  return mant + expStr(X, upper);
}

function stripZeros(s: string): string {
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
      const c = fmt[i];
      if (c === '-') minus = true;
      else if (c === '+') plus = true;
      else if (c === ' ') space = true;
      else if (c === '0') zero = true;
      else if (c === '#') alt = true;
      else break;
    }
    let width = 0;
    while (fmt[i] >= '0' && fmt[i] <= '9') width = width * 10 + Number(fmt[i++]);
    let prec: number | undefined;
    if (fmt[i] === '.') {
      i++;
      prec = 0;
      while (fmt[i] >= '0' && fmt[i] <= '9') prec = prec * 10 + Number(fmt[i++]);
    }
    const conv = fmt[i++];
    const arg = args[ai++];

    let sign = '';
    let prefix = '';
    let body = '';
    let canZero = true;
    const lc = conv.toLowerCase();
    const upper = conv !== lc;

    if (conv === 's' || conv === 'c') {
      body = String(arg);
      if (conv === 's' && prec !== undefined) body = body.slice(0, prec);
      canZero = false;
    } else if (conv === 'd' || conv === 'i') {
      const n = BigInt(arg as number | bigint);
      sign = n < 0n ? '-' : plus ? '+' : space ? ' ' : '';
      const mag = n < 0n ? -n : n;
      body = mag === 0n && prec === 0 ? '' : mag.toString();
      if (prec !== undefined) {
        body = body.padStart(prec, '0');
        canZero = false;
      }
    } else if (conv === 'x' || conv === 'X' || conv === 'o') {
      const n = BigInt(arg as number | bigint);
      body = n === 0n && prec === 0 ? '' : n.toString(conv === 'o' ? 8 : 16);
      if (conv === 'X') body = body.toUpperCase();
      if (prec !== undefined) {
        body = body.padStart(prec, '0');
        canZero = false;
      }
      if (alt) {
        if (conv === 'o') {
          if (body[0] !== '0') body = '0' + body;
        } else if (n !== 0n) prefix = conv === 'X' ? '0X' : '0x';
      }
    } else {
      const v = arg as number;
      const neg = Object.is(v, -0) || v < 0;
      if (Number.isNaN(v)) {
        body = 'nan';
        canZero = false;
      } else {
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        if (!Number.isFinite(v)) {
          body = 'inf';
          canZero = false;
        } else {
          const a = Math.abs(v);
          if (lc === 'f') {
            body = fixed(a, prec ?? 6, alt);
          } else if (lc === 'e') {
            body = fmtE(a, prec ?? 6, alt, upper, false);
          } else {
            const P = prec === undefined ? 6 : prec === 0 ? 1 : prec;
            const { X } = sci(a, P);
            if (P > X && X >= -4) {
              body = fixed(a, P - 1 - X, alt);
              if (!alt) body = stripZeros(body);
            } else {
              body = fmtE(a, P - 1, alt, upper, !alt);
            }
          }
        }
      }
      if (upper) body = body.toUpperCase();
    }

    const len = sign.length + prefix.length + body.length;
    if (len < width) {
      const pad = width - len;
      if (minus) body = sign + prefix + body + ' '.repeat(pad);
      else if (zero && canZero) body = sign + prefix + '0'.repeat(pad) + body;
      else body = ' '.repeat(pad) + sign + prefix + body;
    } else {
      body = sign + prefix + body;
    }
    out += body;
  }
  return out;
}
