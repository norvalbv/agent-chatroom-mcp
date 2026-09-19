function roundDiv(num: bigint, den: bigint): bigint {
  const q = num / den;
  const r = num - q * den;
  const twice = r * 2n;
  if (twice > den || (twice === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// |x| decomposed as m * 2^e
function decompose(x: number): [bigint, number] {
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, Math.abs(x));
  const bits = buf.getBigUint64(0);
  const expBits = Number((bits >> 52n) & 0x7ffn);
  const frac = bits & ((1n << 52n) - 1n);
  if (expBits === 0) return [frac, -1074];
  return [frac | (1n << 52n), expBits - 1075];
}

// round(|x| * 10^k), half-even, exact
function scaled(x: number, k: number): bigint {
  const [m, e] = decompose(x);
  let num = m;
  let den = 1n;
  if (e > 0) num <<= BigInt(e);
  else den <<= BigInt(-e);
  if (k > 0) num *= 10n ** BigInt(k);
  else if (k < 0) den *= 10n ** BigInt(-k);
  return roundDiv(num, den);
}

// digits (P of them) and decimal exponent of |x| (x != 0) in e style
function eDigits(x: number, P: number): [string, number] {
  let e10 = Math.floor(Math.log10(Math.abs(x)));
  if (!isFinite(e10)) e10 = -324;
  const lo = 10n ** BigInt(P - 1);
  const hi = 10n ** BigInt(P);
  for (let i = 0; i < 8; i++) {
    const d = scaled(x, P - 1 - e10);
    if (d >= hi) e10++;
    else if (d < lo) e10--;
    else return [d.toString(), e10];
  }
  throw new Error('eDigits failed');
}

function fixedStr(x: number, p: number, alt: boolean): string {
  let d = scaled(x, p).toString();
  if (p === 0) return alt ? d + '.' : d;
  if (d.length <= p) d = '0'.repeat(p - d.length + 1) + d;
  return d.slice(0, d.length - p) + '.' + d.slice(d.length - p);
}

function expStr(x: number, p: number, alt: boolean, upper: boolean): string {
  let digits: string;
  let e10: number;
  if (x === 0) {
    digits = '0'.repeat(p + 1);
    e10 = 0;
  } else [digits, e10] = eDigits(x, p + 1);
  let s = digits[0];
  if (p > 0) s += '.' + digits.slice(1);
  else if (alt) s += '.';
  const ae = Math.abs(e10);
  s += (upper ? 'E' : 'e') + (e10 < 0 ? '-' : '+') + (ae < 10 ? '0' + ae : String(ae));
  return s;
}

function stripZeros(s: string): string {
  if (!s.includes('.')) return s;
  return s.replace(/0+$/, '').replace(/\.$/, '');
}

function genStr(x: number, P: number, alt: boolean, upper: boolean): string {
  if (P === 0) P = 1;
  let X: number;
  if (x === 0) X = 0;
  else X = eDigits(x, P)[1];
  if (P > X && X >= -4) {
    const s = fixedStr(x, P - 1 - X, alt);
    return alt ? s : stripZeros(s);
  }
  const s = expStr(x, P - 1, alt, upper);
  if (alt) return s;
  const idx = s.search(/[eE]/);
  return stripZeros(s.slice(0, idx)) + s.slice(idx);
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
    for (; i < n; i++) {
      const f = fmt[i];
      if (f === '-') minus = true;
      else if (f === '+') plus = true;
      else if (f === ' ') space = true;
      else if (f === '0') zero = true;
      else if (f === '#') alt = true;
      else break;
    }
    let width = 0;
    while (i < n && fmt[i] >= '0' && fmt[i] <= '9') width = width * 10 + (fmt.charCodeAt(i++) - 48);
    let prec = -1;
    if (fmt[i] === '.') {
      i++;
      prec = 0;
      while (i < n && fmt[i] >= '0' && fmt[i] <= '9') prec = prec * 10 + (fmt.charCodeAt(i++) - 48);
    }
    const conv = fmt[i++];
    const arg = args[ai++];
    let sign = '';
    let prefix = '';
    let body = '';
    let canZero = true;
    switch (conv) {
      case 'd':
      case 'i': {
        const v = typeof arg === 'bigint' ? arg : BigInt(arg as number);
        const neg = v < 0n;
        body = (neg ? -v : v).toString();
        if (prec >= 0) {
          if (prec === 0 && v === 0n) body = '';
          else body = body.padStart(prec, '0');
          canZero = false;
        }
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        break;
      }
      case 'x':
      case 'X':
      case 'o': {
        const v = typeof arg === 'bigint' ? arg : BigInt(arg as number);
        body = v.toString(conv === 'o' ? 8 : 16);
        if (conv === 'X') body = body.toUpperCase();
        if (prec >= 0) {
          if (prec === 0 && v === 0n) body = '';
          else body = body.padStart(prec, '0');
          canZero = false;
        }
        if (alt) {
          if (conv === 'o') {
            if (body[0] !== '0') body = '0' + body;
          } else if (v !== 0n) prefix = conv === 'x' ? '0x' : '0X';
        }
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
        sign = Number.isNaN(x) ? '' : neg ? '-' : plus ? '+' : space ? ' ' : '';
        if (!isFinite(x)) {
          body = Number.isNaN(x) ? 'nan' : 'inf';
          if (upper) body = body.toUpperCase();
          canZero = false;
        } else {
          const p = prec < 0 ? 6 : prec;
          const lc = conv.toLowerCase();
          if (lc === 'f') body = fixedStr(x, p, alt);
          else if (lc === 'e') body = expStr(x, p, alt, upper);
          else body = genStr(x, p, alt, upper);
        }
        break;
      }
      case 's': {
        body = String(arg);
        if (prec >= 0) body = body.slice(0, prec);
        canZero = false;
        break;
      }
      case 'c': {
        body = String(arg);
        canZero = false;
        break;
      }
      default:
        throw new Error('bad conversion');
    }
    const len = sign.length + prefix.length + body.length;
    if (len >= width) out += sign + prefix + body;
    else if (minus) out += sign + prefix + body + ' '.repeat(width - len);
    else if (zero && canZero) out += sign + prefix + '0'.repeat(width - len) + body;
    else out += ' '.repeat(width - len) + sign + prefix + body;
  }
  return out;
}
