function decomposeDouble(absX: number): { M: bigint; e2: number } {
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setFloat64(0, absX);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  const mantHigh = hi & 0xfffff;
  const mantissa = (BigInt(mantHigh) << 32n) | BigInt(lo);
  if (expBits === 0) {
    return { M: mantissa, e2: -1074 };
  }
  return { M: mantissa | (1n << 52n), e2: expBits - 1075 };
}

// Returns round(absX * 10^k), ties to even, based on the exact binary value of absX.
function roundScaled(absX: number, k: number): bigint {
  if (absX === 0) return 0n;
  const { M, e2 } = decomposeDouble(absX);
  const p2 = e2 + k;
  const p5 = k;
  let numerator = M;
  let denominator = 1n;
  if (p2 >= 0) numerator *= 2n ** BigInt(p2);
  else denominator *= 2n ** BigInt(-p2);
  if (p5 >= 0) numerator *= 5n ** BigInt(p5);
  else denominator *= 5n ** BigInt(-p5);
  let quotient = numerator / denominator;
  const remainder = numerator % denominator;
  const twice = remainder * 2n;
  if (twice > denominator) quotient += 1n;
  else if (twice === denominator && quotient % 2n !== 0n) quotient += 1n;
  return quotient;
}

function fixedDigits(absX: number, precision: number): string {
  const scaled = roundScaled(absX, precision);
  let s = scaled.toString();
  s = s.padStart(precision + 1, '0');
  const cut = s.length - precision;
  const intPart = s.slice(0, cut);
  if (precision > 0) return intPart + '.' + s.slice(cut);
  return intPart;
}

function toExpParts(absX: number, precision: number): { digits: string; exp: number } {
  if (absX === 0) return { digits: '0'.repeat(precision + 1), exp: 0 };
  let X = Math.floor(Math.log10(absX));
  let digitsBig = roundScaled(absX, precision - X);
  const lower = 10n ** BigInt(precision);
  const upper = 10n ** BigInt(precision + 1);
  while (digitsBig >= upper) {
    X++;
    digitsBig = roundScaled(absX, precision - X);
  }
  while (digitsBig < lower) {
    X--;
    digitsBig = roundScaled(absX, precision - X);
  }
  return { digits: digitsBig.toString().padStart(precision + 1, '0'), exp: X };
}

function stripTrailingZeros(s: string, hasHash: boolean): string {
  if (hasHash) return s;
  if (!s.includes('.')) return s;
  s = s.replace(/0+$/, '');
  if (s.endsWith('.')) s = s.slice(0, -1);
  return s;
}

function padNumber(
  sign: string,
  prefix: string,
  digits: string,
  width: number,
  leftAlign: boolean,
  zeroFlag: boolean,
): string {
  const full = sign + prefix + digits;
  if (full.length >= width) return full;
  const padLen = width - full.length;
  if (leftAlign) return full + ' '.repeat(padLen);
  if (zeroFlag) return sign + prefix + '0'.repeat(padLen) + digits;
  return ' '.repeat(padLen) + full;
}

function expSuffix(exp: number, letter: string): string {
  const expSign = exp < 0 ? '-' : '+';
  const expAbs = Math.abs(exp).toString().padStart(2, '0');
  return letter + expSign + expAbs;
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  const re = /%([-+ 0#]*)(\d*)(\.(\d*))?([a-zA-Z%])/g;
  let result = '';
  let lastIndex = 0;
  let argIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = re.exec(fmt)) !== null) {
    result += fmt.slice(lastIndex, match.index);
    lastIndex = re.lastIndex;

    const [, flagsStr, widthStr, precGroup, precDigits, conv] = match;

    if (conv === '%') {
      result += '%';
      continue;
    }

    const hasMinus = flagsStr.includes('-');
    const hasPlus = flagsStr.includes('+');
    const hasSpace = flagsStr.includes(' ');
    const hasZero = flagsStr.includes('0');
    const hasHash = flagsStr.includes('#');
    const width = widthStr === '' ? 0 : parseInt(widthStr, 10);
    const precision = precGroup === undefined ? undefined : precDigits === '' ? 0 : parseInt(precDigits, 10);

    const arg = args[argIndex++];

    if (conv === 'd' || conv === 'i') {
      const big = typeof arg === 'bigint' ? arg : BigInt(arg as number);
      const isNeg = big < 0n;
      const mag = isNeg ? -big : big;
      let digits: string;
      if (precision !== undefined) {
        if (precision === 0 && mag === 0n) digits = '';
        else digits = mag.toString().padStart(precision, '0');
      } else {
        digits = mag.toString();
      }
      const sign = isNeg ? '-' : hasPlus ? '+' : hasSpace ? ' ' : '';
      const zeroFlag = hasZero && !hasMinus && precision === undefined;
      result += padNumber(sign, '', digits, width, hasMinus, zeroFlag);
    } else if (conv === 'x' || conv === 'X' || conv === 'o') {
      const big = typeof arg === 'bigint' ? arg : BigInt(arg as number);
      const base = conv === 'o' ? 8 : 16;
      let digits: string;
      if (precision !== undefined) {
        if (precision === 0 && big === 0n) digits = '';
        else digits = big.toString(base).padStart(precision, '0');
      } else {
        digits = big.toString(base);
      }
      if (conv === 'X') digits = digits.toUpperCase();
      let prefix = '';
      if (hasHash) {
        if (conv === 'o') {
          if (digits.length === 0 || digits[0] !== '0') digits = '0' + digits;
        } else if (big !== 0n) {
          prefix = conv === 'x' ? '0x' : '0X';
        }
      }
      const zeroFlag = hasZero && !hasMinus && precision === undefined;
      result += padNumber('', prefix, digits, width, hasMinus, zeroFlag);
    } else if (conv === 'e' || conv === 'E' || conv === 'f' || conv === 'F' || conv === 'g' || conv === 'G') {
      const x = arg as number;
      const isNaN_ = Number.isNaN(x);
      const upper = conv === 'E' || conv === 'F' || conv === 'G';

      if (isNaN_) {
        const body = upper ? 'NAN' : 'nan';
        result += padNumber('', '', body, width, hasMinus, false);
        continue;
      }

      const negative = x < 0 || Object.is(x, -0);
      const sign = negative ? '-' : hasPlus ? '+' : hasSpace ? ' ' : '';

      if (!Number.isFinite(x)) {
        const body = upper ? 'INF' : 'inf';
        result += padNumber(sign, '', body, width, hasMinus, false);
        continue;
      }

      const absX = Math.abs(x);
      const zeroFlag = hasZero && !hasMinus;

      if (conv === 'f' || conv === 'F') {
        const prec = precision !== undefined ? precision : 6;
        let body = fixedDigits(absX, prec);
        if (prec === 0 && hasHash) body += '.';
        result += padNumber(sign, '', body, width, hasMinus, zeroFlag);
      } else if (conv === 'e' || conv === 'E') {
        const prec = precision !== undefined ? precision : 6;
        const { digits, exp } = toExpParts(absX, prec);
        const first = digits[0];
        const rest = digits.slice(1);
        let mantissa: string;
        if (prec > 0) mantissa = first + '.' + rest;
        else mantissa = first + (hasHash ? '.' : '');
        const body = mantissa + expSuffix(exp, conv === 'E' ? 'E' : 'e');
        result += padNumber(sign, '', body, width, hasMinus, zeroFlag);
      } else {
        // g, G
        const P = precision === undefined ? 6 : precision === 0 ? 1 : precision;
        const { digits, exp: X } = toExpParts(absX, P - 1);
        let body: string;
        if (P > X && X >= -4) {
          const prec = P - 1 - X;
          let fbody = fixedDigits(absX, prec);
          if (prec === 0 && hasHash) fbody += '.';
          body = stripTrailingZeros(fbody, hasHash);
        } else {
          const prec = P - 1;
          const first = digits[0];
          const rest = digits.slice(1, 1 + prec);
          let mantissa: string;
          if (prec > 0) mantissa = first + '.' + rest;
          else mantissa = first + (hasHash ? '.' : '');
          mantissa = stripTrailingZeros(mantissa, hasHash);
          body = mantissa + expSuffix(X, conv === 'G' ? 'E' : 'e');
        }
        result += padNumber(sign, '', body, width, hasMinus, zeroFlag);
      }
    } else if (conv === 's') {
      const str = arg as string;
      const body = precision !== undefined ? str.slice(0, precision) : str;
      result += padNumber('', '', body, width, hasMinus, false);
    } else if (conv === 'c') {
      const body = arg as string;
      result += padNumber('', '', body, width, hasMinus, false);
    }
  }

  result += fmt.slice(lastIndex);
  return result;
}
