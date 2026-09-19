function roundDiv(n: bigint, d: bigint): bigint {
  const q = n / d;
  const r = n % d;
  const twice = r * 2n;
  if (twice > d) return q + 1n;
  if (twice < d) return q;
  return q % 2n === 0n ? q : q + 1n;
}

// Decompose a finite non-negative double into num/den (exact).
function toRat(x: number): [bigint, bigint] {
  if (x === 0) return [0n, 1n];
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const bexp = (hi >>> 20) & 0x7ff;
  let mant = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let e: number;
  if (bexp === 0) {
    e = -1074;
  } else {
    mant |= 1n << 52n;
    e = bexp - 1075;
  }
  return e >= 0 ? [mant << BigInt(e), 1n] : [mant, 1n << BigInt(-e)];
}

function pow10(n: number): bigint {
  return 10n ** BigInt(n);
}

// round(x * 10^k) for rational n/d, k may be negative
function scaledRound(n: bigint, d: bigint, k: number): bigint {
  return k >= 0 ? roundDiv(n * pow10(k), d) : roundDiv(n, d * pow10(-k));
}

// Returns digits (prec+1 significant) and decimal exponent.
function expDigits(x: number, prec: number): [string, number] {
  if (x === 0) return ['0'.repeat(prec + 1), 0];
  const [n, d] = toRat(x);
  let X = Math.floor(Math.log10(x));
  if (!isFinite(X)) X = 0;
  // correct estimate so 10^X <= x < 10^(X+1)
  const ge = (k: number) => (k >= 0 ? n >= d * pow10(k) : n * pow10(-k) >= d);
  while (!ge(X)) X--;
  while (ge(X + 1)) X++;
  let s = scaledRound(n, d, prec - X);
  if (s >= pow10(prec + 1)) {
    X++;
    s = scaledRound(n, d, prec - X);
  }
  return [s.toString(), X];
}

function fixedDigits(x: number, prec: number): string {
  const [n, d] = toRat(x);
  let s = scaledRound(n, d, prec).toString();
  if (prec > 0) {
    s = s.padStart(prec + 1, '0');
    return s.slice(0, s.length - prec) + '.' + s.slice(s.length - prec);
  }
  return s;
}

function fmtExp(digits: string, X: number, prec: number, alt: boolean, upper: boolean): string {
  let s = digits[0];
  if (prec > 0) s += '.' + digits.slice(1);
  else if (alt) s += '.';
  const ax = Math.abs(X);
  s += (upper ? 'E' : 'e') + (X < 0 ? '-' : '+') + (ax < 10 ? '0' + ax : String(ax));
  return s;
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
    for (;; i++) {
      const f = fmt[i];
      if (f === '-') minus = true;
      else if (f === '+') plus = true;
      else if (f === ' ') space = true;
      else if (f === '0') zero = true;
      else if (f === '#') alt = true;
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
    let body = '';
    let numeric = true;
    let allowZero = zero && !minus;

    const signFor = (neg: boolean) => (neg ? '-' : plus ? '+' : space ? ' ' : '');

    switch (conv) {
      case 'd':
      case 'i': {
        const v = typeof arg === 'bigint' ? arg : BigInt(arg as number);
        sign = signFor(v < 0n);
        body = (v < 0n ? -v : v).toString();
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
          } else if (v !== 0n) {
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
        const neg = v < 0 || Object.is(v, -0);
        if (Number.isNaN(v)) {
          body = upper ? 'NAN' : 'nan';
          allowZero = false;
          break;
        }
        sign = signFor(neg);
        if (!isFinite(v)) {
          body = upper ? 'INF' : 'inf';
          allowZero = false;
          break;
        }
        const ax = Math.abs(v);
        const lc = conv.toLowerCase();
        if (lc === 'f') {
          const p = prec < 0 ? 6 : prec;
          body = fixedDigits(ax, p);
          if (p === 0 && alt) body += '.';
        } else if (lc === 'e') {
          const p = prec < 0 ? 6 : prec;
          const [dg, X] = expDigits(ax, p);
          body = fmtExp(dg, X, p, alt, conv === 'E');
        } else {
          const P = prec < 0 ? 6 : prec === 0 ? 1 : prec;
          const [dg, X] = expDigits(ax, P - 1);
          if (P > X && X >= -4) {
            const p = P - 1 - X;
            body = fixedDigits(ax, p);
            if (p === 0 && alt) body += '.';
            if (!alt) body = stripZeros(body);
          } else {
            let s = fmtExp(dg, X, P - 1, alt, conv === 'G');
            if (!alt) {
              const ei = s.search(/[eE]/);
              s = stripZeros(s.slice(0, ei)) + s.slice(ei);
            }
            body = s;
          }
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

    const len = sign.length + prefix.length + body.length;
    if (len >= width) {
      out += sign + prefix + body;
    } else if (minus) {
      out += sign + prefix + body + ' '.repeat(width - len);
    } else if (numeric && allowZero) {
      out += sign + prefix + '0'.repeat(width - len) + body;
    } else {
      out += ' '.repeat(width - len) + sign + prefix + body;
    }
  }
  return out;
}
