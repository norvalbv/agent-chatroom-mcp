type Flags = {
  leftAlign: boolean;
  plus: boolean;
  space: boolean;
  zero: boolean;
  hash: boolean;
};

function parseFlags(flagStr: string): Flags {
  return {
    leftAlign: flagStr.includes('-'),
    plus: flagStr.includes('+'),
    space: flagStr.includes(' '),
    zero: flagStr.includes('0'),
    hash: flagStr.includes('#'),
  };
}

function signFor(negative: boolean, plus: boolean, space: boolean): string {
  if (negative) return '-';
  if (plus) return '+';
  if (space) return ' ';
  return '';
}

function pad(body: string, width: number | undefined, leftAlign: boolean): string {
  if (width === undefined || body.length >= width) return body;
  const fill = ' '.repeat(width - body.length);
  return leftAlign ? body + fill : fill + body;
}

// Pads a numeric string (sign + prefix + digits) to width, inserting zeros
// right after the sign/prefix when zeroFlag is set and left-align is not.
function padNumeric(
  sign: string,
  prefix: string,
  digits: string,
  width: number | undefined,
  leftAlign: boolean,
  zeroFlag: boolean
): string {
  const body = sign + prefix + digits;
  if (width === undefined || body.length >= width) return body;
  if (leftAlign) return body + ' '.repeat(width - body.length);
  if (zeroFlag) return sign + prefix + '0'.repeat(width - body.length) + digits;
  return ' '.repeat(width - body.length) + body;
}

// Decompose a positive finite double into exact num/den (den a power of two)
// such that absValue === num/den exactly.
function decompose(absValue: number): { num: bigint; den: bigint } {
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setFloat64(0, absValue);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  let mantissa = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo >>> 0);
  let e2: number;
  if (expBits === 0) {
    e2 = 1 - 1023 - 52;
  } else {
    mantissa |= 1n << 52n;
    e2 = expBits - 1023 - 52;
  }
  if (e2 >= 0) {
    return { num: mantissa << BigInt(e2), den: 1n };
  }
  return { num: mantissa, den: 1n << BigInt(-e2) };
}

function roundHalfEven(scaledNum: bigint, scaledDen: bigint): bigint {
  let q = scaledNum / scaledDen;
  const r = scaledNum % scaledDen;
  const twice = r * 2n;
  if (twice > scaledDen || (twice === scaledDen && q % 2n === 1n)) {
    q += 1n;
  }
  return q;
}

// Round |value| to p digits after the decimal point (f-style), exactly.
function roundToFraction(num: bigint, den: bigint, p: number): bigint {
  const scaledNum = num * 10n ** BigInt(p);
  return roundHalfEven(scaledNum, den);
}

// Find the p+1 significant digits and decimal exponent X of |value| in
// e-style (d.ddd * 10^X), after rounding to p digits past the point.
function computeSig(
  absValue: number,
  num: bigint,
  den: bigint,
  p: number
): { digits: string; exp: number } {
  let X = Math.floor(Math.log10(absValue));
  if (!isFinite(X)) X = 0;
  const lower = 10n ** BigInt(p);
  const upper = 10n ** BigInt(p + 1);
  for (;;) {
    const k = p - X;
    let scaledNum: bigint;
    let scaledDen: bigint;
    if (k >= 0) {
      scaledNum = num * 10n ** BigInt(k);
      scaledDen = den;
    } else {
      scaledNum = num;
      scaledDen = den * 10n ** BigInt(-k);
    }
    const q = roundHalfEven(scaledNum, scaledDen);
    if (q < lower) {
      X -= 1;
      continue;
    }
    if (q >= upper) {
      X += 1;
      continue;
    }
    return { digits: q.toString().padStart(p + 1, '0'), exp: X };
  }
}

function stripTrailingZeros(s: string): string {
  if (!s.includes('.')) return s;
  s = s.replace(/0+$/, '');
  if (s.endsWith('.')) s = s.slice(0, -1);
  return s;
}

function formatExponent(x: number): string {
  const sign = x < 0 ? '-' : '+';
  const digits = Math.abs(x).toString().padStart(2, '0');
  return sign + digits;
}

function toBigIntArg(v: number | bigint): bigint {
  return typeof v === 'bigint' ? v : BigInt(v);
}

function formatIntSigned(
  value: number | bigint,
  flags: Flags,
  width: number | undefined,
  precision: number | undefined
): string {
  const big = toBigIntArg(value);
  const negative = big < 0n;
  const mag = negative ? -big : big;
  let digits = mag.toString();
  if (precision !== undefined) {
    if (precision === 0 && mag === 0n) {
      digits = '';
    } else {
      digits = digits.padStart(precision, '0');
    }
  }
  const sign = signFor(negative, flags.plus, flags.space);
  const zeroFlag = flags.zero && !flags.leftAlign && precision === undefined;
  return padNumeric(sign, '', digits, width, flags.leftAlign, zeroFlag);
}

function formatUnsigned(
  value: number | bigint,
  base: 16 | 8,
  upper: boolean,
  flags: Flags,
  width: number | undefined,
  precision: number | undefined
): string {
  const mag = toBigIntArg(value);
  let digits = mag.toString(base);
  if (upper) digits = digits.toUpperCase();
  if (precision !== undefined) {
    if (precision === 0 && mag === 0n) {
      digits = '';
    } else {
      digits = digits.padStart(precision, '0');
    }
  }
  let prefix = '';
  if (flags.hash) {
    if (base === 16) {
      if (mag !== 0n) prefix = upper ? '0X' : '0x';
    } else {
      if (digits === '' || digits[0] !== '0') digits = '0' + digits;
    }
  }
  const zeroFlag = flags.zero && !flags.leftAlign && precision === undefined;
  return padNumeric('', prefix, digits, width, flags.leftAlign, zeroFlag);
}

function specialFloatText(
  value: number,
  conv: string,
  flags: Flags,
  width: number | undefined
): string {
  const upper = conv === conv.toUpperCase();
  if (Number.isNaN(value)) {
    const body = upper ? 'NAN' : 'nan';
    return pad(body, width, flags.leftAlign);
  }
  const negative = value < 0;
  const sign = signFor(negative, flags.plus, flags.space);
  const body = sign + (upper ? 'INF' : 'inf');
  return pad(body, width, flags.leftAlign);
}

function formatE(
  value: number,
  conv: 'e' | 'E',
  flags: Flags,
  width: number | undefined,
  precision: number | undefined
): string {
  if (Number.isNaN(value) || !Number.isFinite(value)) {
    return specialFloatText(value, conv, flags, width);
  }
  const p = precision === undefined ? 6 : precision;
  const negative = value < 0 || Object.is(value, -0);
  const absValue = Math.abs(value);
  const sign = signFor(negative, flags.plus, flags.space);
  let digits: string;
  let exp: number;
  if (absValue === 0) {
    digits = '0'.repeat(p + 1);
    exp = 0;
  } else {
    const { num, den } = decompose(absValue);
    ({ digits, exp } = computeSig(absValue, num, den, p));
  }
  const mantissa = digits[0] + (p > 0 || flags.hash ? '.' + digits.slice(1) : '');
  const expLetter = conv === 'E' ? 'E' : 'e';
  const rest = mantissa + expLetter + formatExponent(exp);
  const zeroFlag = flags.zero && !flags.leftAlign;
  return padNumeric(sign, '', rest, width, flags.leftAlign, zeroFlag);
}

function formatF(
  value: number,
  conv: 'f' | 'F',
  flags: Flags,
  width: number | undefined,
  precision: number | undefined
): string {
  if (Number.isNaN(value) || !Number.isFinite(value)) {
    return specialFloatText(value, conv, flags, width);
  }
  const p = precision === undefined ? 6 : precision;
  const negative = value < 0 || Object.is(value, -0);
  const absValue = Math.abs(value);
  const sign = signFor(negative, flags.plus, flags.space);
  let intPart: string;
  let fracPart: string;
  if (absValue === 0) {
    intPart = '0';
    fracPart = '0'.repeat(p);
  } else {
    const { num, den } = decompose(absValue);
    const q = roundToFraction(num, den, p);
    let s = q.toString();
    if (s.length < p + 1) s = s.padStart(p + 1, '0');
    intPart = p > 0 ? s.slice(0, s.length - p) : s;
    fracPart = p > 0 ? s.slice(s.length - p) : '';
  }
  const mantissa = intPart + (p > 0 || flags.hash ? '.' + fracPart : '');
  const zeroFlag = flags.zero && !flags.leftAlign;
  return padNumeric(sign, '', mantissa, width, flags.leftAlign, zeroFlag);
}

function formatG(
  value: number,
  conv: 'g' | 'G',
  flags: Flags,
  width: number | undefined,
  precision: number | undefined
): string {
  if (Number.isNaN(value) || !Number.isFinite(value)) {
    return specialFloatText(value, conv, flags, width);
  }
  const P = precision === undefined ? 6 : precision === 0 ? 1 : precision;
  const negative = value < 0 || Object.is(value, -0);
  const absValue = Math.abs(value);
  const sign = signFor(negative, flags.plus, flags.space);

  let digits: string;
  let X: number;
  if (absValue === 0) {
    digits = '0'.repeat(P);
    X = 0;
  } else {
    const { num, den } = decompose(absValue);
    ({ digits, exp: X } = computeSig(absValue, num, den, P - 1));
  }

  let mantissa: string;
  let rest: string;
  const expLetter = conv === 'G' ? 'E' : 'e';
  if (X < -4 || X >= P) {
    const p = P - 1;
    mantissa = digits[0] + (p > 0 || flags.hash ? '.' + digits.slice(1) : '');
    if (!flags.hash) mantissa = stripTrailingZeros(mantissa);
    rest = mantissa + expLetter + formatExponent(X);
  } else {
    let intPart: string;
    let fracPart: string;
    if (X >= 0) {
      intPart = digits.slice(0, X + 1);
      fracPart = digits.slice(X + 1);
    } else {
      intPart = '0';
      fracPart = '0'.repeat(-X - 1) + digits;
    }
    mantissa = intPart + (fracPart.length > 0 || flags.hash ? '.' + fracPart : '');
    if (!flags.hash) mantissa = stripTrailingZeros(mantissa);
    rest = mantissa;
  }
  const zeroFlag = flags.zero && !flags.leftAlign;
  return padNumeric(sign, '', rest, width, flags.leftAlign, zeroFlag);
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let out = '';
  let argIndex = 0;
  const re = /%([-+ 0#]*)(\d*)(?:\.(\d*))?(.)/g;
  let lastEnd = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(fmt)) !== null) {
    out += fmt.slice(lastEnd, m.index);
    lastEnd = re.lastIndex;

    const [, flagStr, widthStr, precStr, conv] = m;

    if (conv === '%') {
      out += '%';
      continue;
    }

    const flags = parseFlags(flagStr);
    const width = widthStr === '' ? undefined : parseInt(widthStr, 10);
    const precision =
      precStr === undefined ? undefined : precStr === '' ? 0 : parseInt(precStr, 10);

    const arg = args[argIndex++];

    switch (conv) {
      case 'd':
      case 'i':
        out += formatIntSigned(arg as number | bigint, flags, width, precision);
        break;
      case 'x':
        out += formatUnsigned(arg as number | bigint, 16, false, flags, width, precision);
        break;
      case 'X':
        out += formatUnsigned(arg as number | bigint, 16, true, flags, width, precision);
        break;
      case 'o':
        out += formatUnsigned(arg as number | bigint, 8, false, flags, width, precision);
        break;
      case 'e':
        out += formatE(arg as number, 'e', flags, width, precision);
        break;
      case 'E':
        out += formatE(arg as number, 'E', flags, width, precision);
        break;
      case 'f':
        out += formatF(arg as number, 'f', flags, width, precision);
        break;
      case 'F':
        out += formatF(arg as number, 'F', flags, width, precision);
        break;
      case 'g':
        out += formatG(arg as number, 'g', flags, width, precision);
        break;
      case 'G':
        out += formatG(arg as number, 'G', flags, width, precision);
        break;
      case 's': {
        let s = arg as string;
        if (precision !== undefined) s = s.slice(0, precision);
        out += pad(s, width, flags.leftAlign);
        break;
      }
      case 'c': {
        const s = arg as string;
        out += pad(s, width, flags.leftAlign);
        break;
      }
      default:
        break;
    }
  }
  out += fmt.slice(lastEnd);
  return out;
}
