// Exact value of a finite non-negative double as num / den (den is a power of 2).
function toFraction(x: number): [bigint, bigint] {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
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

// round(n / d) to nearest, ties to even.
function roundDiv(n: bigint, d: bigint): bigint {
  const q = n / d;
  const r2 = (n - q * d) * 2n;
  if (r2 > d || (r2 === d && (q & 1n) === 1n)) return q + 1n;
  return q;
}

const pow10 = (k: number): bigint => 10n ** BigInt(k);

// Fixed notation of a non-negative finite number with p fractional digits.
function fixedDigits(x: number, p: number, alt: boolean): string {
  const [n, d] = toFraction(x);
  let s = roundDiv(n * pow10(p), d).toString();
  if (s.length < p + 1) s = '0'.repeat(p + 1 - s.length) + s;
  if (p === 0) return alt ? s + '.' : s;
  return s.slice(0, s.length - p) + '.' + s.slice(s.length - p);
}

// Scientific notation pieces: digit string of length p+1 and decimal exponent.
function expDigits(x: number, p: number): [string, number] {
  if (x === 0) return ['0'.repeat(p + 1), 0];
  const [n, d] = toFraction(x);
  let e = Math.floor(Math.log10(x));
  if (!isFinite(e)) e = 0;
  // adjust so that 10^e <= x < 10^(e+1) exactly
  const ge = (k: number): boolean => (k >= 0 ? n >= pow10(k) * d : n * pow10(-k) >= d);
  while (!ge(e)) e--;
  while (ge(e + 1)) e++;
  const sh = p - e;
  let m = sh >= 0 ? roundDiv(n * pow10(sh), d) : roundDiv(n, d * pow10(-sh));
  if (m >= pow10(p + 1)) {
    e++;
    m = m / 10n;
  }
  return [m.toString(), e];
}

function expStyle(digits: string, e: number, upper: boolean, alt: boolean): string {
  const p = digits.length - 1;
  let s = digits[0];
  if (p > 0) s += '.' + digits.slice(1);
  else if (alt) s += '.';
  const ae = Math.abs(e);
  return s + (upper ? 'E' : 'e') + (e < 0 ? '-' : '+') + (ae < 10 ? '0' + ae : String(ae));
}

function stripZeros(s: string): string {
  if (s.indexOf('.') < 0) return s;
  s = s.replace(/0+$/, '');
  return s.endsWith('.') ? s.slice(0, -1) : s;
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let out = '';
  let ai = 0;
  let i = 0;
  const n = fmt.length;
  while (i < n) {
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
      const c = fmt[i];
      if (c === '-') minus = true;
      else if (c === '+') plus = true;
      else if (c === ' ') space = true;
      else if (c === '0') zero = true;
      else if (c === '#') alt = true;
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
    let canZero = false;

    if (conv === 's' || conv === 'c') {
      body = String(arg);
      if (conv === 's' && prec >= 0) body = body.slice(0, prec);
    } else if (conv === 'd' || conv === 'i') {
      const v = BigInt(arg as number | bigint);
      sign = v < 0n ? '-' : plus ? '+' : space ? ' ' : '';
      body = (v < 0n ? -v : v).toString();
      if (prec === 0 && v === 0n) body = '';
      if (prec > body.length) body = '0'.repeat(prec - body.length) + body;
      canZero = prec < 0;
    } else if (conv === 'x' || conv === 'X' || conv === 'o') {
      const v = BigInt(arg as number | bigint);
      body = v.toString(conv === 'o' ? 8 : 16);
      if (conv === 'X') body = body.toUpperCase();
      if (prec === 0 && v === 0n) body = '';
      if (prec > body.length) body = '0'.repeat(prec - body.length) + body;
      if (alt) {
        if (conv === 'o') {
          if (body[0] !== '0') body = '0' + body;
        } else if (v !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      }
      canZero = prec < 0;
    } else {
      const v = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      const isNaNv = Number.isNaN(v);
      const neg = !isNaNv && (v < 0 || Object.is(v, -0));
      sign = neg ? '-' : isNaNv ? '' : plus ? '+' : space ? ' ' : '';
      if (isNaNv || !isFinite(v)) {
        body = isNaNv ? 'nan' : 'inf';
        if (upper) body = body.toUpperCase();
      } else {
        const x = Math.abs(v);
        const lc = conv.toLowerCase();
        if (lc === 'f') {
          body = fixedDigits(x, prec < 0 ? 6 : prec, alt);
        } else if (lc === 'e') {
          const [dg, e] = expDigits(x, prec < 0 ? 6 : prec);
          body = expStyle(dg, e, upper, alt);
        } else {
          const P = prec < 0 ? 6 : prec === 0 ? 1 : prec;
          const [dg, X] = expDigits(x, P - 1);
          if (P > X && X >= -4) {
            body = fixedDigits(x, P - 1 - X, alt);
            if (!alt) body = stripZeros(body);
          } else {
            let mant = expStyle(dg, X, upper, alt);
            if (!alt) {
              const k = mant.search(/[eE]/);
              mant = stripZeros(mant.slice(0, k)) + mant.slice(k);
            }
            body = mant;
          }
        }
        canZero = true;
      }
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
