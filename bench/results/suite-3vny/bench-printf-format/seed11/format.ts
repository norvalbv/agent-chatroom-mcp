function decompose(x: number): [bigint, number] {
  // x > 0 finite; returns [m, e] with x = m * 2^e exactly
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, x);
  const hi = buf.getUint32(0);
  const lo = buf.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (expBits === 0) return [m, -1074];
  m |= 1n << 52n;
  return [m, expBits - 1075];
}

// round(x * 10^k) half-even, x > 0 or 0
function roundScaled(x: number, k: number): bigint {
  if (x === 0) return 0n;
  const [m, e] = decompose(x);
  let num = m;
  let den = 1n;
  if (e >= 0) num <<= BigInt(e);
  else den <<= BigInt(-e);
  if (k >= 0) num *= 10n ** BigInt(k);
  else den *= 10n ** BigInt(-k);
  const q = num / den;
  const r = num % den;
  const c = 2n * r;
  if (c > den || (c === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

function fixed(x: number, p: number, alt: boolean): string {
  let s = roundScaled(x, p).toString();
  if (p > 0) {
    s = s.padStart(p + 1, '0');
    return s.slice(0, s.length - p) + '.' + s.slice(s.length - p);
  }
  return alt ? s + '.' : s;
}

// returns [digits string of length p+1, exponent]
function sci(x: number, p: number): [string, number] {
  if (x === 0) return ['0'.repeat(p + 1), 0];
  let E = Math.floor(Math.log10(x));
  for (let i = 0; i < 10; i++) {
    const d = roundScaled(x, p - E);
    const s = d.toString();
    if (s.length > p + 1) E++;
    else if (s.length < p + 1) E--;
    else return [s, E];
  }
  throw new Error('unreachable');
}

function expStr(E: number, upper: boolean): string {
  const a = Math.abs(E).toString().padStart(2, '0');
  return (upper ? 'E' : 'e') + (E < 0 ? '-' : '+') + a;
}

function fmtE(x: number, p: number, alt: boolean, upper: boolean): string {
  const [d, E] = sci(x, p);
  let s = d[0];
  if (p > 0) s += '.' + d.slice(1);
  else if (alt) s += '.';
  return s + expStr(E, upper);
}

function fmtG(x: number, P: number, alt: boolean, upper: boolean): string {
  if (P === 0) P = 1;
  const [, X] = sci(x, P - 1);
  let s: string;
  let expPart = '';
  if (P > X && X >= -4) {
    s = fixed(x, P - 1 - X, alt);
  } else {
    const [d, E] = sci(x, P - 1);
    s = d[0] + (P - 1 > 0 ? '.' + d.slice(1) : alt ? '.' : '');
    expPart = expStr(E, upper);
  }
  if (!alt && s.includes('.')) {
    s = s.replace(/0+$/, '').replace(/\.$/, '');
  }
  return s + expPart;
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
    let canZero = false;
    const signFor = (neg: boolean) => (neg ? '-' : plus ? '+' : space ? ' ' : '');

    switch (conv) {
      case 'd':
      case 'i': {
        const v = BigInt(arg as number | bigint);
        sign = signFor(v < 0n);
        body = (v < 0n ? -v : v).toString();
        if (prec >= 0) {
          if (prec === 0 && v === 0n) body = '';
          body = body.padStart(prec, '0');
        }
        canZero = prec < 0;
        break;
      }
      case 'x':
      case 'X':
      case 'o': {
        const v = BigInt(arg as number | bigint);
        body = v.toString(conv === 'o' ? 8 : 16);
        if (conv === 'X') body = body.toUpperCase();
        if (prec >= 0) {
          if (prec === 0 && v === 0n) body = '';
          body = body.padStart(prec, '0');
        }
        if (alt) {
          if (conv === 'o') {
            if (body[0] !== '0') body = '0' + body;
          } else if (v !== 0n) prefix = conv === 'x' ? '0x' : '0X';
        }
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
        const neg = x < 0 || Object.is(x, -0);
        sign = signFor(neg);
        const a = Math.abs(x);
        if (a === Infinity) {
          body = upper ? 'INF' : 'inf';
          break;
        }
        canZero = true;
        const p = prec < 0 ? 6 : prec;
        if (conv === 'e' || conv === 'E') body = fmtE(a, p, alt, upper);
        else if (conv === 'f' || conv === 'F') body = fixed(a, p, alt);
        else body = fmtG(a, p, alt, upper);
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
    else if (minus) out += sign + prefix + body + ' '.repeat(width - len);
    else if (zero && canZero) out += sign + prefix + '0'.repeat(width - len) + body;
    else out += ' '.repeat(width - len) + sign + prefix + body;
  }
  return out;
}
