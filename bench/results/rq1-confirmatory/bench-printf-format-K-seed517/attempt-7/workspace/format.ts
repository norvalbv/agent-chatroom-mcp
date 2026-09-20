interface Flags {
  minus: boolean;
  plus: boolean;
  space: boolean;
  zero: boolean;
  hash: boolean;
}

function roundScaled(num: bigint, den: bigint, k: number): bigint {
  let scaledNum = num;
  let scaledDen = den;
  if (k >= 0) {
    scaledNum = num * 10n ** BigInt(k);
  } else {
    scaledDen = den * 10n ** BigInt(-k);
  }
  const q = scaledNum / scaledDen;
  const r = scaledNum % scaledDen;
  const twiceR = r * 2n;
  if (twiceR < scaledDen) return q;
  if (twiceR > scaledDen) return q + 1n;
  return q % 2n === 0n ? q : q + 1n;
}

function numToFraction(x: number): { num: bigint; den: bigint } {
  if (x === 0) return { num: 0n, den: 1n };
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const rawExp = (hi >>> 20) & 0x7ff;
  let mantissa = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let e: number;
  if (rawExp === 0) {
    e = 1 - 1023 - 52;
  } else {
    mantissa |= 1n << 52n;
    e = rawExp - 1023 - 52;
  }
  if (e >= 0) {
    return { num: mantissa << BigInt(e), den: 1n };
  }
  return { num: mantissa, den: 1n << BigInt(-e) };
}

function padNumeric(sign: string, prefix: string, digits: string, width: number, left: boolean, zero: boolean): string {
  const body = sign + prefix + digits;
  if (body.length >= width) return body;
  const padLen = width - body.length;
  if (left) return body + ' '.repeat(padLen);
  if (zero) return sign + prefix + '0'.repeat(padLen) + digits;
  return ' '.repeat(padLen) + body;
}

function padGeneric(s: string, width: number, left: boolean): string {
  if (s.length >= width) return s;
  const padLen = width - s.length;
  return left ? s + ' '.repeat(padLen) : ' '.repeat(padLen) + s;
}

function applyIntPrecision(digits: string, mag: bigint, precision: number | null): string {
  if (precision === null) return digits;
  if (precision === 0 && mag === 0n) return '';
  if (digits.length < precision) return '0'.repeat(precision - digits.length) + digits;
  return digits;
}

function formatDI(flags: Flags, width: number, precision: number | null, value: number | bigint): string {
  const negative = typeof value === 'bigint' ? value < 0n : value < 0 || Object.is(value, -0);
  const mag = typeof value === 'bigint' ? (value < 0n ? -value : value) : BigInt(Math.trunc(Math.abs(value)));
  const digits = applyIntPrecision(mag.toString(10), mag, precision);
  const sign = negative ? '-' : flags.plus ? '+' : flags.space ? ' ' : '';
  const zeroOk = flags.zero && !flags.minus && precision === null;
  return padNumeric(sign, '', digits, width, flags.minus, zeroOk);
}

function formatHex(flags: Flags, width: number, precision: number | null, value: number | bigint, upper: boolean): string {
  const mag = typeof value === 'bigint' ? value : BigInt(value);
  let digits = mag.toString(16);
  if (upper) digits = digits.toUpperCase();
  digits = applyIntPrecision(digits, mag, precision);
  const prefix = flags.hash && mag !== 0n ? (upper ? '0X' : '0x') : '';
  const zeroOk = flags.zero && !flags.minus && precision === null;
  return padNumeric('', prefix, digits, width, flags.minus, zeroOk);
}

function formatOctal(flags: Flags, width: number, precision: number | null, value: number | bigint): string {
  const mag = typeof value === 'bigint' ? value : BigInt(value);
  let digits = applyIntPrecision(mag.toString(8), mag, precision);
  if (flags.hash && (digits.length === 0 || digits[0] !== '0')) {
    digits = '0' + digits;
  }
  const zeroOk = flags.zero && !flags.minus && precision === null;
  return padNumeric('', '', digits, width, flags.minus, zeroOk);
}

function formatString(flags: Flags, width: number, precision: number | null, value: string): string {
  const s = precision !== null ? value.slice(0, precision) : value;
  return padGeneric(s, width, flags.minus);
}

function formatChar(flags: Flags, width: number, value: string): string {
  return padGeneric(value, width, flags.minus);
}

function buildFixed(num: bigint, den: bigint, d: number, hash: boolean): string {
  const scaled = roundScaled(num, den, d);
  const digits = scaled.toString().padStart(d + 1, '0');
  const intPart = d === 0 ? digits : digits.slice(0, digits.length - d);
  const fracPart = d === 0 ? '' : digits.slice(digits.length - d);
  if (d === 0) return intPart + (hash ? '.' : '');
  return intPart + '.' + fracPart;
}

function estimateExponent(num: bigint, den: bigint): number {
  return num.toString().length - den.toString().length;
}

function computeExpParts(num: bigint, den: bigint, d: number): { firstDigit: string; frac: string; exp: number } {
  if (num === 0n) {
    return { firstDigit: '0', frac: '0'.repeat(d), exp: 0 };
  }
  let X = estimateExponent(num, den);
  let sigStr = '';
  for (let iter = 0; iter < 200; iter++) {
    const sig = roundScaled(num, den, d - X);
    sigStr = sig.toString();
    if (sigStr.length === d + 1) break;
    if (sigStr.length > d + 1) {
      X += 1;
    } else {
      X -= 1;
    }
  }
  return { firstDigit: sigStr[0], frac: sigStr.slice(1), exp: X };
}

function buildExp(num: bigint, den: bigint, d: number, hash: boolean, upper: boolean): string {
  const { firstDigit, frac, exp } = computeExpParts(num, den, d);
  const mantissa = d === 0 ? firstDigit + (hash ? '.' : '') : firstDigit + '.' + frac;
  const expLetter = upper ? 'E' : 'e';
  const expSign = exp < 0 ? '-' : '+';
  const expDigits = Math.abs(exp).toString().padStart(2, '0');
  return mantissa + expLetter + expSign + expDigits;
}

function trimTrailingZeros(s: string): string {
  if (!s.includes('.')) return s;
  s = s.replace(/0+$/, '');
  if (s.endsWith('.')) s = s.slice(0, -1);
  return s;
}

function trimTrailingZerosExp(s: string): string {
  const idx = s.search(/[eE]/);
  const mantissa = s.slice(0, idx);
  const rest = s.slice(idx);
  return trimTrailingZeros(mantissa) + rest;
}

function buildGeneral(num: bigint, den: bigint, precisionRaw: number, hash: boolean, upper: boolean): string {
  const P = precisionRaw === 0 ? 1 : precisionRaw;
  const { exp: X } = computeExpParts(num, den, P - 1);
  let body: string;
  if (P > X && X >= -4) {
    const fixedPrecision = P - 1 - X;
    body = buildFixed(num, den, fixedPrecision, true);
    if (!hash) body = trimTrailingZeros(body);
  } else {
    body = buildExp(num, den, P - 1, true, upper);
    if (!hash) body = trimTrailingZerosExp(body);
  }
  return body;
}

function formatFloatConv(conv: string, flags: Flags, width: number, precision: number | null, value: number): string {
  const upper = conv === 'E' || conv === 'F' || conv === 'G';
  if (Number.isNaN(value)) {
    const body = upper ? 'NAN' : 'nan';
    return padNumeric('', '', body, width, flags.minus, false);
  }
  const negative = value < 0 || Object.is(value, -0);
  const sign = negative ? '-' : flags.plus ? '+' : flags.space ? ' ' : '';
  if (!Number.isFinite(value)) {
    const body = upper ? 'INF' : 'inf';
    return padNumeric(sign, '', body, width, flags.minus, false);
  }
  const { num, den } = numToFraction(Math.abs(value));
  let digitsBody: string;
  if (conv === 'f' || conv === 'F') {
    digitsBody = buildFixed(num, den, precision === null ? 6 : precision, flags.hash);
  } else if (conv === 'e' || conv === 'E') {
    digitsBody = buildExp(num, den, precision === null ? 6 : precision, flags.hash, upper);
  } else {
    digitsBody = buildGeneral(num, den, precision === null ? 6 : precision, flags.hash, upper);
  }
  const zeroOk = flags.zero && !flags.minus;
  return padNumeric(sign, '', digitsBody, width, flags.minus, zeroOk);
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let argIndex = 0;
  let result = '';
  let lastIndex = 0;
  const re = /%([-+ 0#]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc%])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(fmt)) !== null) {
    result += fmt.slice(lastIndex, m.index);
    lastIndex = re.lastIndex;
    const flagsStr = m[1];
    const widthStr = m[2];
    const precStr = m[3];
    const conv = m[4];

    if (conv === '%') {
      result += '%';
      continue;
    }

    const flags: Flags = {
      minus: flagsStr.includes('-'),
      plus: flagsStr.includes('+'),
      space: flagsStr.includes(' '),
      zero: flagsStr.includes('0'),
      hash: flagsStr.includes('#'),
    };
    const width = widthStr ? parseInt(widthStr, 10) : 0;
    const precision = precStr !== undefined ? (precStr === '' ? 0 : parseInt(precStr, 10)) : null;
    const arg = args[argIndex++];

    switch (conv) {
      case 'd':
      case 'i':
        result += formatDI(flags, width, precision, arg as number | bigint);
        break;
      case 'x':
        result += formatHex(flags, width, precision, arg as number | bigint, false);
        break;
      case 'X':
        result += formatHex(flags, width, precision, arg as number | bigint, true);
        break;
      case 'o':
        result += formatOctal(flags, width, precision, arg as number | bigint);
        break;
      case 's':
        result += formatString(flags, width, precision, arg as string);
        break;
      case 'c':
        result += formatChar(flags, width, arg as string);
        break;
      case 'e':
      case 'E':
      case 'f':
      case 'F':
      case 'g':
      case 'G':
        result += formatFloatConv(conv, flags, width, precision, arg as number);
        break;
      default:
        throw new Error(`unsupported conversion: ${conv}`);
    }
  }
  result += fmt.slice(lastIndex);
  return result;
}
