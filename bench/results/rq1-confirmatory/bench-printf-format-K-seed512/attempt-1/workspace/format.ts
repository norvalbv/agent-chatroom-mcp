// Decompose |x| (finite double) into an exact fraction numerator/denominator
// (denominator is a power of two), using the IEEE-754 bit pattern.
function decompose(x: number): { numerator: bigint; denominator: bigint } {
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setFloat64(0, Math.abs(x));
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  const mantHi = hi & 0xfffff;
  let mantissa = (BigInt(mantHi) << 32n) | BigInt(lo);
  let exp: number;
  if (expBits === 0) {
    exp = -1074;
  } else {
    mantissa |= 1n << 52n;
    exp = expBits - 1075;
  }
  if (exp >= 0) {
    return { numerator: mantissa << BigInt(exp), denominator: 1n };
  }
  return { numerator: mantissa, denominator: 1n << BigInt(-exp) };
}

// round(numerator/denominator * 10^p) to nearest integer, ties to even.
function roundScaled(numerator: bigint, denominator: bigint, p: number): bigint {
  let sNum = numerator;
  let sDen = denominator;
  if (p >= 0) {
    sNum *= 10n ** BigInt(p);
  } else {
    sDen *= 10n ** BigInt(-p);
  }
  const q = sNum / sDen;
  const r = sNum % sDen;
  const twice = r * 2n;
  if (twice < sDen) return q;
  if (twice > sDen) return q + 1n;
  return q % 2n === 0n ? q : q + 1n;
}

function isNegative(x: number): boolean {
  if (Number.isNaN(x)) return false;
  return x < 0 || Object.is(x, -0);
}

// Round |x| to `precision` digits after the decimal point (f style body, no sign).
function buildFixedBody(x: number, precision: number, hashFlag: boolean): string {
  const { numerator, denominator } = decompose(x);
  const D = roundScaled(numerator, denominator, precision);
  let s = D.toString();
  while (s.length < precision + 1) s = '0' + s;
  if (precision === 0) {
    return hashFlag ? s + '.' : s;
  }
  const intPart = s.slice(0, s.length - precision);
  const fracPart = s.slice(s.length - precision);
  return intPart + '.' + fracPart;
}

// Round |x| to `precision+1` significant digits; returns digit string and decimal exponent.
function expDigits(x: number, precision: number): { digits: string; exp: number } {
  const { numerator, denominator } = decompose(x);
  if (numerator === 0n) {
    return { digits: '0'.repeat(precision + 1), exp: 0 };
  }
  let E = Math.floor(Math.log10(Math.abs(x)));
  const lower = 10n ** BigInt(precision);
  const upper = 10n ** BigInt(precision + 1);
  let D: bigint;
  for (;;) {
    D = roundScaled(numerator, denominator, precision - E);
    if (D >= upper) {
      E++;
      continue;
    }
    if (D < lower) {
      E--;
      continue;
    }
    break;
  }
  return { digits: D.toString(), exp: E };
}

function buildExpBody(x: number, precision: number, hashFlag: boolean, upper: boolean): string {
  const { digits, exp } = expDigits(x, precision);
  const first = digits[0];
  const rest = digits.slice(1);
  const mantissa = precision > 0 ? first + '.' + rest : first + (hashFlag ? '.' : '');
  const eChar = upper ? 'E' : 'e';
  const expSign = exp < 0 ? '-' : '+';
  const expAbs = Math.abs(exp).toString().padStart(2, '0');
  return mantissa + eChar + expSign + expAbs;
}

function stripTrailingZeros(body: string): string {
  const m = body.match(/^([^eE]*)([eE].*)?$/);
  let mantissa = m![1];
  const expPart = m![2] ?? '';
  if (mantissa.includes('.')) {
    mantissa = mantissa.replace(/0+$/, '');
    mantissa = mantissa.replace(/\.$/, '');
  }
  return mantissa + expPart;
}

function formatG(x: number, P: number, hashFlag: boolean, upper: boolean): string {
  const Puse = P === 0 ? 1 : P;
  const { exp: X } = expDigits(x, Puse - 1);
  let body: string;
  if (Puse > X && X >= -4) {
    body = buildFixedBody(x, Puse - 1 - X, hashFlag);
  } else {
    body = buildExpBody(x, Puse - 1, hashFlag, upper);
  }
  if (!hashFlag) body = stripTrailingZeros(body);
  return body;
}

function padNumeric(
  sign: string,
  prefix: string,
  digits: string,
  width: number,
  leftAlign: boolean,
  zeroFlag: boolean,
): string {
  const body = sign + prefix + digits;
  const padLen = width - body.length;
  if (padLen <= 0) return body;
  if (leftAlign) return body + ' '.repeat(padLen);
  if (zeroFlag) return sign + prefix + '0'.repeat(padLen) + digits;
  return ' '.repeat(padLen) + body;
}

function toBigIntArg(arg: number | bigint | string): bigint {
  return typeof arg === 'bigint' ? arg : BigInt(Math.trunc(arg as number));
}

function formatOne(
  conv: string,
  flags: Set<string>,
  width: number,
  precision: number | undefined,
  hasPrecision: boolean,
  arg: number | bigint | string,
): string {
  switch (conv) {
    case 'd':
    case 'i': {
      const v = toBigIntArg(arg);
      const neg = v < 0n;
      const mag = neg ? -v : v;
      let digits = mag.toString();
      if (hasPrecision) {
        if (precision === 0 && mag === 0n) {
          digits = '';
        } else {
          while (digits.length < (precision as number)) digits = '0' + digits;
        }
      }
      const sign = neg ? '-' : flags.has('+') ? '+' : flags.has(' ') ? ' ' : '';
      const zeroFlag = flags.has('0') && !flags.has('-') && !hasPrecision;
      return padNumeric(sign, '', digits, width, flags.has('-'), zeroFlag);
    }
    case 'x':
    case 'X':
    case 'o': {
      const v = toBigIntArg(arg);
      let digits = conv === 'o' ? v.toString(8) : v.toString(16);
      if (conv === 'X') digits = digits.toUpperCase();
      let effPrecision = hasPrecision ? (precision as number) : undefined;
      if (conv === 'o' && flags.has('#')) {
        const needed = digits[0] !== '0' ? digits.length + 1 : digits.length;
        effPrecision = effPrecision === undefined ? needed : Math.max(effPrecision, needed);
      }
      if (effPrecision !== undefined) {
        if (effPrecision === 0 && v === 0n) {
          digits = '';
        } else {
          while (digits.length < effPrecision) digits = '0' + digits;
        }
      }
      let prefix = '';
      if ((conv === 'x' || conv === 'X') && flags.has('#') && v !== 0n) {
        prefix = conv === 'x' ? '0x' : '0X';
      }
      const zeroFlag = flags.has('0') && !flags.has('-') && !hasPrecision;
      return padNumeric('', prefix, digits, width, flags.has('-'), zeroFlag);
    }
    case 'e':
    case 'E':
    case 'f':
    case 'F':
    case 'g':
    case 'G': {
      const x = arg as number;
      const upper = conv === conv.toUpperCase();
      const isNan = Number.isNaN(x);
      const special = isNan || !Number.isFinite(x);
      let sign: string;
      if (isNan) sign = '';
      else if (isNegative(x)) sign = '-';
      else if (flags.has('+')) sign = '+';
      else if (flags.has(' ')) sign = ' ';
      else sign = '';

      let body: string;
      if (special) {
        const word = isNan ? 'nan' : 'inf';
        body = upper ? word.toUpperCase() : word;
      } else {
        const hashFlag = flags.has('#');
        const p = hasPrecision ? (precision as number) : 6;
        switch (conv.toLowerCase()) {
          case 'f':
            body = buildFixedBody(x, p, hashFlag);
            break;
          case 'e':
            body = buildExpBody(x, p, hashFlag, upper);
            break;
          default:
            body = formatG(x, p, hashFlag, upper);
            break;
        }
      }
      const zeroFlag = flags.has('0') && !flags.has('-') && !special;
      return padNumeric(sign, '', body, width, flags.has('-'), zeroFlag);
    }
    case 's': {
      let str = arg as string;
      if (hasPrecision) str = str.slice(0, precision as number);
      const padLen = width - str.length;
      if (padLen <= 0) return str;
      return flags.has('-') ? str + ' '.repeat(padLen) : ' '.repeat(padLen) + str;
    }
    case 'c': {
      const str = arg as string;
      const padLen = width - str.length;
      if (padLen <= 0) return str;
      return flags.has('-') ? str + ' '.repeat(padLen) : ' '.repeat(padLen) + str;
    }
    default:
      throw new Error(`unsupported conversion: %${conv}`);
  }
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let result = '';
  let argIndex = 0;
  const re = /%([-+0 #]*)(\d*)(?:\.(\d*))?(.)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(fmt)) !== null) {
    result += fmt.slice(lastIndex, match.index);
    lastIndex = re.lastIndex;
    const [, flagsStr, widthStr, precStr, conv] = match;
    if (conv === '%') {
      result += '%';
      continue;
    }
    const flags = new Set(flagsStr.split(''));
    const width = widthStr ? parseInt(widthStr, 10) : 0;
    const hasPrecision = precStr !== undefined;
    const precision = hasPrecision ? (precStr === '' ? 0 : parseInt(precStr, 10)) : undefined;
    const arg = args[argIndex++];
    result += formatOne(conv, flags, width, precision, hasPrecision, arg);
  }
  result += fmt.slice(lastIndex);
  return result;
}
