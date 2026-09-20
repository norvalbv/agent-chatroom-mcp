// Exact conversion of a finite non-negative double into num/den (den a power of two),
// so that value === num/den exactly (as an infinite-precision rational).
function toExactFraction(x: number): { num: bigint; den: bigint } {
  if (x === 0) return { num: 0n, den: 1n };
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const exponent = (hi >>> 20) & 0x7ff;
  const mantissaHi = hi & 0xfffff;
  const mantissa = (BigInt(mantissaHi) << 32n) | BigInt(lo);
  let num: bigint;
  let e2: number;
  if (exponent === 0) {
    num = mantissa;
    e2 = -1074;
  } else {
    num = mantissa | (1n << 52n);
    e2 = exponent - 1075;
  }
  if (e2 >= 0) {
    return { num: num << BigInt(e2), den: 1n };
  }
  return { num, den: 1n << BigInt(-e2) };
}

// Round num/den * 10^k to the nearest integer, ties to even. k may be negative.
function roundScaled(num: bigint, den: bigint, k: number): bigint {
  let numerator: bigint;
  let denominator: bigint;
  if (k >= 0) {
    numerator = num * 10n ** BigInt(k);
    denominator = den;
  } else {
    numerator = num;
    denominator = den * 10n ** BigInt(-k);
  }
  let q = numerator / denominator;
  const r = numerator % denominator;
  const twice = r * 2n;
  if (twice > denominator) {
    q += 1n;
  } else if (twice === denominator) {
    if (q % 2n === 1n) q += 1n;
  }
  return q;
}

// Compute the decimal exponent X (10^X <= value < 10^(X+1)) and N correctly-rounded
// significant digits of num/den, adjusting X for any rounding carry-over.
function computeExponent(
  num: bigint,
  den: bigint,
  N: number,
  approxAbs: number
): { X: number; digits: string } {
  if (num === 0n) return { X: 0, digits: '0'.repeat(N) };

  const cmp = (e: number): number => {
    let a = num;
    let b = den;
    if (e >= 0) b = b * 10n ** BigInt(e);
    else a = a * 10n ** BigInt(-e);
    return a < b ? -1 : a > b ? 1 : 0;
  };

  let X = Math.floor(Math.log10(approxAbs));
  if (!Number.isFinite(X)) X = 0;
  while (cmp(X) < 0) X--;
  while (cmp(X + 1) >= 0) X++;

  let digits = roundScaled(num, den, N - 1 - X).toString();
  if (digits.length > N) {
    X += digits.length - N;
    digits = digits.slice(0, N);
  } else if (digits.length < N) {
    digits = digits.padStart(N, '0');
  }
  return { X, digits };
}

function formatFBody(num: bigint, den: bigint, precision: number, hash: boolean): string {
  const digits = roundScaled(num, den, precision).toString().padStart(precision + 1, '0');
  if (precision > 0) {
    const intPart = digits.slice(0, digits.length - precision);
    const fracPart = digits.slice(digits.length - precision);
    return intPart + '.' + fracPart;
  }
  return digits + (hash ? '.' : '');
}

function formatEBody(
  num: bigint,
  den: bigint,
  precision: number,
  hash: boolean,
  letter: string,
  approxAbs: number
): string {
  const N = precision + 1;
  const { X, digits } = computeExponent(num, den, N, approxAbs);
  const first = digits[0];
  const rest = digits.slice(1);
  const frac = precision > 0 ? '.' + rest : hash ? '.' : '';
  const expSign = X < 0 ? '-' : '+';
  const expDigits = Math.abs(X).toString().padStart(2, '0');
  return first + frac + letter + expSign + expDigits;
}

function stripTrailingZeros(body: string, isFStyle: boolean): string {
  if (isFStyle) {
    if (!body.includes('.')) return body;
    return body.replace(/0+$/, '').replace(/\.$/, '');
  }
  const idx = body.search(/[eE]/);
  let mantissa = body.slice(0, idx);
  const rest = body.slice(idx);
  if (mantissa.includes('.')) {
    mantissa = mantissa.replace(/0+$/, '').replace(/\.$/, '');
  }
  return mantissa + rest;
}

function formatGBody(
  num: bigint,
  den: bigint,
  precisionIn: number,
  hash: boolean,
  upper: boolean,
  approxAbs: number
): string {
  const P = precisionIn === 0 ? 1 : precisionIn;
  const { X } = computeExponent(num, den, P, approxAbs);
  let body: string;
  let isFStyle: boolean;
  if (P > X && X >= -4) {
    isFStyle = true;
    body = formatFBody(num, den, P - 1 - X, hash);
  } else {
    isFStyle = false;
    body = formatEBody(num, den, P - 1, hash, upper ? 'E' : 'e', approxAbs);
  }
  if (!hash) body = stripTrailingZeros(body, isFStyle);
  return body;
}

function computeSign(value: number, plusFlag: boolean, spaceFlag: boolean): string {
  const negative = value < 0 || Object.is(value, -0);
  if (negative) return '-';
  if (plusFlag) return '+';
  if (spaceFlag) return ' ';
  return '';
}

function applyWidth(
  prefix: string,
  digits: string,
  width: number,
  leftAlign: boolean,
  zeroPad: boolean
): string {
  const body = prefix + digits;
  if (body.length >= width) return body;
  const padLen = width - body.length;
  if (leftAlign) return body + ' '.repeat(padLen);
  if (zeroPad) return prefix + '0'.repeat(padLen) + digits;
  return ' '.repeat(padLen) + body;
}

const SPEC_RE = /%([-+0 #]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc%])/g;

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let result = '';
  let argIndex = 0;
  let lastEnd = 0;
  SPEC_RE.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = SPEC_RE.exec(fmt)) !== null) {
    result += fmt.slice(lastEnd, match.index);
    lastEnd = SPEC_RE.lastIndex;

    const [, flagsStr, widthStr, precisionStr, conv] = match;

    if (conv === '%') {
      result += '%';
      continue;
    }

    const leftFlag = flagsStr.includes('-');
    const plusFlag = flagsStr.includes('+');
    const spaceFlag = flagsStr.includes(' ');
    const zeroFlag = flagsStr.includes('0');
    const hashFlag = flagsStr.includes('#');
    const width = widthStr === '' ? 0 : parseInt(widthStr, 10);
    const precisionGiven = precisionStr !== undefined;
    const precisionVal = precisionGiven ? (precisionStr === '' ? 0 : parseInt(precisionStr, 10)) : 0;

    const arg = args[argIndex++];

    switch (conv) {
      case 'd':
      case 'i': {
        const val: bigint = typeof arg === 'bigint' ? arg : BigInt(arg as number);
        const negative = val < 0n;
        const mag = negative ? -val : val;
        let digits: string;
        if (precisionGiven) {
          digits = precisionVal === 0 && mag === 0n ? '' : mag.toString().padStart(precisionVal, '0');
        } else {
          digits = mag.toString();
        }
        const sign = negative ? '-' : plusFlag ? '+' : spaceFlag ? ' ' : '';
        const zeroPad = zeroFlag && !leftFlag && !precisionGiven;
        result += applyWidth(sign, digits, width, leftFlag, zeroPad);
        break;
      }
      case 'x':
      case 'X':
      case 'o': {
        const mag: bigint = typeof arg === 'bigint' ? arg : BigInt(arg as number);
        let digits = conv === 'o' ? mag.toString(8) : mag.toString(16);
        if (conv === 'X') digits = digits.toUpperCase();
        if (precisionGiven) {
          digits = precisionVal === 0 && mag === 0n ? '' : digits.padStart(precisionVal, '0');
        }
        let prefix = '';
        if (hashFlag) {
          if (conv === 'o') {
            if (digits === '' || digits[0] !== '0') digits = '0' + digits;
          } else if (mag !== 0n) {
            prefix = conv === 'X' ? '0X' : '0x';
          }
        }
        const zeroPad = zeroFlag && !leftFlag && !precisionGiven;
        result += applyWidth(prefix, digits, width, leftFlag, zeroPad);
        break;
      }
      case 'e':
      case 'E':
      case 'f':
      case 'F':
      case 'g':
      case 'G': {
        const value = arg as number;
        if (Number.isNaN(value)) {
          const text = conv === 'E' || conv === 'F' || conv === 'G' ? 'NAN' : 'nan';
          result += applyWidth('', text, width, leftFlag, false);
          break;
        }
        if (!Number.isFinite(value)) {
          const sign = value < 0 ? '-' : plusFlag ? '+' : spaceFlag ? ' ' : '';
          const text = conv === 'E' || conv === 'F' || conv === 'G' ? 'INF' : 'inf';
          result += applyWidth(sign, text, width, leftFlag, false);
          break;
        }
        const sign = computeSign(value, plusFlag, spaceFlag);
        const approxAbs = Math.abs(value);
        const { num, den } = toExactFraction(approxAbs);
        let body: string;
        if (conv === 'f' || conv === 'F') {
          const precision = precisionGiven ? precisionVal : 6;
          body = formatFBody(num, den, precision, hashFlag);
        } else if (conv === 'e' || conv === 'E') {
          const precision = precisionGiven ? precisionVal : 6;
          body = formatEBody(num, den, precision, hashFlag, conv === 'E' ? 'E' : 'e', approxAbs);
        } else {
          const precisionIn = precisionGiven ? precisionVal : 6;
          body = formatGBody(num, den, precisionIn, hashFlag, conv === 'G', approxAbs);
        }
        const zeroPad = zeroFlag && !leftFlag;
        result += applyWidth(sign, body, width, leftFlag, zeroPad);
        break;
      }
      case 's': {
        let str = arg as string;
        if (precisionGiven) str = str.slice(0, precisionVal);
        result += applyWidth('', str, width, leftFlag, false);
        break;
      }
      case 'c': {
        const str = arg as string;
        result += applyWidth('', str, width, leftFlag, false);
        break;
      }
    }
  }

  result += fmt.slice(lastEnd);
  return result;
}
