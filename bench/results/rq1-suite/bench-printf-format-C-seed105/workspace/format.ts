// Exact rational of a finite non-negative double: num / den, den a power of 2.
function exact(x: number): [bigint, bigint] {
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, x);
  const hi = buf.getUint32(0);
  const lo = buf.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  let mant = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let e: number;
  if (expBits === 0) {
    e = -1074;
  } else {
    mant |= 1n << 52n;
    e = expBits - 1075;
  }
  return e >= 0 ? [mant << BigInt(e), 1n] : [mant, 1n << BigInt(-e)];
}

// round-half-even of (num/den) * 10^k
function scaled(num: bigint, den: bigint, k: number): bigint {
  let n = num;
  let d = den;
  if (k >= 0) n *= 10n ** BigInt(k);
  else d *= 10n ** BigInt(-k);
  const q = n / d;
  const r = n - q * d;
  const twice = r * 2n;
  if (twice > d || (twice === d && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// digits (p+1 sig digits) and decimal exponent for e-style
function eDigits(x: number, p: number): [string, number] {
  if (x === 0) return ['0'.repeat(p + 1), 0];
  const [num, den] = exact(x);
  let e = Math.floor(Math.log10(x));
  if (!isFinite(e)) e = -324;
  const lo = 10n ** BigInt(p);
  const hi = lo * 10n;
  for (;;) {
    const n = scaled(num, den, p - e);
    if (n >= hi) e++;
    else if (n < lo) e--;
    else return [n.toString(), e];
  }
}

function fDigits(x: number, p: number): string {
  const [num, den] = exact(x);
  let s = scaled(num, den, p).toString();
  if (p > 0) {
    if (s.length <= p) s = '0'.repeat(p + 1 - s.length) + s;
    return s.slice(0, s.length - p) + '.' + s.slice(s.length - p);
  }
  return s;
}

function expStr(e: number, upper: boolean): string {
  const a = Math.abs(e).toString().padStart(2, '0');
  return (upper ? 'E' : 'e') + (e < 0 ? '-' : '+') + a;
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
    while (fmt[i] >= '0' && fmt[i] <= '9') width = width * 10 + (fmt.charCodeAt(i++) - 48);
    let prec = -1;
    if (fmt[i] === '.') {
      i++;
      prec = 0;
      while (fmt[i] >= '0' && fmt[i] <= '9') prec = prec * 10 + (fmt.charCodeAt(i++) - 48);
    }
    const conv = fmt[i++];
    const arg = args[ai++];

    let sign = '';
    let prefix = '';
    let body = '';
    let canZero = true;

    if (conv === 's' || conv === 'c') {
      body = String(arg);
      if (conv === 's' && prec >= 0) body = body.slice(0, prec);
      canZero = false;
    } else if (conv === 'd' || conv === 'i') {
      const v = BigInt(arg as number | bigint);
      sign = v < 0n ? '-' : plus ? '+' : space ? ' ' : '';
      body = v < 0n ? (-v).toString() : v.toString();
      if (prec >= 0) {
        if (prec === 0 && v === 0n) body = '';
        body = body.padStart(prec, '0');
        canZero = false;
      }
    } else if (conv === 'x' || conv === 'X' || conv === 'o') {
      const v = BigInt(arg as number | bigint);
      body = v.toString(conv === 'o' ? 8 : 16);
      if (conv === 'X') body = body.toUpperCase();
      if (prec >= 0) {
        if (prec === 0 && v === 0n) body = '';
        body = body.padStart(prec, '0');
        canZero = false;
      }
      if (alt) {
        if (conv === 'o') {
          if (body[0] !== '0') body = '0' + body;
        } else if (v !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      }
    } else {
      const x = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      const neg = x < 0 || Object.is(x, -0);
      if (Number.isNaN(x)) {
        body = upper ? 'NAN' : 'nan';
        canZero = false;
      } else {
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        const a = Math.abs(x);
        if (a === Infinity) {
          body = upper ? 'INF' : 'inf';
          canZero = false;
        } else if (conv === 'f' || conv === 'F') {
          const p = prec < 0 ? 6 : prec;
          body = fDigits(a, p);
          if (p === 0 && alt) body += '.';
        } else if (conv === 'e' || conv === 'E') {
          const p = prec < 0 ? 6 : prec;
          const [d, e] = eDigits(a, p);
          body = d[0] + (p > 0 ? '.' + d.slice(1) : alt ? '.' : '') + expStr(e, upper);
        } else {
          const P = prec < 0 ? 6 : prec === 0 ? 1 : prec;
          const [d, X] = eDigits(a, P - 1);
          if (P > X && X >= -4) {
            body = fDigits(a, P - 1 - X);
            if (P - 1 - X === 0 && alt) body += '.';
            if (!alt && body.includes('.')) body = body.replace(/0+$/, '').replace(/\.$/, '');
          } else {
            let m = d[0] + (P > 1 ? '.' + d.slice(1) : alt ? '.' : '');
            if (!alt && m.includes('.')) m = m.replace(/0+$/, '').replace(/\.$/, '');
            body = m + expStr(X, upper);
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
