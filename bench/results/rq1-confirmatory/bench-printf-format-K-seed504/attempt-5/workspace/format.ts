type Flags = {
  minus: boolean;
  plus: boolean;
  space: boolean;
  zero: boolean;
  hash: boolean;
};

function parseFlags(s: string): Flags {
  return {
    minus: s.includes('-'),
    plus: s.includes('+'),
    space: s.includes(' '),
    zero: s.includes('0'),
    hash: s.includes('#'),
  };
}

function toBigInt(v: number | bigint | string): bigint {
  if (typeof v === 'bigint') return v;
  if (typeof v === 'number') return BigInt(v);
  throw new Error('expected numeric argument');
}

// Decompose a finite non-zero double into mantissa * 2^exp (exact).
function decompose(x: number): { mantissa: bigint; exp: number } {
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setFloat64(0, x);
  const hi = view.getUint32(0);
  const lo = view.getUint32(4);
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
  return { mantissa, exp };
}

// Represents |x| exactly as digits / 10^scale, digits is a non-negative BigInt.
function exactDecimal(x: number): { digits: bigint; scale: number } {
  if (x === 0) return { digits: 0n, scale: 0 };
  const { mantissa, exp } = decompose(x);
  if (exp >= 0) {
    return { digits: mantissa << BigInt(exp), scale: 0 };
  } else {
    const e = -exp;
    return { digits: mantissa * 5n ** BigInt(e), scale: e };
  }
}

// Round digits/10^scale to targetScale fractional decimal digits, ties to even.
function roundDigits(digits: bigint, scale: number, targetScale: number): { digits: bigint; scale: number } {
  if (targetScale >= scale) {
    return { digits: digits * 10n ** BigInt(targetScale - scale), scale: targetScale };
  }
  const diff = scale - targetScale;
  const divisor = 10n ** BigInt(diff);
  let q = digits / divisor;
  const r = digits % divisor;
  const twiceR = r * 2n;
  if (twiceR > divisor) {
    q += 1n;
  } else if (twiceR === divisor) {
    if (q % 2n === 1n) q += 1n;
  }
  return { digits: q, scale: targetScale };
}

function formatFixed(digits: bigint, scale: number, precision: number): { intPart: string; fracPart: string } {
  const rounded = roundDigits(digits, scale, precision);
  let str = rounded.digits.toString();
  if (str.length <= precision) str = str.padStart(precision + 1, '0');
  const intPart = str.slice(0, str.length - precision) || '0';
  const fracPart = precision > 0 ? str.slice(str.length - precision) : '';
  return { intPart, fracPart };
}

function eFormat(digits: bigint, scale: number, p: number): { mantissa: string; exponent: number } {
  if (digits === 0n) return { mantissa: '0'.repeat(p + 1), exponent: 0 };
  const L = digits.toString().length;
  const targetScale = scale - (L - (p + 1));
  const rounded = roundDigits(digits, scale, targetScale);
  let newStr = rounded.digits.toString();
  const newL = newStr.length;
  const exponent = newL - 1 - rounded.scale;
  const mantissa = newL > p + 1 ? newStr.slice(0, p + 1) : newStr.padStart(p + 1, '0');
  return { mantissa, exponent };
}

function stripTrailingZeros(s: string): string {
  if (!s.includes('.')) return s;
  s = s.replace(/0+$/, '');
  s = s.replace(/\.$/, '');
  return s;
}

function padSimple(str: string, width: number, left: boolean): string {
  if (str.length >= width) return str;
  const pad = ' '.repeat(width - str.length);
  return left ? str + pad : pad + str;
}

function padNumeric(sign: string, prefix: string, digits: string, width: number, zeroFlag: boolean, left: boolean): string {
  const body = sign + prefix + digits;
  if (body.length >= width) return body;
  const padLen = width - body.length;
  if (left) return body + ' '.repeat(padLen);
  if (zeroFlag) return sign + prefix + '0'.repeat(padLen) + digits;
  return ' '.repeat(padLen) + body;
}

function signFor(neg: boolean, flags: Flags): string {
  if (neg) return '-';
  if (flags.plus) return '+';
  if (flags.space) return ' ';
  return '';
}

function isNegZeroOrNeg(x: number): boolean {
  return x < 0 || Object.is(x, -0);
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let result = '';
  let argIndex = 0;
  const re = /%([-+0 #]*)(\d*)(?:\.(\d*))?(.)/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;

  while ((m = re.exec(fmt)) !== null) {
    result += fmt.slice(lastIndex, m.index);
    lastIndex = re.lastIndex;

    const flagsStr = m[1];
    const widthStr = m[2];
    const precisionStr = m[3];
    const conv = m[4];

    if (conv === '%') {
      result += '%';
      continue;
    }

    const flags = parseFlags(flagsStr);
    const width = widthStr ? parseInt(widthStr, 10) : 0;
    const precision = precisionStr === undefined ? undefined : precisionStr === '' ? 0 : parseInt(precisionStr, 10);

    const arg = args[argIndex++];

    switch (conv) {
      case 'd':
      case 'i': {
        const value = toBigInt(arg);
        const neg = value < 0n;
        const abs = neg ? -value : value;
        const absStr = abs.toString();
        let digits: string;
        if (precision !== undefined) {
          digits = precision === 0 && abs === 0n ? '' : absStr.padStart(precision, '0');
        } else {
          digits = absStr;
        }
        const sign = signFor(neg, flags);
        const zeroFlag = flags.zero && precision === undefined;
        result += padNumeric(sign, '', digits, width, zeroFlag, flags.minus);
        break;
      }
      case 'x':
      case 'X':
      case 'o': {
        const value = toBigInt(arg);
        const absStr = conv === 'o' ? value.toString(8) : value.toString(16);
        const baseStr = conv === 'X' ? absStr.toUpperCase() : absStr;
        let digits: string;
        if (precision !== undefined) {
          digits = precision === 0 && value === 0n ? '' : baseStr.padStart(precision, '0');
        } else {
          digits = baseStr;
        }
        let prefix = '';
        if (flags.hash) {
          if (conv === 'o') {
            if (digits.length === 0 || digits[0] !== '0') digits = '0' + digits;
          } else if (value !== 0n) {
            prefix = conv === 'X' ? '0X' : '0x';
          }
        }
        const zeroFlag = flags.zero && precision === undefined;
        result += padNumeric('', prefix, digits, width, zeroFlag, flags.minus);
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
        let sign: string;
        let body: string;
        let zeroFlag = flags.zero;

        if (Number.isNaN(x)) {
          sign = '';
          body = upper ? 'NAN' : 'nan';
          zeroFlag = false;
        } else if (!Number.isFinite(x)) {
          const neg = x < 0;
          sign = signFor(neg, flags);
          body = upper ? 'INF' : 'inf';
          zeroFlag = false;
        } else {
          const neg = isNegZeroOrNeg(x);
          sign = signFor(neg, flags);
          const abs = Math.abs(x);
          const { digits, scale } = exactDecimal(abs);

          if (conv === 'e' || conv === 'E') {
            const p = precision === undefined ? 6 : precision;
            const { mantissa, exponent } = eFormat(digits, scale, p);
            const intDigit = mantissa[0];
            const frac = mantissa.slice(1);
            const dot = p > 0 || flags.hash ? '.' : '';
            const expSign = exponent < 0 ? '-' : '+';
            const expAbs = Math.abs(exponent).toString().padStart(2, '0');
            body = intDigit + dot + frac + (upper ? 'E' : 'e') + expSign + expAbs;
          } else if (conv === 'f' || conv === 'F') {
            const p = precision === undefined ? 6 : precision;
            const { intPart, fracPart } = formatFixed(digits, scale, p);
            const dot = p > 0 || flags.hash ? '.' : '';
            body = intPart + dot + fracPart;
          } else {
            // g, G
            const P = precision === undefined ? 6 : precision === 0 ? 1 : precision;
            const { exponent: X } = eFormat(digits, scale, P - 1);
            if (P > X && X >= -4) {
              const precisionF = P - 1 - X;
              const { intPart, fracPart } = formatFixed(digits, scale, precisionF);
              let combined = fracPart.length > 0 ? intPart + '.' + fracPart : flags.hash ? intPart + '.' : intPart;
              if (!flags.hash) combined = stripTrailingZeros(combined);
              body = combined;
            } else {
              const { mantissa, exponent } = eFormat(digits, scale, P - 1);
              const intDigit = mantissa[0];
              let frac = mantissa.slice(1);
              if (!flags.hash) frac = frac.replace(/0+$/, '');
              const dot = frac.length > 0 || flags.hash ? '.' : '';
              const expSign = exponent < 0 ? '-' : '+';
              const expAbs = Math.abs(exponent).toString().padStart(2, '0');
              body = intDigit + dot + frac + (upper ? 'E' : 'e') + expSign + expAbs;
            }
          }
        }

        result += padNumeric(sign, '', body, width, zeroFlag, flags.minus);
        break;
      }
      case 's': {
        let str = arg as string;
        if (precision !== undefined) str = str.slice(0, precision);
        result += padSimple(str, width, flags.minus);
        break;
      }
      case 'c': {
        const str = arg as string;
        result += padSimple(str, width, flags.minus);
        break;
      }
      default:
        throw new Error(`unsupported conversion: %${conv}`);
    }
  }

  result += fmt.slice(lastIndex);
  return result;
}
