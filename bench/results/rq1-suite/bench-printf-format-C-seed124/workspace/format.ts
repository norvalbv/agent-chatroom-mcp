function decompose(x: number): { m: bigint; e: number } {
  // x finite, >= 0; value = m * 2^e
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (expBits === 0) return { m, e: -1074 };
  m |= 1n << 52n;
  return { m, e: expBits - 1075 };
}

// round-half-even(x * 10^k) as BigInt, x finite >= 0
function scaled(x: number, k: number): bigint {
  const { m, e } = decompose(x);
  let num = m;
  let den = 1n;
  if (e >= 0) num <<= BigInt(e);
  else den <<= BigInt(-e);
  if (k >= 0) num *= 10n ** BigInt(k);
  else den *= 10n ** BigInt(-k);
  let q = num / den;
  const r = num % den;
  const c = r * 2n;
  if (c > den || (c === den && (q & 1n) === 1n)) q += 1n;
  return q;
}

function fixedStr(x: number, prec: number, alt: boolean): string {
  const n = scaled(x, prec);
  let s = n.toString();
  if (prec > 0) {
    s = s.padStart(prec + 1, '0');
    s = s.slice(0, s.length - prec) + '.' + s.slice(s.length - prec);
  } else if (alt) s += '.';
  return s;
}

// digits (prec+1 of them) and decimal exponent
function sciParts(x: number, prec: number): { digits: string; exp: number } {
  if (x === 0) return { digits: '0'.repeat(prec + 1), exp: 0 };
  let E = Math.floor(Math.log10(x));
  if (!Number.isFinite(E)) E = 0;
  const lo = 10n ** BigInt(prec);
  const hi = lo * 10n;
  for (let i = 0; i < 10; i++) {
    const n = scaled(x, prec - E);
    if (n >= hi) E++;
    else if (n < lo) E--;
    else return { digits: n.toString(), exp: E };
  }
  throw new Error('exponent search failed');
}

function expStr(exp: number, upper: boolean): string {
  const a = Math.abs(exp).toString().padStart(2, '0');
  return (upper ? 'E' : 'e') + (exp < 0 ? '-' : '+') + a;
}

function sciStr(x: number, prec: number, alt: boolean, upper: boolean): string {
  const { digits, exp } = sciParts(x, prec);
  let s = digits[0];
  if (prec > 0) s += '.' + digits.slice(1);
  else if (alt) s += '.';
  return s + expStr(exp, upper);
}

function stripZeros(s: string): string {
  if (!s.includes('.')) return s;
  return s.replace(/0+$/, '').replace(/\.$/, '');
}

function genStr(x: number, precIn: number, alt: boolean, upper: boolean): string {
  const P = precIn === 0 ? 1 : precIn;
  const { exp: X } = sciParts(x, P - 1);
  if (P > X && X >= -4) {
    let s = fixedStr(x, P - 1 - X, alt);
    if (!alt) s = stripZeros(s);
    return s;
  }
  const { digits, exp } = sciParts(x, P - 1);
  let mant = digits[0];
  if (P - 1 > 0) mant += '.' + digits.slice(1);
  else if (alt) mant += '.';
  if (!alt) mant = stripZeros(mant);
  return mant + expStr(exp, upper);
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
    while (i < fmt.length && fmt[i] >= '0' && fmt[i] <= '9') width = width * 10 + (fmt.charCodeAt(i++) - 48);
    let prec = -1;
    if (fmt[i] === '.') {
      i++;
      prec = 0;
      while (i < fmt.length && fmt[i] >= '0' && fmt[i] <= '9') prec = prec * 10 + (fmt.charCodeAt(i++) - 48);
    }
    const conv = fmt[i++];
    const arg = args[ai++];

    let sign = '';
    let prefix = '';
    let body = '';
    let numeric = true;
    let allowZero = zero && !minus;

    switch (conv) {
      case 'd':
      case 'i': {
        const v = typeof arg === 'bigint' ? arg : BigInt(arg as number);
        const neg = v < 0n;
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        body = (neg ? -v : v).toString();
        if (prec === 0 && v === 0n) body = '';
        if (prec >= 0) {
          body = body.padStart(prec, '0');
          allowZero = false;
        }
        break;
      }
      case 'x':
      case 'X':
      case 'o': {
        const v = typeof arg === 'bigint' ? arg : BigInt(arg as number);
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
        const isNaNv = Number.isNaN(x);
        const neg = !isNaNv && (x < 0 || Object.is(x, -0));
        sign = isNaNv ? '' : neg ? '-' : plus ? '+' : space ? ' ' : '';
        if (isNaNv || !Number.isFinite(x)) {
          body = isNaNv ? 'nan' : 'inf';
          if (upper) body = body.toUpperCase();
          allowZero = false;
          break;
        }
        const a = Math.abs(x);
        const p = prec < 0 ? 6 : prec;
        const lc = conv.toLowerCase();
        if (lc === 'f') body = fixedStr(a, p, alt);
        else if (lc === 'e') body = sciStr(a, p, alt, upper);
        else body = genStr(a, p, alt, upper);
        break;
      }
      case 's': {
        numeric = false;
        body = String(arg);
        if (prec >= 0) body = body.slice(0, prec);
        break;
      }
      case 'c': {
        numeric = false;
        body = String(arg);
        break;
      }
      default:
        throw new Error('bad conversion');
    }

    const len = sign.length + prefix.length + body.length;
    if (len >= width) out += sign + prefix + body;
    else if (minus) out += sign + prefix + body + ' '.repeat(width - len);
    else if (numeric && allowZero) out += sign + prefix + '0'.repeat(width - len) + body;
    else out += ' '.repeat(width - len) + sign + prefix + body;
  }
  return out;
}
