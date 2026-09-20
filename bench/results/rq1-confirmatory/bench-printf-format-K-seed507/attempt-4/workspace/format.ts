type Flags = {
  minus: boolean;
  plus: boolean;
  space: boolean;
  zero: boolean;
  hash: boolean;
};

function exactFraction(x: number): { num: bigint; den: bigint } {
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setFloat64(0, x);
  const hi = view.getUint32(0);
  const lo = view.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  const mantHi = hi & 0xfffff;
  let mantissa = (BigInt(mantHi) << 32n) | BigInt(lo);
  let e2: number;
  if (expBits === 0) {
    e2 = -1074;
  } else {
    mantissa |= 1n << 52n;
    e2 = expBits - 1075;
  }
  if (e2 >= 0) {
    return { num: mantissa << BigInt(e2), den: 1n };
  }
  return { num: mantissa, den: 1n << BigInt(-e2) };
}

function roundDiv(num: bigint, den: bigint): bigint {
  const q = num / den;
  const r = num % den;
  const twice = r * 2n;
  if (twice > den) return q + 1n;
  if (twice < den) return q;
  return q % 2n === 0n ? q : q + 1n;
}

function sigDigits(value: number, numDigits: number): { digits: string; exp: number } {
  if (value === 0) return { digits: '0'.repeat(numDigits), exp: 0 };
  const { num, den } = exactFraction(value);
  let exp = Math.floor(Math.log10(value));
  for (let iter = 0; iter < 64; iter++) {
    const shift = numDigits - 1 - exp;
    let scaledNum: bigint;
    let scaledDen: bigint;
    if (shift >= 0) {
      scaledNum = num * 10n ** BigInt(shift);
      scaledDen = den;
    } else {
      scaledNum = num;
      scaledDen = den * 10n ** BigInt(-shift);
    }
    const rounded = roundDiv(scaledNum, scaledDen);
    const s = rounded.toString();
    if (s.length > numDigits) {
      exp += 1;
      continue;
    }
    if (s.length < numDigits) {
      exp -= 1;
      continue;
    }
    return { digits: s, exp };
  }
  throw new Error('sigDigits failed to converge');
}

function fFormat(absVal: number, precision: number, hash: boolean): string {
  const { num, den } = exactFraction(absVal);
  const scaledNum = num * 10n ** BigInt(precision);
  const rounded = roundDiv(scaledNum, den);
  let s = rounded.toString();
  if (s.length < precision + 1) s = s.padStart(precision + 1, '0');
  const intPart = precision === 0 ? s : s.slice(0, s.length - precision);
  const fracPart = precision === 0 ? '' : s.slice(s.length - precision);
  return intPart + (precision > 0 ? '.' + fracPart : hash ? '.' : '');
}

function eFormat(absVal: number, precision: number, hash: boolean, upper: boolean): string {
  const numDigits = precision + 1;
  const { digits, exp } = sigDigits(absVal, numDigits);
  const mantissa = digits[0] + (precision > 0 ? '.' + digits.slice(1) : hash ? '.' : '');
  const expSign = exp >= 0 ? '+' : '-';
  const expDigits = Math.abs(exp).toString().padStart(2, '0');
  return mantissa + (upper ? 'E' : 'e') + expSign + expDigits;
}

function stripTrailingZeros(s: string): string {
  if (!s.includes('.')) return s;
  s = s.replace(/0+$/, '');
  if (s.endsWith('.')) s = s.slice(0, -1);
  return s;
}

function stripTrailingZerosG(s: string): string {
  const idx = s.search(/[eE]/);
  if (idx === -1) return stripTrailingZeros(s);
  return stripTrailingZeros(s.slice(0, idx)) + s.slice(idx);
}

function gFormat(absVal: number, precision: number, hash: boolean, upper: boolean): string {
  const P = precision === 0 ? 1 : precision;
  const X = absVal === 0 ? 0 : sigDigits(absVal, P).exp;
  let body: string;
  if (P > X && X >= -4) {
    body = fFormat(absVal, P - 1 - X, hash);
  } else {
    body = eFormat(absVal, P - 1, hash, upper);
  }
  if (!hash) body = stripTrailingZerosG(body);
  return body;
}

function pad(prefix: string, body: string, width: number | undefined, left: boolean, zero: boolean): string {
  const full = prefix + body;
  if (width === undefined || full.length >= width) return full;
  const padLen = width - full.length;
  if (left) return full + ' '.repeat(padLen);
  if (zero) return prefix + '0'.repeat(padLen) + body;
  return ' '.repeat(padLen) + full;
}

function toBigIntArg(v: number | bigint): bigint {
  return typeof v === 'bigint' ? v : BigInt(v);
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
    case 'i': {
      const v = toBigIntArg(arg as number | bigint);
      const neg = v < 0n;
      const abs = neg ? -v : v;
      let digits = abs.toString();
      if (precision !== undefined) {
        digits = precision === 0 && abs === 0n ? '' : digits.padStart(precision, '0');
      }
      const sign = neg ? '-' : flags.plus ? '+' : flags.space ? ' ' : '';
      const zeroPad = flags.zero && !flags.minus && precision === undefined;
      return pad(sign, digits, width, flags.minus, zeroPad);
    }
    case 'x':
    case 'X': {
      const v = toBigIntArg(arg as number | bigint);
      let digits = v.toString(16);
      if (conv === 'X') digits = digits.toUpperCase();
      if (precision !== undefined) {
        digits = precision === 0 && v === 0n ? '' : digits.padStart(precision, '0');
      }
      const prefix = flags.hash && v !== 0n ? (conv === 'X' ? '0X' : '0x') : '';
      const zeroPad = flags.zero && !flags.minus && precision === undefined;
      return pad(prefix, digits, width, flags.minus, zeroPad);
    }
    case 'o': {
      const v = toBigIntArg(arg as number | bigint);
      let digits = v.toString(8);
      if (precision !== undefined) {
        digits = precision === 0 && v === 0n ? '' : digits.padStart(precision, '0');
      }
      if (flags.hash) {
        if (digits === '' || digits[0] !== '0') digits = '0' + digits;
      }
      const zeroPad = flags.zero && !flags.minus && precision === undefined;
      return pad('', digits, width, flags.minus, zeroPad);
    }
    case 'e':
    case 'E':
    case 'f':
    case 'F':
    case 'g':
    case 'G': {
      const value = arg as number;
      const upper = conv === 'F' || conv === 'E' || conv === 'G';
      if (Number.isNaN(value)) {
        const text = upper ? 'NAN' : 'nan';
        return pad('', text, width, flags.minus, false);
      }
      const neg = value < 0 || Object.is(value, -0);
      const sign = neg ? '-' : flags.plus ? '+' : flags.space ? ' ' : '';
      if (!Number.isFinite(value)) {
        const text = upper ? 'INF' : 'inf';
        return pad(sign, text, width, flags.minus, false);
      }
      const absVal = Math.abs(value);
      const prec = precision === undefined ? 6 : precision;
      let body: string;
      if (conv === 'f' || conv === 'F') {
        body = fFormat(absVal, prec, flags.hash);
      } else if (conv === 'e' || conv === 'E') {
        body = eFormat(absVal, prec, flags.hash, conv === 'E');
      } else {
        body = gFormat(absVal, prec, flags.hash, conv === 'G');
      }
      const zeroPad = flags.zero && !flags.minus;
      return pad(sign, body, width, flags.minus, zeroPad);
    }
    case 's': {
      const value = arg as string;
      const text = precision !== undefined ? value.slice(0, precision) : value;
      return pad('', text, width, flags.minus, false);
    }
    case 'c': {
      const text = arg as string;
      return pad('', text, width, flags.minus, false);
    }
    default:
      throw new Error(`unsupported conversion: ${conv}`);
  }
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let result = '';
  let argIndex = 0;
  let i = 0;
  while (i < fmt.length) {
    const ch = fmt[i];
    if (ch !== '%') {
      result += ch;
      i++;
      continue;
    }
    let j = i + 1;
    const flags: Flags = { minus: false, plus: false, space: false, zero: false, hash: false };
    while (j < fmt.length && '-+ 0#'.includes(fmt[j])) {
      switch (fmt[j]) {
        case '-':
          flags.minus = true;
          break;
        case '+':
          flags.plus = true;
          break;
        case ' ':
          flags.space = true;
          break;
        case '0':
          flags.zero = true;
          break;
        case '#':
          flags.hash = true;
          break;
      }
      j++;
    }
    let widthStr = '';
    while (j < fmt.length && /[0-9]/.test(fmt[j])) {
      widthStr += fmt[j];
      j++;
    }
    const width = widthStr === '' ? undefined : parseInt(widthStr, 10);
    let precision: number | undefined;
    if (fmt[j] === '.') {
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
    i = j;
    if (conv === '%') {
      result += '%';
      continue;
    }
    const arg = args[argIndex++];
    result += formatOne(conv, flags, width, precision, arg);
  }
  return result;
}
