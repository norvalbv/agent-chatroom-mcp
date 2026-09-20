type Flags = {
  minus: boolean;
  plus: boolean;
  space: boolean;
  zero: boolean;
  hash: boolean;
};

function decompose(absValue: number): { num: bigint; den: bigint } {
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setFloat64(0, absValue);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const bits = (BigInt(hi) << 32n) | BigInt(lo);
  const exponentBits = Number((bits >> 52n) & 0x7ffn);
  const mantissaBits = bits & 0xfffffffffffffn;
  let mantissa: bigint;
  let exp2: number;
  if (exponentBits === 0) {
    mantissa = mantissaBits;
    exp2 = -1074;
  } else {
    mantissa = mantissaBits | (1n << 52n);
    exp2 = exponentBits - 1075;
  }
  if (exp2 >= 0) {
    return { num: mantissa << BigInt(exp2), den: 1n };
  }
  return { num: mantissa, den: 1n << BigInt(-exp2) };
}

function roundScaled(num: bigint, den: bigint, k: number): bigint {
  let n = num;
  let d = den;
  if (k >= 0) n *= 10n ** BigInt(k);
  else d *= 10n ** BigInt(-k);
  let q = n / d;
  const r = n % d;
  const twiceR = r * 2n;
  if (twiceR > d) q += 1n;
  else if (twiceR === d && q % 2n === 1n) q += 1n;
  return q;
}

function fixedDigits(absValue: number, precision: number): { intPart: string; fracPart: string } {
  const { num, den } = decompose(absValue);
  const q = roundScaled(num, den, precision);
  if (precision === 0) {
    return { intPart: q.toString(), fracPart: '' };
  }
  const qs = q.toString().padStart(precision + 1, '0');
  return { intPart: qs.slice(0, qs.length - precision), fracPart: qs.slice(qs.length - precision) };
}

function decimalExpand(absValue: number, sigDigits: number): { digits: string; exponent: number } {
  if (absValue === 0) {
    return { digits: '0'.repeat(sigDigits), exponent: 0 };
  }
  const { num, den } = decompose(absValue);
  let exponent = Math.floor(Math.log10(absValue));
  for (let iter = 0; iter < 8; iter++) {
    const k = sigDigits - 1 - exponent;
    const q = roundScaled(num, den, k);
    const qs = q.toString();
    if (qs.length === sigDigits) {
      return { digits: qs, exponent };
    } else if (qs.length > sigDigits) {
      exponent += qs.length - sigDigits;
    } else {
      exponent -= sigDigits - qs.length;
    }
  }
  throw new Error('decimalExpand failed to converge');
}

function assembleFromDigits(digits: string, x: number): { intPart: string; fracPart: string } {
  if (x >= 0) {
    if (x + 1 >= digits.length) {
      return { intPart: digits + '0'.repeat(x + 1 - digits.length), fracPart: '' };
    }
    return { intPart: digits.slice(0, x + 1), fracPart: digits.slice(x + 1) };
  }
  return { intPart: '0', fracPart: '0'.repeat(-x - 1) + digits };
}

function stripTrailingZeros(s: string): string {
  let end = s.length;
  while (end > 0 && s[end - 1] === '0') end--;
  return s.slice(0, end);
}

function padWithSign(prefix: string, body: string, flags: Flags, width: number | undefined, allowZero: boolean): string {
  const full = prefix + body;
  if (width === undefined || full.length >= width) return full;
  const padLen = width - full.length;
  if (flags.minus) return full + ' '.repeat(padLen);
  if (flags.zero && allowZero) return prefix + '0'.repeat(padLen) + body;
  return ' '.repeat(padLen) + full;
}

function padSpacesOnly(body: string, flags: Flags, width: number | undefined): string {
  if (width === undefined || body.length >= width) return body;
  const padLen = width - body.length;
  return flags.minus ? body + ' '.repeat(padLen) : ' '.repeat(padLen) + body;
}

function toBigIntArg(v: number | bigint): bigint {
  return typeof v === 'bigint' ? v : BigInt(v);
}

function applyPrecisionDigits(digits: string, isZero: boolean, precision?: number): string {
  if (precision === undefined) return digits;
  if (precision === 0 && isZero) return '';
  if (digits.length < precision) return digits.padStart(precision, '0');
  return digits;
}

function formatDI(v: bigint, flags: Flags, width: number | undefined, precision: number | undefined): string {
  const negative = v < 0n;
  const magnitude = negative ? -v : v;
  let digits = applyPrecisionDigits(magnitude.toString(), magnitude === 0n, precision);
  const sign = negative ? '-' : flags.plus ? '+' : flags.space ? ' ' : '';
  const allowZero = flags.zero && precision === undefined;
  return padWithSign(sign, digits, flags, width, allowZero);
}

function formatXO(conv: string, v: bigint, flags: Flags, width: number | undefined, precision: number | undefined): string {
  const isZero = v === 0n;
  let digits: string;
  let prefix = '';
  if (conv === 'x' || conv === 'X') {
    digits = v.toString(16);
    if (conv === 'X') digits = digits.toUpperCase();
    digits = applyPrecisionDigits(digits, isZero, precision);
    if (flags.hash && !isZero) prefix = conv === 'X' ? '0X' : '0x';
  } else {
    digits = v.toString(8);
    digits = applyPrecisionDigits(digits, isZero, precision);
    if (flags.hash && (digits === '' || digits[0] !== '0')) digits = '0' + digits;
  }
  const allowZero = flags.zero && precision === undefined;
  return padWithSign(prefix, digits, flags, width, allowZero);
}

function floatSignChar(negative: boolean, isNaN_: boolean, flags: Flags): string {
  if (isNaN_) return '';
  if (negative) return '-';
  if (flags.plus) return '+';
  if (flags.space) return ' ';
  return '';
}

function isNegativeValue(value: number): boolean {
  return value < 0 || Object.is(value, -0);
}

function formatEF(conv: string, value: number, flags: Flags, width: number | undefined, precision: number | undefined): string {
  const isUpper = conv === conv.toUpperCase();
  if (Number.isNaN(value)) {
    const text = isUpper ? 'NAN' : 'nan';
    return padSpacesOnly(text, flags, width);
  }
  const negative = isNegativeValue(value);
  const sign = floatSignChar(negative, false, flags);
  if (!Number.isFinite(value)) {
    const text = isUpper ? 'INF' : 'inf';
    return padSpacesOnly(sign + text, flags, width);
  }
  const absValue = Math.abs(value);
  const prec = precision === undefined ? 6 : precision;
  let body: string;
  if (conv === 'f' || conv === 'F') {
    const { intPart, fracPart } = fixedDigits(absValue, prec);
    const dotNeeded = prec > 0 || flags.hash;
    body = intPart + (dotNeeded ? '.' + fracPart : '');
  } else {
    const P = prec + 1;
    const { digits, exponent } = decimalExpand(absValue, P);
    const first = digits[0];
    const rest = digits.slice(1);
    const dotNeeded = prec > 0 || flags.hash;
    const expLetter = conv === 'E' ? 'E' : 'e';
    const expSign = exponent >= 0 ? '+' : '-';
    const expDigits = Math.abs(exponent).toString().padStart(2, '0');
    body = first + (dotNeeded ? '.' + rest : '') + expLetter + expSign + expDigits;
  }
  return padWithSign(sign, body, flags, width, flags.zero);
}

function formatG(conv: string, value: number, flags: Flags, width: number | undefined, precision: number | undefined): string {
  const isUpper = conv === conv.toUpperCase();
  if (Number.isNaN(value)) {
    const text = isUpper ? 'NAN' : 'nan';
    return padSpacesOnly(text, flags, width);
  }
  const negative = isNegativeValue(value);
  const sign = floatSignChar(negative, false, flags);
  if (!Number.isFinite(value)) {
    const text = isUpper ? 'INF' : 'inf';
    return padSpacesOnly(sign + text, flags, width);
  }
  const absValue = Math.abs(value);
  const rawP = precision === undefined ? 6 : precision;
  const P = rawP === 0 ? 1 : rawP;
  const { digits, exponent: X } = decimalExpand(absValue, P);
  const useF = P > X && X >= -4;
  let body: string;
  if (useF) {
    const { intPart, fracPart: fracRaw } = assembleFromDigits(digits, X);
    const fracPart = flags.hash ? fracRaw : stripTrailingZeros(fracRaw);
    const dotNeeded = flags.hash || fracPart.length > 0;
    body = intPart + (dotNeeded ? '.' + fracPart : '');
  } else {
    const first = digits[0];
    const restRaw = digits.slice(1);
    const rest = flags.hash ? restRaw : stripTrailingZeros(restRaw);
    const dotNeeded = flags.hash || rest.length > 0;
    const expLetter = conv === 'G' ? 'E' : 'e';
    const expSign = X >= 0 ? '+' : '-';
    const expDigits = Math.abs(X).toString().padStart(2, '0');
    body = first + (dotNeeded ? '.' + rest : '') + expLetter + expSign + expDigits;
  }
  return padWithSign(sign, body, flags, width, flags.zero);
}

function formatS(value: string, flags: Flags, width: number | undefined, precision: number | undefined): string {
  const text = precision === undefined ? value : value.slice(0, precision);
  return padSpacesOnly(text, flags, width);
}

function formatC(value: string, flags: Flags, width: number | undefined): string {
  return padSpacesOnly(value, flags, width);
}

function formatOne(
  conv: string,
  flags: Flags,
  width: number | undefined,
  precision: number | undefined,
  arg: number | bigint | string
): string {
  switch (conv) {
    case 'd':
    case 'i':
      return formatDI(toBigIntArg(arg as number | bigint), flags, width, precision);
    case 'x':
    case 'X':
    case 'o':
      return formatXO(conv, toBigIntArg(arg as number | bigint), flags, width, precision);
    case 'e':
    case 'E':
    case 'f':
    case 'F':
      return formatEF(conv, arg as number, flags, width, precision);
    case 'g':
    case 'G':
      return formatG(conv, arg as number, flags, width, precision);
    case 's':
      return formatS(arg as string, flags, width, precision);
    case 'c':
      return formatC(arg as string, flags, width);
    default:
      throw new Error(`unsupported conversion: ${conv}`);
  }
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  const re = /%([-+ 0#]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc%])/g;
  let result = '';
  let lastEnd = 0;
  let argIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(fmt)) !== null) {
    result += fmt.slice(lastEnd, m.index);
    lastEnd = re.lastIndex;
    const [, flagStr, widthStr, precStr, conv] = m;
    if (conv === '%') {
      result += '%';
      continue;
    }
    const flags: Flags = {
      minus: flagStr.includes('-'),
      plus: flagStr.includes('+'),
      space: flagStr.includes(' '),
      zero: flagStr.includes('0'),
      hash: flagStr.includes('#'),
    };
    const width = widthStr ? parseInt(widthStr, 10) : undefined;
    const precision = precStr !== undefined ? (precStr === '' ? 0 : parseInt(precStr, 10)) : undefined;
    const arg = args[argIndex++];
    result += formatOne(conv, flags, width, precision, arg);
  }
  result += fmt.slice(lastEnd);
  return result;
}
