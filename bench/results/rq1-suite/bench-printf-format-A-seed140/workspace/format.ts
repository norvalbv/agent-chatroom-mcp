function roundDiv(n: bigint, d: bigint): bigint {
  const q = n / d;
  const r = n % d;
  const t = r * 2n;
  if (t > d || (t === d && (q & 1n) === 1n)) return q + 1n;
  return q;
}

const p10 = (k: number): bigint => 10n ** BigInt(k);

// exact rational of |x|
function ratio(x: number): [bigint, bigint] {
  x = Math.abs(x);
  if (x === 0) return [0n, 1n];
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, x);
  const hi = buf.getUint32(0);
  const lo = buf.getUint32(4);
  const be = (hi >>> 20) & 0x7ff;
  let mant = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let e: number;
  if (be === 0) e = -1074;
  else {
    mant |= 1n << 52n;
    e = be - 1075;
  }
  return e >= 0 ? [mant << BigInt(e), 1n] : [mant, 1n << BigInt(-e)];
}

function fixedStr(num: bigint, den: bigint, p: number, alt: boolean): string {
  let s = roundDiv(num * p10(p), den).toString();
  if (s.length < p + 1) s = '0'.repeat(p + 1 - s.length) + s;
  const ip = s.slice(0, s.length - p);
  const fp = s.slice(s.length - p);
  return p > 0 ? ip + '.' + fp : alt ? ip + '.' : ip;
}

// returns digits (p+1 of them) and exponent
function expParts(num: bigint, den: bigint, p: number): [string, number] {
  if (num === 0n) return ['0'.repeat(p + 1), 0];
  const v = Number(num) / Number(den);
  let X = Number.isFinite(v) && v > 0 ? Math.floor(Math.log10(v)) : 0;
  const ge = (k: number): boolean =>
    // v >= 10^k
    k >= 0 ? num >= den * p10(k) : num * p10(-k) >= den;
  while (!ge(X)) X--;
  while (ge(X + 1)) X++;
  const k = X - p;
  let d = k >= 0 ? roundDiv(num, den * p10(k)) : roundDiv(num * p10(-k), den);
  if (d >= p10(p + 1)) {
    X++;
    d = d / 10n;
  }
  return [d.toString(), X];
}

function expStr(digits: string, X: number, upper: boolean, alt: boolean): string {
  const p = digits.length - 1;
  let s = digits[0];
  if (p > 0) s += '.' + digits.slice(1);
  else if (alt) s += '.';
  const ax = Math.abs(X);
  return s + (upper ? 'E' : 'e') + (X < 0 ? '-' : '+') + (ax < 10 ? '0' : '') + ax;
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
    let numeric = true;
    let allowZero = zero && !left;

    if (conv === 's' || conv === 'c') {
      numeric = false;
      body = String(arg);
      if (conv === 's' && prec >= 0) body = body.slice(0, prec);
    } else if ('dixXo'.includes(conv)) {
      const v = BigInt(arg as number | bigint);
      const neg = v < 0n;
      const mag = neg ? -v : v;
      let digits = conv === 'd' || conv === 'i' ? mag.toString() : mag.toString(conv === 'o' ? 8 : 16);
      if (conv === 'X') digits = digits.toUpperCase();
      if (prec >= 0) {
        allowZero = false;
        if (prec === 0 && mag === 0n) digits = '';
        if (digits.length < prec) digits = '0'.repeat(prec - digits.length) + digits;
      }
      if (conv === 'd' || conv === 'i') {
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
      } else if (alt) {
        if (conv === 'o') {
          if (digits[0] !== '0') digits = '0' + digits;
        } else if (mag !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      }
      body = digits;
    } else {
      const x = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      if (Number.isNaN(x)) {
        body = upper ? 'NAN' : 'nan';
        allowZero = false;
      } else {
        const neg = x < 0 || Object.is(x, -0);
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        if (!Number.isFinite(x)) {
          body = upper ? 'INF' : 'inf';
          allowZero = false;
        } else {
          const [num, den] = ratio(x);
          const lc = conv.toLowerCase();
          if (lc === 'f') {
            body = fixedStr(num, den, prec < 0 ? 6 : prec, alt);
          } else if (lc === 'e') {
            const [d, X] = expParts(num, den, prec < 0 ? 6 : prec);
            body = expStr(d, X, upper, alt);
          } else {
            const P = prec < 0 ? 6 : prec === 0 ? 1 : prec;
            const [d, X] = expParts(num, den, P - 1);
            if (P > X && X >= -4) {
              body = fixedStr(num, den, P - 1 - X, alt);
              if (!alt && body.includes('.')) body = body.replace(/0+$/, '').replace(/\.$/, '');
            } else {
              let dd = d;
              if (!alt) dd = d[0] + d.slice(1).replace(/0+$/, '');
              body = expStr(dd, X, upper, alt);
            }
          }
        }
      }
    }

    const len = sign.length + prefix.length + body.length;
    if (len >= width) out += sign + prefix + body;
    else if (left) out += sign + prefix + body + ' '.repeat(width - len);
    else if (numeric && allowZero) out += sign + prefix + '0'.repeat(width - len) + body;
    else out += ' '.repeat(width - len) + sign + prefix + body;
  }
  return out;
}
