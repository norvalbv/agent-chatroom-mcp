type Flags = Set<string>;

function pow10(n: number): bigint {
  return 10n ** BigInt(n);
}

// Exact fraction num/den equal to |x| for a finite, non-negative-treated double x.
function decompose(absX: number): { num: bigint; den: bigint } {
  if (absX === 0) return { num: 0n, den: 1n };
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setFloat64(0, absX);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const exponent = (hi >>> 20) & 0x7ff;
  const mantissaHigh = hi & 0xfffff;
  const mantissa = (BigInt(mantissaHigh) << 32n) | BigInt(lo);
  const significand = exponent === 0 ? mantissa : mantissa + (1n << 52n);
  const exp2 = exponent === 0 ? -1074 : exponent - 1075;
  if (exp2 >= 0) return { num: significand << BigInt(exp2), den: 1n };
  return { num: significand, den: 1n << BigInt(-exp2) };
}

// Round num/den * 10^n to nearest integer, ties to even. n may be negative.
function roundScaled(num: bigint, den: bigint, n: number): bigint {
  let scaledNum: bigint;
  let scaledDen: bigint;
  if (n >= 0) {
    scaledNum = num * pow10(n);
    scaledDen = den;
  } else {
    scaledNum = num;
    scaledDen = den * pow10(-n);
  }
  let q = scaledNum / scaledDen;
  const r = scaledNum - q * scaledDen;
  const twice = r * 2n;
  if (twice > scaledDen || (twice === scaledDen && q % 2n === 1n)) {
    q += 1n;
  }
  return q;
}

// Compares num/den to 10^e. Returns -1, 0 or 1.
function compareToPow10(num: bigint, den: bigint, e: number): number {
  let lhs: bigint;
  let rhs: bigint;
  if (e >= 0) {
    lhs = num;
    rhs = den * pow10(e);
  } else {
    lhs = num * pow10(-e);
    rhs = den;
  }
  if (lhs < rhs) return -1;
  if (lhs > rhs) return 1;
  return 0;
}

// Largest e such that 10^e <= num/den, requires num > 0.
function findExponent(num: bigint, den: bigint, hint: number): number {
  let e = hint;
  while (compareToPow10(num, den, e) < 0) e--;
  while (compareToPow10(num, den, e + 1) >= 0) e++;
  return e;
}

function formatFixed(num: bigint, den: bigint, precision: number): { intPart: string; fracPart: string } {
  const q = roundScaled(num, den, precision);
  if (precision === 0) {
    const s = q.toString();
    return { intPart: s === '' ? '0' : s, fracPart: '' };
  }
  const s = q.toString().padStart(precision + 1, '0');
  return { intPart: s.slice(0, s.length - precision), fracPart: s.slice(s.length - precision) };
}

function formatExp(num: bigint, den: bigint, fracDigits: number): { digit: string; frac: string; exp: number } {
  if (num === 0n) {
    return { digit: '0', frac: '0'.repeat(fracDigits), exp: 0 };
  }
  const hint = Math.floor(Math.log10(Number(num) / Number(den)));
  let e10 = findExponent(num, den, Number.isFinite(hint) ? hint : 0);
  const n = fracDigits - e10;
  let q = roundScaled(num, den, n);
  const expectedLen = fracDigits + 1;
  let qStr = q.toString();
  if (qStr.length > expectedLen) {
    e10 += qStr.length - expectedLen;
    qStr = qStr.slice(0, expectedLen);
  } else if (qStr.length < expectedLen) {
    qStr = qStr.padStart(expectedLen, '0');
  }
  return { digit: qStr[0], frac: qStr.slice(1), exp: e10 };
}

function padNumber(
  sign: string,
  prefix: string,
  digits: string,
  width: number,
  leftAlign: boolean,
  zeroPad: boolean
): string {
  const bodyLen = sign.length + prefix.length + digits.length;
  if (width <= bodyLen) return sign + prefix + digits;
  const padLen = width - bodyLen;
  if (leftAlign) return sign + prefix + digits + ' '.repeat(padLen);
  if (zeroPad) return sign + prefix + '0'.repeat(padLen) + digits;
  return ' '.repeat(padLen) + sign + prefix + digits;
}

function toBig(v: number | bigint): bigint {
  return typeof v === 'bigint' ? v : BigInt(v);
}

function formatIntLike(
  value: number | bigint,
  conv: string,
  flags: Flags,
  width: number,
  precision: number | undefined,
  hasSign: boolean
): string {
  const big = toBig(value);
  const negative = hasSign && big < 0n;
  const magnitude = negative ? -big : big;

  let digits: string;
  if (conv === 'x' || conv === 'X') {
    digits = magnitude.toString(16);
    if (conv === 'X') digits = digits.toUpperCase();
  } else if (conv === 'o') {
    digits = magnitude.toString(8);
  } else {
    digits = magnitude.toString();
  }

  if (precision !== undefined) {
    if (magnitude === 0n && precision === 0) {
      digits = '';
    } else {
      digits = digits.padStart(precision, '0');
    }
  }

  let prefix = '';
  if (flags.has('#')) {
    if ((conv === 'x' || conv === 'X') && magnitude !== 0n) {
      prefix = conv === 'x' ? '0x' : '0X';
    } else if (conv === 'o') {
      if (digits.length === 0 || digits[0] !== '0') digits = '0' + digits;
    }
  }

  let sign = '';
  if (hasSign) {
    sign = negative ? '-' : flags.has('+') ? '+' : flags.has(' ') ? ' ' : '';
  }

  const zeroPad = flags.has('0') && !flags.has('-') && precision === undefined;
  return padNumber(sign, prefix, digits, width, flags.has('-'), zeroPad);
}

function formatFloatLike(
  x: number,
  conv: string,
  flags: Flags,
  width: number,
  precisionOpt: number | undefined
): string {
  const isUpper = conv === 'E' || conv === 'F' || conv === 'G';
  const isNaNVal = Number.isNaN(x);
  const negative = !isNaNVal && (x < 0 || Object.is(x, -0));
  const isInf = !isNaNVal && !Number.isFinite(x);

  const sign = isNaNVal ? '' : negative ? '-' : flags.has('+') ? '+' : flags.has(' ') ? ' ' : '';
  const leftAlign = flags.has('-');
  const hasHash = flags.has('#');
  const zeroPad = flags.has('0') && !leftAlign && !isNaNVal && !isInf;

  let bodyDigits: string;

  if (isNaNVal) {
    bodyDigits = isUpper ? 'NAN' : 'nan';
  } else if (isInf) {
    bodyDigits = isUpper ? 'INF' : 'inf';
  } else {
    const { num, den } = decompose(Math.abs(x));
    if (conv === 'f' || conv === 'F') {
      const precision = precisionOpt ?? 6;
      const { intPart, fracPart } = formatFixed(num, den, precision);
      bodyDigits = intPart + (precision > 0 || hasHash ? '.' + fracPart : '');
    } else if (conv === 'e' || conv === 'E') {
      const precision = precisionOpt ?? 6;
      const { digit, frac, exp } = formatExp(num, den, precision);
      const expSign = exp < 0 ? '-' : '+';
      const expDigits = Math.abs(exp).toString().padStart(2, '0');
      bodyDigits =
        digit + (precision > 0 || hasHash ? '.' + frac : '') + (isUpper ? 'E' : 'e') + expSign + expDigits;
    } else {
      let precision = precisionOpt ?? 6;
      if (precision === 0) precision = 1;
      const { digit, frac, exp: X } = formatExp(num, den, precision - 1);
      if (precision > X && X >= -4) {
        const fprec = precision - 1 - X;
        const { intPart, fracPart } = formatFixed(num, den, fprec);
        let fp = fracPart;
        if (!hasHash) fp = fp.replace(/0+$/, '');
        bodyDigits = intPart + (fp.length > 0 || hasHash ? '.' + fp : '');
      } else {
        let fp = frac;
        if (!hasHash) fp = fp.replace(/0+$/, '');
        const expSign = X < 0 ? '-' : '+';
        const expDigits = Math.abs(X).toString().padStart(2, '0');
        bodyDigits =
          digit + (fp.length > 0 || hasHash ? '.' + fp : '') + (isUpper ? 'E' : 'e') + expSign + expDigits;
      }
    }
  }

  return padNumber(sign, '', bodyDigits, width, leftAlign, zeroPad);
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  const re = /%([-+0 #]*)(\d*)(\.(\d*))?([diouxXeEfFgGsc%])/g;
  let result = '';
  let lastIndex = 0;
  let argIndex = 0;
  let m: RegExpExecArray | null;

  while ((m = re.exec(fmt))) {
    result += fmt.slice(lastIndex, m.index);
    lastIndex = re.lastIndex;

    const flagsStr = m[1];
    const widthStr = m[2];
    const precGroup = m[3];
    const precDigits = m[4];
    const conv = m[5];

    if (conv === '%') {
      result += '%';
      continue;
    }

    const flags: Flags = new Set(flagsStr.split(''));
    const width = widthStr ? parseInt(widthStr, 10) : 0;
    const precision = precGroup !== undefined ? (precDigits === '' ? 0 : parseInt(precDigits, 10)) : undefined;
    const arg = args[argIndex++];

    if (conv === 'd' || conv === 'i') {
      result += formatIntLike(arg as number | bigint, conv, flags, width, precision, true);
    } else if (conv === 'x' || conv === 'X' || conv === 'o') {
      result += formatIntLike(arg as number | bigint, conv, flags, width, precision, false);
    } else if (conv === 'e' || conv === 'E' || conv === 'f' || conv === 'F' || conv === 'g' || conv === 'G') {
      result += formatFloatLike(arg as number, conv, flags, width, precision);
    } else if (conv === 's') {
      let str = arg as string;
      if (precision !== undefined) str = str.slice(0, precision);
      result += flags.has('-') ? str.padEnd(width, ' ') : str.padStart(width, ' ');
    } else if (conv === 'c') {
      const str = arg as string;
      result += flags.has('-') ? str.padEnd(width, ' ') : str.padStart(width, ' ');
    }
  }

  result += fmt.slice(lastIndex);
  return result;
}
