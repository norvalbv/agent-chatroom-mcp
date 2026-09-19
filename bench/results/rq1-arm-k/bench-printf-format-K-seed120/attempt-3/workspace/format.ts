function decompose(x: number): [bigint, bigint] {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const ef = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let e: number;
  if (ef === 0) {
    e = -1074;
  } else {
    m |= 1n << 52n;
    e = ef - 1075;
  }
  return e >= 0 ? [m << BigInt(e), 1n] : [m, 1n << BigInt(-e)];
}

function roundDiv(n: bigint, d: bigint): bigint {
  const q = n / d;
  const r2 = (n - q * d) * 2n;
  if (r2 > d || (r2 === d && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// round v * 10^k to an integer, half-even
function scaledRound(v: [bigint, bigint], k: number): bigint {
  let [n, d] = v;
  if (k >= 0) n *= 10n ** BigInt(k);
  else d *= 10n ** BigInt(-k);
  return roundDiv(n, d);
}

// digits (p+1 of them) and decimal exponent, for |x| finite
function eDigits(x: number, p: number): [string, number] {
  if (x === 0) return ['0'.repeat(p + 1), 0];
  const v = decompose(x);
  let X = Math.floor(Math.log10(x));
  if (!isFinite(X)) X = -324;
  const hi = 10n ** BigInt(p + 1);
  const lo = 10n ** BigInt(p);
  for (let i = 0; i < 10; i++) {
    const n = scaledRound(v, p - X);
    if (n >= hi) X++;
    else if (n < lo) X--;
    else return [n.toString(), X];
  }
  throw new Error('unreachable');
}

function fDigits(x: number, p: number): [string, string] {
  let s = x === 0 ? '0' : scaledRound(decompose(x), p).toString();
  if (s.length < p + 1) s = '0'.repeat(p + 1 - s.length) + s;
  return [s.slice(0, s.length - p), s.slice(s.length - p)];
}

function expStr(X: number, upper: boolean): string {
  const a = Math.abs(X);
  return (upper ? 'E' : 'e') + (X < 0 ? '-' : '+') + (a < 10 ? '0' + a : String(a));
}

function stripZeros(s: string): string {
  if (s.indexOf('.') < 0) return s;
  s = s.replace(/0+$/, '');
  return s.endsWith('.') ? s.slice(0, -1) : s;
}

function fmtE(x: number, p: number, alt: boolean, upper: boolean, strip: boolean): string {
  const [d, X] = eDigits(x, p);
  let m = d[0];
  if (p > 0 || alt) m += '.' + d.slice(1);
  if (strip) m = stripZeros(m);
  return m + expStr(X, upper);
}

function fmtF(x: number, p: number, alt: boolean, strip: boolean): string {
  const [i, f] = fDigits(x, p);
  let s = i;
  if (p > 0 || alt) s += '.' + f;
  return strip ? stripZeros(s) : s;
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
    while (i < fmt.length && fmt[i] >= '0' && fmt[i] <= '9') width = width * 10 + Number(fmt[i++]);
    let prec = -1;
    if (fmt[i] === '.') {
      i++;
      prec = 0;
      while (i < fmt.length && fmt[i] >= '0' && fmt[i] <= '9') prec = prec * 10 + Number(fmt[i++]);
    }
    const conv = fmt[i++];
    const arg = args[ai++];
    let prefix = '';
    let body = '';
    let numeric = true;
    let canZero = true;
    switch (conv) {
      case 'd':
      case 'i': {
        const b = BigInt(arg as number | bigint);
        const neg = b < 0n;
        let digits = (neg ? -b : b).toString();
        if (prec === 0 && b === 0n) digits = '';
        if (prec >= 0) {
          if (digits.length < prec) digits = '0'.repeat(prec - digits.length) + digits;
          canZero = false;
        }
        prefix = neg ? '-' : plus ? '+' : space ? ' ' : '';
        body = digits;
        break;
      }
      case 'x':
      case 'X':
      case 'o': {
        const b = BigInt(arg as number | bigint);
        let digits = b.toString(conv === 'o' ? 8 : 16);
        if (conv === 'X') digits = digits.toUpperCase();
        if (prec === 0 && b === 0n) digits = '';
        if (prec >= 0) {
          if (digits.length < prec) digits = '0'.repeat(prec - digits.length) + digits;
          canZero = false;
        }
        if (alt) {
          if (conv === 'o') {
            if (!digits.startsWith('0')) digits = '0' + digits;
          } else if (b !== 0n) {
            prefix = conv === 'x' ? '0x' : '0X';
          }
        }
        body = digits;
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
          prefix = '';
          body = upper ? 'NAN' : 'nan';
          canZero = false;
          break;
        }
        prefix = neg ? '-' : plus ? '+' : space ? ' ' : '';
        const a = Math.abs(x);
        if (a === Infinity) {
          body = upper ? 'INF' : 'inf';
          canZero = false;
          break;
        }
        const lc = conv.toLowerCase();
        if (lc === 'e') {
          body = fmtE(a, prec < 0 ? 6 : prec, alt, upper, false);
        } else if (lc === 'f') {
          body = fmtF(a, prec < 0 ? 6 : prec, alt, false);
        } else {
          let P = prec < 0 ? 6 : prec;
          if (P === 0) P = 1;
          const X = eDigits(a, P - 1)[1];
          if (P > X && X >= -4) body = fmtF(a, P - 1 - X, alt, !alt);
          else body = fmtE(a, P - 1, alt, upper, !alt);
        }
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
    const len = prefix.length + body.length;
    if (len >= width) out += prefix + body;
    else if (minus) out += prefix + body + ' '.repeat(width - len);
    else if (numeric && zero && canZero) out += prefix + '0'.repeat(width - len) + body;
    else out += ' '.repeat(width - len) + prefix + body;
  }
  return out;
}
