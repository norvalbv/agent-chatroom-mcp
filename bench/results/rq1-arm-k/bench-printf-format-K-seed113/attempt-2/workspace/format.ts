function decompose(x: number): { m: bigint; e: number } {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let e: number;
  if (expBits === 0) {
    e = -1074;
  } else {
    m |= 1n << 52n;
    e = expBits - 1075;
  }
  return { m, e };
}

// value * 10^k as a fraction num/den
function scaled(m: bigint, e: number, k: number): [bigint, bigint] {
  let num = m;
  let den = 1n;
  if (e >= 0) num <<= BigInt(e);
  else den <<= BigInt(-e);
  if (k >= 0) num *= 10n ** BigInt(k);
  else den *= 10n ** BigInt(-k);
  return [num, den];
}

function roundHalfEven(num: bigint, den: bigint): bigint {
  const q = num / den;
  const r = num % den;
  const c = r * 2n;
  if (c > den || (c === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// |x| rounded to p fractional digits, as digit string of the integer round(|x|*10^p)
function fixedDigits(x: number, p: number): string {
  const { m, e } = decompose(Math.abs(x));
  const [n, d] = scaled(m, e, p);
  return roundHalfEven(n, d).toString();
}

function expParts(x: number, p: number): { digits: string; X: number } {
  if (x === 0) return { digits: '0'.repeat(p + 1), X: 0 };
  const { m, e } = decompose(Math.abs(x));
  let X = Math.floor(Math.log10(Math.abs(x)));
  if (!Number.isFinite(X)) X = -324;
  // exact correction: 10^X <= v < 10^(X+1)
  for (;;) {
    const [n, d] = scaled(m, e, -X);
    if (n < d) X--;
    else {
      const [n2, d2] = scaled(m, e, -(X + 1));
      if (n2 >= d2) X++;
      else break;
    }
  }
  const [n, d] = scaled(m, e, p - X);
  let q = roundHalfEven(n, d);
  if (q >= 10n ** BigInt(p + 1)) {
    q /= 10n;
    X++;
  }
  return { digits: q.toString(), X };
}

function expStr(digits: string, X: number, alt: boolean, upper: boolean): string {
  let s = digits[0];
  if (digits.length > 1) s += '.' + digits.slice(1);
  else if (alt) s += '.';
  const ax = Math.abs(X);
  s += (upper ? 'E' : 'e') + (X < 0 ? '-' : '+') + (ax < 10 ? '0' : '') + ax;
  return s;
}

function fixedStr(x: number, p: number, alt: boolean): string {
  let d = fixedDigits(x, p);
  if (p === 0) return d + (alt ? '.' : '');
  if (d.length <= p) d = '0'.repeat(p + 1 - d.length) + d;
  return d.slice(0, d.length - p) + '.' + d.slice(d.length - p);
}

function stripZeros(s: string): string {
  // s has a '.'; strip in the mantissa part only
  const i = s.search(/[eE]/);
  let mant = i < 0 ? s : s.slice(0, i);
  const rest = i < 0 ? '' : s.slice(i);
  if (mant.includes('.')) {
    mant = mant.replace(/0+$/, '').replace(/\.$/, '');
  }
  return mant + rest;
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
    for (;; i++) {
      const f = fmt[i];
      if (f === '-') minus = true;
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
    let numeric = true;
    let allowZero = true;
    const lc = conv.toLowerCase();
    if (conv === 'd' || conv === 'i') {
      const v = BigInt(arg as number | bigint);
      sign = v < 0n ? '-' : plus ? '+' : space ? ' ' : '';
      body = (v < 0n ? -v : v).toString();
      if (prec === 0 && v === 0n) body = '';
      if (prec >= 0) {
        body = body.padStart(prec, '0');
        allowZero = false;
      }
    } else if (conv === 'x' || conv === 'X' || conv === 'o') {
      const v = BigInt(arg as number | bigint);
      body = v.toString(conv === 'o' ? 8 : 16);
      if (conv === 'X') body = body.toUpperCase();
      if (prec === 0 && v === 0n) body = '';
      if (prec >= 0) {
        body = body.padStart(prec, '0');
        allowZero = false;
      }
      if (alt) {
        if (conv === 'o') {
          if (body[0] !== '0') body = '0' + body;
        } else if (v !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      }
    } else if ('eEfFgG'.includes(conv)) {
      const x = arg as number;
      const upper = conv === conv.toUpperCase();
      const neg = x < 0 || Object.is(x, -0);
      if (Number.isNaN(x)) {
        body = 'NAN';
        allowZero = false;
      } else {
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        if (!Number.isFinite(x)) {
          body = 'INF';
          allowZero = false;
        } else if (lc === 'f') {
          body = fixedStr(x, prec < 0 ? 6 : prec, alt);
        } else if (lc === 'e') {
          const p = prec < 0 ? 6 : prec;
          const { digits, X } = expParts(x, p);
          body = expStr(digits, X, alt, upper);
        } else {
          const P = prec < 0 ? 6 : prec === 0 ? 1 : prec;
          const { digits, X } = expParts(x, P - 1);
          if (P > X && X >= -4) {
            body = fixedStr(x, P - 1 - X, alt);
          } else {
            body = expStr(digits, X, alt, upper);
          }
          if (!alt) body = stripZeros(body);
        }
      }
      if (!Number.isFinite(x)) body = upper ? body : body.toLowerCase();
      else if (upper) body = body.toUpperCase();
    } else {
      numeric = false;
      const s = String(arg);
      body = conv === 's' && prec >= 0 ? s.slice(0, prec) : s;
    }
    const len = sign.length + prefix.length + body.length;
    if (len >= width) out += sign + prefix + body;
    else if (minus) out += sign + prefix + body + ' '.repeat(width - len);
    else if (numeric && zero && allowZero)
      out += sign + prefix + '0'.repeat(width - len) + body;
    else out += ' '.repeat(width - len) + sign + prefix + body;
  }
  return out;
}
