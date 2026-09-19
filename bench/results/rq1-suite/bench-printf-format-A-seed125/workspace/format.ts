// round(m * 2^e * 10^k) to nearest integer, ties to even; m >= 0n
function roundScaled(m: bigint, e: number, k: number): bigint {
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

function decompose(x: number): { m: bigint; e: number } {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const be = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (be === 0) return { m, e: -1074 };
  m |= 1n << 52n;
  return { m, e: be - 1075 };
}

// x finite, >= 0. Returns digits string (p+1 digits) and exponent
function expDigits(x: number, p: number): { digits: string; exp: number } {
  if (x === 0) return { digits: '0'.repeat(p + 1), exp: 0 };
  const { m, e } = decompose(x);
  let exp = Math.floor(Math.log10(x));
  if (!isFinite(exp)) exp = -324;
  const lo = 10n ** BigInt(p);
  const hi = lo * 10n;
  for (let i = 0; i < 20; i++) {
    const n = roundScaled(m, e, p - exp);
    if (n >= hi) {
      // may be genuine overflow from rounding or estimate too low
      const n2 = roundScaled(m, e, p - exp - 1);
      if (n2 >= lo && n2 < hi) return { digits: n2.toString(), exp: exp + 1 };
      exp++;
    } else if (n < lo) {
      exp--;
    } else return { digits: n.toString(), exp };
  }
  throw new Error('unreachable');
}

function fixedDigits(x: number, p: number): string {
  let n: bigint;
  if (x === 0) n = 0n;
  else {
    const { m, e } = decompose(x);
    n = roundScaled(m, e, p);
  }
  let s = n.toString();
  if (p > 0) {
    if (s.length <= p) s = '0'.repeat(p - s.length + 1) + s;
    return s.slice(0, s.length - p) + '.' + s.slice(s.length - p);
  }
  return s;
}

function expStyle(x: number, p: number, alt: boolean, upper: boolean): string {
  const { digits, exp } = expDigits(x, p);
  let s = digits[0];
  if (p > 0) s += '.' + digits.slice(1);
  else if (alt) s += '.';
  const ae = Math.abs(exp);
  return s + (upper ? 'E' : 'e') + (exp < 0 ? '-' : '+') + (ae < 10 ? '0' : '') + ae;
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
    let body = '';
    let canZero = true;

    const signFor = (neg: boolean) => (neg ? '-' : plus ? '+' : space ? ' ' : '');

    switch (conv) {
      case 's': {
        body = String(arg);
        if (prec !== undefined) body = body.slice(0, prec);
        canZero = false;
        break;
      }
      case 'c':
        body = String(arg);
        canZero = false;
        break;
      case 'd':
      case 'i': {
        const v = BigInt(arg as number | bigint);
        sign = signFor(v < 0n);
        body = (v < 0n ? -v : v).toString();
        if (prec !== undefined) {
          if (prec === 0 && v === 0n) body = '';
          body = body.padStart(prec, '0');
          canZero = false;
        }
        break;
      }
      case 'x':
      case 'X':
      case 'o': {
        const v = BigInt(arg as number | bigint);
        body = v.toString(conv === 'o' ? 8 : 16);
        if (conv === 'X') body = body.toUpperCase();
        if (prec !== undefined) {
          if (prec === 0 && v === 0n) body = '';
          body = body.padStart(prec, '0');
          canZero = false;
        }
        if (alt) {
          if (conv === 'o') {
            if (body[0] !== '0') body = '0' + body;
          } else if (v !== 0n) prefix = conv === 'x' ? '0x' : '0X';
        }
        break;
      }
      default: {
        // e E f F g G
        const x = arg as number;
        const upper = conv === 'E' || conv === 'F' || conv === 'G';
        if (Number.isNaN(x)) {
          body = upper ? 'NAN' : 'nan';
          canZero = false;
          break;
        }
        const neg = x < 0 || Object.is(x, -0);
        sign = signFor(neg);
        if (!isFinite(x)) {
          body = upper ? 'INF' : 'inf';
          canZero = false;
          break;
        }
        const a = Math.abs(x);
        const lc = conv.toLowerCase();
        if (lc === 'f') {
          const p = prec ?? 6;
          body = fixedDigits(a, p);
          if (p === 0 && alt) body += '.';
        } else if (lc === 'e') {
          body = expStyle(a, prec ?? 6, alt, upper);
        } else {
          let P = prec ?? 6;
          if (P === 0) P = 1;
          const X = expDigits(a, P - 1).exp;
          if (P > X && X >= -4) {
            body = fixedDigits(a, P - 1 - X);
            if (P - 1 - X === 0 && alt) body += '.';
            if (!alt) body = stripZeros(body);
          } else {
            body = expStyle(a, P - 1, alt, upper);
            if (!alt) {
              const idx = body.search(/[eE]/);
              body = stripZeros(body.slice(0, idx)) + body.slice(idx);
            }
          }
        }
      }
    }

    const len = sign.length + prefix.length + body.length;
    if (len >= width) out += sign + prefix + body;
    else if (minus) out += sign + prefix + body + ' '.repeat(width - len);
    else if (zero && canZero) out += sign + prefix + '0'.repeat(width - len) + body;
    else out += ' '.repeat(width - len) + sign + prefix + body;
  }
  return out;
}
