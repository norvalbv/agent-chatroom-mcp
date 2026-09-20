type Flags = {
  minus: boolean;
  plus: boolean;
  space: boolean;
  zero: boolean;
  hash: boolean;
};

function decompose(absValue: number): { numerator: bigint; k: number } {
  if (absValue === 0) return { numerator: 0n, k: 0 };
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setFloat64(0, absValue);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  const mantHigh = hi & 0xfffff;
  let mantissa = (BigInt(mantHigh) << 32n) | BigInt(lo >>> 0);
  let exp: number;
  if (expBits === 0) {
    exp = -1074;
  } else {
    mantissa |= 1n << 52n;
    exp = expBits - 1075;
  }
  if (exp >= 0) {
    return { numerator: mantissa << BigInt(exp), k: 0 };
  }
  const k = -exp;
  return { numerator: mantissa * 5n ** BigInt(k), k };
}

function roundDiv(numerator: bigint, d: number): bigint {
  const divisor = 10n ** BigInt(d);
  let q = numerator / divisor;
  const r = numerator % divisor;
  const twice = r * 2n;
  if (twice > divisor) q += 1n;
  else if (twice === divisor && q % 2n !== 0n) q += 1n;
  return q;
}

function roundToShift(numerator: bigint, k: number, shift: number): bigint {
  const effShift = shift - k;
  if (effShift >= 0) return numerator * 10n ** BigInt(effShift);
  return roundDiv(numerator, -effShift);
}

function computeSigDigits(absValue: number, sig: number): { digits: string; exp: number } {
  if (absValue === 0) return { digits: '0'.repeat(sig), exp: 0 };
  const { numerator, k } = decompose(absValue);
  let e0 = numerator.toString().length - k - 1;
  const shift = sig - 1 - e0;
  const resInt = roundToShift(numerator, k, shift);
  let digitsStr = resInt.toString();
  if (digitsStr.length === sig + 1) {
    e0 += 1;
    digitsStr = digitsStr.slice(0, -1);
  } else if (digitsStr.length < sig) {
    digitsStr = digitsStr.padStart(sig, '0');
  }
  return { digits: digitsStr, exp: e0 };
}

function padNumeric(signPrefix: string, rest: string, width: number, leftAlign: boolean, zeroPad: boolean): string {
  const body = signPrefix + rest;
  if (body.length >= width) return body;
  const padLen = width - body.length;
  if (leftAlign) return body + ' '.repeat(padLen);
  if (zeroPad) return signPrefix + '0'.repeat(padLen) + rest;
  return ' '.repeat(padLen) + body;
}

function formatF(absValue: number, p: number, hash: boolean): string {
  const { numerator, k } = decompose(absValue);
  const resInt = roundToShift(numerator, k, p);
  const s = resInt.toString().padStart(p + 1, '0');
  const intPart = s.slice(0, s.length - p);
  const fracPart = p > 0 ? s.slice(s.length - p) : '';
  const dot = p === 0 ? (hash ? '.' : '') : '.' + fracPart;
  return intPart + dot;
}

function formatE(absValue: number, p: number, hash: boolean, upper: boolean): string {
  const { digits, exp } = computeSigDigits(absValue, p + 1);
  const first = digits[0];
  const frac = digits.slice(1);
  const dot = p === 0 ? (hash ? '.' : '') : '.' + frac;
  const expSign = exp < 0 ? '-' : '+';
  const expDigits = Math.abs(exp).toString().padStart(2, '0');
  return first + dot + (upper ? 'E' : 'e') + expSign + expDigits;
}

function formatG(absValue: number, precision: number | undefined, hash: boolean, upper: boolean): string {
  const p = precision === undefined ? 6 : precision === 0 ? 1 : precision;
  const { digits, exp: x } = computeSigDigits(absValue, p);
  let intPart: string;
  let frac: string;
  let expPart = '';
  if (p > x && x >= -4) {
    const fp = p - 1 - x;
    const { numerator, k } = decompose(absValue);
    const resInt = roundToShift(numerator, k, fp);
    const s = resInt.toString().padStart(fp + 1, '0');
    intPart = s.slice(0, s.length - fp);
    frac = fp > 0 ? s.slice(s.length - fp) : '';
  } else {
    intPart = digits[0];
    frac = digits.slice(1);
    const expSign = x < 0 ? '-' : '+';
    expPart = (upper ? 'E' : 'e') + expSign + Math.abs(x).toString().padStart(2, '0');
  }
  let dot: string;
  if (hash) {
    dot = '.' + frac;
  } else {
    const trimmed = frac.replace(/0+$/, '');
    dot = trimmed === '' ? '' : '.' + trimmed;
  }
  return intPart + dot + expPart;
}

function formatFloat(conv: string, flags: Flags, width: number, precision: number | undefined, value: number): string {
  const upper = conv === conv.toUpperCase();
  if (Number.isNaN(value)) {
    const body = upper ? 'NAN' : 'nan';
    return padNumeric('', body, width, flags.minus, false);
  }
  const negative = value < 0 || Object.is(value, -0);
  const sign = negative ? '-' : flags.plus ? '+' : flags.space ? ' ' : '';
  if (!Number.isFinite(value)) {
    const body = upper ? 'INF' : 'inf';
    return padNumeric(sign, body, width, flags.minus, false);
  }
  const absValue = Math.abs(value);
  const zeroPad = flags.zero && !flags.minus;
  const lower = conv.toLowerCase();
  let rest: string;
  if (lower === 'f') {
    const p = precision === undefined ? 6 : precision;
    rest = formatF(absValue, p, flags.hash);
  } else if (lower === 'e') {
    const p = precision === undefined ? 6 : precision;
    rest = formatE(absValue, p, flags.hash, upper);
  } else {
    rest = formatG(absValue, precision, flags.hash, upper);
  }
  return padNumeric(sign, rest, width, flags.minus, zeroPad);
}

function convertOne(
  conv: string,
  flags: Flags,
  width: number,
  precision: number | undefined,
  arg: number | bigint | string,
): string {
  switch (conv) {
    case 'd':
    case 'i': {
      const raw = arg as number | bigint;
      const big = typeof raw === 'bigint' ? raw : BigInt(raw);
      const negative = big < 0n;
      const mag = negative ? -big : big;
      let digits: string;
      if (precision !== undefined) {
        digits = mag === 0n && precision === 0 ? '' : mag.toString().padStart(precision, '0');
      } else {
        digits = mag.toString();
      }
      const sign = negative ? '-' : flags.plus ? '+' : flags.space ? ' ' : '';
      const zeroPad = flags.zero && !flags.minus && precision === undefined;
      return padNumeric(sign, digits, width, flags.minus, zeroPad);
    }
    case 'x':
    case 'X':
    case 'o': {
      const raw = arg as number | bigint;
      const big = typeof raw === 'bigint' ? raw : BigInt(raw);
      let digits = conv === 'o' ? big.toString(8) : big.toString(16);
      if (conv === 'X') digits = digits.toUpperCase();
      if (precision !== undefined) {
        digits = big === 0n && precision === 0 ? '' : digits.padStart(precision, '0');
      }
      if (conv === 'o' && flags.hash) {
        if (digits.length === 0 || digits[0] !== '0') digits = '0' + digits;
      }
      let prefix = '';
      if ((conv === 'x' || conv === 'X') && flags.hash && big !== 0n) {
        prefix = conv === 'x' ? '0x' : '0X';
      }
      const zeroPad = flags.zero && !flags.minus && precision === undefined;
      return padNumeric(prefix, digits, width, flags.minus, zeroPad);
    }
    case 's': {
      let str = arg as string;
      if (precision !== undefined) str = str.slice(0, precision);
      return padNumeric('', str, width, flags.minus, false);
    }
    case 'c': {
      const str = arg as string;
      return padNumeric('', str, width, flags.minus, false);
    }
    case 'e':
    case 'E':
    case 'f':
    case 'F':
    case 'g':
    case 'G':
      return formatFloat(conv, flags, width, precision, arg as number);
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
    if (fmt[j] === '%') {
      result += '%';
      i = j + 1;
      continue;
    }
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
    const width = widthStr === '' ? 0 : parseInt(widthStr, 10);
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
    const arg = args[argIndex++];
    result += convertOne(conv, flags, width, precision, arg);
    i = j;
  }
  return result;
}
