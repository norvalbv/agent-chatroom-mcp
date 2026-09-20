function decomposeDouble(x: number): { M: bigint; E: number } {
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const biasedExp = (hi >>> 20) & 0x7ff;
  const mantHi = hi & 0xfffff;
  const mantissa = (BigInt(mantHi) << 32n) | BigInt(lo >>> 0);
  if (biasedExp === 0) {
    return { M: mantissa, E: -1074 };
  }
  return { M: mantissa | (1n << 52n), E: biasedExp - 1075 };
}

// Returns round_half_to_even(M * 2^E * 10^d) as a bigint, exactly.
function roundScaled(M: bigint, E: number, d: number): bigint {
  const numPow5 = d >= 0 ? 5n ** BigInt(d) : 1n;
  const denPow5 = d >= 0 ? 1n : 5n ** BigInt(-d);
  const twoExp = E + d;
  const numPow2 = twoExp >= 0 ? 2n ** BigInt(twoExp) : 1n;
  const denPow2 = twoExp >= 0 ? 1n : 2n ** BigInt(-twoExp);
  const numerator = M * numPow5 * numPow2;
  const denominator = denPow5 * denPow2;
  let quotient = numerator / denominator;
  const remainder = numerator % denominator;
  const twice = remainder * 2n;
  if (twice > denominator) {
    quotient += 1n;
  } else if (twice === denominator && quotient % 2n === 1n) {
    quotient += 1n;
  }
  return quotient;
}

function formatFixed(magnitude: number, precision: number): { intPart: string; fracPart: string } {
  if (magnitude === 0) {
    return { intPart: '0', fracPart: '0'.repeat(precision) };
  }
  const { M, E } = decomposeDouble(magnitude);
  const N = roundScaled(M, E, precision);
  let s = N.toString();
  if (precision > 0) {
    if (s.length <= precision) s = s.padStart(precision + 1, '0');
    return { intPart: s.slice(0, s.length - precision), fracPart: s.slice(s.length - precision) };
  }
  return { intPart: s, fracPart: '' };
}

function formatExp(magnitude: number, precision: number): { digits: string; exp: number } {
  const S = precision + 1;
  if (magnitude === 0) {
    return { digits: '0'.repeat(S), exp: 0 };
  }
  const { M, E } = decomposeDouble(magnitude);
  let exp0 = Math.floor(Math.log10(magnitude));
  for (;;) {
    const d = S - 1 - exp0;
    const N = roundScaled(M, E, d);
    const s = N.toString();
    if (s.length > S) {
      exp0 += 1;
      continue;
    }
    if (s.length < S) {
      exp0 -= 1;
      continue;
    }
    return { digits: s, exp: exp0 };
  }
}

function signStr(negative: boolean, plusFlag: boolean, spaceFlag: boolean): string {
  if (negative) return '-';
  if (plusFlag) return '+';
  if (spaceFlag) return ' ';
  return '';
}

function padNumeric(
  sign: string,
  prefix: string,
  digits: string,
  width: number,
  leftAlign: boolean,
  zeroFlag: boolean
): string {
  const body = sign + prefix + digits;
  if (body.length >= width) return body;
  const padLen = width - body.length;
  if (leftAlign) return body + ' '.repeat(padLen);
  if (zeroFlag) return sign + prefix + '0'.repeat(padLen) + digits;
  return ' '.repeat(padLen) + body;
}

function padGeneral(str: string, width: number, leftAlign: boolean): string {
  if (str.length >= width) return str;
  const padLen = width - str.length;
  return leftAlign ? str + ' '.repeat(padLen) : ' '.repeat(padLen) + str;
}

function toBigIntArg(arg: number | bigint): bigint {
  return typeof arg === 'bigint' ? arg : BigInt(arg);
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  const re = /%([-+ 0#]*)(\d*)(\.(\d*))?([diouxXeEfFgGsc%])/g;
  let result = '';
  let lastIndex = 0;
  let argIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = re.exec(fmt)) !== null) {
    result += fmt.slice(lastIndex, match.index);
    lastIndex = re.lastIndex;

    const conv = match[5];
    if (conv === '%') {
      result += '%';
      continue;
    }

    const flags = match[1];
    const leftAlign = flags.includes('-');
    const plusFlag = flags.includes('+');
    const spaceFlag = flags.includes(' ');
    const zeroFlag = flags.includes('0');
    const hashFlag = flags.includes('#');
    const width = match[2] ? parseInt(match[2], 10) : 0;
    const precisionGiven = match[3] !== undefined;
    const precision = precisionGiven ? (match[4] === '' ? 0 : parseInt(match[4], 10)) : undefined;

    const arg = args[argIndex++];

    if (conv === 'd' || conv === 'i') {
      const v = toBigIntArg(arg as number | bigint);
      const negative = v < 0n;
      const magnitude = negative ? -v : v;
      let digits: string;
      if (precisionGiven) {
        if (precision === 0 && magnitude === 0n) digits = '';
        else digits = magnitude.toString().padStart(precision!, '0');
      } else {
        digits = magnitude.toString();
      }
      const sign = signStr(negative, plusFlag, spaceFlag);
      const zeroFlagEffective = zeroFlag && !precisionGiven;
      result += padNumeric(sign, '', digits, width, leftAlign, zeroFlagEffective);
    } else if (conv === 'x' || conv === 'X' || conv === 'o') {
      const v = toBigIntArg(arg as number | bigint);
      const radix = conv === 'o' ? 8 : 16;
      let digitsRaw = v.toString(radix);
      if (conv === 'X') digitsRaw = digitsRaw.toUpperCase();
      let digits: string;
      if (precisionGiven) {
        if (precision === 0 && v === 0n) digits = '';
        else digits = digitsRaw.padStart(precision!, '0');
      } else {
        digits = digitsRaw;
      }
      let prefix = '';
      if (hashFlag) {
        if (conv === 'o') {
          if (digits === '' || digits[0] !== '0') digits = '0' + digits;
        } else if (v !== 0n) {
          prefix = conv === 'x' ? '0x' : '0X';
        }
      }
      const zeroFlagEffective = zeroFlag && !precisionGiven;
      result += padNumeric('', prefix, digits, width, leftAlign, zeroFlagEffective);
    } else if (conv === 'f' || conv === 'F') {
      const value = arg as number;
      const isUpper = conv === 'F';
      if (Number.isNaN(value)) {
        result += padGeneral(isUpper ? 'NAN' : 'nan', width, leftAlign);
      } else if (!Number.isFinite(value)) {
        const negative = value < 0;
        const sign = signStr(negative, plusFlag, spaceFlag);
        result += padNumeric(sign, '', isUpper ? 'INF' : 'inf', width, leftAlign, false);
      } else {
        const negative = value < 0 || Object.is(value, -0);
        const magnitude = Math.abs(value);
        const p = precision === undefined ? 6 : precision;
        const { intPart, fracPart } = formatFixed(magnitude, p);
        const dot = p > 0 || hashFlag ? '.' : '';
        const sign = signStr(negative, plusFlag, spaceFlag);
        const digits = intPart + dot + fracPart;
        result += padNumeric(sign, '', digits, width, leftAlign, zeroFlag);
      }
    } else if (conv === 'e' || conv === 'E') {
      const value = arg as number;
      const isUpper = conv === 'E';
      if (Number.isNaN(value)) {
        result += padGeneral(isUpper ? 'NAN' : 'nan', width, leftAlign);
      } else if (!Number.isFinite(value)) {
        const negative = value < 0;
        const sign = signStr(negative, plusFlag, spaceFlag);
        result += padNumeric(sign, '', isUpper ? 'INF' : 'inf', width, leftAlign, false);
      } else {
        const negative = value < 0 || Object.is(value, -0);
        const magnitude = Math.abs(value);
        const p = precision === undefined ? 6 : precision;
        const { digits, exp } = formatExp(magnitude, p);
        const first = digits[0];
        const rest = digits.slice(1);
        const dot = p > 0 || hashFlag ? '.' : '';
        const expSign = exp < 0 ? '-' : '+';
        const expAbs = Math.abs(exp).toString().padStart(2, '0');
        const eChar = isUpper ? 'E' : 'e';
        const digitsPart = first + dot + rest + eChar + expSign + expAbs;
        const sign = signStr(negative, plusFlag, spaceFlag);
        result += padNumeric(sign, '', digitsPart, width, leftAlign, zeroFlag);
      }
    } else if (conv === 'g' || conv === 'G') {
      const value = arg as number;
      const isUpper = conv === 'G';
      if (Number.isNaN(value)) {
        result += padGeneral(isUpper ? 'NAN' : 'nan', width, leftAlign);
      } else if (!Number.isFinite(value)) {
        const negative = value < 0;
        const sign = signStr(negative, plusFlag, spaceFlag);
        result += padNumeric(sign, '', isUpper ? 'INF' : 'inf', width, leftAlign, false);
      } else {
        const negative = value < 0 || Object.is(value, -0);
        const magnitude = Math.abs(value);
        const pRaw = precision === undefined ? 6 : precision;
        const P = pRaw === 0 ? 1 : pRaw;
        const { exp: X } = formatExp(magnitude, P - 1);
        let digitsPart: string;
        if (P > X && X >= -4) {
          const fprec = P - 1 - X;
          const { intPart, fracPart } = formatFixed(magnitude, fprec);
          let fp = fracPart;
          if (!hashFlag) fp = fp.replace(/0+$/, '');
          const dot = fp.length > 0 || hashFlag ? '.' : '';
          digitsPart = intPart + dot + fp;
        } else {
          const { digits } = formatExp(magnitude, P - 1);
          const first = digits[0];
          let rest = digits.slice(1);
          if (!hashFlag) rest = rest.replace(/0+$/, '');
          const dot = rest.length > 0 || hashFlag ? '.' : '';
          const eChar = isUpper ? 'E' : 'e';
          const expSign = X < 0 ? '-' : '+';
          const expAbs = Math.abs(X).toString().padStart(2, '0');
          digitsPart = first + dot + rest + eChar + expSign + expAbs;
        }
        const sign = signStr(negative, plusFlag, spaceFlag);
        result += padNumeric(sign, '', digitsPart, width, leftAlign, zeroFlag);
      }
    } else if (conv === 's') {
      let str = arg as string;
      if (precisionGiven) str = str.slice(0, precision);
      result += padGeneral(str, width, leftAlign);
    } else if (conv === 'c') {
      const str = arg as string;
      result += padGeneral(str, width, leftAlign);
    }
  }

  result += fmt.slice(lastIndex);
  return result;
}
