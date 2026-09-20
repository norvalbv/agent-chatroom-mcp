export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let argIndex = 0;
  const nextArg = () => args[argIndex++];

  let out = '';
  let i = 0;
  const specRe = /%([-+ 0#]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc%])/g;
  specRe.lastIndex = 0;

  let m: RegExpExecArray | null;
  let lastEnd = 0;
  while ((m = specRe.exec(fmt)) !== null) {
    out += fmt.slice(lastEnd, m.index);
    lastEnd = specRe.lastIndex;

    const flagsStr = m[1];
    const widthStr = m[2];
    const precStr = m[3];
    const conv = m[4];

    if (conv === '%') {
      out += '%';
      continue;
    }

    const flags = new Set(flagsStr.split(''));
    const leftAlign = flags.has('-');
    const plusFlag = flags.has('+');
    const spaceFlag = flags.has(' ');
    const zeroFlagRaw = flags.has('0');
    const hashFlag = flags.has('#');
    const width = widthStr ? parseInt(widthStr, 10) : 0;
    const precision = precStr !== undefined ? (precStr === '' ? 0 : parseInt(precStr, 10)) : undefined;

    out += formatOne(conv, flags, {
      leftAlign,
      plusFlag,
      spaceFlag,
      zeroFlagRaw,
      hashFlag,
      width,
      precision,
    }, nextArg());
  }
  out += fmt.slice(lastEnd);
  return out;
}

interface Opts {
  leftAlign: boolean;
  plusFlag: boolean;
  spaceFlag: boolean;
  zeroFlagRaw: boolean;
  hashFlag: boolean;
  width: number;
  precision: number | undefined;
}

function formatOne(conv: string, _flags: Set<string>, opts: Opts, arg: number | bigint | string): string {
  switch (conv) {
    case 'd':
    case 'i':
      return formatInt(arg as number | bigint, opts, 10, false, '');
    case 'x':
      return formatIntBase(arg as number | bigint, opts, 16, false, 'x');
    case 'X':
      return formatIntBase(arg as number | bigint, opts, 16, true, 'X');
    case 'o':
      return formatIntBase(arg as number | bigint, opts, 8, false, 'o');
    case 's':
      return formatString(arg as string, opts);
    case 'c':
      return formatChar(arg as string, opts);
    case 'e':
      return formatExpStyle(arg as number, opts, false);
    case 'E':
      return formatExpStyle(arg as number, opts, true);
    case 'f':
      return formatFixedStyle(arg as number, opts, false);
    case 'F':
      return formatFixedStyle(arg as number, opts, true);
    case 'g':
      return formatGeneral(arg as number, opts, false);
    case 'G':
      return formatGeneral(arg as number, opts, true);
    default:
      throw new Error(`unsupported conversion: ${conv}`);
  }
}

// ---------- generic padding helpers ----------

function padNumeric(sign: string, prefix: string, digits: string, width: number, zeroFlag: boolean, leftAlign: boolean): string {
  const body = sign + prefix + digits;
  if (body.length >= width) return body;
  const padLen = width - body.length;
  if (leftAlign) {
    return body + ' '.repeat(padLen);
  }
  if (zeroFlag) {
    return sign + prefix + '0'.repeat(padLen) + digits;
  }
  return ' '.repeat(padLen) + body;
}

function padText(text: string, width: number, leftAlign: boolean): string {
  if (text.length >= width) return text;
  const padLen = width - text.length;
  return leftAlign ? text + ' '.repeat(padLen) : ' '.repeat(padLen) + text;
}

// ---------- integer conversions ----------

function toMagnitudeBigInt(v: number | bigint): { neg: boolean; mag: bigint } {
  if (typeof v === 'bigint') {
    return v < 0n ? { neg: true, mag: -v } : { neg: false, mag: v };
  }
  const neg = v < 0;
  const mag = BigInt(Math.trunc(Math.abs(v)));
  return { neg, mag };
}

function signChar(neg: boolean, plusFlag: boolean, spaceFlag: boolean): string {
  if (neg) return '-';
  if (plusFlag) return '+';
  if (spaceFlag) return ' ';
  return '';
}

function digitsWithPrecision(mag: bigint, precision: number | undefined): string {
  const base = mag.toString();
  if (precision === undefined) return base;
  if (precision === 0 && mag === 0n) return '';
  return base.padStart(precision, '0');
}

function formatInt(arg: number | bigint, opts: Opts, _radix: number, _upper: boolean, _kind: string): string {
  const { neg, mag } = toMagnitudeBigInt(arg);
  const digits = digitsWithPrecision(mag, opts.precision);
  const sign = signChar(neg, opts.plusFlag, opts.spaceFlag);
  const zeroFlag = opts.zeroFlagRaw && !opts.leftAlign && opts.precision === undefined;
  return padNumeric(sign, '', digits, opts.width, zeroFlag, opts.leftAlign);
}

function formatIntBase(arg: number | bigint, opts: Opts, radix: number, upper: boolean, kind: 'x' | 'X' | 'o'): string {
  const { mag } = toMagnitudeBigInt(arg);
  let digits = mag.toString(radix);
  if (upper) digits = digits.toUpperCase();
  if (opts.precision !== undefined) {
    if (opts.precision === 0 && mag === 0n) {
      digits = '';
    } else {
      digits = digits.padStart(opts.precision, '0');
    }
  }

  let prefix = '';
  if (opts.hashFlag) {
    if (kind === 'x' && mag !== 0n) prefix = '0x';
    else if (kind === 'X' && mag !== 0n) prefix = '0X';
    else if (kind === 'o') {
      if (digits === '' || digits[0] !== '0') {
        digits = '0' + digits;
      }
    }
  }

  const zeroFlag = opts.zeroFlagRaw && !opts.leftAlign && opts.precision === undefined;
  return padNumeric('', prefix, digits, opts.width, zeroFlag, opts.leftAlign);
}

// ---------- string / char conversions ----------

function formatString(arg: string, opts: Opts): string {
  let s = arg;
  if (opts.precision !== undefined) {
    s = s.slice(0, opts.precision);
  }
  return padText(s, opts.width, opts.leftAlign);
}

function formatChar(arg: string, opts: Opts): string {
  return padText(arg, opts.width, opts.leftAlign);
}

// ---------- exact decimal decomposition of doubles ----------

function decomposeDouble(x: number): { mantissa: bigint; exp: number } {
  const buf = new ArrayBuffer(8);
  new Float64Array(buf)[0] = x;
  const bits = new BigUint64Array(buf)[0];
  const mantissaBits = bits & 0xFFFFFFFFFFFFFn;
  const exponentBits = Number((bits >> 52n) & 0x7FFn);
  if (exponentBits === 0) {
    return { mantissa: mantissaBits, exp: -1074 };
  }
  return { mantissa: mantissaBits | (1n << 52n), exp: exponentBits - 1075 };
}

function exactDecimalParts(x: number): { intPart: string; fracPart: string } {
  if (x === 0) return { intPart: '0', fracPart: '' };
  const { mantissa, exp } = decomposeDouble(x);
  if (exp >= 0) {
    const n = mantissa * (1n << BigInt(exp));
    return { intPart: n.toString(), fracPart: '' };
  }
  const k = -exp;
  const n = mantissa * (5n ** BigInt(k));
  let s = n.toString();
  if (s.length <= k) s = '0'.repeat(k - s.length + 1) + s;
  const intPart = s.slice(0, s.length - k);
  const fracPart = s.slice(s.length - k);
  return { intPart, fracPart };
}

function incrementDigits(s: string): string {
  const arr = s.split('');
  let i = arr.length - 1;
  while (i >= 0) {
    if (arr[i] === '9') {
      arr[i] = '0';
      i--;
    } else {
      arr[i] = String(Number(arr[i]) + 1);
      return arr.join('');
    }
  }
  return '1' + arr.join('');
}

// Round the exact fractional-digit string (intPart.fracPart) to n fractional digits.
function roundFrac(intPart: string, fracPart: string, n: number): { intPart: string; fracPart: string } {
  if (fracPart.length <= n) {
    return { intPart, fracPart: fracPart.padEnd(n, '0') };
  }
  const keep = fracPart.slice(0, n);
  const rest = fracPart.slice(n);
  const first = rest[0];
  let roundUp: boolean;
  if (first > '5') roundUp = true;
  else if (first < '5') roundUp = false;
  else {
    const remainder = rest.slice(1);
    if (/[1-9]/.test(remainder)) roundUp = true;
    else {
      const lastDigit = n > 0 ? Number(keep[n - 1]) : Number(intPart[intPart.length - 1] ?? '0');
      roundUp = lastDigit % 2 === 1;
    }
  }
  if (!roundUp) {
    return { intPart, fracPart: keep };
  }
  const combined = intPart + keep;
  const incremented = incrementDigits(combined);
  if (incremented.length > combined.length) {
    // carried out of intPart
    const newIntPart = incremented.slice(0, incremented.length - n);
    const newFracPart = n > 0 ? incremented.slice(incremented.length - n) : '';
    return { intPart: newIntPart, fracPart: newFracPart };
  }
  const newIntPart = n > 0 ? incremented.slice(0, incremented.length - n) : incremented;
  const newFracPart = n > 0 ? incremented.slice(incremented.length - n) : '';
  return { intPart: newIntPart || '0', fracPart: newFracPart };
}

// Round an exact significant-digit string to k significant digits (round-half-even).
// Returns the rounded digit string (length k) and an exponent adjustment (0 or 1) for carry-out.
function roundSig(digits: string, k: number): { digits: string; expAdj: number } {
  if (digits.length <= k) {
    return { digits: digits.padEnd(k, '0'), expAdj: 0 };
  }
  const keep = digits.slice(0, k);
  const rest = digits.slice(k);
  const first = rest[0];
  let roundUp: boolean;
  if (first > '5') roundUp = true;
  else if (first < '5') roundUp = false;
  else {
    const remainder = rest.slice(1);
    if (/[1-9]/.test(remainder)) roundUp = true;
    else {
      const lastDigit = Number(keep[k - 1]);
      roundUp = lastDigit % 2 === 1;
    }
  }
  if (!roundUp) return { digits: keep, expAdj: 0 };
  const incremented = incrementDigits(keep);
  if (incremented.length > k) {
    return { digits: incremented.slice(0, k), expAdj: 1 };
  }
  return { digits: incremented, expAdj: 0 };
}

function findExponent(intPart: string, fracPart: string): { j: number; combined: string; L: number } {
  const combined = intPart + fracPart;
  const L = intPart.length;
  const idx = combined.search(/[1-9]/);
  const j = idx === -1 ? 0 : idx;
  return { j, combined, L };
}

// ---------- sign / special-value handling for floating conversions ----------

function isNegSign(x: number): boolean {
  return x < 0 || Object.is(x, -0);
}

function floatSignChar(neg: boolean, plusFlag: boolean, spaceFlag: boolean): string {
  if (neg) return '-';
  if (plusFlag) return '+';
  if (spaceFlag) return ' ';
  return '';
}

function specialText(x: number, upper: boolean): string | null {
  if (Number.isNaN(x)) return upper ? 'NAN' : 'nan';
  if (!Number.isFinite(x)) return upper ? 'INF' : 'inf';
  return null;
}

// ---------- e / E ----------

function formatExpStyle(x: number, opts: Opts, upper: boolean): string {
  const precision = opts.precision !== undefined ? opts.precision : 6;

  const special = specialText(x, upper);
  if (special !== null) {
    if (Number.isNaN(x)) {
      const sign = '';
      return padNumeric(sign, '', special, opts.width, false, opts.leftAlign);
    }
    const neg = isNegSign(x);
    const sign = floatSignChar(neg, opts.plusFlag, opts.spaceFlag);
    return padNumeric(sign, '', special, opts.width, false, opts.leftAlign);
  }

  const neg = isNegSign(x);
  const mag = Math.abs(x);
  const { intPart, fracPart } = exactDecimalParts(mag);
  const { j, combined, L } = findExponent(intPart, fracPart);
  let exponent = L - 1 - j;
  const significant = combined.slice(j);
  const { digits, expAdj } = roundSig(significant, precision + 1);
  exponent += expAdj;

  const first = digits[0];
  const rest = digits.slice(1);
  const includeDot = rest.length > 0 || opts.hashFlag;
  const mantissa = first + (includeDot ? '.' + rest : '');
  const eLetter = upper ? 'E' : 'e';
  const expSign = exponent < 0 ? '-' : '+';
  const expMag = Math.abs(exponent).toString();
  const expStr = eLetter + expSign + (expMag.length < 2 ? '0' + expMag : expMag);

  const sign = floatSignChar(neg, opts.plusFlag, opts.spaceFlag);
  const zeroFlag = opts.zeroFlagRaw && !opts.leftAlign;
  return padNumeric(sign, '', mantissa + expStr, opts.width, zeroFlag, opts.leftAlign);
}

// ---------- f / F ----------

function formatFixedStyle(x: number, opts: Opts, upper: boolean): string {
  const precision = opts.precision !== undefined ? opts.precision : 6;

  const special = specialText(x, upper);
  if (special !== null) {
    if (Number.isNaN(x)) {
      return padNumeric('', '', special, opts.width, false, opts.leftAlign);
    }
    const neg = isNegSign(x);
    const sign = floatSignChar(neg, opts.plusFlag, opts.spaceFlag);
    return padNumeric(sign, '', special, opts.width, false, opts.leftAlign);
  }

  const neg = isNegSign(x);
  const mag = Math.abs(x);
  const { intPart, fracPart } = exactDecimalParts(mag);
  const rounded = roundFrac(intPart, fracPart, precision);
  const includeDot = rounded.fracPart.length > 0 || opts.hashFlag;
  const body = rounded.intPart + (includeDot ? '.' + rounded.fracPart : '');

  const sign = floatSignChar(neg, opts.plusFlag, opts.spaceFlag);
  const zeroFlag = opts.zeroFlagRaw && !opts.leftAlign;
  return padNumeric(sign, '', body, opts.width, zeroFlag, opts.leftAlign);
}

// ---------- g / G ----------

function stripTrailingZeros(fracPart: string, hashFlag: boolean): string {
  if (hashFlag) return fracPart;
  let end = fracPart.length;
  while (end > 0 && fracPart[end - 1] === '0') end--;
  return fracPart.slice(0, end);
}

function formatGeneral(x: number, opts: Opts, upper: boolean): string {
  const P = opts.precision !== undefined ? (opts.precision === 0 ? 1 : opts.precision) : 6;

  const special = specialText(x, upper);
  if (special !== null) {
    if (Number.isNaN(x)) {
      return padNumeric('', '', special, opts.width, false, opts.leftAlign);
    }
    const neg = isNegSign(x);
    const sign = floatSignChar(neg, opts.plusFlag, opts.spaceFlag);
    return padNumeric(sign, '', special, opts.width, false, opts.leftAlign);
  }

  const neg = isNegSign(x);
  const mag = Math.abs(x);
  const { intPart, fracPart } = exactDecimalParts(mag);
  const { j, combined, L } = findExponent(intPart, fracPart);
  let X = L - 1 - j;
  const significant = combined.slice(j);
  const { digits, expAdj } = roundSig(significant, P);
  X += expAdj;

  const sign = floatSignChar(neg, opts.plusFlag, opts.spaceFlag);
  const eLetter = upper ? 'E' : 'e';

  let body: string;
  if (P > X && X >= -4) {
    // f style with precision P-1-X
    let numIntPart: string;
    let numFracPart: string;
    if (X >= 0) {
      numIntPart = digits.slice(0, X + 1);
      numFracPart = digits.slice(X + 1);
    } else {
      numIntPart = '0';
      numFracPart = '0'.repeat(-X - 1) + digits;
    }
    const stripped = stripTrailingZeros(numFracPart, opts.hashFlag);
    const includeDot = stripped.length > 0 || opts.hashFlag;
    body = numIntPart + (includeDot ? '.' + stripped : '');
  } else {
    // e style with precision P-1
    const first = digits[0];
    const rest = digits.slice(1);
    const stripped = stripTrailingZeros(rest, opts.hashFlag);
    const includeDot = stripped.length > 0 || opts.hashFlag;
    const mantissa = first + (includeDot ? '.' + stripped : '');
    const expSign = X < 0 ? '-' : '+';
    const expMag = Math.abs(X).toString();
    const expStr = eLetter + expSign + (expMag.length < 2 ? '0' + expMag : expMag);
    body = mantissa + expStr;
  }

  const zeroFlag = opts.zeroFlagRaw && !opts.leftAlign;
  return padNumeric(sign, '', body, opts.width, zeroFlag, opts.leftAlign);
}
