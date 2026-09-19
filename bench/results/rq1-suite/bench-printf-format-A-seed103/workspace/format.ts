function decompose(v: number): [bigint, number] {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, v);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  let mant = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (expBits === 0) return [mant, -1074];
  mant |= 1n << 52n;
  return [mant, expBits - 1075];
}

// round-half-even of m * 2^e * 10^s
function roundScaled(m: bigint, e: number, s: number): bigint {
  let num = m;
  let den = 1n;
  if (e >= 0) num <<= BigInt(e);
  else den <<= BigInt(-e);
  if (s >= 0) num *= 10n ** BigInt(s);
  else den *= 10n ** BigInt(-s);
  const q = num / den;
  const r = num - q * den;
  const twice = r * 2n;
  if (twice > den || (twice === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// returns digit string (p+1 digits) and decimal exponent
function expStyle(v: number, p: number): [string, number] {
  if (v === 0) return ['0'.repeat(p + 1), 0];
  const [m, e] = decompose(v);
  let k = Math.floor(Math.log10(v));
  const lo = 10n ** BigInt(p);
  const hi = lo * 10n;
  for (let i = 0; i < 100; i++) {
    const n = roundScaled(m, e, p - k);
    if (n >= hi) k++;
    else if (n < lo) k--;
    else return [n.toString(), k];
  }
  throw new Error('exp');
}

function fixedStyle(v: number, p: number): string {
  let n = 0n;
  if (v !== 0) {
    const [m, e] = decompose(v);
    n = roundScaled(m, e, p);
  }
  let s = n.toString();
  if (p > 0) {
    s = s.padStart(p + 1, '0');
    return s.slice(0, s.length - p) + '.' + s.slice(s.length - p);
  }
  return s;
}

function fmtExp(digits: string, x: number, upper: boolean, alt: boolean): string {
  const p = digits.length - 1;
  let s = digits[0];
  if (p > 0) s += '.' + digits.slice(1);
  else if (alt) s += '.';
  const ax = Math.abs(x);
  s += (upper ? 'E' : 'e') + (x < 0 ? '-' : '+') + (ax < 10 ? '0' : '') + ax;
  return s;
}

function stripZeros(s: string): string {
  if (!s.includes('.')) return s;
  s = s.replace(/0+$/, '');
  if (s.endsWith('.')) s = s.slice(0, -1);
  return s;
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
    while (i < fmt.length && fmt[i] >= '0' && fmt[i] <= '9') {
      width = width * 10 + (fmt.charCodeAt(i) - 48);
      i++;
    }
    let prec = -1;
    if (fmt[i] === '.') {
      i++;
      prec = 0;
      while (i < fmt.length && fmt[i] >= '0' && fmt[i] <= '9') {
        prec = prec * 10 + (fmt.charCodeAt(i) - 48);
        i++;
      }
    }
    const conv = fmt[i++];
    const arg = args[ai++];
    let sign = '';
    let prefix = '';
    let body = '';
    let canZero = true;
    const signFor = (neg: boolean) => (neg ? '-' : plus ? '+' : space ? ' ' : '');

    switch (conv) {
      case 'd':
      case 'i':
      case 'x':
      case 'X':
      case 'o': {
        const b = BigInt(arg as number | bigint);
        const neg = b < 0n;
        const mag = neg ? -b : b;
        if (conv === 'd' || conv === 'i') {
          sign = signFor(neg);
          body = mag.toString();
        } else {
          body = mag.toString(conv === 'o' ? 8 : 16);
          if (conv === 'X') body = body.toUpperCase();
        }
        if (prec === 0 && mag === 0n) body = '';
        if (prec >= 0) {
          body = body.padStart(prec, '0');
          canZero = false;
        }
        if (alt) {
          if (conv === 'o') {
            if (body[0] !== '0') body = '0' + body;
          } else if (conv !== 'd' && conv !== 'i' && mag !== 0n) {
            prefix = conv === 'x' ? '0x' : '0X';
          }
        }
        break;
      }
      case 'e':
      case 'E':
      case 'f':
      case 'F':
      case 'g':
      case 'G': {
        const v = arg as number;
        const upper = conv === 'E' || conv === 'F' || conv === 'G';
        if (Number.isNaN(v)) {
          body = upper ? 'NAN' : 'nan';
          canZero = false;
          break;
        }
        sign = signFor(v < 0 || Object.is(v, -0));
        const av = Math.abs(v);
        if (av === Infinity) {
          body = upper ? 'INF' : 'inf';
          canZero = false;
          break;
        }
        const lc = conv.toLowerCase();
        if (lc === 'e') {
          const [d, x] = expStyle(av, prec < 0 ? 6 : prec);
          body = fmtExp(d, x, upper, alt);
        } else if (lc === 'f') {
          const p = prec < 0 ? 6 : prec;
          body = fixedStyle(av, p);
          if (p === 0 && alt) body += '.';
        } else {
          const P = prec < 0 ? 6 : prec === 0 ? 1 : prec;
          const [d, x] = expStyle(av, P - 1);
          if (P > x && x >= -4) {
            body = fixedStyle(av, P - 1 - x);
            if (P - 1 - x === 0 && alt) body += '.';
            if (!alt) body = stripZeros(body);
          } else {
            let dd = d;
            if (!alt) {
              let t = d[0] + '.' + d.slice(1);
              t = stripZeros(t);
              dd = t.replace('.', '');
            }
            body = fmtExp(dd, x, upper, alt);
          }
        }
        break;
      }
      case 's': {
        body = arg as string;
        if (prec >= 0) body = body.slice(0, prec);
        canZero = false;
        break;
      }
      case 'c': {
        body = arg as string;
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
