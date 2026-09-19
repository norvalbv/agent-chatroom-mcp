const pow10 = (n: number): bigint => 10n ** BigInt(n);

// Decompose a finite non-negative double into m * 2^e exactly.
function decompose(x: number): [bigint, number] {
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, x);
  const hi = buf.getUint32(0);
  const lo = buf.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  let mant = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (expBits === 0) return [mant, -1074];
  mant |= 1n << 52n;
  return [mant, expBits - 1075];
}

// round-half-even of x * 10^k, exactly.
function roundScaled(x: number, k: number): bigint {
  const [m, e] = decompose(x);
  let num = m;
  let den = 1n;
  if (e >= 0) num <<= BigInt(e);
  else den <<= BigInt(-e);
  if (k >= 0) num *= pow10(k);
  else den *= pow10(-k);
  const q = num / den;
  const r2 = (num % den) * 2n;
  if (r2 > den || (r2 === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

function fixedDigits(x: number, prec: number, alt: boolean): string {
  let s = roundScaled(x, prec).toString();
  if (prec === 0) return alt ? s + '.' : s;
  if (s.length <= prec) s = '0'.repeat(prec - s.length + 1) + s;
  return s.slice(0, s.length - prec) + '.' + s.slice(s.length - prec);
}

// digits (p+1 of them) and decimal exponent for e style
function expParts(x: number, p: number): [string, number] {
  if (x === 0) return ['0'.repeat(p + 1), 0];
  let X = Math.floor(Math.log10(x));
  if (!isFinite(X)) X = -324;
  for (let i = 0; i < 10; i++) {
    const n = roundScaled(x, p - X);
    const s = n.toString();
    if (s.length > p + 1) X++;
    else if (s.length < p + 1) X--;
    else return [s, X];
  }
  throw new Error('exp');
}

function expStyle(x: number, p: number, alt: boolean, upper: boolean): string {
  const [d, X] = expParts(x, p);
  let out = d[0];
  if (p > 0) out += '.' + d.slice(1);
  else if (alt) out += '.';
  const ax = Math.abs(X);
  out += (upper ? 'E' : 'e') + (X < 0 ? '-' : '+') + (ax < 10 ? '0' : '') + ax;
  return out;
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
    let left = false, plus = false, space = false, zero = false, alt = false;
    for (; i < fmt.length; i++) {
      const f = fmt[i];
      if (f === '-') left = true;
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
    let body = '';
    let canZero = false;

    switch (conv) {
      case 'd':
      case 'i': {
        const v = typeof arg === 'bigint' ? arg : BigInt(arg as number);
        const neg = v < 0n;
        let digits = (neg ? -v : v).toString();
        if (prec === 0 && v === 0n) digits = '';
        if (prec > digits.length) digits = '0'.repeat(prec - digits.length) + digits;
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        body = digits;
        canZero = prec < 0;
        break;
      }
      case 'x':
      case 'X':
      case 'o': {
        const v = typeof arg === 'bigint' ? arg : BigInt(arg as number);
        let digits = v.toString(conv === 'o' ? 8 : 16);
        if (conv === 'X') digits = digits.toUpperCase();
        if (prec === 0 && v === 0n) digits = '';
        if (prec > digits.length) digits = '0'.repeat(prec - digits.length) + digits;
        if (alt) {
          if (conv === 'o') {
            if (digits[0] !== '0') digits = '0' + digits;
          } else if (v !== 0n) prefix = conv === 'x' ? '0x' : '0X';
        }
        body = digits;
        canZero = prec < 0;
        break;
      }
      case 'e': case 'E': case 'f': case 'F': case 'g': case 'G': {
        const x = arg as number;
        const upper = conv === 'E' || conv === 'F' || conv === 'G';
        if (Number.isNaN(x)) {
          body = upper ? 'NAN' : 'nan';
          break;
        }
        const negBit = x < 0 || Object.is(x, -0);
        sign = negBit ? '-' : plus ? '+' : space ? ' ' : '';
        if (!isFinite(x)) {
          body = upper ? 'INF' : 'inf';
          break;
        }
        canZero = true;
        const ax = Math.abs(x);
        const lc = conv.toLowerCase();
        if (lc === 'f') {
          body = fixedDigits(ax, prec < 0 ? 6 : prec, alt);
        } else if (lc === 'e') {
          body = expStyle(ax, prec < 0 ? 6 : prec, alt, upper);
        } else {
          let P = prec < 0 ? 6 : prec;
          if (P === 0) P = 1;
          const X = expParts(ax, P - 1)[1];
          if (P > X && X >= -4) {
            body = fixedDigits(ax, P - 1 - X, alt);
            if (!alt) body = stripZeros(body);
          } else {
            body = expStyle(ax, P - 1, alt, upper);
            if (!alt) {
              const ei = body.search(/[eE]/);
              body = stripZeros(body.slice(0, ei)) + body.slice(ei);
            }
          }
        }
        break;
      }
      case 's': {
        body = String(arg);
        if (prec >= 0) body = body.slice(0, prec);
        break;
      }
      case 'c':
        body = String(arg);
        break;
      default:
        throw new Error('bad conversion');
    }

    const len = sign.length + prefix.length + body.length;
    if (len >= width) out += sign + prefix + body;
    else if (left) out += sign + prefix + body + ' '.repeat(width - len);
    else if (zero && canZero) out += sign + prefix + '0'.repeat(width - len) + body;
    else out += ' '.repeat(width - len) + sign + prefix + body;
  }
  return out;
}
