// round(num/den), half to even, for positive BigInts
function divRound(num: bigint, den: bigint): bigint {
  const q = num / den;
  const r2 = (num % den) * 2n;
  if (r2 > den || (r2 === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// Decompose finite non-negative double into m * 2^e exactly.
function decompose(v: number): [bigint, number] {
  if (v === 0) return [0n, 0];
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, v);
  const bits = buf.getBigUint64(0);
  const expBits = Number((bits >> 52n) & 0x7ffn);
  const frac = bits & ((1n << 52n) - 1n);
  if (expBits === 0) return [frac, -1074];
  return [frac | (1n << 52n), expBits - 1075];
}

// round(v * 10^k), half even, exact
function scaled(m: bigint, e: number, k: number): bigint {
  let num = m;
  let den = 1n;
  if (e >= 0) num <<= BigInt(e);
  else den <<= BigInt(-e);
  if (k >= 0) num *= 10n ** BigInt(k);
  else den *= 10n ** BigInt(-k);
  return divRound(num, den);
}

// Fixed style digits: returns integer part and fraction strings
function fixedDigits(v: number, p: number): string {
  const [m, e] = decompose(v);
  let s = scaled(m, e, p).toString();
  if (p > 0) {
    s = s.padStart(p + 1, '0');
    return s.slice(0, s.length - p) + '.' + s.slice(s.length - p);
  }
  return s;
}

// Exp style: returns [digits string of length p+1, exponent]
function expDigits(v: number, p: number): [string, number] {
  if (v === 0) return ['0'.repeat(p + 1), 0];
  const [m, e] = decompose(v);
  let x = Math.floor(Math.log10(v));
  if (!isFinite(x)) x = -324;
  for (let i = 0; i < 10; i++) {
    const n = scaled(m, e, p - x);
    const s = n.toString();
    if (s.length > p + 1) x++;
    else if (s.length < p + 1) x--;
    else return [s, x];
  }
  throw new Error('exp failed');
}

function expText(digits: string, x: number, hash: boolean, upper: boolean): string {
  let s = digits[0];
  if (digits.length > 1) s += '.' + digits.slice(1);
  else if (hash) s += '.';
  const ax = Math.abs(x);
  return s + (upper ? 'E' : 'e') + (x < 0 ? '-' : '+') + (ax < 10 ? '0' + ax : String(ax));
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
    let minus = false, plus = false, space = false, zero = false, hash = false;
    for (; i < fmt.length; i++) {
      const f = fmt[i];
      if (f === '-') minus = true;
      else if (f === '+') plus = true;
      else if (f === ' ') space = true;
      else if (f === '0') zero = true;
      else if (f === '#') hash = true;
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
    let canZero = zero && !minus;

    switch (conv) {
      case 'd':
      case 'i': {
        const n = BigInt(arg as number | bigint);
        const neg = n < 0n;
        let digits = (neg ? -n : n).toString();
        if (prec === 0 && n === 0n) digits = '';
        if (prec > digits.length) digits = digits.padStart(prec, '0');
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        body = digits;
        if (prec >= 0) canZero = false;
        break;
      }
      case 'x':
      case 'X':
      case 'o': {
        const n = BigInt(arg as number | bigint);
        let digits = n.toString(conv === 'o' ? 8 : 16);
        if (conv === 'X') digits = digits.toUpperCase();
        if (prec === 0 && n === 0n) digits = '';
        if (prec > digits.length) digits = digits.padStart(prec, '0');
        if (hash) {
          if (conv === 'o') {
            if (digits[0] !== '0') digits = '0' + digits;
          } else if (n !== 0n) prefix = conv === 'x' ? '0x' : '0X';
        }
        body = digits;
        if (prec >= 0) canZero = false;
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
        const neg = v < 0 || Object.is(v, -0);
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        if (!isFinite(v)) {
          body = upper ? 'INF' : 'inf';
          canZero = false;
          break;
        }
        const a = Math.abs(v);
        const lc = conv.toLowerCase();
        if (lc === 'f') {
          const p = prec < 0 ? 6 : prec;
          body = fixedDigits(a, p);
          if (p === 0 && hash) body += '.';
        } else if (lc === 'e') {
          const p = prec < 0 ? 6 : prec;
          const [d, x] = expDigits(a, p);
          body = expText(d, x, hash, upper && conv === 'E');
        } else {
          const P = prec < 0 ? 6 : prec === 0 ? 1 : prec;
          const [d, x] = expDigits(a, P - 1);
          const strip = (s: string) => {
            if (hash || !s.includes('.')) return s;
            return s.replace(/0+$/, '').replace(/\.$/, '');
          };
          if (P > x && x >= -4) {
            const p = P - 1 - x;
            body = fixedDigits(a, p);
            if (p === 0 && hash) body += '.';
            body = strip(body);
          } else {
            let mant = d[0];
            if (d.length > 1) mant += '.' + d.slice(1);
            else if (hash) mant += '.';
            mant = strip(mant);
            const ax = Math.abs(x);
            body = mant + (upper ? 'E' : 'e') + (x < 0 ? '-' : '+') + (ax < 10 ? '0' + ax : String(ax));
          }
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
    else if (canZero) out += sign + prefix + '0'.repeat(width - len) + body;
    else out += ' '.repeat(width - len) + sign + prefix + body;
  }
  return out;
}
