function roundDiv(n: bigint, d: bigint): bigint {
  const q = n / d;
  const r2 = (n % d) * 2n;
  if (r2 > d || (r2 === d && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// exact rational of |x| as [num, den]
function ratio(x: number): [bigint, bigint] {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, Math.abs(x));
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let e: number;
  if (expBits === 0) e = -1074;
  else {
    m |= 1n << 52n;
    e = expBits - 1075;
  }
  return e >= 0 ? [m << BigInt(e), 1n] : [m, 1n << BigInt(-e)];
}

// round(|x| * 10^k) as integer
function scaled(x: number, k: number): bigint {
  const [n, d] = ratio(x);
  return k >= 0 ? roundDiv(n * 10n ** BigInt(k), d) : roundDiv(n, d * 10n ** BigInt(-k));
}

function fixed(x: number, prec: number, alt: boolean): string {
  let s = scaled(x, prec).toString();
  if (prec > 0) {
    s = s.padStart(prec + 1, '0');
    return s.slice(0, s.length - prec) + '.' + s.slice(s.length - prec);
  }
  return alt ? s + '.' : s;
}

// returns digits (prec+1 chars) and decimal exponent
function sci(x: number, prec: number): [string, number] {
  if (x === 0) return ['0'.repeat(prec + 1), 0];
  const [n, d] = ratio(x);
  let X = Math.floor(Math.log10(Math.abs(x)));
  if (!isFinite(X)) X = 0;
  const lo = 10n ** BigInt(prec);
  const hi = lo * 10n;
  for (let i = 0; i < 10; i++) {
    const k = prec - X;
    const v = k >= 0 ? roundDiv(n * 10n ** BigInt(k), d) : roundDiv(n, d * 10n ** BigInt(-k));
    if (v >= hi) X++;
    else if (v < lo) X--;
    else return [v.toString(), X];
  }
  throw new Error('sci failed');
}

function expStr(X: number, upper: boolean): string {
  const a = Math.abs(X).toString().padStart(2, '0');
  return (upper ? 'E' : 'e') + (X < 0 ? '-' : '+') + a;
}

function fmtE(x: number, prec: number, alt: boolean, upper: boolean): string {
  const [d, X] = sci(x, prec);
  const mant = prec > 0 ? d[0] + '.' + d.slice(1) : alt ? d + '.' : d;
  return mant + expStr(X, upper);
}

function stripZeros(s: string): string {
  if (!s.includes('.')) return s;
  s = s.replace(/0+$/, '');
  return s.endsWith('.') ? s.slice(0, -1) : s;
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
    let body: string;
    let canZero = true;
    const lower = conv.toLowerCase();

    if (conv === 's' || conv === 'c') {
      body = String(arg);
      if (conv === 's' && prec !== undefined) body = body.slice(0, prec);
      canZero = false;
    } else if (conv === 'd' || conv === 'i' || lower === 'x' || conv === 'o') {
      const v = BigInt(arg as number | bigint);
      const neg = v < 0n;
      const mag = neg ? -v : v;
      if (conv === 'd' || conv === 'i') sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
      const base = conv === 'o' ? 8 : lower === 'x' ? 16 : 10;
      let digits = mag.toString(base);
      if (conv === 'X') digits = digits.toUpperCase();
      if (prec !== undefined) {
        if (prec === 0 && mag === 0n) digits = '';
        digits = digits.padStart(prec, '0');
        canZero = false;
      }
      if (alt) {
        if (lower === 'x' && mag !== 0n) prefix = conv === 'x' ? '0x' : '0X';
        else if (conv === 'o' && !digits.startsWith('0')) digits = '0' + digits;
      }
      body = digits;
    } else {
      const x = arg as number;
      const neg = x < 0 || Object.is(x, -0);
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      if (!Number.isNaN(x)) sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
      if (!Number.isFinite(x)) {
        body = Number.isNaN(x) ? 'nan' : 'inf';
        if (upper) body = body.toUpperCase();
        canZero = false;
      } else {
        const p = prec === undefined ? 6 : prec;
        if (lower === 'f') body = fixed(x, p, alt);
        else if (lower === 'e') body = fmtE(x, p, alt, upper);
        else {
          const P = p === 0 ? 1 : p;
          const X = sci(x, P - 1)[1];
          if (P > X && X >= -4) {
            body = fixed(x, P - 1 - X, alt);
            if (!alt) body = stripZeros(body);
          } else {
            body = fmtE(x, P - 1, alt, upper);
            if (!alt) {
              const m = body.match(/^([^eE]*)([eE].*)$/)!;
              body = stripZeros(m[1]) + m[2];
            }
          }
        }
      }
    }

    const len = sign.length + prefix.length + body.length;
    if (len < width) {
      if (minus) body = body + ' '.repeat(width - len);
      else if (zero && canZero && conv !== 's' && conv !== 'c') body = '0'.repeat(width - len) + body;
      else sign = ' '.repeat(width - len) + sign;
    }
    out += sign + prefix + body;
  }
  return out;
}
