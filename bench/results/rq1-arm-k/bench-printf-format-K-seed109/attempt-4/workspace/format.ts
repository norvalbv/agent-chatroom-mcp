function decompose(v: number): [bigint, number] {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, v);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const ex = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (ex === 0) return [m, -1074];
  m |= 1n << 52n;
  return [m, ex - 1075];
}

// round-half-even of v * 10^k, v finite positive
function roundScaled(v: number, k: number): bigint {
  const [m, e] = decompose(v);
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

// digits (p+1 digits) and decimal exponent for e-style
function sci(v: number, p: number): [string, number] {
  if (v === 0) return ['0'.repeat(p + 1), 0];
  let X = Math.floor(Math.log10(v));
  if (!isFinite(X)) X = -324;
  const lowB = 10n ** BigInt(p);
  for (let i = 0; i < 20; i++) {
    const n = roundScaled(v, p - X);
    if (n < lowB) X--;
    else if (n >= lowB * 10n) X++;
    else return [n.toString(), X];
  }
  throw new Error('sci failed');
}

function fixed(v: number, p: number, alt: boolean): string {
  let s = roundScaled(v, p).toString();
  if (p > 0) {
    s = s.padStart(p + 1, '0');
    return s.slice(0, s.length - p) + '.' + s.slice(s.length - p);
  }
  return alt ? s + '.' : s;
}

function expStr(X: number, upper: boolean): string {
  const a = Math.abs(X).toString().padStart(2, '0');
  return (upper ? 'E' : 'e') + (X < 0 ? '-' : '+') + a;
}

function sciStr(v: number, p: number, alt: boolean, upper: boolean): string {
  const [d, X] = sci(v, p);
  let s = d[0];
  if (p > 0) s += '.' + d.slice(1);
  else if (alt) s += '.';
  return s + expStr(X, upper);
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
    let digits = '';
    let canZero = true;
    let text: string | null = null;

    switch (conv) {
      case 'd':
      case 'i': {
        const b = BigInt(arg as number | bigint);
        const neg = b < 0n;
        digits = (neg ? -b : b).toString();
        if (prec >= 0) {
          if (prec === 0 && b === 0n) digits = '';
          digits = digits.padStart(prec, '0');
          canZero = false;
        }
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        break;
      }
      case 'x':
      case 'X':
      case 'o': {
        const b = BigInt(arg as number | bigint);
        digits = b.toString(conv === 'o' ? 8 : 16);
        if (conv === 'X') digits = digits.toUpperCase();
        if (prec >= 0) {
          if (prec === 0 && b === 0n) digits = '';
          digits = digits.padStart(prec, '0');
          canZero = false;
        }
        if (alt) {
          if (conv === 'o') {
            if (digits[0] !== '0') digits = '0' + digits;
          } else if (b !== 0n) prefix = conv === 'x' ? '0x' : '0X';
        }
        break;
      }
      case 'e': case 'E': case 'f': case 'F': case 'g': case 'G': {
        const v = arg as number;
        const upper = conv === 'E' || conv === 'F' || conv === 'G';
        if (Number.isNaN(v)) {
          digits = upper ? 'NAN' : 'nan';
          canZero = false;
          break;
        }
        const negBit = v < 0 || Object.is(v, -0);
        sign = negBit ? '-' : plus ? '+' : space ? ' ' : '';
        const a = Math.abs(v);
        if (a === Infinity) {
          digits = upper ? 'INF' : 'inf';
          canZero = false;
          break;
        }
        const lc = conv.toLowerCase();
        if (lc === 'f') {
          digits = fixed(a, prec < 0 ? 6 : prec, alt);
        } else if (lc === 'e') {
          digits = sciStr(a, prec < 0 ? 6 : prec, alt, upper);
        } else {
          const P = prec < 0 ? 6 : prec === 0 ? 1 : prec;
          const [, X] = sci(a, P - 1);
          const strip = (s: string) => {
            if (alt || s.indexOf('.') < 0) return s;
            return s.replace(/0+$/, '').replace(/\.$/, '');
          };
          if (P > X && X >= -4) {
            digits = strip(fixed(a, P - 1 - X, alt));
          } else {
            const s = sciStr(a, P - 1, alt, upper);
            const ei = s.search(/[eE]/);
            digits = strip(s.slice(0, ei)) + s.slice(ei);
          }
        }
        break;
      }
      case 's': {
        text = String(arg);
        if (prec >= 0) text = text.slice(0, prec);
        break;
      }
      case 'c':
        text = String(arg);
        break;
      default:
        throw new Error('bad conversion');
    }

    if (text !== null) {
      if (text.length < width) text = minus ? text.padEnd(width) : text.padStart(width);
      out += text;
      continue;
    }
    const len = sign.length + prefix.length + digits.length;
    if (len >= width) out += sign + prefix + digits;
    else if (minus) out += (sign + prefix + digits).padEnd(width);
    else if (zero && canZero) out += sign + prefix + '0'.repeat(width - len) + digits;
    else out += ' '.repeat(width - len) + sign + prefix + digits;
  }
  return out;
}
