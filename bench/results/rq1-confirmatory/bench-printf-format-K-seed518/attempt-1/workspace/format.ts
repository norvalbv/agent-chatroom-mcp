// ---- Exact double decomposition and big-integer decimal rounding ----

function decompose(value: number): { M: bigint; E: number } {
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setFloat64(0, value);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const biasedExp = (hi >>> 20) & 0x7ff;
  const mantissaHi = BigInt(hi & 0xfffff);
  const mantissaLo = BigInt(lo >>> 0);
  const mantissa = (mantissaHi << 32n) | mantissaLo;
  if (biasedExp === 0) {
    return { M: mantissa, E: -1074 };
  }
  return { M: mantissa | (1n << 52n), E: biasedExp - 1075 };
}

// Round(value * 10^p) to nearest integer, ties to even, exact.
function roundToInt(M: bigint, E: number, p: number): bigint {
  let numerator = M;
  let denominator = 1n;
  if (p >= 0) numerator *= 5n ** BigInt(p);
  else denominator *= 5n ** BigInt(-p);
  const a = E + p;
  if (a >= 0) numerator *= 2n ** BigInt(a);
  else denominator *= 2n ** BigInt(-a);
  let quotient = numerator / denominator;
  const remainder = numerator - quotient * denominator;
  const doubled = remainder * 2n;
  if (doubled > denominator) quotient += 1n;
  else if (doubled === denominator && quotient % 2n !== 0n) quotient += 1n;
  return quotient;
}

// Compare M*2^E to 10^k exactly. Returns -1, 0 or 1.
function compareToPow10(M: bigint, E: number, k: number): number {
  let numerator = M;
  let denom = 1n;
  if (E >= 0) numerator *= 2n ** BigInt(E);
  else denom *= 2n ** BigInt(-E);
  let rNum = 1n;
  let rDenom = 1n;
  if (k >= 0) rNum = 10n ** BigInt(k);
  else rDenom = 10n ** BigInt(-k);
  const lhs = numerator * rDenom;
  const rhs = rNum * denom;
  if (lhs < rhs) return -1;
  if (lhs > rhs) return 1;
  return 0;
}

function decimalExponent(value: number, M: bigint, E: number): number {
  let X = Math.floor(Math.log10(value));
  if (!Number.isFinite(X)) X = 0;
  while (compareToPow10(M, E, X + 1) >= 0) X++;
  while (compareToPow10(M, E, X) < 0) X--;
  return X;
}

// Compute P correctly-rounded significant digits of absValue, ties to even,
// plus the base-10 exponent of the (rounded) leading digit.
function getSignificantDigits(absValue: number, P: number): { digits: string; exp: number } {
  if (absValue === 0) return { digits: '0'.repeat(P), exp: 0 };
  const { M, E } = decompose(absValue);
  let X = decimalExponent(absValue, M, E);
  let N = roundToInt(M, E, P - 1 - X);
  let digits = N.toString();
  if (digits.length > P) {
    X += 1;
    N = N / 10n;
    digits = N.toString();
  }
  if (digits.length < P) digits = digits.padStart(P, '0');
  return { digits, exp: X };
}

function stripTrailingZeros(s: string): string {
  if (!s.includes('.')) return s;
  s = s.replace(/0+$/, '');
  if (s.endsWith('.')) s = s.slice(0, -1);
  return s;
}

// ---- Padding helpers ----

function padNumeric(
  sign: string,
  prefix: string,
  digits: string,
  width: number,
  zeroFill: boolean,
  leftAlign: boolean
): string {
  const body = sign + prefix + digits;
  if (body.length >= width) return body;
  const padLen = width - body.length;
  if (leftAlign) return body + ' '.repeat(padLen);
  if (zeroFill) return sign + prefix + '0'.repeat(padLen) + digits;
  return ' '.repeat(padLen) + body;
}

function padText(text: string, width: number, leftAlign: boolean): string {
  if (text.length >= width) return text;
  const padLen = width - text.length;
  return leftAlign ? text + ' '.repeat(padLen) : ' '.repeat(padLen) + text;
}

// ---- Float body builders ----

function buildExponential(absValue: number, prec: number, hash: boolean, upper: boolean): string {
  const P = prec + 1;
  const { digits, exp } = getSignificantDigits(absValue, P);
  const first = digits[0];
  const rest = digits.slice(1);
  const mantissa = rest.length > 0 ? first + '.' + rest : first + (hash ? '.' : '');
  const expSign = exp < 0 ? '-' : '+';
  const expDigits = Math.abs(exp).toString().padStart(2, '0');
  return mantissa + (upper ? 'E' : 'e') + expSign + expDigits;
}

function buildFixed(absValue: number, prec: number, hash: boolean): string {
  const { M, E } = decompose(absValue);
  const N = roundToInt(M, E, prec);
  const digits = N.toString().padStart(prec + 1, '0');
  const intPart = prec > 0 ? digits.slice(0, digits.length - prec) : digits;
  const fracPart = prec > 0 ? digits.slice(digits.length - prec) : '';
  if (prec === 0) return hash ? intPart + '.' : intPart;
  return intPart + '.' + fracPart;
}

function buildGeneral(absValue: number, P: number, hash: boolean, upper: boolean): string {
  const { digits, exp: X } = getSignificantDigits(absValue, P);
  if (P > X && X >= -4) {
    let intPart: string;
    let fracPart: string;
    if (X >= 0) {
      intPart = digits.slice(0, X + 1);
      fracPart = digits.slice(X + 1);
    } else {
      intPart = '0';
      fracPart = '0'.repeat(-X - 1) + digits;
    }
    let body = fracPart.length > 0 ? intPart + '.' + fracPart : intPart + (hash ? '.' : '');
    if (!hash) body = stripTrailingZeros(body);
    return body;
  }
  const first = digits[0];
  const rest = digits.slice(1);
  let mantissa = rest.length > 0 ? first + '.' + rest : first + (hash ? '.' : '');
  if (!hash) mantissa = stripTrailingZeros(mantissa);
  const expSign = X < 0 ? '-' : '+';
  const expDigits = Math.abs(X).toString().padStart(2, '0');
  return mantissa + (upper ? 'E' : 'e') + expSign + expDigits;
}

function toBigIntArg(arg: number | bigint | string): bigint {
  return typeof arg === 'bigint' ? arg : BigInt(arg as number);
}

// ---- Main formatter ----

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  const re = /%([-+0 #]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc%])/g;
  let result = '';
  let lastIndex = 0;
  let argIndex = 0;
  let m: RegExpExecArray | null;

  while ((m = re.exec(fmt)) !== null) {
    result += fmt.slice(lastIndex, m.index);
    lastIndex = re.lastIndex;
    const [, flagsStr, widthStr, precStr, conv] = m;

    if (conv === '%') {
      result += '%';
      continue;
    }

    const leftAlign = flagsStr.includes('-');
    const plusFlag = flagsStr.includes('+');
    const spaceFlag = flagsStr.includes(' ');
    const zeroFlag = flagsStr.includes('0');
    const hashFlag = flagsStr.includes('#');
    const width = widthStr ? parseInt(widthStr, 10) : 0;
    const hasPrecision = precStr !== undefined;
    const precision = hasPrecision ? (precStr === '' ? 0 : parseInt(precStr, 10)) : undefined;
    const arg = args[argIndex++];

    switch (conv) {
      case 'd':
      case 'i': {
        const value = toBigIntArg(arg);
        const neg = value < 0n;
        const abs = neg ? -value : value;
        let digits: string;
        if (hasPrecision) {
          digits = precision === 0 && abs === 0n ? '' : abs.toString().padStart(precision!, '0');
        } else {
          digits = abs.toString();
        }
        const sign = neg ? '-' : plusFlag ? '+' : spaceFlag ? ' ' : '';
        const zeroFill = zeroFlag && !hasPrecision;
        result += padNumeric(sign, '', digits, width, zeroFill, leftAlign);
        break;
      }
      case 'x':
      case 'X':
      case 'o': {
        const value = toBigIntArg(arg);
        const base = conv === 'o' ? 8 : 16;
        let digits: string;
        if (hasPrecision) {
          digits = precision === 0 && value === 0n ? '' : value.toString(base).padStart(precision!, '0');
        } else {
          digits = value.toString(base);
        }
        if (conv === 'X') digits = digits.toUpperCase();
        let prefix = '';
        if (hashFlag) {
          if (conv === 'o') {
            if (digits.length === 0 || digits[0] !== '0') digits = '0' + digits;
          } else if (value !== 0n) {
            prefix = conv === 'X' ? '0X' : '0x';
          }
        }
        const zeroFill = zeroFlag && !hasPrecision;
        result += padNumeric('', prefix, digits, width, zeroFill, leftAlign);
        break;
      }
      case 'e':
      case 'E':
      case 'f':
      case 'F':
      case 'g':
      case 'G': {
        const value = arg as number;
        const upper = conv === conv.toUpperCase();
        if (Number.isNaN(value)) {
          const text = upper ? 'NAN' : 'nan';
          result += padNumeric('', '', text, width, false, leftAlign);
          break;
        }
        const negative = value < 0 || Object.is(value, -0);
        const sign = negative ? '-' : plusFlag ? '+' : spaceFlag ? ' ' : '';
        if (!Number.isFinite(value)) {
          const text = upper ? 'INF' : 'inf';
          result += padNumeric(sign, '', text, width, false, leftAlign);
          break;
        }
        const absValue = Math.abs(value);
        const prec = hasPrecision ? precision! : 6;
        let digitsBody: string;
        if (conv === 'e' || conv === 'E') {
          digitsBody = buildExponential(absValue, prec, hashFlag, upper);
        } else if (conv === 'f' || conv === 'F') {
          digitsBody = buildFixed(absValue, prec, hashFlag);
        } else {
          const P = hasPrecision ? (precision === 0 ? 1 : precision!) : 6;
          digitsBody = buildGeneral(absValue, P, hashFlag, upper);
        }
        result += padNumeric(sign, '', digitsBody, width, zeroFlag, leftAlign);
        break;
      }
      case 's': {
        let text = arg as string;
        if (hasPrecision) text = text.slice(0, precision!);
        result += padText(text, width, leftAlign);
        break;
      }
      case 'c': {
        const text = arg as string;
        result += padText(text, width, leftAlign);
        break;
      }
    }
  }

  result += fmt.slice(lastIndex);
  return result;
}
