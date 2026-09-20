type Flags = {
  minus: boolean;
  plus: boolean;
  space: boolean;
  zero: boolean;
  hash: boolean;
};

function parseFlags(s: string): Flags {
  return {
    minus: s.indexOf('-') !== -1,
    plus: s.indexOf('+') !== -1,
    space: s.indexOf(' ') !== -1,
    zero: s.indexOf('0') !== -1,
    hash: s.indexOf('#') !== -1,
  };
}

function applyWidth(
  sign: string,
  prefix: string,
  digits: string,
  width: number,
  minus: boolean,
  zero: boolean
): string {
  const body = sign + prefix + digits;
  if (body.length >= width) return body;
  const padLen = width - body.length;
  if (minus) return body + ' '.repeat(padLen);
  if (zero) return sign + prefix + '0'.repeat(padLen) + digits;
  return ' '.repeat(padLen) + body;
}

function padPlain(s: string, width: number, minus: boolean): string {
  if (s.length >= width) return s;
  const padLen = width - s.length;
  return minus ? s + ' '.repeat(padLen) : ' '.repeat(padLen) + s;
}

// ---- integer digit formatting (d, i, x, X, o) ----

function intDigits(mag: bigint, base: number, precision?: number): string {
  const raw = mag.toString(base);
  if (precision === undefined) return raw;
  if (mag === 0n && precision === 0) return '';
  return raw.padStart(precision, '0');
}

// ---- exact decimal decomposition of a finite double ----

function floatBits(x: number): { sign: number; exp: number; mant: bigint } {
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const sign = hi >>> 31;
  const exp = (hi >>> 20) & 0x7ff;
  const mant = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  return { sign, exp, mant };
}

function exactDecimalParts(absX: number): { intPart: string; fracPart: string } {
  if (absX === 0) return { intPart: '0', fracPart: '' };
  const { exp, mant } = floatBits(absX);
  let M: bigint;
  let E: number;
  if (exp === 0) {
    M = mant;
    E = -1074;
  } else {
    M = mant | (1n << 52n);
    E = exp - 1075;
  }
  let numerator: bigint;
  let k: number;
  if (E >= 0) {
    numerator = M << BigInt(E);
    k = 0;
  } else {
    k = -E;
    numerator = M * 5n ** BigInt(k);
  }
  const numStr = numerator.toString();
  let intPart: string;
  let fracPart: string;
  if (numStr.length <= k) {
    intPart = '0';
    fracPart = '0'.repeat(k - numStr.length) + numStr;
  } else {
    intPart = numStr.slice(0, numStr.length - k);
    fracPart = k === 0 ? '' : numStr.slice(numStr.length - k);
  }
  return { intPart, fracPart };
}

// Round the exact decimal number intPart.fracPart to `keepFrac` fractional
// digits, using round-half-to-even, based on the exact digits (no ambiguity).
function roundDecimal(
  intPart: string,
  fracPart: string,
  keepFrac: number
): { intPart: string; fracPart: string } {
  if (keepFrac >= fracPart.length) {
    return { intPart, fracPart: fracPart + '0'.repeat(keepFrac - fracPart.length) };
  }
  const kept = fracPart.slice(0, keepFrac);
  const rest = fracPart.slice(keepFrac);
  let roundUp = false;
  const firstRest = rest[0];
  if (firstRest > '5') {
    roundUp = true;
  } else if (firstRest === '5') {
    if (/[1-9]/.test(rest.slice(1))) {
      roundUp = true;
    } else {
      const lastKept = kept.length > 0 ? kept[kept.length - 1] : intPart[intPart.length - 1];
      roundUp = parseInt(lastKept, 10) % 2 === 1;
    }
  }
  if (!roundUp) {
    return { intPart, fracPart: kept };
  }
  const combined = intPart + kept;
  const incremented = (BigInt(combined) + 1n).toString().padStart(combined.length, '0');
  const newFrac = incremented.slice(incremented.length - keepFrac);
  const newInt = incremented.slice(0, incremented.length - keepFrac);
  return { intPart: newInt, fracPart: newFrac };
}

// Round to scientific notation: one leading digit + `precision` fractional
// digits, returning the (possibly shifted) decimal exponent.
function toExponential(
  intPart: string,
  fracPart: string,
  precision: number
): { digit: string; frac: string; exp: number } {
  const S = intPart + fracPart;
  const pointPos = intPart.length;
  let firstNonZero = -1;
  for (let i = 0; i < S.length; i++) {
    if (S[i] !== '0') {
      firstNonZero = i;
      break;
    }
  }
  if (firstNonZero === -1) {
    return { digit: '0', frac: '0'.repeat(precision), exp: 0 };
  }
  let exp = pointPos - firstNonZero - 1;
  const sig = S.slice(firstNonZero);
  const lead = sig[0];
  const rest = sig.slice(1);
  const rounded = roundDecimal(lead, rest, precision);
  let leadOut = rounded.intPart;
  let fracOut = rounded.fracPart;
  if (leadOut.length > 1) {
    exp += leadOut.length - 1;
    const combinedExtra = leadOut.slice(1) + fracOut;
    fracOut = combinedExtra.slice(0, precision);
    leadOut = leadOut[0];
  }
  return { digit: leadOut, frac: fracOut, exp };
}

function stripTrailingZerosFrac(frac: string): string {
  let end = frac.length;
  while (end > 0 && frac[end - 1] === '0') end--;
  return frac.slice(0, end);
}

function floatSign(signBit: number, plus: boolean, space: boolean): string {
  if (signBit) return '-';
  if (plus) return '+';
  if (space) return ' ';
  return '';
}

function formatExpBody(
  absX: number,
  precision: number,
  upper: boolean,
  hash: boolean
): string {
  const { intPart, fracPart } = exactDecimalParts(absX);
  const { digit, frac, exp } = toExponential(intPart, fracPart, precision);
  let out = digit;
  if (precision > 0 || hash) {
    out += '.' + frac;
  }
  const eLetter = upper ? 'E' : 'e';
  const expSign = exp < 0 ? '-' : '+';
  const expAbs = Math.abs(exp).toString().padStart(2, '0');
  return out + eLetter + expSign + expAbs;
}

function formatFixedBody(absX: number, precision: number, hash: boolean): string {
  const { intPart, fracPart } = exactDecimalParts(absX);
  const rounded = roundDecimal(intPart, fracPart, precision);
  let out = rounded.intPart;
  if (precision > 0 || hash) {
    out += '.' + rounded.fracPart;
  }
  return out;
}

function formatGBody(
  absX: number,
  P: number,
  upper: boolean,
  hash: boolean
): string {
  const { intPart, fracPart } = exactDecimalParts(absX);
  const eResult = toExponential(intPart, fracPart, P - 1);
  const X = eResult.exp;
  if (P > X && X >= -4) {
    const precisionF = P - 1 - X;
    const rounded = roundDecimal(intPart, fracPart, precisionF);
    let intOut = rounded.intPart;
    let fracOut = rounded.fracPart;
    if (!hash) {
      fracOut = stripTrailingZerosFrac(fracOut);
    }
    return fracOut.length > 0 ? intOut + '.' + fracOut : hash ? intOut + '.' : intOut;
  } else {
    let digit = eResult.digit;
    let frac = eResult.frac;
    if (!hash) {
      frac = stripTrailingZerosFrac(frac);
    }
    const eLetter = upper ? 'E' : 'e';
    const expSign = eResult.exp < 0 ? '-' : '+';
    const expAbs = Math.abs(eResult.exp).toString().padStart(2, '0');
    const mantissa = frac.length > 0 ? digit + '.' + frac : hash ? digit + '.' : digit;
    return mantissa + eLetter + expSign + expAbs;
  }
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let result = '';
  let argIndex = 0;
  const specRe = /%([-+0# ]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc%])/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = specRe.exec(fmt)) !== null) {
    result += fmt.slice(lastIndex, match.index);
    lastIndex = specRe.lastIndex;

    const [, flagsStr, widthStr, precStr, conv] = match;

    if (conv === '%') {
      result += '%';
      continue;
    }

    const flags = parseFlags(flagsStr);
    const width = widthStr === '' ? 0 : parseInt(widthStr, 10);
    const hasPrecision = precStr !== undefined;
    const precision = hasPrecision ? (precStr === '' ? 0 : parseInt(precStr, 10)) : undefined;

    const arg = args[argIndex++];

    if (conv === 'd' || conv === 'i') {
      const v = typeof arg === 'bigint' ? arg : BigInt(arg as number);
      const negative = v < 0n;
      const mag = negative ? -v : v;
      const sign = negative ? '-' : flags.plus ? '+' : flags.space ? ' ' : '';
      const digits = intDigits(mag, 10, precision);
      const zeroFlag = flags.zero && !flags.minus && precision === undefined;
      result += applyWidth(sign, '', digits, width, flags.minus, zeroFlag);
    } else if (conv === 'x' || conv === 'X' || conv === 'o') {
      const mag = typeof arg === 'bigint' ? arg : BigInt(arg as number);
      const base = conv === 'o' ? 8 : 16;
      let digits = intDigits(mag, base, precision);
      if (conv === 'X') digits = digits.toUpperCase();
      let prefix = '';
      if (flags.hash) {
        if (conv === 'o') {
          if (digits.length === 0 || digits[0] !== '0') {
            digits = digits.padStart(digits.length + 1, '0');
          }
        } else if (mag !== 0n) {
          prefix = conv === 'x' ? '0x' : '0X';
        }
      }
      const zeroFlag = flags.zero && !flags.minus && precision === undefined;
      result += applyWidth('', prefix, digits, width, flags.minus, zeroFlag);
    } else if (conv === 'e' || conv === 'E' || conv === 'f' || conv === 'F' || conv === 'g' || conv === 'G') {
      const x = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      const isNaNVal = Number.isNaN(x);
      const isInfVal = !isNaNVal && !Number.isFinite(x);
      const { sign: signBit } = floatBits(x);

      if (isNaNVal) {
        const body = upper ? 'NAN' : 'nan';
        result += padPlain(body, width, flags.minus);
        continue;
      }
      if (isInfVal) {
        const sign = signBit ? '-' : flags.plus ? '+' : flags.space ? ' ' : '';
        const body = upper ? 'INF' : 'inf';
        result += padPlain(sign + body, width, flags.minus);
        continue;
      }

      const absX = Math.abs(x);
      const sign = floatSign(signBit, flags.plus, flags.space);
      const zeroFlag = flags.zero && !flags.minus;

      let digits: string;
      if (conv === 'e' || conv === 'E') {
        const p = precision === undefined ? 6 : precision;
        digits = formatExpBody(absX, p, upper, flags.hash);
      } else if (conv === 'f' || conv === 'F') {
        const p = precision === undefined ? 6 : precision;
        digits = formatFixedBody(absX, p, flags.hash);
      } else {
        let P = precision === undefined ? 6 : precision;
        if (P === 0) P = 1;
        digits = formatGBody(absX, P, upper, flags.hash);
      }
      result += applyWidth(sign, '', digits, width, flags.minus, zeroFlag);
    } else if (conv === 's') {
      let s = arg as string;
      if (precision !== undefined) s = s.slice(0, precision);
      result += padPlain(s, width, flags.minus);
    } else if (conv === 'c') {
      const s = arg as string;
      result += padPlain(s, width, flags.minus);
    }
  }
  result += fmt.slice(lastIndex);
  return result;
}
