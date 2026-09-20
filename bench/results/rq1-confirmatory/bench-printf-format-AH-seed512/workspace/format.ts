function decompose(x: number): { mantissa: bigint; exp2: number } {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, x);
  const bits = dv.getBigUint64(0);
  const expBits = Number((bits >> 52n) & 0x7ffn);
  const mantissaBits = bits & 0xfffffffffffffn;
  if (expBits === 0) {
    return { mantissa: mantissaBits, exp2: -1074 };
  }
  return { mantissa: mantissaBits | (1n << 52n), exp2: expBits - 1075 };
}

function toFraction(absX: number): { num: bigint; den: bigint } {
  if (absX === 0) return { num: 0n, den: 1n };
  const { mantissa, exp2 } = decompose(absX);
  if (exp2 >= 0) return { num: mantissa << BigInt(exp2), den: 1n };
  return { num: mantissa, den: 1n << BigInt(-exp2) };
}

function roundDiv(num: bigint, den: bigint): bigint {
  let q = num / den;
  const r = num % den;
  const twice = r * 2n;
  if (twice > den) q += 1n;
  else if (twice === den && q % 2n === 1n) q += 1n;
  return q;
}

// round(value * 10^p) as a bigint, exact based on num/den (den a power of 2)
function scaleRound(num: bigint, den: bigint, p: number): bigint {
  if (num === 0n) return 0n;
  if (p >= 0) return roundDiv(num * 10n ** BigInt(p), den);
  return roundDiv(num, den * 10n ** BigInt(-p));
}

// digits/fracPart for %f-style: precision p fractional digits
function fDigits(num: bigint, den: bigint, p: number): { intPart: string; fracPart: string } {
  const scaled = scaleRound(num, den, p);
  let s = scaled.toString();
  if (p === 0) return { intPart: s, fracPart: '' };
  if (s.length <= p) s = s.padStart(p + 1, '0');
  return { intPart: s.slice(0, s.length - p), fracPart: s.slice(s.length - p) };
}

// significant-digit representation for %e-style: sigDigits significant digits, decimal exponent X
function sciDigits(num: bigint, den: bigint, sigDigits: number, xApprox: number): { digits: string; exp: number } {
  if (num === 0n) return { digits: '0'.repeat(sigDigits), exp: 0 };
  let X = xApprox;
  for (let iter = 0; iter < 10; iter++) {
    const p = sigDigits - 1 - X;
    const scaled = scaleRound(num, den, p);
    const s = scaled.toString();
    if (s.length > sigDigits) {
      X += 1;
      continue;
    }
    if (s.length < sigDigits) {
      X -= 1;
      continue;
    }
    return { digits: s, exp: X };
  }
  throw new Error('sciDigits failed to converge');
}

function trimTrailingZeros(frac: string): string {
  let end = frac.length;
  while (end > 0 && frac[end - 1] === '0') end--;
  return frac.slice(0, end);
}

function toBigIntMagnitude(v: number | bigint): bigint {
  return typeof v === 'bigint' ? (v < 0n ? -v : v) : BigInt(Math.abs(v));
}

function isNegativeIntArg(v: number | bigint): boolean {
  return typeof v === 'bigint' ? v < 0n : v < 0;
}

function applyPrecisionToDigits(digits: string, precisionGiven: boolean, precisionVal: number): string {
  if (!precisionGiven) return digits;
  if (digits === '0' && precisionVal === 0) return '';
  if (digits.length < precisionVal) return digits.padStart(precisionVal, '0');
  return digits;
}

function padNumeric(
  prefixPart: string,
  digitsPart: string,
  width: number,
  dashFlag: boolean,
  zeroFlag: boolean,
  zeroApplicable: boolean
): string {
  const content = prefixPart + digitsPart;
  if (content.length >= width) return content;
  const padLen = width - content.length;
  if (dashFlag) return content + ' '.repeat(padLen);
  if (zeroFlag && zeroApplicable) return prefixPart + '0'.repeat(padLen) + digitsPart;
  return ' '.repeat(padLen) + content;
}

function padGeneric(content: string, width: number, dashFlag: boolean): string {
  if (content.length >= width) return content;
  const padLen = width - content.length;
  return dashFlag ? content + ' '.repeat(padLen) : ' '.repeat(padLen) + content;
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let argIndex = 0;
  const re = /%([-+0# ]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc%])/g;

  return fmt.replace(re, (_match, flagsStr: string, widthStr: string, precStr: string | undefined, conv: string) => {
    if (conv === '%') return '%';

    const dashFlag = flagsStr.includes('-');
    const plusFlag = flagsStr.includes('+');
    const spaceFlag = flagsStr.includes(' ');
    const zeroFlag = flagsStr.includes('0');
    const hashFlag = flagsStr.includes('#');
    const width = widthStr ? parseInt(widthStr, 10) : 0;
    const precisionGiven = precStr !== undefined;
    const precisionVal = precStr === undefined ? 0 : precStr === '' ? 0 : parseInt(precStr, 10);

    const signPrefix = (negative: boolean): string => (negative ? '-' : plusFlag ? '+' : spaceFlag ? ' ' : '');

    if (conv === 'd' || conv === 'i') {
      const arg = args[argIndex++] as number | bigint;
      const negative = isNegativeIntArg(arg);
      const mag = toBigIntMagnitude(arg);
      const digits = applyPrecisionToDigits(mag.toString(), precisionGiven, precisionVal);
      const sign = signPrefix(negative);
      const zeroApplicable = !precisionGiven;
      return padNumeric(sign, digits, width, dashFlag, zeroFlag, zeroApplicable);
    }

    if (conv === 'x' || conv === 'X' || conv === 'o') {
      const arg = args[argIndex++] as number | bigint;
      const mag = toBigIntMagnitude(arg);
      let digits =
        conv === 'o' ? mag.toString(8) : conv === 'x' ? mag.toString(16) : mag.toString(16).toUpperCase();
      digits = applyPrecisionToDigits(digits, precisionGiven, precisionVal);

      let prefix = '';
      if (hashFlag) {
        if (conv === 'o') {
          if (digits.length === 0 || digits[0] !== '0') digits = '0' + digits;
        } else if (mag !== 0n) {
          prefix = conv === 'x' ? '0x' : '0X';
        }
      }
      const zeroApplicable = !precisionGiven;
      return padNumeric(prefix, digits, width, dashFlag, zeroFlag, zeroApplicable);
    }

    if (conv === 'e' || conv === 'E' || conv === 'f' || conv === 'F' || conv === 'g' || conv === 'G') {
      const x = args[argIndex++] as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';

      if (Number.isNaN(x)) {
        const body = upper ? 'NAN' : 'nan';
        return padNumeric('', body, width, dashFlag, false, false);
      }

      const negative = x < 0 || Object.is(x, -0);
      const sign = signPrefix(negative);

      if (!Number.isFinite(x)) {
        const body = upper ? 'INF' : 'inf';
        return padNumeric(sign, body, width, dashFlag, false, false);
      }

      const absX = Math.abs(x);
      const { num, den } = toFraction(absX);

      if (conv === 'f' || conv === 'F') {
        const p = precisionGiven ? precisionVal : 6;
        const { intPart, fracPart } = fDigits(num, den, p);
        const dot = p === 0 ? (hashFlag ? '.' : '') : '.' + fracPart;
        const body = intPart + dot;
        return padNumeric(sign, body, width, dashFlag, zeroFlag, true);
      }

      if (conv === 'e' || conv === 'E') {
        const p = precisionGiven ? precisionVal : 6;
        const xApprox = absX === 0 ? 0 : Math.floor(Math.log10(absX));
        const { digits, exp } = sciDigits(num, den, p + 1, xApprox);
        const mantissa = digits[0];
        const frac = digits.slice(1);
        const dot = p === 0 ? (hashFlag ? '.' : '') : '.' + frac;
        const expSign = exp >= 0 ? '+' : '-';
        const expDigits = String(Math.abs(exp)).padStart(2, '0');
        const body = mantissa + dot + (upper ? 'E' : 'e') + expSign + expDigits;
        return padNumeric(sign, body, width, dashFlag, zeroFlag, true);
      }

      // g, G
      const Peff = precisionGiven ? (precisionVal === 0 ? 1 : precisionVal) : 6;
      const xApprox = absX === 0 ? 0 : Math.floor(Math.log10(absX));
      const { digits, exp: X } = sciDigits(num, den, Peff, xApprox);

      let body: string;
      if (Peff > X && X >= -4) {
        const fPrecision = Peff - 1 - X;
        const { intPart, fracPart: rawFrac } = fDigits(num, den, fPrecision);
        let dot: string;
        if (hashFlag) {
          dot = fPrecision === 0 ? '.' : '.' + rawFrac;
        } else {
          const trimmed = trimTrailingZeros(rawFrac);
          dot = trimmed.length > 0 ? '.' + trimmed : '';
        }
        body = intPart + dot;
      } else {
        const ePrecision = Peff - 1;
        const mantissa = digits[0];
        const rawFrac = digits.slice(1);
        let dot: string;
        if (hashFlag) {
          dot = ePrecision === 0 ? '.' : '.' + rawFrac;
        } else {
          const trimmed = trimTrailingZeros(rawFrac);
          dot = trimmed.length > 0 ? '.' + trimmed : '';
        }
        const expSign = X >= 0 ? '+' : '-';
        const expDigits = String(Math.abs(X)).padStart(2, '0');
        body = mantissa + dot + (upper ? 'E' : 'e') + expSign + expDigits;
      }
      return padNumeric(sign, body, width, dashFlag, zeroFlag, true);
    }

    if (conv === 's') {
      const arg = args[argIndex++] as string;
      const content = precisionGiven ? arg.slice(0, precisionVal) : arg;
      return padGeneric(content, width, dashFlag);
    }

    if (conv === 'c') {
      const arg = args[argIndex++] as string;
      return padGeneric(arg, width, dashFlag);
    }

    return _match;
  });
}
