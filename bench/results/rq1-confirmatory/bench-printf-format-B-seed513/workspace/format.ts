type Arg = number | bigint | string;

interface Spec {
  flags: Set<string>;
  width: number | null;
  precision: number | null;
  conv: string;
}

function parseSpecs(fmt: string): (string | Spec)[] {
  const tokens: (string | Spec)[] = [];
  let i = 0;
  let literal = '';
  while (i < fmt.length) {
    const ch = fmt[i];
    if (ch !== '%') {
      literal += ch;
      i++;
      continue;
    }
    // ch === '%'
    let j = i + 1;
    const flags = new Set<string>();
    while (j < fmt.length && '-+0 #'.includes(fmt[j])) {
      flags.add(fmt[j]);
      j++;
    }
    let widthStr = '';
    while (j < fmt.length && /[0-9]/.test(fmt[j])) {
      widthStr += fmt[j];
      j++;
    }
    let precision: number | null = null;
    if (j < fmt.length && fmt[j] === '.') {
      j++;
      let precStr = '';
      while (j < fmt.length && /[0-9]/.test(fmt[j])) {
        precStr += fmt[j];
        j++;
      }
      precision = precStr === '' ? 0 : parseInt(precStr, 10);
    }
    const conv = fmt[j];
    j++;
    if (literal) {
      tokens.push(literal);
      literal = '';
    }
    tokens.push({
      flags,
      width: widthStr === '' ? null : parseInt(widthStr, 10),
      precision,
      conv,
    });
    i = j;
  }
  if (literal) tokens.push(literal);
  return tokens;
}

function padNumber(
  sign: string,
  prefix: string,
  digits: string,
  width: number | null,
  zeroFlag: boolean,
  minusFlag: boolean
): string {
  const body = sign + prefix + digits;
  if (width === null || body.length >= width) return body;
  const padLen = width - body.length;
  if (minusFlag) return body + ' '.repeat(padLen);
  if (zeroFlag) return sign + prefix + '0'.repeat(padLen) + digits;
  return ' '.repeat(padLen) + body;
}

function padText(text: string, width: number | null, minusFlag: boolean): string {
  if (width === null || text.length >= width) return text;
  const padLen = width - text.length;
  if (minusFlag) return text + ' '.repeat(padLen);
  return ' '.repeat(padLen) + text;
}

// Exact decimal expansion of a non-negative finite number.
function exactDecimal(x: number): { intPart: bigint; frac: string } {
  if (x === 0) return { intPart: 0n, frac: '' };
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setFloat64(0, x);
  const hi = view.getUint32(0);
  const lo = view.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  const mantHi = hi & 0xfffff;
  const mantissa = (BigInt(mantHi) << 32n) | BigInt(lo >>> 0);
  let M: bigint;
  let e2: number;
  if (expBits === 0) {
    M = mantissa;
    e2 = -1074;
  } else {
    M = mantissa | (1n << 52n);
    e2 = expBits - 1075;
  }
  if (e2 >= 0) {
    return { intPart: M << BigInt(e2), frac: '' };
  }
  const k = -e2;
  const numerator = M * 5n ** BigInt(k);
  const denom = 10n ** BigInt(k);
  const intPart = numerator / denom;
  const fracVal = numerator % denom;
  const frac = fracVal.toString().padStart(k, '0');
  return { intPart, frac };
}

// Round (intPart + 0.frac) to exactly p fractional digits, round-half-to-even.
function roundFixed(intPart: bigint, frac: string, p: number): { intPart: bigint; frac: string } {
  if (frac.length <= p) {
    return { intPart, frac: frac.padEnd(p, '0') };
  }
  const kept = frac.slice(0, p);
  const rest = frac.slice(p);
  const firstRest = rest[0];
  const restZeroAfter = /^0*$/.test(rest.slice(1));
  let roundUp = false;
  if (firstRest > '5') {
    roundUp = true;
  } else if (firstRest === '5') {
    if (!restZeroAfter) {
      roundUp = true;
    } else {
      const lastDigitChar = p > 0 ? kept[p - 1] : intPart.toString().slice(-1);
      roundUp = parseInt(lastDigitChar, 10) % 2 === 1;
    }
  }
  if (!roundUp) {
    return { intPart, frac: kept };
  }
  const combinedStr = intPart.toString() + kept;
  let resultStr = (BigInt(combinedStr) + 1n).toString();
  if (resultStr.length < combinedStr.length) {
    resultStr = resultStr.padStart(combinedStr.length, '0');
  }
  if (p === 0) {
    return { intPart: BigInt(resultStr), frac: '' };
  }
  const newFrac = resultStr.slice(-p);
  const newIntStr = resultStr.slice(0, resultStr.length - p) || '0';
  return { intPart: BigInt(newIntStr), frac: newFrac };
}

function signFor(negative: boolean, plusFlag: boolean, spaceFlag: boolean): string {
  if (negative) return '-';
  if (plusFlag) return '+';
  if (spaceFlag) return ' ';
  return '';
}

function isNegativeValue(x: number): boolean {
  return x < 0 || Object.is(x, -0);
}

function formatFixed(x: number, precision: number, hashFlag: boolean, plusFlag: boolean, spaceFlag: boolean): { sign: string; digits: string } {
  const neg = isNegativeValue(x);
  const { intPart, frac } = exactDecimal(Math.abs(x));
  const rounded = roundFixed(intPart, frac, precision);
  let digits = rounded.intPart.toString();
  if (precision > 0 || hashFlag) {
    digits += '.' + rounded.frac;
  }
  return { sign: signFor(neg, plusFlag, spaceFlag), digits };
}

function formatExp(
  x: number,
  precision: number,
  hashFlag: boolean,
  plusFlag: boolean,
  spaceFlag: boolean,
  upper: boolean
): { sign: string; digits: string } {
  const neg = isNegativeValue(x);
  const ax = Math.abs(x);
  const sign = signFor(neg, plusFlag, spaceFlag);
  if (ax === 0) {
    let mantissa = '0';
    if (precision > 0 || hashFlag) mantissa += '.' + '0'.repeat(precision);
    const e = upper ? 'E' : 'e';
    return { sign, digits: mantissa + e + '+00' };
  }
  const { intPart, frac } = exactDecimal(ax);
  const intStr = intPart.toString();
  const allDigits = intStr + frac;
  const pointPos = intStr.length;
  let firstNonZero = allDigits.search(/[1-9]/);
  // allDigits always has at least one nonzero digit since ax !== 0
  let exponent = pointPos - 1 - firstNonZero;
  const firstDigit = allDigits[firstNonZero];
  const rest = allDigits.slice(firstNonZero + 1);
  const rounded = roundFixed(BigInt(firstDigit), rest, precision);
  let leadDigit: string;
  let fracDigits: string;
  if (rounded.intPart >= 10n) {
    exponent += 1;
    leadDigit = '1';
    fracDigits = '0'.repeat(precision);
  } else {
    leadDigit = rounded.intPart.toString();
    fracDigits = rounded.frac;
  }
  let mantissa = leadDigit;
  if (precision > 0 || hashFlag) mantissa += '.' + fracDigits;
  const eChar = upper ? 'E' : 'e';
  const expSign = exponent < 0 ? '-' : '+';
  const expAbs = Math.abs(exponent).toString().padStart(2, '0');
  return { sign, digits: mantissa + eChar + expSign + expAbs };
}

function formatGeneral(
  x: number,
  precisionIn: number,
  hashFlag: boolean,
  plusFlag: boolean,
  spaceFlag: boolean,
  upper: boolean
): { sign: string; digits: string } {
  const P = precisionIn === 0 ? 1 : precisionIn;
  const neg = isNegativeValue(x);
  const ax = Math.abs(x);
  const sign = signFor(neg, plusFlag, spaceFlag);

  if (ax === 0) {
    if (hashFlag) {
      const digits = '0.' + '0'.repeat(P - 1);
      return { sign, digits };
    }
    return { sign, digits: '0' };
  }

  // Determine X: exponent in e-style with P-1 digits after point, after rounding.
  const { intPart, frac } = exactDecimal(ax);
  const intStr = intPart.toString();
  const allDigits = intStr + frac;
  const pointPos = intStr.length;
  const firstNonZero = allDigits.search(/[1-9]/);
  let X = pointPos - 1 - firstNonZero;
  const firstDigit = allDigits[firstNonZero];
  const rest = allDigits.slice(firstNonZero + 1);
  const rounded = roundFixed(BigInt(firstDigit), rest, P - 1);
  let leadDigit: string;
  let fracDigits: string;
  if (rounded.intPart >= 10n) {
    X += 1;
    leadDigit = '1';
    fracDigits = '0'.repeat(P - 1);
  } else {
    leadDigit = rounded.intPart.toString();
    fracDigits = rounded.frac;
  }

  let digits: string;
  if (P > X && X >= -4) {
    // f style with precision P-1-X
    const fPrecision = P - 1 - X;
    // Reconstruct exact value from rounded significant digits and re-round to fPrecision.
    // Significant digits: leadDigit + fracDigits represent value = leadDigit.fracDigits * 10^X
    const sigDigits = leadDigit + fracDigits; // P digits total
    // value's digit string positioned with decimal point after position (X+1) from the left of sigDigits
    let combinedInt: bigint;
    let combinedFrac: string;
    if (X >= 0) {
      const intLen = X + 1;
      const intPortion = sigDigits.slice(0, intLen).padEnd(intLen, '0');
      combinedInt = BigInt(intPortion === '' ? '0' : intPortion);
      combinedFrac = sigDigits.slice(intLen);
    } else {
      combinedInt = 0n;
      combinedFrac = '0'.repeat(-X - 1) + sigDigits;
    }
    const r2 = roundFixed(combinedInt, combinedFrac, fPrecision);
    let intDigits = r2.intPart.toString();
    let fdigits = r2.frac;
    if (hashFlag) {
      digits = intDigits + '.' + fdigits;
    } else {
      let trimmed = fdigits.replace(/0+$/, '');
      digits = intDigits + (trimmed.length > 0 ? '.' + trimmed : '');
    }
  } else {
    // e style with precision P-1
    let mantissa = leadDigit;
    if (hashFlag) {
      mantissa += '.' + fracDigits;
    } else {
      const trimmed = fracDigits.replace(/0+$/, '');
      mantissa += trimmed.length > 0 ? '.' + trimmed : '';
    }
    const eChar = upper ? 'E' : 'e';
    const expSign = X < 0 ? '-' : '+';
    const expAbs = Math.abs(X).toString().padStart(2, '0');
    digits = mantissa + eChar + expSign + expAbs;
  }
  return { sign, digits };
}

function toBigIntArg(v: Arg): bigint {
  if (typeof v === 'bigint') return v;
  if (typeof v === 'number') return BigInt(v);
  throw new Error('expected integer argument');
}

export function format(fmt: string, ...args: Arg[]): string {
  const tokens = parseSpecs(fmt);
  let out = '';
  let argIdx = 0;

  for (const token of tokens) {
    if (typeof token === 'string') {
      out += token;
      continue;
    }
    const spec = token;
    if (spec.conv === '%') {
      out += '%';
      continue;
    }
    const arg = args[argIdx++];
    const minusFlag = spec.flags.has('-');
    const zeroFlag = spec.flags.has('0') && !minusFlag;
    const plusFlag = spec.flags.has('+');
    const spaceFlag = spec.flags.has(' ');
    const hashFlag = spec.flags.has('#');

    switch (spec.conv) {
      case 'd':
      case 'i': {
        const val = toBigIntArg(arg);
        const neg = val < 0n;
        const abs = neg ? -val : val;
        let digits: string;
        if (spec.precision === 0 && abs === 0n) {
          digits = '';
        } else {
          digits = abs.toString();
          if (spec.precision !== null && digits.length < spec.precision) {
            digits = digits.padStart(spec.precision, '0');
          }
        }
        const sign = signFor(neg, plusFlag, spaceFlag);
        const effectiveZero = zeroFlag && spec.precision === null;
        out += padNumber(sign, '', digits, spec.width, effectiveZero, minusFlag);
        break;
      }
      case 'x':
      case 'X':
      case 'o': {
        const val = toBigIntArg(arg);
        let digits: string;
        if (spec.conv === 'o') {
          digits = val.toString(8);
        } else {
          digits = val.toString(16);
          if (spec.conv === 'X') digits = digits.toUpperCase();
        }
        let precision = spec.precision;
        if (spec.conv === 'o' && hashFlag) {
          const requiredPrecision = digits[0] === '0' ? digits.length : digits.length + 1;
          precision = Math.max(precision ?? 0, requiredPrecision);
        }
        if (precision === 0 && val === 0n) {
          digits = '';
        } else if (precision !== null && digits.length < precision) {
          digits = digits.padStart(precision, '0');
        }
        let prefix = '';
        if (hashFlag && (spec.conv === 'x' || spec.conv === 'X') && val !== 0n) {
          prefix = spec.conv === 'x' ? '0x' : '0X';
        }
        const effectiveZero = zeroFlag && spec.precision === null;
        out += padNumber('', prefix, digits, spec.width, effectiveZero, minusFlag);
        break;
      }
      case 'f':
      case 'F': {
        const x = arg as number;
        const precision = spec.precision === null ? 6 : spec.precision;
        if (Number.isNaN(x)) {
          const txt = spec.conv === 'F' ? 'NAN' : 'nan';
          out += padText(txt, spec.width, minusFlag);
        } else if (!Number.isFinite(x)) {
          const neg = x < 0;
          const sign = signFor(neg, plusFlag, spaceFlag);
          const txt = spec.conv === 'F' ? 'INF' : 'inf';
          out += padNumber(sign, '', txt, spec.width, false, minusFlag);
        } else {
          const { sign, digits } = formatFixed(x, precision, hashFlag, plusFlag, spaceFlag);
          out += padNumber(sign, '', digits, spec.width, zeroFlag, minusFlag);
        }
        break;
      }
      case 'e':
      case 'E': {
        const x = arg as number;
        const precision = spec.precision === null ? 6 : spec.precision;
        const upper = spec.conv === 'E';
        if (Number.isNaN(x)) {
          const txt = upper ? 'NAN' : 'nan';
          out += padText(txt, spec.width, minusFlag);
        } else if (!Number.isFinite(x)) {
          const neg = x < 0;
          const sign = signFor(neg, plusFlag, spaceFlag);
          const txt = upper ? 'INF' : 'inf';
          out += padNumber(sign, '', txt, spec.width, false, minusFlag);
        } else {
          const { sign, digits } = formatExp(x, precision, hashFlag, plusFlag, spaceFlag, upper);
          out += padNumber(sign, '', digits, spec.width, zeroFlag, minusFlag);
        }
        break;
      }
      case 'g':
      case 'G': {
        const x = arg as number;
        const precision = spec.precision === null ? 6 : spec.precision;
        const upper = spec.conv === 'G';
        if (Number.isNaN(x)) {
          const txt = upper ? 'NAN' : 'nan';
          out += padText(txt, spec.width, minusFlag);
        } else if (!Number.isFinite(x)) {
          const neg = x < 0;
          const sign = signFor(neg, plusFlag, spaceFlag);
          const txt = upper ? 'INF' : 'inf';
          out += padNumber(sign, '', txt, spec.width, false, minusFlag);
        } else {
          const { sign, digits } = formatGeneral(x, precision, hashFlag, plusFlag, spaceFlag, upper);
          out += padNumber(sign, '', digits, spec.width, zeroFlag, minusFlag);
        }
        break;
      }
      case 's': {
        let s = arg as string;
        if (spec.precision !== null) s = s.slice(0, spec.precision);
        out += padText(s, spec.width, minusFlag);
        break;
      }
      case 'c': {
        const s = arg as string;
        out += padText(s, spec.width, minusFlag);
        break;
      }
      default:
        throw new Error(`unsupported conversion: %${spec.conv}`);
    }
  }

  return out;
}
