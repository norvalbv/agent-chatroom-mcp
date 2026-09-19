const pow10 = (n: number): bigint => 10n ** BigInt(n);

// Exact rational of |x| (finite): num/den.
function exact(x: number): [bigint, bigint] {
  x = Math.abs(x);
  if (x === 0) return [0n, 1n];
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, x);
  const hi = buf.getUint32(0);
  const lo = buf.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  let mant = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let e: number;
  if (expBits === 0) e = -1074;
  else {
    mant |= 1n << 52n;
    e = expBits - 1075;
  }
  return e >= 0 ? [mant << BigInt(e), 1n] : [mant, 1n << BigInt(-e)];
}

function divHalfEven(n: bigint, d: bigint): bigint {
  const q = n / d;
  const r2 = (n % d) * 2n;
  if (r2 > d || (r2 === d && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// round(|x| * 10^k), half-even
function scaled(num: bigint, den: bigint, k: number): bigint {
  return k >= 0 ? divHalfEven(num * pow10(k), den) : divHalfEven(num, den * pow10(-k));
}

function fixedDigits(x: number, p: number): string {
  const [n, d] = exact(x);
  return scaled(n, d, p).toString();
}

// returns digit string of length p+1 and decimal exponent
function expDigits(x: number, p: number): [string, number] {
  const [n, d] = exact(x);
  if (n === 0n) return ['0'.repeat(p + 1), 0];
  // estimate exponent
  let e = Math.floor(Math.log10(Math.abs(x)));
  if (!isFinite(e)) e = -324;
  // adjust so 10^e <= x < 10^(e+1)
  const ge = (k: number) => (k >= 0 ? n >= pow10(k) * d : n * pow10(-k) >= d);
  while (!ge(e)) e--;
  while (ge(e + 1)) e++;
  let digs = scaled(n, d, p - e);
  if (digs >= pow10(p + 1)) {
    e++;
    digs = scaled(n, d, p - e);
  }
  return [digs.toString(), e];
}

function fmtF(x: number, p: number, alt: boolean): string {
  let s = fixedDigits(x, p);
  if (p > 0) {
    s = s.padStart(p + 1, '0');
    s = s.slice(0, s.length - p) + '.' + s.slice(s.length - p);
  } else if (alt) s += '.';
  return s;
}

function fmtE(x: number, p: number, alt: boolean, upper: boolean): string {
  const [digs, e] = expDigits(x, p);
  let s = digs[0];
  if (p > 0) s += '.' + digs.slice(1);
  else if (alt) s += '.';
  const ae = Math.abs(e);
  s += (upper ? 'E' : 'e') + (e < 0 ? '-' : '+') + (ae < 10 ? '0' + ae : String(ae));
  return s;
}

function stripZeros(s: string): string {
  const ei = s.search(/[eE]/);
  let mant = ei < 0 ? s : s.slice(0, ei);
  const rest = ei < 0 ? '' : s.slice(ei);
  if (mant.includes('.')) mant = mant.replace(/0+$/, '').replace(/\.$/, '');
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
      const v = typeof arg === 'bigint' ? arg : BigInt(arg as number);
      const neg = v < 0n;
      body = (neg ? -v : v).toString();
      if (prec >= 0) {
        if (prec === 0 && v === 0n) body = '';
        body = body.padStart(prec, '0');
        canZero = false;
      }
      sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
    } else if (lc === 'x' || conv === 'o') {
      const v = typeof arg === 'bigint' ? arg : BigInt(arg as number);
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
      if (Number.isNaN(x)) {
        body = upper ? 'NAN' : 'nan';
        canZero = false;
      } else {
        const neg = x < 0 || Object.is(x, -0);
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        if (!isFinite(x)) {
          body = upper ? 'INF' : 'inf';
          canZero = false;
        } else if (lc === 'f') {
          body = fmtF(x, prec < 0 ? 6 : prec, alt);
        } else if (lc === 'e') {
          body = fmtE(x, prec < 0 ? 6 : prec, alt, upper);
        } else {
          let P = prec < 0 ? 6 : prec;
          if (P === 0) P = 1;
          const X = expDigits(x, P - 1)[1];
          if (P > X && X >= -4) body = fmtF(x, P - 1 - X, alt);
          else body = fmtE(x, P - 1, alt, upper);
          if (!alt) body = stripZeros(body);
        }
      }
    }

    const len = sign.length + prefix.length + body.length;
    if (len < width) {
      const n = width - len;
      if (minus) body = sign + prefix + body + ' '.repeat(n);
      else if (zero && canZero && conv !== 's' && conv !== 'c') body = sign + prefix + '0'.repeat(n) + body;
      else body = ' '.repeat(n) + sign + prefix + body;
    } else body = sign + prefix + body;
    out += body;
  }
  return out;
}
