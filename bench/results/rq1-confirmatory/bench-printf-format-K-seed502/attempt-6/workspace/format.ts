type Flags = {
  hasMinus: boolean;
  hasPlus: boolean;
  hasSpace: boolean;
  hasZero: boolean;
  hasHash: boolean;
  width: number | undefined;
  precision: number | undefined;
};

function decompose(x: number): { M: bigint; e: number } {
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setFloat64(0, x);
  const hi = view.getUint32(0);
  const lo = view.getUint32(4);
  const exponentBits = (hi >>> 20) & 0x7ff;
  const mantissaHigh = BigInt(hi & 0xfffff);
  const mantissa = (mantissaHigh << 32n) | BigInt(lo);
  if (exponentBits === 0) {
    return { M: mantissa, e: -1074 };
  }
  return { M: mantissa | (1n << 52n), e: exponentBits - 1075 };
}

function roundDiv(a: bigint, b: bigint): bigint {
  const q = a / b;
  const r = a - q * b;
  const twice = r * 2n;
  if (twice < b) return q;
  if (twice > b) return q + 1n;
  return q % 2n === 0n ? q : q + 1n;
}

// Returns round(value * 10^s) exactly, using the true binary value of `value`.
function roundToDigits(value: number, s: number): bigint {
  const { M, e } = decompose(value);
  if (M === 0n) return 0n;
  const p5 = s;
  const p2 = e + s;
  let numerator = M;
  let denominator = 1n;
  if (p5 >= 0) numerator *= 5n ** BigInt(p5);
  else denominator *= 5n ** BigInt(-p5);
  if (p2 >= 0) numerator *= 2n ** BigInt(p2);
  else denominator *= 2n ** BigInt(-p2);
  return roundDiv(numerator, denominator);
}

function computeSci(absValue: number, p: number): { exp: number; digits: string } {
  if (absValue === 0) return { exp: 0, digits: '0'.repeat(p + 1) };
  let exp = Math.floor(Math.log10(absValue));
  for (let iter = 0; iter < 20; iter++) {
    const N = roundToDigits(absValue, p - exp);
    const ds = N.toString();
    if (ds.length === p + 1) return { exp, digits: ds };
    exp += ds.length - (p + 1);
  }
  throw new Error('failed to converge');
}

function signPrefix(negative: boolean, hasPlus: boolean, hasSpace: boolean): string {
  return negative ? '-' : hasPlus ? '+' : hasSpace ? ' ' : '';
}

function isNegativeValue(x: number): boolean {
  return x < 0 || Object.is(x, -0);
}

function padGeneric(s: string, width: number | undefined, hasMinus: boolean): string {
  if (width === undefined || s.length >= width) return s;
  const pad = ' '.repeat(width - s.length);
  return hasMinus ? s + pad : pad + s;
}

function applyNumericPad(
  prefix: string,
  digitsPart: string,
  width: number | undefined,
  hasMinus: boolean,
  zeroActive: boolean
): string {
  const body = prefix + digitsPart;
  if (width === undefined || body.length >= width) return body;
  if (zeroActive) {
    return prefix + digitsPart.padStart(width - prefix.length, '0');
  }
  const pad = ' '.repeat(width - body.length);
  return hasMinus ? body + pad : pad + body;
}

function toBigInt(v: number | bigint): bigint {
  return typeof v === 'bigint' ? v : BigInt(v);
}

function formatIntLike(
  conv: string,
  value: number | bigint,
  f: Flags
): string {
  const n = toBigInt(value);
  if (conv === 'd' || conv === 'i') {
    const neg = n < 0n;
    const abs = neg ? -n : n;
    let digitStr: string;
    if (f.precision === 0 && abs === 0n) {
      digitStr = '';
    } else {
      digitStr = abs.toString();
      if (f.precision !== undefined) digitStr = digitStr.padStart(f.precision, '0');
    }
    const sign = signPrefix(neg, f.hasPlus, f.hasSpace);
    const zeroActive = f.hasZero && !f.hasMinus && f.precision === undefined;
    return applyNumericPad(sign, digitStr, f.width, f.hasMinus, zeroActive);
  }

  // x, X, o
  const abs = n;
  let digitStr: string;
  if (f.precision === 0 && abs === 0n) {
    digitStr = '';
  } else {
    digitStr = conv === 'o' ? abs.toString(8) : abs.toString(16);
    if (conv === 'X') digitStr = digitStr.toUpperCase();
    if (f.precision !== undefined) digitStr = digitStr.padStart(f.precision, '0');
  }

  let prefix = '';
  if (conv === 'o') {
    if (f.hasHash && (digitStr === '' || digitStr[0] !== '0')) {
      digitStr = '0' + digitStr;
    }
  } else {
    if (f.hasHash && abs !== 0n) {
      prefix = conv === 'X' ? '0X' : '0x';
    }
  }

  const zeroActive = f.hasZero && !f.hasMinus && f.precision === undefined;
  return applyNumericPad(prefix, digitStr, f.width, f.hasMinus, zeroActive);
}

function formatFloatLike(conv: string, value: number, f: Flags): string {
  const upper = conv === 'E' || conv === 'F' || conv === 'G';

  if (Number.isNaN(value)) {
    const body = upper ? 'NAN' : 'nan';
    return padGeneric(body, f.width, f.hasMinus);
  }
  if (!Number.isFinite(value)) {
    const neg = value < 0;
    const sign = signPrefix(neg, f.hasPlus, f.hasSpace);
    const body = sign + (upper ? 'INF' : 'inf');
    return padGeneric(body, f.width, f.hasMinus);
  }

  const neg = isNegativeValue(value);
  const abs = Math.abs(value);
  const sign = signPrefix(neg, f.hasPlus, f.hasSpace);
  const zeroActive = f.hasZero && !f.hasMinus;

  if (conv === 'e' || conv === 'E') {
    const precision = f.precision ?? 6;
    const { exp, digits } = computeSci(abs, precision);
    const frac = digits.slice(1);
    const mantissa = digits[0] + (precision > 0 ? '.' + frac : f.hasHash ? '.' : '');
    const expSign = exp < 0 ? '-' : '+';
    const expAbs = Math.abs(exp).toString().padStart(2, '0');
    const expLetter = conv === 'E' ? 'E' : 'e';
    const bodyDigits = mantissa + expLetter + expSign + expAbs;
    return applyNumericPad(sign, bodyDigits, f.width, f.hasMinus, zeroActive);
  }

  if (conv === 'f' || conv === 'F') {
    const precision = f.precision ?? 6;
    const N = roundToDigits(abs, precision);
    const digitsStr = N.toString().padStart(precision + 1, '0');
    const intPart = precision > 0 ? digitsStr.slice(0, -precision) : digitsStr;
    const fracPart = precision > 0 ? digitsStr.slice(-precision) : '';
    const bodyDigits = intPart + (precision > 0 || f.hasHash ? '.' + fracPart : '');
    return applyNumericPad(sign, bodyDigits, f.width, f.hasMinus, zeroActive);
  }

  // g, G
  let P = f.precision ?? 6;
  if (P === 0) P = 1;
  const { exp: X } = computeSci(abs, P - 1);
  let bodyDigits: string;
  if (P > X && X >= -4) {
    const p = P - 1 - X;
    const N = roundToDigits(abs, p);
    const digitsStr = N.toString().padStart(p + 1, '0');
    const intPart = p > 0 ? digitsStr.slice(0, -p) : digitsStr;
    let fracPart = p > 0 ? digitsStr.slice(-p) : '';
    if (!f.hasHash) fracPart = fracPart.replace(/0+$/, '');
    bodyDigits = intPart + (fracPart.length > 0 || f.hasHash ? '.' + fracPart : '');
  } else {
    const p = P - 1;
    const sci = computeSci(abs, p);
    let frac = sci.digits.slice(1);
    if (!f.hasHash) frac = frac.replace(/0+$/, '');
    const mantissa = sci.digits[0] + (frac.length > 0 || f.hasHash ? '.' + frac : '');
    const expSign = sci.exp < 0 ? '-' : '+';
    const expAbs = Math.abs(sci.exp).toString().padStart(2, '0');
    const expLetter = conv === 'G' ? 'E' : 'e';
    bodyDigits = mantissa + expLetter + expSign + expAbs;
  }
  return applyNumericPad(sign, bodyDigits, f.width, f.hasMinus, zeroActive);
}

function convertOne(conv: string, value: number | bigint | string, f: Flags): string {
  switch (conv) {
    case 'd':
    case 'i':
    case 'x':
    case 'X':
    case 'o':
      return formatIntLike(conv, value as number | bigint, f);
    case 'e':
    case 'E':
    case 'f':
    case 'F':
    case 'g':
    case 'G':
      return formatFloatLike(conv, value as number, f);
    case 's': {
      let str = value as string;
      if (f.precision !== undefined) str = str.slice(0, f.precision);
      return padGeneric(str, f.width, f.hasMinus);
    }
    case 'c': {
      const str = value as string;
      return padGeneric(str, f.width, f.hasMinus);
    }
    default:
      throw new Error(`unsupported conversion: ${conv}`);
  }
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let result = '';
  let argIndex = 0;
  const re = /%([-+ 0#]*)(\d*)(\.\d*)?([diouxXeEfFgGsc%])/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(fmt)) !== null) {
    result += fmt.slice(lastIndex, m.index);
    lastIndex = re.lastIndex;
    const [, flagsStr, widthStr, precStr, conv] = m;
    if (conv === '%') {
      result += '%';
      continue;
    }
    const hasMinus = flagsStr.includes('-');
    const hasPlus = flagsStr.includes('+');
    const hasSpace = flagsStr.includes(' ');
    const hasZero = flagsStr.includes('0');
    const hasHash = flagsStr.includes('#');
    const width = widthStr.length > 0 ? parseInt(widthStr, 10) : undefined;
    const precision =
      precStr !== undefined ? (precStr.length > 1 ? parseInt(precStr.slice(1), 10) : 0) : undefined;
    const value = args[argIndex++];
    result += convertOne(conv, value, {
      hasMinus,
      hasPlus,
      hasSpace,
      hasZero,
      hasHash,
      width,
      precision,
    });
  }
  result += fmt.slice(lastIndex);
  return result;
}
