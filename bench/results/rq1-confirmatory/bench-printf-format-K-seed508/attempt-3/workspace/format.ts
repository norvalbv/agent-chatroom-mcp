type Flags = {
  minus: boolean;
  plus: boolean;
  space: boolean;
  zero: boolean;
  hash: boolean;
};

function decodeDouble(x: number): { mantissa: bigint; exp: number } {
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setFloat64(0, Math.abs(x), false);
  const hi = view.getUint32(0, false);
  const lo = view.getUint32(4, false);
  const expBits = (hi >>> 20) & 0x7ff;
  const fracHi = hi & 0xfffff;
  const fracBig = (BigInt(fracHi) << 32n) | BigInt(lo >>> 0);
  if (expBits === 0) {
    return { mantissa: fracBig, exp: 1 - 1023 - 52 };
  }
  return { mantissa: fracBig | (1n << 52n), exp: expBits - 1023 - 52 };
}

function exactAbsDecimal(x: number): { intPart: string; fracPart: string } {
  const { mantissa, exp } = decodeDouble(x);
  if (mantissa === 0n) return { intPart: '0', fracPart: '' };
  if (exp >= 0) {
    return { intPart: (mantissa << BigInt(exp)).toString(), fracPart: '' };
  }
  const shift = -exp;
  const numerator = mantissa * 5n ** BigInt(shift);
  let s = numerator.toString();
  if (s.length <= shift) s = s.padStart(shift + 1, '0');
  return { intPart: s.slice(0, s.length - shift), fracPart: s.slice(s.length - shift) };
}

// Rounds intPart.fracPart to `ndigits` digits after the decimal point,
// using round-half-to-even on the exact value.
function roundDecimal(
  intPart: string,
  fracPart: string,
  ndigits: number
): { intPart: string; fracPart: string } {
  if (ndigits >= fracPart.length) {
    return { intPart, fracPart: fracPart.padEnd(ndigits, '0') };
  }
  const keep = fracPart.slice(0, ndigits);
  const rest = fracPart.slice(ndigits);
  const firstRestDigit = rest[0];
  let roundUp: boolean;
  if (firstRestDigit < '5') {
    roundUp = false;
  } else if (firstRestDigit > '5') {
    roundUp = true;
  } else {
    const remainder = rest.slice(1);
    if (/[1-9]/.test(remainder)) {
      roundUp = true;
    } else {
      const lastDigit = ndigits > 0 ? keep[ndigits - 1] : intPart[intPart.length - 1];
      roundUp = parseInt(lastDigit, 10) % 2 === 1;
    }
  }
  if (!roundUp) {
    return { intPart, fracPart: keep };
  }
  const fullStr = intPart + keep;
  const fullBig = BigInt(fullStr) + 1n;
  let newFullStr = fullBig.toString();
  const totalLen = intPart.length + ndigits;
  if (newFullStr.length < totalLen) newFullStr = newFullStr.padStart(totalLen, '0');
  const newFracPart = ndigits > 0 ? newFullStr.slice(newFullStr.length - ndigits) : '';
  let newIntPart = ndigits > 0 ? newFullStr.slice(0, newFullStr.length - ndigits) : newFullStr;
  newIntPart = newIntPart.replace(/^0+(?=\d)/, '') || '0';
  return { intPart: newIntPart, fracPart: newFracPart };
}

function toSignificant(intPart: string, fracPart: string): { sigDigits: string; exp: number } {
  const combined = intPart + fracPart;
  if (!/[1-9]/.test(combined)) return { sigDigits: '0', exp: 0 };
  const firstNonZero = combined.search(/[1-9]/);
  return { sigDigits: combined.slice(firstNonZero), exp: intPart.length - 1 - firstNonZero };
}

// Rounds sigDigits (first digit d1, rest fractional) to P significant digits.
function roundSignificant(
  sigDigits: string,
  exp: number,
  P: number
): { digits: string; exp: number } {
  if (P >= sigDigits.length) {
    return { digits: sigDigits.padEnd(P, '0'), exp };
  }
  const intPart = sigDigits[0];
  const fracPart = sigDigits.slice(1);
  const ndigits = P - 1;
  const { intPart: newInt, fracPart: newFrac } = roundDecimal(intPart, fracPart, ndigits);
  const combined = newInt + newFrac;
  if (combined.length > P) {
    return { digits: combined.slice(0, P), exp: exp + (combined.length - P) };
  }
  return { digits: combined, exp };
}

function toBigInt(v: number | bigint): bigint {
  return typeof v === 'bigint' ? v : BigInt(v);
}

function padField(
  sign: string,
  prefix: string,
  body: string,
  width: number,
  leftAlign: boolean,
  zeroPad: boolean
): string {
  const core = sign + prefix + body;
  if (core.length >= width) return core;
  const padLen = width - core.length;
  if (leftAlign) return core + ' '.repeat(padLen);
  if (zeroPad) return sign + prefix + '0'.repeat(padLen) + body;
  return ' '.repeat(padLen) + core;
}

function floatSign(x: number, flags: Flags): string {
  if (Number.isNaN(x)) return '';
  const negative = x < 0 || Object.is(x, -0);
  return negative ? '-' : flags.plus ? '+' : flags.space ? ' ' : '';
}

function formatInt(conv: string, arg: number | bigint, flags: Flags, width: number, precision: number | undefined): string {
  const value = toBigInt(arg);
  const zeroPad = flags.zero && !flags.minus && precision === undefined;

  if (conv === 'd' || conv === 'i') {
    const neg = value < 0n;
    const mag = neg ? -value : value;
    let digits = mag.toString(10);
    if (precision !== undefined) {
      digits = mag === 0n && precision === 0 ? '' : digits.padStart(precision, '0');
    }
    const sign = neg ? '-' : flags.plus ? '+' : flags.space ? ' ' : '';
    return padField(sign, '', digits, width, flags.minus, zeroPad);
  }

  if (conv === 'x' || conv === 'X') {
    const mag = value;
    let digits = mag.toString(16);
    if (conv === 'X') digits = digits.toUpperCase();
    if (precision !== undefined) {
      digits = mag === 0n && precision === 0 ? '' : digits.padStart(precision, '0');
    }
    const prefix = flags.hash && mag !== 0n ? (conv === 'x' ? '0x' : '0X') : '';
    return padField('', prefix, digits, width, flags.minus, zeroPad);
  }

  // 'o'
  const mag = value;
  let digits = mag.toString(8);
  if (precision !== undefined) {
    digits = mag === 0n && precision === 0 ? '' : digits.padStart(precision, '0');
  }
  if (flags.hash && (digits === '' || digits[0] !== '0')) digits = '0' + digits;
  return padField('', '', digits, width, flags.minus, zeroPad);
}

function formatFloat(conv: string, x: number, flags: Flags, width: number, precision: number | undefined): string {
  const upper = conv === conv.toUpperCase();

  if (!Number.isFinite(x)) {
    const isNaN = Number.isNaN(x);
    let base = isNaN ? 'nan' : 'inf';
    if (upper) base = base.toUpperCase();
    const sign = isNaN ? '' : floatSign(x, flags);
    return padField(sign, '', base, width, flags.minus, false);
  }

  const sign = floatSign(x, flags);
  const mag = Math.abs(x);
  const { intPart, fracPart } = exactAbsDecimal(mag);
  const zeroPad = flags.zero && !flags.minus;

  const lower = conv.toLowerCase();

  if (lower === 'f') {
    const prec = precision === undefined ? 6 : precision;
    const rounded = roundDecimal(intPart, fracPart, prec);
    const fracStr = prec > 0 ? '.' + rounded.fracPart : flags.hash ? '.' : '';
    const body = rounded.intPart + fracStr;
    return padField(sign, '', body, width, flags.minus, zeroPad);
  }

  if (lower === 'e') {
    const prec = precision === undefined ? 6 : precision;
    const { sigDigits, exp } = toSignificant(intPart, fracPart);
    const { digits, exp: expFinal } = roundSignificant(sigDigits, exp, prec + 1);
    const d1 = digits[0];
    const rest = digits.slice(1);
    const mantissa = d1 + (prec > 0 || flags.hash ? '.' + rest : '');
    const expSign = expFinal >= 0 ? '+' : '-';
    let expDigits = Math.abs(expFinal).toString();
    if (expDigits.length < 2) expDigits = expDigits.padStart(2, '0');
    const body = mantissa + (conv === 'E' ? 'E' : 'e') + expSign + expDigits;
    return padField(sign, '', body, width, flags.minus, zeroPad);
  }

  // g / G
  let P = precision === undefined ? 6 : precision === 0 ? 1 : precision;
  const { sigDigits, exp } = toSignificant(intPart, fracPart);
  const { digits, exp: X } = roundSignificant(sigDigits, exp, P);
  let bodyDigits: string;
  if (P > X && X >= -4) {
    const precisionUsed = P - 1 - X;
    const rounded = roundDecimal(intPart, fracPart, precisionUsed);
    let fp = rounded.fracPart;
    if (!flags.hash) fp = fp.replace(/0+$/, '');
    bodyDigits = rounded.intPart + (fp.length > 0 ? '.' + fp : flags.hash ? '.' : '');
  } else {
    const d1 = digits[0];
    let rest = digits.slice(1);
    if (!flags.hash) rest = rest.replace(/0+$/, '');
    const mantissa = d1 + (rest.length > 0 ? '.' + rest : flags.hash ? '.' : '');
    const expSign = X >= 0 ? '+' : '-';
    let expDigits = Math.abs(X).toString();
    if (expDigits.length < 2) expDigits = expDigits.padStart(2, '0');
    bodyDigits = mantissa + (conv === 'G' ? 'E' : 'e') + expSign + expDigits;
  }
  return padField(sign, '', bodyDigits, width, flags.minus, zeroPad);
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let result = '';
  let argIndex = 0;
  let i = 0;
  const n = fmt.length;

  while (i < n) {
    const ch = fmt[i];
    if (ch !== '%') {
      result += ch;
      i++;
      continue;
    }

    if (fmt[i + 1] === '%') {
      result += '%';
      i += 2;
      continue;
    }

    let j = i + 1;
    const flags: Flags = { minus: false, plus: false, space: false, zero: false, hash: false };
    while (j < n) {
      const f = fmt[j];
      if (f === '-') flags.minus = true;
      else if (f === '+') flags.plus = true;
      else if (f === ' ') flags.space = true;
      else if (f === '0') flags.zero = true;
      else if (f === '#') flags.hash = true;
      else break;
      j++;
    }

    let widthStr = '';
    while (j < n && fmt[j] >= '0' && fmt[j] <= '9') {
      widthStr += fmt[j];
      j++;
    }
    const width = widthStr === '' ? 0 : parseInt(widthStr, 10);

    let precision: number | undefined = undefined;
    if (fmt[j] === '.') {
      j++;
      let precStr = '';
      while (j < n && fmt[j] >= '0' && fmt[j] <= '9') {
        precStr += fmt[j];
        j++;
      }
      precision = precStr === '' ? 0 : parseInt(precStr, 10);
    }

    const conv = fmt[j];
    j++;

    const arg = args[argIndex++];

    if (conv === 'd' || conv === 'i' || conv === 'x' || conv === 'X' || conv === 'o') {
      result += formatInt(conv, arg as number | bigint, flags, width, precision);
    } else if (
      conv === 'e' ||
      conv === 'E' ||
      conv === 'f' ||
      conv === 'F' ||
      conv === 'g' ||
      conv === 'G'
    ) {
      result += formatFloat(conv, arg as number, flags, width, precision);
    } else if (conv === 's') {
      const str = arg as string;
      const body = precision !== undefined ? str.slice(0, precision) : str;
      result += padField('', '', body, width, flags.minus, false);
    } else if (conv === 'c') {
      const ch2 = arg as string;
      result += padField('', '', ch2, width, flags.minus, false);
    }

    i = j;
  }

  return result;
}
