export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let out = '';
  let argIndex = 0;
  const re = /%([-+ 0#]*)(\d*)(\.(\d*))?([a-zA-Z%])/g;
  let lastEnd = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(fmt)) !== null) {
    out += fmt.slice(lastEnd, m.index);
    lastEnd = m.index + m[0].length;

    const flags = m[1];
    const widthStr = m[2];
    const precGiven = m[3] !== undefined;
    const precStr = m[4];
    const conv = m[5];

    if (conv === '%') {
      out += '%';
      continue;
    }

    const hasMinus = flags.includes('-');
    const hasPlus = flags.includes('+');
    const hasSpace = flags.includes(' ');
    const hasZero = flags.includes('0');
    const hasHash = flags.includes('#');
    const width = widthStr ? parseInt(widthStr, 10) : 0;
    const precision = precGiven ? (precStr === '' ? 0 : parseInt(precStr, 10)) : undefined;

    const arg = args[argIndex++];

    out += convertOne(conv, arg, { hasMinus, hasPlus, hasSpace, hasZero, hasHash, width, precision });
  }
  out += fmt.slice(lastEnd);
  return out;
}

interface Flags {
  hasMinus: boolean;
  hasPlus: boolean;
  hasSpace: boolean;
  hasZero: boolean;
  hasHash: boolean;
  width: number;
  precision: number | undefined;
}

function applyPadding(sign: string, prefix: string, digits: string, width: number, hasMinus: boolean, zeroPad: boolean): string {
  const content = sign + prefix + digits;
  if (content.length >= width) return content;
  const padLen = width - content.length;
  if (hasMinus) return content + ' '.repeat(padLen);
  if (zeroPad) return sign + prefix + '0'.repeat(padLen) + digits;
  return ' '.repeat(padLen) + content;
}

function bitLen(n: bigint): number {
  return n === 0n ? 0 : n.toString(2).length;
}

function roundQuotient(N: bigint, D: bigint): bigint {
  let Q = N / D;
  const R = N % D;
  const twiceR = R * 2n;
  if (twiceR > D) {
    Q += 1n;
  } else if (twiceR === D) {
    if (Q % 2n === 1n) Q += 1n;
  }
  return Q;
}

function splitFloat(absX: number): { num: bigint; den: bigint } {
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setFloat64(0, absX);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const exponent = (hi >>> 20) & 0x7ff;
  const mantHi = hi & 0xfffff;
  const mantissa = (BigInt(mantHi) << 32n) | BigInt(lo);
  let num: bigint;
  let e2: number;
  if (exponent === 0) {
    num = mantissa;
    e2 = -1074;
  } else {
    num = mantissa + (1n << 52n);
    e2 = exponent - 1075;
  }
  let den: bigint;
  if (e2 >= 0) {
    num = num << BigInt(e2);
    den = 1n;
  } else {
    den = 1n << BigInt(-e2);
  }
  return { num, den };
}

function compareValueToPow10(num: bigint, den: bigint, exp: number): number {
  if (exp >= 0) {
    const rhs = den * 10n ** BigInt(exp);
    return num < rhs ? -1 : num > rhs ? 1 : 0;
  } else {
    const lhs = num * 10n ** BigInt(-exp);
    return lhs < den ? -1 : lhs > den ? 1 : 0;
  }
}

function findExp(num: bigint, den: bigint): number {
  let exp = Math.floor((bitLen(num) - bitLen(den)) * Math.log10(2));
  while (compareValueToPow10(num, den, exp) < 0) exp--;
  while (compareValueToPow10(num, den, exp + 1) >= 0) exp++;
  return exp;
}

function computeExpAndDigits(num: bigint, den: bigint, numDigits: number): { digits: string; exp: number } {
  if (num === 0n) {
    return { digits: '0'.repeat(numDigits), exp: 0 };
  }
  let exp = findExp(num, den);
  const k = exp - numDigits + 1;
  let N: bigint;
  let D: bigint;
  if (k >= 0) {
    N = num;
    D = den * 10n ** BigInt(k);
  } else {
    N = num * 10n ** BigInt(-k);
    D = den;
  }
  let Q = roundQuotient(N, D);
  let digits = Q.toString();
  if (digits.length > numDigits) {
    exp += digits.length - numDigits;
    digits = digits.slice(0, numDigits);
  } else if (digits.length < numDigits) {
    digits = digits.padStart(numDigits, '0');
  }
  return { digits, exp };
}

function fFormat(num: bigint, den: bigint, p: number): { intPart: string; fracPart: string } {
  const N = num * 10n ** BigInt(p);
  const Q = roundQuotient(N, den);
  const s = Q.toString().padStart(p + 1, '0');
  const intPart = s.slice(0, s.length - p) || '0';
  const fracPart = p > 0 ? s.slice(s.length - p) : '';
  return { intPart, fracPart };
}

function signBit(x: number): boolean {
  if (Number.isNaN(x)) return false;
  return x < 0 || Object.is(x, -0);
}

function signStr(neg: boolean, hasPlus: boolean, hasSpace: boolean): string {
  if (neg) return '-';
  if (hasPlus) return '+';
  if (hasSpace) return ' ';
  return '';
}

function convertOne(conv: string, arg: number | bigint | string, f: Flags): string {
  const { hasMinus, hasPlus, hasSpace, hasZero, hasHash, width, precision } = f;

  switch (conv) {
    case 'd':
    case 'i': {
      const value: bigint = typeof arg === 'bigint' ? arg : BigInt(arg as number);
      const isNeg = value < 0n;
      const mag = isNeg ? -value : value;
      let digitsStr = mag.toString();
      if (precision !== undefined) {
        if (precision === 0 && mag === 0n) {
          digitsStr = '';
        } else if (digitsStr.length < precision) {
          digitsStr = digitsStr.padStart(precision, '0');
        }
      }
      const sign = isNeg ? '-' : hasPlus ? '+' : hasSpace ? ' ' : '';
      const zeroPad = hasZero && !hasMinus && precision === undefined;
      return applyPadding(sign, '', digitsStr, width, hasMinus, zeroPad);
    }
    case 'x':
    case 'X':
    case 'o': {
      const value: bigint = typeof arg === 'bigint' ? arg : BigInt(arg as number);
      let digitsStr = value.toString(conv === 'o' ? 8 : 16);
      if (conv === 'X') digitsStr = digitsStr.toUpperCase();
      if (precision !== undefined) {
        if (precision === 0 && value === 0n) {
          digitsStr = '';
        } else if (digitsStr.length < precision) {
          digitsStr = digitsStr.padStart(precision, '0');
        }
      }
      let prefix = '';
      if (hasHash) {
        if (conv === 'o') {
          if (digitsStr === '') {
            digitsStr = '0';
          } else if (digitsStr[0] !== '0') {
            digitsStr = '0' + digitsStr;
          }
        } else if (value !== 0n) {
          prefix = conv === 'X' ? '0X' : '0x';
        }
      }
      const zeroPad = hasZero && !hasMinus && precision === undefined;
      return applyPadding('', prefix, digitsStr, width, hasMinus, zeroPad);
    }
    case 'e':
    case 'E':
    case 'f':
    case 'F':
    case 'g':
    case 'G': {
      const x = arg as number;
      const isUpper = conv === 'E' || conv === 'F' || conv === 'G';
      if (Number.isNaN(x)) {
        const text = isUpper ? 'NAN' : 'nan';
        return applyPadding('', '', text, width, hasMinus, false);
      }
      const neg = signBit(x);
      const sign = signStr(neg, hasPlus, hasSpace);
      if (!Number.isFinite(x)) {
        const text = isUpper ? 'INF' : 'inf';
        return applyPadding(sign, '', text, width, hasMinus, false);
      }

      const { num, den } = splitFloat(Math.abs(x));
      const zeroPad = hasZero && !hasMinus;

      if (conv === 'f' || conv === 'F') {
        const p = precision === undefined ? 6 : precision;
        const { intPart, fracPart } = fFormat(num, den, p);
        let text: string;
        if (p === 0) {
          text = intPart + (hasHash ? '.' : '');
        } else {
          text = intPart + '.' + fracPart;
        }
        return applyPadding(sign, '', text, width, hasMinus, zeroPad);
      }

      if (conv === 'e' || conv === 'E') {
        const p = precision === undefined ? 6 : precision;
        const { digits, exp } = computeExpAndDigits(num, den, p + 1);
        const digit = digits[0];
        const frac = digits.slice(1);
        let mantissa: string;
        if (p === 0) {
          mantissa = digit + (hasHash ? '.' : '');
        } else {
          mantissa = digit + '.' + frac;
        }
        const expChar = conv === 'E' ? 'E' : 'e';
        const expSign = exp < 0 ? '-' : '+';
        const expAbs = Math.abs(exp).toString().padStart(2, '0');
        const text = mantissa + expChar + expSign + expAbs;
        return applyPadding(sign, '', text, width, hasMinus, zeroPad);
      }

      // g, G
      const P = precision === undefined ? 6 : precision === 0 ? 1 : precision;
      const { digits, exp: X } = computeExpAndDigits(num, den, P);
      const useF = P > X && X >= -4;
      let text: string;
      if (useF) {
        const fp = P - 1 - X;
        const { intPart, fracPart } = fFormat(num, den, fp);
        let frac = fracPart;
        if (!hasHash) frac = frac.replace(/0+$/, '');
        if (frac) {
          text = intPart + '.' + frac;
        } else {
          text = intPart + (hasHash ? '.' : '');
        }
      } else {
        const digit = digits[0];
        let frac = digits.slice(1);
        if (!hasHash) frac = frac.replace(/0+$/, '');
        let mantissa: string;
        if (frac) {
          mantissa = digit + '.' + frac;
        } else {
          mantissa = digit + (hasHash ? '.' : '');
        }
        const expChar = conv === 'G' ? 'E' : 'e';
        const expSign = X < 0 ? '-' : '+';
        const expAbs = Math.abs(X).toString().padStart(2, '0');
        text = mantissa + expChar + expSign + expAbs;
      }
      return applyPadding(sign, '', text, width, hasMinus, zeroPad);
    }
    case 's': {
      let text = arg as string;
      if (precision !== undefined) text = text.slice(0, precision);
      return applyPadding('', '', text, width, hasMinus, false);
    }
    case 'c': {
      const text = arg as string;
      return applyPadding('', '', text, width, hasMinus, false);
    }
    default:
      throw new Error(`Unsupported conversion: %${conv}`);
  }
}
