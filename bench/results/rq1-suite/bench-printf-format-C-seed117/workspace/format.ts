// Round-half-even of |x| * 10^k, exact, for finite x > 0 (k may be negative).
function scaled(x: number, k: number): bigint {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const be = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let e: number;
  if (be === 0) e = -1074;
  else {
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
  const r = num % den;
  const twice = r * 2n;
  if (twice > den || (twice === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// Digits (p+1 of them) and decimal exponent of x > 0 in e style.
function eDigits(x: number, p: number): { digits: string; exp: number } {
  let e10 = Math.floor(Math.log10(x));
  if (!isFinite(e10)) e10 = -324;
  const lim = 10n ** BigInt(p + 1);
  const low = 10n ** BigInt(p);
  for (let i = 0; i < 10; i++) {
    const d = scaled(x, p - e10);
    if (d >= lim) e10++;
    else if (d < low) e10--;
    else return { digits: d.toString(), exp: e10 };
  }
  throw new Error('exponent search failed');
}

function fixedStr(x: number, p: number, alt: boolean): string {
  let s = x === 0 ? '0'.repeat(p + 1) : scaled(x, p).toString().padStart(p + 1, '0');
  const ip = s.slice(0, s.length - p);
  const fp = s.slice(s.length - p);
  return ip + (p > 0 || alt ? '.' : '') + fp;
}

function expStr(x: number, p: number, alt: boolean, upper: boolean): string {
  let digits: string;
  let exp: number;
  if (x === 0) {
    digits = '0'.repeat(p + 1);
    exp = 0;
  } else ({ digits, exp } = eDigits(x, p));
  const a = Math.abs(exp);
  const es = (exp < 0 ? '-' : '+') + (a < 10 ? '0' + a : String(a));
  return digits[0] + (p > 0 || alt ? '.' : '') + digits.slice(1) + (upper ? 'E' : 'e') + es;
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
    let prec = -1;
    if (fmt[i] === '.') {
      i++;
      prec = 0;
      while (i < fmt.length && fmt[i] >= '0' && fmt[i] <= '9') prec = prec * 10 + Number(fmt[i++]);
    }
    const conv = fmt[i++];
    const arg = args[ai++];

    let sign = '';
    let prefix = '';
    let body: string;
    let canZero = true;

    if (conv === 's' || conv === 'c') {
      body = String(arg);
      if (conv === 's' && prec >= 0) body = body.slice(0, prec);
      canZero = false;
    } else if (conv === 'd' || conv === 'i' || conv === 'x' || conv === 'X' || conv === 'o') {
      let v = typeof arg === 'bigint' ? arg : BigInt(arg as number);
      if (v < 0n) {
        sign = '-';
        v = -v;
      } else if (conv === 'd' || conv === 'i') sign = plus ? '+' : space ? ' ' : '';
      body = conv === 'x' ? v.toString(16) : conv === 'X' ? v.toString(16).toUpperCase() : conv === 'o' ? v.toString(8) : v.toString();
      if (prec >= 0) {
        if (prec === 0 && v === 0n) body = '';
        body = body.padStart(prec, '0');
        canZero = false;
      }
      if (alt) {
        if (conv === 'o') {
          if (body[0] !== '0') body = '0' + body;
        } else if ((conv === 'x' || conv === 'X') && v !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      }
    } else {
      const n = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      const neg = n < 0 || Object.is(n, -0);
      if (Number.isNaN(n)) {
        body = upper ? 'NAN' : 'nan';
        canZero = false;
      } else {
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        const x = Math.abs(n);
        if (x === Infinity) {
          body = upper ? 'INF' : 'inf';
          canZero = false;
        } else if (conv === 'f' || conv === 'F') {
          body = fixedStr(x, prec < 0 ? 6 : prec, alt);
        } else if (conv === 'e' || conv === 'E') {
          body = expStr(x, prec < 0 ? 6 : prec, alt, upper);
        } else {
          const P = prec < 0 ? 6 : prec === 0 ? 1 : prec;
          const X = x === 0 ? 0 : eDigits(x, P - 1).exp;
          if (P > X && X >= -4) {
            body = fixedStr(x, P - 1 - X, alt);
            if (!alt) body = stripZeros(body);
          } else {
            body = expStr(x, P - 1, alt, upper);
            if (!alt) {
              const k = body.search(/[eE]/);
              body = stripZeros(body.slice(0, k)) + body.slice(k);
            }
          }
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
