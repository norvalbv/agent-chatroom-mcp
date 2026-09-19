function decompose(x: number): [bigint, number] {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, Math.abs(x));
  const bits = dv.getBigUint64(0);
  const expBits = Number((bits >> 52n) & 0x7ffn);
  const frac = bits & ((1n << 52n) - 1n);
  if (expBits === 0) return [frac, -1074];
  return [frac | (1n << 52n), expBits - 1075];
}

// round(|x| * 10^k) to nearest integer, ties to even, using the exact value
function roundScaled(x: number, k: number): bigint {
  const [m, e] = decompose(x);
  let num = m;
  let den = 1n;
  if (e > 0) num <<= BigInt(e);
  else den <<= BigInt(-e);
  if (k > 0) num *= 10n ** BigInt(k);
  else if (k < 0) den *= 10n ** BigInt(-k);
  const q = num / den;
  const r = num % den;
  const twice = 2n * r;
  if (twice > den || (twice === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

function fixed(x: number, p: number, alt: boolean): string {
  let s = roundScaled(x, p).toString();
  if (s.length < p + 1) s = '0'.repeat(p + 1 - s.length) + s;
  const ip = s.slice(0, s.length - p);
  const fp = s.slice(s.length - p);
  return p > 0 ? ip + '.' + fp : alt ? ip + '.' : ip;
}

function sci(x: number, p: number): [string, number] {
  if (x === 0) return ['0'.repeat(p + 1), 0];
  let E = Math.floor(Math.log10(Math.abs(x)));
  const hi = 10n ** BigInt(p + 1);
  const lo = 10n ** BigInt(p);
  for (let i = 0; i < 10; i++) {
    const N = roundScaled(x, p - E);
    if (N >= hi) E++;
    else if (N < lo) E--;
    else return [N.toString(), E];
  }
  throw new Error('sci failed');
}

function expStyle(x: number, p: number, alt: boolean, upper: boolean): string {
  const [d, E] = sci(x, p);
  let m = d[0];
  if (p > 0) m += '.' + d.slice(1);
  else if (alt) m += '.';
  const ae = Math.abs(E);
  return m + (upper ? 'E' : 'e') + (E < 0 ? '-' : '+') + (ae < 10 ? '0' + ae : String(ae));
}

function stripZeros(s: string): string {
  // s is either fixed style or mantissa[e...]
  const ei = s.search(/[eE]/);
  const mant = ei >= 0 ? s.slice(0, ei) : s;
  const rest = ei >= 0 ? s.slice(ei) : '';
  if (!mant.includes('.')) return s;
  return mant.replace(/0+$/, '').replace(/\.$/, '') + rest;
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
    let prec: number | undefined;
    if (fmt[i] === '.') {
      i++;
      prec = 0;
      while (i < fmt.length && fmt[i] >= '0' && fmt[i] <= '9') prec = prec * 10 + Number(fmt[i++]);
    }
    const conv = fmt[i++];
    const arg = args[ai++];

    let sign = '';
    let prefix = '';
    let digits = '';
    let numeric = true;
    let allowZero = true;
    const signOf = (neg: boolean) => (neg ? '-' : plus ? '+' : space ? ' ' : '');

    switch (conv) {
      case 'd':
      case 'i':
      case 'x':
      case 'X':
      case 'o': {
        const v = BigInt(arg as number | bigint);
        const neg = v < 0n;
        const mag = neg ? -v : v;
        if (conv === 'd' || conv === 'i') sign = signOf(neg);
        const base = conv === 'o' ? 8 : conv === 'd' || conv === 'i' ? 10 : 16;
        digits = mag === 0n && prec === 0 ? '' : mag.toString(base);
        if (conv === 'X') digits = digits.toUpperCase();
        if (prec !== undefined && digits.length < prec) digits = '0'.repeat(prec - digits.length) + digits;
        if (alt) {
          if (conv === 'o') {
            if (digits[0] !== '0') digits = '0' + digits;
          } else if ((conv === 'x' || conv === 'X') && mag !== 0n) prefix = conv === 'x' ? '0x' : '0X';
        }
        if (prec !== undefined) allowZero = false;
        break;
      }
      case 'e':
      case 'E':
      case 'f':
      case 'F':
      case 'g':
      case 'G': {
        const x = arg as number;
        const upper = conv === 'E' || conv === 'F' || conv === 'G';
        const neg = x < 0 || Object.is(x, -0);
        if (Number.isNaN(x)) {
          digits = 'nan';
          allowZero = false;
        } else {
          sign = signOf(neg);
          if (!Number.isFinite(x)) {
            digits = 'inf';
            allowZero = false;
          } else {
            const lc = conv.toLowerCase();
            if (lc === 'f') digits = fixed(x, prec ?? 6, alt);
            else if (lc === 'e') digits = expStyle(x, prec ?? 6, alt, upper);
            else {
              const P = prec === undefined ? 6 : prec === 0 ? 1 : prec;
              const X = sci(x, P - 1)[1];
              if (P > X && X >= -4) digits = fixed(x, P - 1 - X, alt);
              else digits = expStyle(x, P - 1, alt, upper);
              if (!alt) digits = stripZeros(digits);
            }
          }
        }
        if (upper) digits = digits.toUpperCase();
        break;
      }
      case 's':
        numeric = false;
        digits = String(arg);
        if (prec !== undefined) digits = digits.slice(0, prec);
        break;
      case 'c':
        numeric = false;
        digits = String(arg)[0];
        break;
      default:
        throw new Error('bad conversion');
    }

    const len = sign.length + prefix.length + digits.length;
    let body: string;
    if (len >= width) body = sign + prefix + digits;
    else if (minus) body = sign + prefix + digits + ' '.repeat(width - len);
    else if (numeric && zero && allowZero) body = sign + prefix + '0'.repeat(width - len) + digits;
    else body = ' '.repeat(width - len) + sign + prefix + digits;
    out += body;
  }
  return out;
}
