// ---- exact rational arithmetic helpers for correctly-rounded float formatting ----

function decompose(x: number): [bigint, number] {
  // x must be finite and non-negative (sign is ignored/handled by caller).
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setFloat64(0, x);
  const hi = view.getUint32(0);
  const lo = view.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  const mantHigh = hi & 0xfffff;
  let mantissa = (BigInt(mantHigh) << 32n) | BigInt(lo);
  let exponent: number;
  if (expBits === 0) {
    exponent = -1074;
  } else {
    mantissa |= 1n << 52n;
    exponent = expBits - 1075;
  }
  return [mantissa, exponent];
}

function toRational(x: number): [bigint, bigint] {
  const [mantissa, exponent] = decompose(x);
  if (exponent >= 0) {
    return [mantissa << BigInt(exponent), 1n];
  }
  return [mantissa, 1n << BigInt(-exponent)];
}

// round(num/den * 10^k) to nearest integer, ties to even
function scaleRound(num: bigint, den: bigint, k: number): bigint {
  let n = num;
  let d = den;
  if (k >= 0) {
    n = n * 10n ** BigInt(k);
  } else {
    d = d * 10n ** BigInt(-k);
  }
  let q = n / d;
  const r = n - q * d;
  const twiceR = r * 2n;
  if (twiceR > d) {
    q += 1n;
  } else if (twiceR === d) {
    if (q % 2n !== 0n) q += 1n;
  }
  return q;
}

function cmpPow10(num: bigint, den: bigint, e: number): number {
  let lhs = num;
  let rhs = den;
  if (e >= 0) {
    rhs = rhs * 10n ** BigInt(e);
  } else {
    lhs = lhs * 10n ** BigInt(-e);
  }
  if (lhs < rhs) return -1;
  if (lhs > rhs) return 1;
  return 0;
}

function floorLog10(num: bigint, den: bigint, x: number): number {
  let e = Math.floor(Math.log10(x));
  while (cmpPow10(num, den, e) < 0) e--;
  while (cmpPow10(num, den, e + 1) >= 0) e++;
  return e;
}

// Returns the p+1 significant digits (as a string of length p+1) of x (x>0 finite)
// together with the decimal exponent, correctly rounded (ties to even) to p
// digits after the first.
function toExpDigits(x: number, p: number): { digits: string; exp: number } {
  const [num, den] = toRational(x);
  let exp = floorLog10(num, den, x);
  let N = scaleRound(num, den, p - exp);
  let digits = N.toString();
  while (digits.length > p + 1) {
    exp++;
    N = scaleRound(num, den, p - exp);
    digits = N.toString();
  }
  while (digits.length < p + 1) {
    exp--;
    N = scaleRound(num, den, p - exp);
    digits = N.toString();
  }
  return { digits, exp };
}

// Returns the digit string of round(x * 10^p) (x>0 finite), i.e. the integer
// and fractional digits needed for %f with p fractional digits, without the
// decimal point.
function toFixedDigits(x: number, p: number): string {
  const [num, den] = toRational(x);
  const N = scaleRound(num, den, p);
  return N.toString();
}

// ---- generic conversion-spec parsing/formatting ----

interface Spec {
  flags: Set<string>;
  width: number | null;
  precision: number | null;
  conv: string;
}

function padNumeric(prefix: string, digits: string, spec: Spec, zeroOk: boolean): string {
  const body = prefix + digits;
  const width = spec.width ?? 0;
  if (body.length >= width) return body;
  const padLen = width - body.length;
  if (spec.flags.has('-')) {
    return body + ' '.repeat(padLen);
  }
  if (spec.flags.has('0') && zeroOk) {
    return prefix + '0'.repeat(padLen) + digits;
  }
  return ' '.repeat(padLen) + body;
}

function padGeneral(text: string, spec: Spec): string {
  const width = spec.width ?? 0;
  if (text.length >= width) return text;
  const padLen = width - text.length;
  if (spec.flags.has('-')) {
    return text + ' '.repeat(padLen);
  }
  return ' '.repeat(padLen) + text;
}

function signPrefix(negative: boolean, spec: Spec): string {
  if (negative) return '-';
  if (spec.flags.has('+')) return '+';
  if (spec.flags.has(' ')) return ' ';
  return '';
}

function formatIntArg(value: number | bigint): { negative: boolean; magnitude: bigint } {
  const big = typeof value === 'bigint' ? value : BigInt(value);
  if (big < 0n) return { negative: true, magnitude: -big };
  return { negative: false, magnitude: big };
}

function applyPrecisionDigits(digits: string, precision: number | null): string {
  if (precision === null) return digits;
  if (precision === 0 && digits === '0') return '';
  if (digits.length < precision) return '0'.repeat(precision - digits.length) + digits;
  return digits;
}

function formatDI(value: number | bigint, spec: Spec): string {
  const { negative, magnitude } = formatIntArg(value);
  const rawDigits = magnitude.toString();
  const digits = applyPrecisionDigits(rawDigits, spec.precision);
  const prefix = signPrefix(negative, spec);
  const zeroOk = spec.precision === null;
  return padNumeric(prefix, digits, spec, zeroOk);
}

function formatXO(value: number | bigint, spec: Spec): string {
  const big = typeof value === 'bigint' ? value : BigInt(value);
  const base = spec.conv === 'o' ? 8 : 16;
  let rawDigits = big.toString(base);
  if (spec.conv === 'X') rawDigits = rawDigits.toUpperCase();
  let digits = applyPrecisionDigits(rawDigits, spec.precision);
  let prefix = '';
  if (spec.flags.has('#')) {
    if (spec.conv === 'o') {
      if (digits.length === 0 || digits[0] !== '0') {
        digits = '0' + digits;
      }
    } else if (big !== 0n) {
      prefix = spec.conv === 'X' ? '0X' : '0x';
    }
  }
  const zeroOk = spec.precision === null;
  return padNumeric(prefix, digits, spec, zeroOk);
}

function isNegativeValue(x: number): boolean {
  return x < 0 || Object.is(x, -0);
}

function formatEFG(value: number, spec: Spec): string {
  const conv = spec.conv;
  const upper = conv === conv.toUpperCase();

  if (Number.isNaN(value)) {
    const text = upper ? 'NAN' : 'nan';
    return padGeneral(text, spec);
  }

  const negative = isNegativeValue(value);
  const prefix = signPrefix(negative, spec);

  if (!Number.isFinite(value)) {
    const text = upper ? 'INF' : 'inf';
    return padNumeric(prefix, text, spec, false);
  }

  const abs = Math.abs(value);
  const hash = spec.flags.has('#');

  if (conv === 'e' || conv === 'E') {
    const p = spec.precision ?? 6;
    let expDigits: string;
    let exp: number;
    if (abs === 0) {
      expDigits = '0'.repeat(p + 1);
      exp = 0;
    } else {
      const r = toExpDigits(abs, p);
      expDigits = r.digits;
      exp = r.exp;
    }
    const first = expDigits[0];
    const rest = expDigits.slice(1);
    let mantissa = first;
    if (p > 0) {
      mantissa += '.' + rest;
    } else if (hash) {
      mantissa += '.';
    }
    const expSign = exp < 0 ? '-' : '+';
    const expAbs = Math.abs(exp).toString();
    const expStr = expAbs.length < 2 ? '0'.repeat(2 - expAbs.length) + expAbs : expAbs;
    const eChar = conv === 'E' ? 'E' : 'e';
    const digitsOut = mantissa + eChar + expSign + expStr;
    return padNumeric(prefix, digitsOut, spec, true);
  }

  if (conv === 'f' || conv === 'F') {
    const p = spec.precision ?? 6;
    let digits: string;
    if (abs === 0) {
      digits = '0'.repeat(p + 1);
    } else {
      digits = toFixedDigits(abs, p);
      if (digits.length < p + 1) {
        digits = '0'.repeat(p + 1 - digits.length) + digits;
      }
    }
    const intPart = digits.slice(0, digits.length - p);
    const fracPart = p > 0 ? digits.slice(digits.length - p) : '';
    let out = intPart;
    if (p > 0) {
      out += '.' + fracPart;
    } else if (hash) {
      out += '.';
    }
    return padNumeric(prefix, out, spec, true);
  }

  // g, G
  let P = spec.precision ?? 6;
  if (P === 0) P = 1;
  let expDigits: string;
  let exp: number;
  if (abs === 0) {
    expDigits = '0'.repeat(P);
    exp = 0;
  } else {
    const r = toExpDigits(abs, P - 1);
    expDigits = r.digits;
    exp = r.exp;
  }

  let out: string;
  if (P > exp && exp >= -4) {
    // f style with precision P-1-exp
    const fp = P - 1 - exp;
    let digits: string;
    if (abs === 0) {
      digits = '0'.repeat(fp + 1);
    } else {
      digits = toFixedDigits(abs, fp);
      const needed = (exp >= 0 ? exp + 1 : 1) + fp;
      if (digits.length < needed) {
        digits = '0'.repeat(needed - digits.length) + digits;
      }
    }
    const intPart = fp > 0 ? digits.slice(0, digits.length - fp) : digits;
    let fracPart = fp > 0 ? digits.slice(digits.length - fp) : '';
    if (!hash) {
      fracPart = fracPart.replace(/0+$/, '');
    }
    out = intPart;
    if (fracPart.length > 0) {
      out += '.' + fracPart;
    } else if (hash) {
      out += '.';
    }
  } else {
    // e style with precision P-1
    const first = expDigits[0];
    let rest = expDigits.slice(1);
    if (!hash) {
      rest = rest.replace(/0+$/, '');
    }
    let mantissa = first;
    if (rest.length > 0) {
      mantissa += '.' + rest;
    } else if (hash) {
      mantissa += '.';
    }
    const expSign = exp < 0 ? '-' : '+';
    const expAbs = Math.abs(exp).toString();
    const expStr = expAbs.length < 2 ? '0'.repeat(2 - expAbs.length) + expAbs : expAbs;
    const eChar = conv === 'G' ? 'E' : 'e';
    out = mantissa + eChar + expSign + expStr;
  }

  return padNumeric(prefix, out, spec, true);
}

function formatS(value: string, spec: Spec): string {
  let text = value;
  if (spec.precision !== null) {
    text = text.slice(0, spec.precision);
  }
  return padGeneral(text, spec);
}

function formatC(value: string, spec: Spec): string {
  return padGeneral(value, spec);
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let out = '';
  let argIndex = 0;
  let i = 0;
  const n = fmt.length;
  while (i < n) {
    const ch = fmt[i];
    if (ch !== '%') {
      out += ch;
      i++;
      continue;
    }
    i++; // consume '%'
    if (fmt[i] === '%') {
      out += '%';
      i++;
      continue;
    }
    const flags = new Set<string>();
    while (i < n && '-+ 0#'.includes(fmt[i])) {
      flags.add(fmt[i]);
      i++;
    }
    let widthStr = '';
    while (i < n && fmt[i] >= '0' && fmt[i] <= '9') {
      widthStr += fmt[i];
      i++;
    }
    const width = widthStr.length > 0 ? parseInt(widthStr, 10) : null;
    let precision: number | null = null;
    if (fmt[i] === '.') {
      i++;
      let precStr = '';
      while (i < n && fmt[i] >= '0' && fmt[i] <= '9') {
        precStr += fmt[i];
        i++;
      }
      precision = precStr.length > 0 ? parseInt(precStr, 10) : 0;
    }
    const conv = fmt[i];
    i++;
    const spec: Spec = { flags, width, precision, conv };
    const arg = args[argIndex++];
    switch (conv) {
      case 'd':
      case 'i':
        out += formatDI(arg as number | bigint, spec);
        break;
      case 'x':
      case 'X':
      case 'o':
        out += formatXO(arg as number | bigint, spec);
        break;
      case 'e':
      case 'E':
      case 'f':
      case 'F':
      case 'g':
      case 'G':
        out += formatEFG(arg as number, spec);
        break;
      case 's':
        out += formatS(arg as string, spec);
        break;
      case 'c':
        out += formatC(arg as string, spec);
        break;
      default:
        throw new Error(`Unsupported conversion: %${conv}`);
    }
  }
  return out;
}
