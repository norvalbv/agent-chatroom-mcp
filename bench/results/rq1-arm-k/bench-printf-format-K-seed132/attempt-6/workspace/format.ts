function decompose(v: number): { m: bigint; e: number } {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, v);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const be = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (be === 0) return { m, e: -1074 };
  m |= 1n << 52n;
  return { m, e: be - 1075 };
}

// round_half_even(|v| * 10^k) as BigInt
function scaled(m: bigint, e: number, k: number): bigint {
  let num = m;
  let den = 1n;
  if (e >= 0) num <<= BigInt(e);
  else den <<= BigInt(-e);
  if (k >= 0) num *= 10n ** BigInt(k);
  else den *= 10n ** BigInt(-k);
  const q = num / den;
  const r2 = (num % den) * 2n;
  if (r2 > den || (r2 === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

function fixedStr(v: number, prec: number, alt: boolean): string {
  const { m, e } = decompose(v);
  let s = scaled(m, e, prec).toString();
  if (prec > 0) {
    s = s.padStart(prec + 1, '0');
    return s.slice(0, s.length - prec) + '.' + s.slice(s.length - prec);
  }
  return alt ? s + '.' : s;
}

// returns digits (prec+1 of them) and decimal exponent
function expParts(v: number, prec: number): { digits: string; x: number } {
  if (v === 0) return { digits: '0'.repeat(prec + 1), x: 0 };
  const { m, e } = decompose(v);
  let x = Math.floor(Math.log10(v));
  if (!isFinite(x)) x = -324;
  for (let i = 0; i < 10; i++) {
    const d = scaled(m, e, prec - x);
    const lim = 10n ** BigInt(prec);
    if (d >= lim * 10n) x++;
    else if (d < lim) x--;
    else return { digits: d.toString(), x };
  }
  throw new Error('exp');
}

function expStr(digits: string, x: number, alt: boolean, upper: boolean): string {
  const prec = digits.length - 1;
  let s = digits[0];
  if (prec > 0) s += '.' + digits.slice(1);
  else if (alt) s += '.';
  const ax = Math.abs(x);
  s += (upper ? 'E' : 'e') + (x < 0 ? '-' : '+') + (ax < 10 ? '0' + ax : String(ax));
  return s;
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
    let left = false, plus = false, space = false, zero = false, alt = false;
    for (;; i++) {
      const f = fmt[i];
      if (f === '-') left = true;
      else if (f === '+') plus = true;
      else if (f === ' ') space = true;
      else if (f === '0') zero = true;
      else if (f === '#') alt = true;
      else break;
    }
    let width = 0;
    while (fmt[i] >= '0' && fmt[i] <= '9') width = width * 10 + Number(fmt[i++]);
    let prec = -1;
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
    if (conv === 's' || conv === 'c') {
      body = String(arg);
      if (conv === 's' && prec >= 0) body = body.slice(0, prec);
      canZero = false;
    } else if (conv === 'd' || conv === 'i') {
      const n = BigInt(arg as number | bigint);
      sign = n < 0n ? '-' : plus ? '+' : space ? ' ' : '';
      body = (n < 0n ? -n : n).toString();
      if (prec === 0 && n === 0n) body = '';
      if (prec >= 0) {
        body = body.padStart(prec, '0');
        canZero = false;
      }
    } else if (conv === 'x' || conv === 'X' || conv === 'o') {
      const n = BigInt(arg as number | bigint);
      body = n.toString(conv === 'o' ? 8 : 16);
      if (conv === 'X') body = body.toUpperCase();
      if (prec === 0 && n === 0n) body = '';
      if (prec >= 0) {
        body = body.padStart(prec, '0');
        canZero = false;
      }
      if (alt) {
        if (conv === 'o') {
          if (body[0] !== '0') body = '0' + body;
        } else if (n !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      }
    } else {
      const v = arg as number;
      const upper = conv === conv.toUpperCase();
      if (Number.isNaN(v)) {
        body = upper ? 'NAN' : 'nan';
        canZero = false;
      } else {
        const neg = v < 0 || Object.is(v, -0);
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        const a = Math.abs(v);
        if (a === Infinity) {
          body = upper ? 'INF' : 'inf';
          canZero = false;
        } else if (lc === 'f') {
          body = fixedStr(a, prec < 0 ? 6 : prec, alt);
        } else if (lc === 'e') {
          const p = prec < 0 ? 6 : prec;
          const { digits, x } = expParts(a, p);
          body = expStr(digits, x, alt, upper);
        } else {
          const P = prec < 0 ? 6 : prec === 0 ? 1 : prec;
          const { digits, x } = expParts(a, P - 1);
          if (P > x && x >= -4) {
            body = fixedStr(a, P - 1 - x, alt);
            if (!alt) body = stripZeros(body);
          } else {
            let mant = digits[0] + (P > 1 ? '.' + digits.slice(1) : alt ? '.' : '');
            if (!alt) mant = stripZeros(mant);
            const ax = Math.abs(x);
            body = mant + (upper ? 'E' : 'e') + (x < 0 ? '-' : '+') + (ax < 10 ? '0' + ax : String(ax));
          }
        }
      }
    }
    const len = sign.length + prefix.length + body.length;
    if (len < width) {
      const pad = width - len;
      if (left) body = sign + prefix + body + ' '.repeat(pad), sign = prefix = '';
      else if (zero && canZero) body = '0'.repeat(pad) + body;
      else sign = ' '.repeat(pad) + sign;
    }
    out += sign + prefix + body;
  }
  return out;
}
