type Flags = {
  minus: boolean;
  plus: boolean;
  space: boolean;
  zero: boolean;
  hash: boolean;
};

function decideRoundUp(dropped: string, lastKeptDigit: string): boolean {
  if (dropped.length === 0) return false;
  const first = dropped[0];
  if (first > '5') return true;
  if (first < '5') return false;
  if (/[1-9]/.test(dropped.slice(1))) return true;
  return Number(lastKeptDigit) % 2 === 1;
}

function incrementDigitString(s: string): string {
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

// Exact decimal representation of the magnitude of a finite nonzero double.
// value = Number(digits) * 10^-k
function exactDecimalMagnitude(x: number): { digits: string; k: number } {
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  const mantissaHigh = hi & 0xfffff;
  const mantissa = (BigInt(mantissaHigh) << 32n) | BigInt(lo);
  let m: bigint;
  let e: number;
  if (expBits === 0) {
    m = mantissa;
    e = -1074;
  } else {
    m = mantissa | (1n << 52n);
    e = expBits - 1075;
  }
  if (e >= 0) {
    return { digits: (m << BigInt(e)).toString(), k: 0 };
  }
  const k = -e;
  return { digits: (m * 5n ** BigInt(k)).toString(), k };
}

// Round the exact value digits*10^-k to exactly n fractional digits (ties to even).
function roundFixed(digits: string, k: number, n: number): { intPart: string; fracPart: string } {
  let R: string;
  if (n >= k) {
    R = digits + '0'.repeat(n - k);
  } else {
    const cut = k - n;
    const padded = digits.length > cut ? digits : '0'.repeat(cut - digits.length + 1) + digits;
    const keepLen = padded.length - cut;
    const keep = padded.slice(0, keepLen);
    const dropped = padded.slice(keepLen);
    const roundUp = decideRoundUp(dropped, keep[keep.length - 1]);
    R = roundUp ? incrementDigitString(keep) : keep;
  }
  if (n === 0) {
    return { intPart: R.replace(/^0+(?=\d)/, ''), fracPart: '' };
  }
  const padded = R.padStart(n + 1, '0');
  const intPart = padded.slice(0, padded.length - n).replace(/^0+(?=\d)/, '');
  const fracPart = padded.slice(padded.length - n);
  return { intPart, fracPart };
}

// Round the exact value digits*10^-k to totalSig significant digits (ties to even).
function roundSignificant(digits: string, k: number, totalSig: number): { sigDigits: string; exponent: number } {
  const L = digits.length;
  const exponent = L - k;
  if (totalSig >= L) {
    return { sigDigits: digits.padEnd(totalSig, '0'), exponent };
  }
  const keep = digits.slice(0, totalSig);
  const dropped = digits.slice(totalSig);
  const roundUp = decideRoundUp(dropped, keep[keep.length - 1]);
  if (!roundUp) return { sigDigits: keep, exponent };
  const inc = incrementDigitString(keep);
  if (inc.length > totalSig) {
    return { sigDigits: inc.slice(0, totalSig), exponent: exponent + 1 };
  }
  return { sigDigits: inc, exponent };
}

function padNumeric(sign: string, prefix: string, digits: string, width: number, useZero: boolean, minus: boolean): string {
  const body = sign + prefix + digits;
  if (body.length >= width) return body;
  const padLen = width - body.length;
  if (minus) return body + ' '.repeat(padLen);
  if (useZero) return sign + prefix + '0'.repeat(padLen) + digits;
  return ' '.repeat(padLen) + body;
}

function padPlain(str: string, width: number, minus: boolean): string {
  if (str.length >= width) return str;
  const pad = ' '.repeat(width - str.length);
  return minus ? str + pad : pad + str;
}

function toBigIntMagnitude(arg: number | bigint): bigint {
  return typeof arg === 'bigint' ? arg : BigInt(Math.trunc(arg));
}

function formatIntDigits(mag: bigint, precision: number | undefined): string {
  let digits = mag.toString();
  if (precision !== undefined) {
    if (precision === 0 && mag === 0n) return '';
    digits = digits.padStart(precision, '0');
  }
  return digits;
}

function convertDI(flags: Flags, width: number, precision: number | undefined, arg: number | bigint): string {
  const neg = typeof arg === 'bigint' ? arg < 0n : (arg as number) < 0;
  const mag = neg ? -toBigIntMagnitude(arg) : toBigIntMagnitude(arg);
  const digits = formatIntDigits(mag, precision);
  const sign = neg ? '-' : flags.plus ? '+' : flags.space ? ' ' : '';
  const useZero = flags.zero && !flags.minus && precision === undefined;
  return padNumeric(sign, '', digits, width, useZero, flags.minus);
}

function convertOne(conv: string, flags: Flags, width: number, precision: number | undefined, arg: number | bigint | string): string {
  switch (conv) {
    case 'd':
    case 'i':
      return convertDI(flags, width, precision, arg as number | bigint);
    case 'x':
    case 'X':
    case 'o': {
      const mag = toBigIntMagnitude(arg as number | bigint);
      let digits = mag.toString(conv === 'o' ? 8 : 16);
      if (conv === 'X') digits = digits.toUpperCase();
      if (precision !== undefined) {
        if (precision === 0 && mag === 0n) digits = '';
        else digits = digits.padStart(precision, '0');
      }
      let prefix = '';
      if (conv === 'o') {
        if (flags.hash && (digits.length === 0 || digits[0] !== '0')) digits = '0' + digits;
      } else {
        if (flags.hash && mag !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      }
      const useZero = flags.zero && !flags.minus && precision === undefined;
      return padNumeric('', prefix, digits, width, useZero, flags.minus);
    }
    case 'e':
    case 'E':
    case 'f':
    case 'F':
      return convertFloat(conv, flags, width, precision, arg as number);
    case 'g':
    case 'G':
      return convertG(conv, flags, width, precision, arg as number);
    case 's': {
      let str = arg as string;
      if (precision !== undefined) str = str.slice(0, precision);
      return padPlain(str, width, flags.minus);
    }
    case 'c':
      return padPlain(arg as string, width, flags.minus);
    default:
      throw new Error(`unsupported conversion: ${conv}`);
  }
}

function signOf(x: number, flags: Flags): string {
  const neg = x < 0 || Object.is(x, -0);
  return neg ? '-' : flags.plus ? '+' : flags.space ? ' ' : '';
}

function convertFloat(conv: 'e' | 'E' | 'f' | 'F', flags: Flags, width: number, precision: number | undefined, x: number): string {
  const upper = conv === 'E' || conv === 'F';
  const isE = conv === 'e' || conv === 'E';
  const P = precision === undefined ? 6 : precision;

  if (Number.isNaN(x)) {
    const word = upper ? 'NAN' : 'nan';
    return padNumeric('', '', word, width, false, flags.minus);
  }
  if (!Number.isFinite(x)) {
    const word = upper ? 'INF' : 'inf';
    const sign = x < 0 ? '-' : flags.plus ? '+' : flags.space ? ' ' : '';
    return padNumeric(sign, '', word, width, false, flags.minus);
  }

  const sign = signOf(x, flags);

  let numStr: string;
  if (x === 0) {
    if (isE) {
      const frac = P > 0 ? '.' + '0'.repeat(P) : flags.hash ? '.' : '';
      numStr = '0' + frac + (upper ? 'E' : 'e') + '+00';
    } else {
      const frac = P > 0 ? '.' + '0'.repeat(P) : flags.hash ? '.' : '';
      numStr = '0' + frac;
    }
  } else {
    const { digits, k } = exactDecimalMagnitude(Math.abs(x));
    if (isE) {
      const { sigDigits, exponent } = roundSignificant(digits, k, P + 1);
      const eExp = exponent - 1;
      const frac = P > 0 ? '.' + sigDigits.slice(1) : flags.hash ? '.' : '';
      const expSign = eExp < 0 ? '-' : '+';
      const expDigits = Math.abs(eExp).toString().padStart(2, '0');
      numStr = sigDigits[0] + frac + (upper ? 'E' : 'e') + expSign + expDigits;
    } else {
      const { intPart, fracPart } = roundFixed(digits, k, P);
      const frac = P > 0 ? '.' + fracPart : flags.hash ? '.' : '';
      numStr = intPart + frac;
    }
  }

  const useZero = flags.zero && !flags.minus;
  return padNumeric(sign, '', numStr, width, useZero, flags.minus);
}

function convertG(conv: 'g' | 'G', flags: Flags, width: number, precision: number | undefined, x: number): string {
  const upper = conv === 'G';

  if (Number.isNaN(x)) {
    const word = upper ? 'NAN' : 'nan';
    return padNumeric('', '', word, width, false, flags.minus);
  }
  if (!Number.isFinite(x)) {
    const word = upper ? 'INF' : 'inf';
    const sign = x < 0 ? '-' : flags.plus ? '+' : flags.space ? ' ' : '';
    return padNumeric(sign, '', word, width, false, flags.minus);
  }

  const sign = signOf(x, flags);
  let P = precision === undefined ? 6 : precision === 0 ? 1 : precision;

  let numStr: string;
  if (x === 0) {
    numStr = flags.hash ? '0.' + '0'.repeat(P - 1) : '0';
  } else {
    const { digits, k } = exactDecimalMagnitude(Math.abs(x));
    const { exponent } = roundSignificant(digits, k, P);
    const X = exponent - 1;
    if (P > X && X >= -4) {
      const fPrec = P - 1 - X;
      const { intPart, fracPart } = roundFixed(digits, k, fPrec);
      if (flags.hash) {
        numStr = fPrec > 0 ? intPart + '.' + fracPart : intPart;
      } else {
        let frac = fracPart.replace(/0+$/, '');
        numStr = frac.length > 0 ? intPart + '.' + frac : intPart;
      }
    } else {
      const { sigDigits, exponent: exp2 } = roundSignificant(digits, k, P);
      const eExp = exp2 - 1;
      let fracDigits = sigDigits.slice(1);
      let mantissa: string;
      if (flags.hash) {
        mantissa = fracDigits.length > 0 ? sigDigits[0] + '.' + fracDigits : sigDigits[0];
      } else {
        fracDigits = fracDigits.replace(/0+$/, '');
        mantissa = fracDigits.length > 0 ? sigDigits[0] + '.' + fracDigits : sigDigits[0];
      }
      const expSign = eExp < 0 ? '-' : '+';
      const expDigits = Math.abs(eExp).toString().padStart(2, '0');
      numStr = mantissa + (upper ? 'E' : 'e') + expSign + expDigits;
    }
  }

  const useZero = flags.zero && !flags.minus;
  return padNumeric(sign, '', numStr, width, useZero, flags.minus);
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let result = '';
  let argIndex = 0;
  const specRe = /%([-+ 0#]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc%])/y;
  let i = 0;
  while (i < fmt.length) {
    if (fmt[i] !== '%') {
      result += fmt[i];
      i++;
      continue;
    }
    specRe.lastIndex = i;
    const m = specRe.exec(fmt);
    if (!m) {
      result += fmt[i];
      i++;
      continue;
    }
    const [full, flagsStr, widthStr, precStr, conv] = m;
    i += full.length;
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
    const precision = precStr !== undefined ? (precStr === '' ? 0 : parseInt(precStr, 10)) : undefined;
    const arg = args[argIndex++];
    result += convertOne(conv, flags, width, precision, arg);
  }
  return result;
}
