// round_half_even(|x| * 10^k) as a bigint, computed exactly from the binary value.
function scaledRound(x: number, k: number): bigint {
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, Math.abs(x));
  const hi = buf.getUint32(0);
  const lo = buf.getUint32(4);
  const bexp = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let e: number;
  if (bexp === 0) {
    e = -1074;
  } else {
    m |= 1n << 52n;
    e = bexp - 1075;
  }
  let num = m;
  let den = 1n;
  if (e >= 0) num <<= BigInt(e);
  else den <<= BigInt(-e);
  if (k >= 0) num *= 10n ** BigInt(k);
  else den *= 10n ** BigInt(-k);
  let q = num / den;
  const r = num - q * den;
  const twice = r * 2n;
  if (twice > den || (twice === den && (q & 1n) === 1n)) q += 1n;
  return q;
}

// Fixed style: digits of |x| with prec fractional digits.
function fixedParts(x: number, prec: number): { int: string; frac: string } {
  let s = scaledRound(x, prec).toString();
  if (prec > 0) {
    s = s.padStart(prec + 1, '0');
    return { int: s.slice(0, s.length - prec), frac: s.slice(s.length - prec) };
  }
  return { int: s, frac: '' };
}

// Exponent style: one digit, prec more digits, and decimal exponent.
function expParts(x: number, prec: number): { digits: string; exp: number } {
  if (x === 0) return { digits: '0'.repeat(prec + 1), exp: 0 };
  let X = Math.floor(Math.log10(Math.abs(x)));
  if (!isFinite(X)) X = -324;
  const lim = 10n ** BigInt(prec + 1);
  const low = 10n ** BigInt(prec);
  for (let i = 0; i < 8; i++) {
    const q = scaledRound(x, prec - X);
    if (q >= lim) X++;
    else if (q < low) X--;
    else return { digits: q.toString(), exp: X };
  }
  throw new Error('exponent search failed');
}

function expStr(digits: string, exp: number, prec: number, alt: boolean, upper: boolean): string {
  let s = digits[0];
  if (prec > 0 || alt) s += '.';
  s += digits.slice(1);
  const a = Math.abs(exp);
  s += (upper ? 'E' : 'e') + (exp < 0 ? '-' : '+') + (a < 10 ? '0' + a : String(a));
  return s;
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
    for (; i < fmt.length; i++) {
      const f = fmt[i];
      if (f === '-') left = true;
      else if (f === '+') plus = true;
      else if (f === ' ') space = true;
      else if (f === '0') zero = true;
      else if (f === '#') alt = true;
      else break;
    }
    let width = 0;
    while (i < fmt.length && fmt[i] >= '0' && fmt[i] <= '9') width = width * 10 + (fmt.charCodeAt(i++) - 48);
    let prec = -1;
    if (fmt[i] === '.') {
      i++;
      prec = 0;
      while (i < fmt.length && fmt[i] >= '0' && fmt[i] <= '9') prec = prec * 10 + (fmt.charCodeAt(i++) - 48);
    }
    const conv = fmt[i++];
    const arg = args[ai++];

    let sign = '';
    let prefix = '';
    let body = '';
    let numeric = true;
    let zeroOk = zero && !left;

    if (conv === 's' || conv === 'c') {
      numeric = false;
      body = String(arg);
      if (conv === 's' && prec >= 0) body = body.slice(0, prec);
    } else if (conv === 'd' || conv === 'i') {
      const v = typeof arg === 'bigint' ? arg : BigInt(arg as number);
      const neg = v < 0n;
      let digits = (neg ? -v : v).toString();
      if (prec >= 0) {
        if (prec === 0 && v === 0n) digits = '';
        digits = digits.padStart(prec, '0');
        zeroOk = false;
      }
      sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
      body = digits;
    } else if (conv === 'x' || conv === 'X' || conv === 'o') {
      const v = typeof arg === 'bigint' ? arg : BigInt(arg as number);
      let digits = v.toString(conv === 'o' ? 8 : 16);
      if (conv === 'X') digits = digits.toUpperCase();
      if (prec >= 0) {
        if (prec === 0 && v === 0n) digits = '';
        digits = digits.padStart(prec, '0');
        zeroOk = false;
      }
      if (alt) {
        if (conv === 'o') {
          if (digits[0] !== '0') digits = '0' + digits;
        } else if (v !== 0n) {
          prefix = conv === 'x' ? '0x' : '0X';
        }
      }
      body = digits;
    } else {
      const x = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      const neg = x < 0 || Object.is(x, -0);
      if (Number.isNaN(x)) {
        body = upper ? 'NAN' : 'nan';
        zeroOk = false;
      } else {
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        if (!isFinite(x)) {
          body = upper ? 'INF' : 'inf';
          zeroOk = false;
        } else if (conv === 'f' || conv === 'F') {
          const p = prec < 0 ? 6 : prec;
          const { int, frac } = fixedParts(x, p);
          body = int + (p > 0 || alt ? '.' : '') + frac;
        } else if (conv === 'e' || conv === 'E') {
          const p = prec < 0 ? 6 : prec;
          const { digits, exp } = expParts(x, p);
          body = expStr(digits, exp, p, alt, upper);
        } else {
          let P = prec < 0 ? 6 : prec;
          if (P === 0) P = 1;
          const { digits, exp: X } = expParts(x, P - 1);
          if (P > X && X >= -4) {
            const p = P - 1 - X;
            const { int, frac } = fixedParts(x, p);
            let f = frac;
            if (!alt) f = f.replace(/0+$/, '');
            body = int + (f.length > 0 || alt ? '.' : '') + f;
          } else {
            let d = digits;
            let p = P - 1;
            if (!alt) {
              d = d[0] + d.slice(1).replace(/0+$/, '');
              p = d.length - 1;
            }
            body = expStr(d, X, p, alt, upper);
          }
        }
      }
    }

    const len = sign.length + prefix.length + body.length;
    if (len < width) {
      const pad = width - len;
      if (left) body = sign + prefix + body + ' '.repeat(pad);
      else if (numeric && zeroOk) body = sign + prefix + '0'.repeat(pad) + body;
      else body = ' '.repeat(pad) + sign + prefix + body;
    } else {
      body = sign + prefix + body;
    }
    out += body;
  }
  return out;
}
