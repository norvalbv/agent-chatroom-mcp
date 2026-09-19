// round-half-even(x * 10^k) for finite x > 0, using the exact binary value
function roundScaled(x: number, k: number): bigint {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const be = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let e: number;
  if (be === 0) {
    e = -1074;
  } else {
    m |= 1n << 52n;
    e = be - 1075;
  }
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

function fStr(x: number, p: number, alt: boolean): string {
  const d = x === 0 ? '0'.repeat(p + 1) : roundScaled(x, p).toString().padStart(p + 1, '0');
  if (p === 0) return d + (alt ? '.' : '');
  return d.slice(0, d.length - p) + '.' + d.slice(d.length - p);
}

// returns digits (p+1 of them) and decimal exponent
function eParts(x: number, p: number): { digits: string; exp: number } {
  if (x === 0) return { digits: '0'.repeat(p + 1), exp: 0 };
  let X = Math.floor(Math.log10(x));
  for (let i = 0; i < 10; i++) {
    const s = roundScaled(x, p - X).toString();
    if (s.length > p + 1) X++;
    else if (s.length < p + 1) X--;
    else return { digits: s, exp: X };
  }
  throw new Error('unreachable');
}

function expSuffix(exp: number, upper: boolean): string {
  const a = Math.abs(exp).toString().padStart(2, '0');
  return (upper ? 'E' : 'e') + (exp < 0 ? '-' : '+') + a;
}

function eStr(x: number, p: number, alt: boolean, upper: boolean): string {
  const { digits, exp } = eParts(x, p);
  let s = digits[0];
  if (p > 0) s += '.' + digits.slice(1);
  else if (alt) s += '.';
  return s + expSuffix(exp, upper);
}

function stripZeros(s: string): string {
  if (!s.includes('.')) return s;
  s = s.replace(/0+$/, '');
  if (s.endsWith('.')) s = s.slice(0, -1);
  return s;
}

function gStr(x: number, prec: number, alt: boolean, upper: boolean): string {
  const P = prec === 0 ? 1 : prec;
  const { exp: X } = eParts(x, P - 1);
  if (P > X && X >= -4) {
    let s = fStr(x, P - 1 - X, alt);
    if (!alt) s = stripZeros(s);
    return s;
  }
  const { digits, exp } = eParts(x, P - 1);
  let mant = digits[0];
  if (P - 1 > 0) mant += '.' + digits.slice(1);
  else if (alt) mant += '.';
  if (!alt) mant = stripZeros(mant);
  return mant + expSuffix(exp, upper);
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
    while (i < fmt.length && fmt[i] >= '0' && fmt[i] <= '9') {
      width = width * 10 + (fmt.charCodeAt(i) - 48);
      i++;
    }
    let prec = -1;
    if (fmt[i] === '.') {
      i++;
      prec = 0;
      while (i < fmt.length && fmt[i] >= '0' && fmt[i] <= '9') {
        prec = prec * 10 + (fmt.charCodeAt(i) - 48);
        i++;
      }
    }
    const conv = fmt[i++];
    const arg = args[ai++];
    let sign = '';
    let prefix = '';
    let body = '';
    let canZero = true;
    const signFor = (neg: boolean) => (neg ? '-' : plus ? '+' : space ? ' ' : '');

    if (conv === 's' || conv === 'c') {
      let s = String(arg);
      if (conv === 's' && prec >= 0) s = s.slice(0, prec);
      body = s;
      canZero = false;
    } else if (conv === 'd' || conv === 'i' || conv === 'x' || conv === 'X' || conv === 'o') {
      const v = typeof arg === 'bigint' ? arg : BigInt(arg as number);
      const neg = v < 0n;
      const mag = neg ? -v : v;
      let digits =
        conv === 'x' ? mag.toString(16) : conv === 'X' ? mag.toString(16).toUpperCase() : conv === 'o' ? mag.toString(8) : mag.toString(10);
      if (prec >= 0) {
        if (prec === 0 && mag === 0n) digits = '';
        digits = digits.padStart(prec, '0');
        canZero = false;
      }
      if (conv === 'd' || conv === 'i') sign = signFor(neg);
      else if (alt) {
        if (conv === 'o') {
          if (!digits.startsWith('0')) digits = '0' + digits;
        } else if (mag !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      }
      body = digits;
    } else {
      const x = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      if (Number.isNaN(x)) {
        body = upper ? 'NAN' : 'nan';
        canZero = false;
      } else {
        const neg = x < 0 || Object.is(x, -0);
        sign = signFor(neg);
        const ax = Math.abs(x);
        if (!Number.isFinite(ax)) {
          body = upper ? 'INF' : 'inf';
          canZero = false;
        } else {
          const lc = conv.toLowerCase();
          const p = prec < 0 ? 6 : prec;
          if (lc === 'f') body = fStr(ax, p, alt);
          else if (lc === 'e') body = eStr(ax, p, alt, upper);
          else body = gStr(ax, p, alt, upper);
        }
      }
    }

    const len = sign.length + prefix.length + body.length;
    if (len >= width) out += sign + prefix + body;
    else if (minus) out += sign + prefix + body + ' '.repeat(width - len);
    else if (zero && canZero) out += sign + prefix + '0'.repeat(width - len) + body;
    else out += ' '.repeat(width - len) + sign + prefix + body;
  }
  return out;
}
