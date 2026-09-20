type Flags = {
  dash: boolean;
  plus: boolean;
  space: boolean;
  zero: boolean;
  hash: boolean;
};

function toBigInt(v: number | bigint | string): bigint {
  if (typeof v === 'bigint') return v;
  return BigInt(v as number);
}

function incrementDecimalString(s: string): string {
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

function shouldRoundUp(rest: string, lastDigit: string): boolean {
  if (rest.length === 0) return false;
  const first = rest[0];
  if (first > '5') return true;
  if (first < '5') return false;
  const restIsZero = /^0*$/.test(rest.slice(1));
  if (!restIsZero) return true;
  return Number(lastDigit) % 2 === 1;
}

// Exact decimal expansion of a non-negative finite double.
function exactParts(ax: number): { intPart: string; fracPart: string } {
  if (ax === 0) return { intPart: '0', fracPart: '' };
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, ax);
  const hi = buf.getUint32(0);
  const lo = buf.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  const mantHi = hi & 0xfffff;
  let mantissa = (BigInt(mantHi) << 32n) | BigInt(lo);
  let e: number;
  if (expBits === 0) {
    e = -1074;
  } else {
    mantissa = mantissa | (1n << 52n);
    e = expBits - 1075;
  }
  if (e >= 0) {
    return { intPart: (mantissa << BigInt(e)).toString(), fracPart: '' };
  }
  const k = -e;
  const numerator = mantissa * 5n ** BigInt(k);
  let s = numerator.toString();
  if (s.length <= k) s = '0'.repeat(k - s.length + 1) + s;
  const intPart = s.slice(0, s.length - k) || '0';
  const fracPart = s.slice(s.length - k);
  return { intPart, fracPart };
}

// Round the exact fixed-point number (intPart.fracPart) to `precision` fractional digits.
function roundFixed(
  intPart: string,
  fracPart: string,
  precision: number,
): { intPart: string; fracPart: string } {
  if (precision >= fracPart.length) {
    return { intPart, fracPart: fracPart.padEnd(precision, '0') };
  }
  const kept = fracPart.slice(0, precision);
  const rest = fracPart.slice(precision);
  const lastKeptDigit = precision > 0 ? kept[precision - 1] : intPart[intPart.length - 1] ?? '0';
  if (!shouldRoundUp(rest, lastKeptDigit)) {
    return { intPart, fracPart: kept };
  }
  const combined = intPart + kept;
  const inc = incrementDecimalString(combined);
  return {
    intPart: inc.slice(0, inc.length - precision),
    fracPart: precision > 0 ? inc.slice(inc.length - precision) : '',
  };
}

// Round significant-digit string D (D[0] at decimal exponent decExp) to P significant digits.
function roundSignificant(
  D: string,
  decExp: number,
  P: number,
): { D: string; decExp: number } {
  if (P >= D.length) {
    return { D: D.padEnd(P, '0'), decExp };
  }
  const kept = D.slice(0, P);
  const rest = D.slice(P);
  if (!shouldRoundUp(rest, kept[P - 1])) {
    return { D: kept, decExp };
  }
  const inc = incrementDecimalString(kept);
  if (inc.length > P) {
    return { D: inc.slice(0, P), decExp: decExp + 1 };
  }
  return { D: inc, decExp };
}

function getSignificantDigits(ax: number, P: number): { D: string; decExp: number } {
  if (ax === 0) return { D: '0'.repeat(P), decExp: 0 };
  const { intPart, fracPart } = exactParts(ax);
  const combined = intPart + fracPart;
  const firstNZ = combined.search(/[1-9]/);
  const rawD = combined.slice(firstNZ);
  const rawX = intPart.length - 1 - firstNZ;
  const r = roundSignificant(rawD, rawX, P);
  return { D: r.D, decExp: r.decExp };
}

function pad(
  sign: string,
  prefix: string,
  digits: string,
  width: number,
  flags: Flags,
  zeroAllowed: boolean,
): string {
  const full = sign + prefix + digits;
  if (full.length >= width) return full;
  const padLen = width - full.length;
  if (flags.dash) return full + ' '.repeat(padLen);
  if (zeroAllowed) return sign + prefix + '0'.repeat(padLen) + digits;
  return ' '.repeat(padLen) + full;
}

function signChar(neg: boolean, isNaN_: boolean, flags: Flags): string {
  if (isNaN_) return '';
  if (neg) return '-';
  if (flags.plus) return '+';
  if (flags.space) return ' ';
  return '';
}

function formatD(
  value: bigint,
  flags: Flags,
  width: number,
  precisionGiven: boolean,
  precision: number,
): string {
  const neg = value < 0n;
  const mag = neg ? -value : value;
  let digits: string;
  if (precisionGiven) {
    digits = precision === 0 && mag === 0n ? '' : mag.toString(10).padStart(precision, '0');
  } else {
    digits = mag.toString(10);
  }
  const sign = neg ? '-' : flags.plus ? '+' : flags.space ? ' ' : '';
  const zeroAllowed = flags.zero && !flags.dash && !precisionGiven;
  return pad(sign, '', digits, width, flags, zeroAllowed);
}

function formatHexOct(
  value: bigint,
  conv: 'x' | 'X' | 'o',
  flags: Flags,
  width: number,
  precisionGiven: boolean,
  precision: number,
): string {
  const base = conv === 'o' ? 8 : 16;
  let digits = value.toString(base);
  if (conv === 'X') digits = digits.toUpperCase();
  if (precisionGiven) {
    digits = precision === 0 && value === 0n ? '' : digits.padStart(precision, '0');
  }
  let prefix = '';
  if (flags.hash) {
    if ((conv === 'x' || conv === 'X') && value !== 0n) {
      prefix = conv === 'x' ? '0x' : '0X';
    }
    if (conv === 'o') {
      if (digits.length === 0 || digits[0] !== '0') {
        digits = '0' + digits;
      }
    }
  }
  const zeroAllowed = flags.zero && !flags.dash && !precisionGiven;
  return pad('', prefix, digits, width, flags, zeroAllowed);
}

function formatF(
  x: number,
  flags: Flags,
  width: number,
  precisionGiven: boolean,
  precision: number,
  upper: boolean,
): string {
  const prec = precisionGiven ? precision : 6;
  const isNaN_ = Number.isNaN(x);
  const isInf = !Number.isFinite(x) && !isNaN_;
  const neg = isNaN_ ? false : x < 0 || Object.is(x, -0);
  const sign = signChar(neg, isNaN_, flags);
  let zeroAllowed = flags.zero && !flags.dash;
  let body: string;
  if (isNaN_) {
    body = upper ? 'NAN' : 'nan';
    zeroAllowed = false;
  } else if (isInf) {
    body = upper ? 'INF' : 'inf';
    zeroAllowed = false;
  } else {
    const ax = Math.abs(x);
    const { intPart, fracPart } = exactParts(ax);
    const rounded = roundFixed(intPart, fracPart, prec);
    const dot = prec > 0 ? '.' : flags.hash ? '.' : '';
    body = rounded.intPart + dot + (prec > 0 ? rounded.fracPart : '');
  }
  return pad(sign, '', body, width, flags, zeroAllowed);
}

function formatE(
  x: number,
  flags: Flags,
  width: number,
  precisionGiven: boolean,
  precision: number,
  upper: boolean,
): string {
  const prec = precisionGiven ? precision : 6;
  const isNaN_ = Number.isNaN(x);
  const isInf = !Number.isFinite(x) && !isNaN_;
  const neg = isNaN_ ? false : x < 0 || Object.is(x, -0);
  const sign = signChar(neg, isNaN_, flags);
  let zeroAllowed = flags.zero && !flags.dash;
  let body: string;
  if (isNaN_) {
    body = upper ? 'NAN' : 'nan';
    zeroAllowed = false;
  } else if (isInf) {
    body = upper ? 'INF' : 'inf';
    zeroAllowed = false;
  } else {
    const ax = Math.abs(x);
    const P = prec + 1;
    const { D, decExp } = getSignificantDigits(ax, P);
    const digit0 = D[0];
    const rest = D.slice(1);
    const dot = prec > 0 ? '.' : flags.hash ? '.' : '';
    const expSign = decExp < 0 ? '-' : '+';
    const expAbs = Math.abs(decExp).toString().padStart(2, '0');
    body = digit0 + dot + (prec > 0 ? rest : '') + (upper ? 'E' : 'e') + expSign + expAbs;
  }
  return pad(sign, '', body, width, flags, zeroAllowed);
}

function formatG(
  x: number,
  flags: Flags,
  width: number,
  precisionGiven: boolean,
  precision: number,
  upper: boolean,
): string {
  let P = precisionGiven ? precision : 6;
  if (P === 0) P = 1;
  const isNaN_ = Number.isNaN(x);
  const isInf = !Number.isFinite(x) && !isNaN_;
  const neg = isNaN_ ? false : x < 0 || Object.is(x, -0);
  const sign = signChar(neg, isNaN_, flags);
  let zeroAllowed = flags.zero && !flags.dash;
  let body: string;
  if (isNaN_) {
    body = upper ? 'NAN' : 'nan';
    zeroAllowed = false;
  } else if (isInf) {
    body = upper ? 'INF' : 'inf';
    zeroAllowed = false;
  } else {
    const ax = Math.abs(x);
    const { D, decExp: X } = getSignificantDigits(ax, P);
    if (P > X && X >= -4) {
      let intDigits: string;
      let fracDigits: string;
      if (X >= 0) {
        intDigits = D.slice(0, X + 1);
        fracDigits = D.slice(X + 1);
      } else {
        intDigits = '0';
        fracDigits = '0'.repeat(-X - 1) + D;
      }
      if (!flags.hash) fracDigits = fracDigits.replace(/0+$/, '');
      body = intDigits + (fracDigits.length > 0 ? '.' + fracDigits : flags.hash ? '.' : '');
    } else {
      let fracDigits = D.slice(1);
      if (!flags.hash) fracDigits = fracDigits.replace(/0+$/, '');
      const expSign = X < 0 ? '-' : '+';
      const expAbs = Math.abs(X).toString().padStart(2, '0');
      body =
        D[0] +
        (fracDigits.length > 0 ? '.' + fracDigits : flags.hash ? '.' : '') +
        (upper ? 'E' : 'e') +
        expSign +
        expAbs;
    }
  }
  return pad(sign, '', body, width, flags, zeroAllowed);
}

function formatS(
  str: string,
  flags: Flags,
  width: number,
  precisionGiven: boolean,
  precision: number,
): string {
  const s = precisionGiven ? str.slice(0, precision) : str;
  return pad('', '', s, width, flags, false);
}

function formatC(ch: string, flags: Flags, width: number): string {
  return pad('', '', ch, width, flags, false);
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let result = '';
  let argi = 0;
  let i = 0;
  while (i < fmt.length) {
    const ch = fmt[i];
    if (ch !== '%') {
      result += ch;
      i++;
      continue;
    }
    i++;
    if (fmt[i] === '%') {
      result += '%';
      i++;
      continue;
    }
    const flags: Flags = { dash: false, plus: false, space: false, zero: false, hash: false };
    while (i < fmt.length && '-+0# '.includes(fmt[i])) {
      switch (fmt[i]) {
        case '-':
          flags.dash = true;
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
      i++;
    }
    let widthStr = '';
    while (i < fmt.length && /[0-9]/.test(fmt[i])) {
      widthStr += fmt[i];
      i++;
    }
    const width = widthStr === '' ? 0 : parseInt(widthStr, 10);
    let precisionGiven = false;
    let precision = 0;
    if (fmt[i] === '.') {
      precisionGiven = true;
      i++;
      let precStr = '';
      while (i < fmt.length && /[0-9]/.test(fmt[i])) {
        precStr += fmt[i];
        i++;
      }
      precision = precStr === '' ? 0 : parseInt(precStr, 10);
    }
    const conv = fmt[i];
    i++;
    const arg = args[argi++];
    switch (conv) {
      case 'd':
      case 'i':
        result += formatD(toBigInt(arg as number | bigint), flags, width, precisionGiven, precision);
        break;
      case 'x':
      case 'X':
      case 'o':
        result += formatHexOct(
          toBigInt(arg as number | bigint),
          conv,
          flags,
          width,
          precisionGiven,
          precision,
        );
        break;
      case 'e':
        result += formatE(Number(arg), flags, width, precisionGiven, precision, false);
        break;
      case 'E':
        result += formatE(Number(arg), flags, width, precisionGiven, precision, true);
        break;
      case 'f':
        result += formatF(Number(arg), flags, width, precisionGiven, precision, false);
        break;
      case 'F':
        result += formatF(Number(arg), flags, width, precisionGiven, precision, true);
        break;
      case 'g':
        result += formatG(Number(arg), flags, width, precisionGiven, precision, false);
        break;
      case 'G':
        result += formatG(Number(arg), flags, width, precisionGiven, precision, true);
        break;
      case 's':
        result += formatS(String(arg), flags, width, precisionGiven, precision);
        break;
      case 'c':
        result += formatC(String(arg), flags, width);
        break;
    }
  }
  return result;
}
