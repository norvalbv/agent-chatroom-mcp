type Flags = Set<string>;

function incrementDecimalString(s: string): string {
  if (s === '') return '1';
  const arr = s.split('');
  let i = arr.length - 1;
  while (i >= 0) {
    if (arr[i] === '9') {
      arr[i] = '0';
      i--;
    } else {
      arr[i] = String(Number(arr[i]) + 1);
      break;
    }
  }
  if (i < 0) return '1' + arr.join('');
  return arr.join('');
}

// Rounds an exact decimal digit string to `keep` digits, using round-half-to-even.
// Returns the rounded digits; if rounding overflows (e.g. "999" -> "1000"), the
// returned string has length keep+1 and `carried` is true.
function roundDigits(digits: string, keep: number): { digits: string; carried: boolean } {
  if (keep >= digits.length) {
    return { digits: digits + '0'.repeat(keep - digits.length), carried: false };
  }
  const kept = digits.slice(0, keep);
  const rest = digits.slice(keep);
  const firstRest = rest[0];
  let roundUp = false;
  if (firstRest > '5') {
    roundUp = true;
  } else if (firstRest === '5') {
    if (/[1-9]/.test(rest.slice(1))) {
      roundUp = true;
    } else {
      const lastKept = keep > 0 ? kept[keep - 1] : '0';
      roundUp = Number(lastKept) % 2 === 1;
    }
  }
  if (!roundUp) return { digits: kept, carried: false };
  const incremented = incrementDecimalString(kept);
  if (incremented.length > kept.length) {
    return { digits: incremented, carried: true };
  }
  return { digits: incremented, carried: false };
}

// Decomposes a finite, non-negative double into its exact decimal expansion.
function decomposeDouble(x: number): { intPart: string; fracPart: string } {
  if (x === 0) return { intPart: '0', fracPart: '' };
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setFloat64(0, x);
  const hi = view.getUint32(0);
  const lo = view.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  const mantHi = hi & 0xfffff;
  let mantissa = (BigInt(mantHi) << 32n) | BigInt(lo >>> 0);
  let E: bigint;
  if (expBits === 0) {
    E = -1074n;
  } else {
    mantissa = mantissa | (1n << 52n);
    E = BigInt(expBits - 1075);
  }
  if (E >= 0n) {
    return { intPart: (mantissa << E).toString(), fracPart: '' };
  }
  const k = -E;
  const numerator = mantissa * 5n ** k;
  let s = numerator.toString();
  const kNum = Number(k);
  if (s.length <= kNum) {
    s = '0'.repeat(kNum - s.length + 1) + s;
  }
  const intPart = s.slice(0, s.length - kNum) || '0';
  const fracPart = s.slice(s.length - kNum);
  return { intPart, fracPart };
}

function assembleNumeric(
  sign: string,
  prefix: string,
  digits: string,
  width: number,
  leftAlign: boolean,
  zeroPad: boolean
): string {
  const content = sign + prefix + digits;
  if (content.length >= width) return content;
  const padLen = width - content.length;
  if (leftAlign) return content + ' '.repeat(padLen);
  if (zeroPad) return sign + prefix + '0'.repeat(padLen) + digits;
  return ' '.repeat(padLen) + content;
}

function padText(s: string, width: number, leftAlign: boolean): string {
  if (s.length >= width) return s;
  const p = ' '.repeat(width - s.length);
  return leftAlign ? s + p : p + s;
}

function toBigIntMagnitude(arg: number | bigint): { negative: boolean; mag: bigint } {
  if (typeof arg === 'bigint') {
    return { negative: arg < 0n, mag: arg < 0n ? -arg : arg };
  }
  const negative = arg < 0 || Object.is(arg, -0);
  return { negative, mag: BigInt(Math.abs(arg)) };
}

function fmtDI(flags: Flags, width: number, precision: number | undefined, arg: number | bigint): string {
  const { negative, mag } = toBigIntMagnitude(arg);
  let digits = mag.toString();
  if (precision !== undefined) {
    digits = precision === 0 && mag === 0n ? '' : digits.padStart(precision, '0');
  }
  const sign = negative ? '-' : flags.has('+') ? '+' : flags.has(' ') ? ' ' : '';
  const zeroPad = flags.has('0') && !flags.has('-') && precision === undefined;
  return assembleNumeric(sign, '', digits, width, flags.has('-'), zeroPad);
}

function fmtXO(
  conv: 'x' | 'X' | 'o',
  flags: Flags,
  width: number,
  precision: number | undefined,
  arg: number | bigint
): string {
  const mag = typeof arg === 'bigint' ? arg : BigInt(arg);
  const base = conv === 'o' ? 8 : 16;
  let raw = mag.toString(base);
  if (conv === 'X') raw = raw.toUpperCase();
  let digits = raw;
  if (precision !== undefined) {
    digits = precision === 0 && mag === 0n ? '' : digits.padStart(precision, '0');
  }
  let prefix = '';
  if (flags.has('#')) {
    if (conv === 'x' || conv === 'X') {
      if (mag !== 0n) prefix = conv === 'X' ? '0X' : '0x';
    } else {
      if (digits.length === 0 || digits[0] !== '0') digits = '0' + digits;
    }
  }
  const zeroPad = flags.has('0') && !flags.has('-') && precision === undefined;
  return assembleNumeric('', prefix, digits, width, flags.has('-'), zeroPad);
}

function signAndSpecialFor(
  flags: Flags,
  upper: boolean,
  arg: number
): { done: false; sign: string } | { done: true; result: string } {
  if (Number.isNaN(arg)) {
    return { done: true, result: upper ? 'NAN' : 'nan' };
  }
  const negative = arg < 0 || Object.is(arg, -0);
  const sign = negative ? '-' : flags.has('+') ? '+' : flags.has(' ') ? ' ' : '';
  return { done: false, sign };
}

function fmtEG(
  conv: 'e' | 'E',
  flags: Flags,
  width: number,
  precision: number | undefined,
  arg: number
): string {
  const upper = conv === 'E';
  const prec = precision === undefined ? 6 : precision;
  const special = signAndSpecialFor(flags, upper, arg);
  if (special.done) {
    return assembleNumeric('', '', special.result, width, flags.has('-'), false);
  }
  const sign = special.sign;
  if (!Number.isFinite(arg)) {
    return assembleNumeric(sign, '', upper ? 'INF' : 'inf', width, flags.has('-'), false);
  }
  const absVal = Math.abs(arg);
  const P = prec + 1;
  let rounded: string;
  let exp: number;
  if (absVal === 0) {
    rounded = '0'.repeat(P);
    exp = 0;
  } else {
    const { intPart, fracPart } = decomposeDouble(absVal);
    const D = intPart + fracPart;
    const pointPos = intPart.length;
    const firstNonZero = D.search(/[1-9]/);
    exp = pointPos - firstNonZero - 1;
    const S = D.slice(firstNonZero);
    const r = roundDigits(S, P);
    rounded = r.digits;
    if (r.carried) {
      exp += 1;
      rounded = rounded.slice(0, P);
    }
  }
  const firstDigit = rounded[0];
  const rest = rounded.slice(1);
  const dot = prec > 0 || flags.has('#') ? '.' : '';
  const expSign = exp < 0 ? '-' : '+';
  const expAbs = Math.abs(exp).toString().padStart(2, '0');
  const digits = firstDigit + dot + rest + (upper ? 'E' : 'e') + expSign + expAbs;
  const zeroPad = flags.has('0') && !flags.has('-');
  return assembleNumeric(sign, '', digits, width, flags.has('-'), zeroPad);
}

function fmtF(
  conv: 'f' | 'F',
  flags: Flags,
  width: number,
  precision: number | undefined,
  arg: number
): string {
  const upper = conv === 'F';
  const prec = precision === undefined ? 6 : precision;
  const special = signAndSpecialFor(flags, upper, arg);
  if (special.done) {
    return assembleNumeric('', '', special.result, width, flags.has('-'), false);
  }
  const sign = special.sign;
  if (!Number.isFinite(arg)) {
    return assembleNumeric(sign, '', upper ? 'INF' : 'inf', width, flags.has('-'), false);
  }
  const absVal = Math.abs(arg);
  const { intPart, fracPart } = decomposeDouble(absVal);
  const D = intPart + fracPart;
  const pointPos = intPart.length;
  const keep = pointPos + prec;
  const { digits: rounded, carried } = roundDigits(D, keep);
  const finalPointPos = pointPos + (carried ? 1 : 0);
  const newIntPart = rounded.slice(0, finalPointPos);
  const newFracPart = rounded.slice(finalPointPos);
  const dot = prec > 0 || flags.has('#') ? '.' : '';
  const digits = newIntPart + dot + newFracPart;
  const zeroPad = flags.has('0') && !flags.has('-');
  return assembleNumeric(sign, '', digits, width, flags.has('-'), zeroPad);
}

function fmtG(
  conv: 'g' | 'G',
  flags: Flags,
  width: number,
  precision: number | undefined,
  arg: number
): string {
  const upper = conv === 'G';
  let P = precision === undefined ? 6 : precision === 0 ? 1 : precision;
  const special = signAndSpecialFor(flags, upper, arg);
  if (special.done) {
    return assembleNumeric('', '', special.result, width, flags.has('-'), false);
  }
  const sign = special.sign;
  if (!Number.isFinite(arg)) {
    return assembleNumeric(sign, '', upper ? 'INF' : 'inf', width, flags.has('-'), false);
  }
  const absVal = Math.abs(arg);
  let rounded: string;
  let exp: number;
  if (absVal === 0) {
    rounded = '0'.repeat(P);
    exp = 0;
  } else {
    const { intPart, fracPart } = decomposeDouble(absVal);
    const D = intPart + fracPart;
    const pointPos = intPart.length;
    const firstNonZero = D.search(/[1-9]/);
    exp = pointPos - firstNonZero - 1;
    const S = D.slice(firstNonZero);
    const r = roundDigits(S, P);
    rounded = r.digits;
    if (r.carried) {
      exp += 1;
      rounded = rounded.slice(0, P);
    }
  }
  const hash = flags.has('#');
  let digits: string;
  if (P > exp && exp >= -4) {
    let intPart: string;
    let fracPart: string;
    if (exp >= 0) {
      const intPartLen = exp + 1;
      if (intPartLen <= rounded.length) {
        intPart = rounded.slice(0, intPartLen);
        fracPart = rounded.slice(intPartLen);
      } else {
        intPart = rounded + '0'.repeat(intPartLen - rounded.length);
        fracPart = '';
      }
    } else {
      intPart = '0';
      fracPart = '0'.repeat(-exp - 1) + rounded;
    }
    if (!hash) {
      fracPart = fracPart.replace(/0+$/, '');
    }
    const dot = fracPart.length > 0 || hash ? '.' : '';
    digits = intPart + dot + fracPart;
  } else {
    const firstDigit = rounded[0];
    let rest = rounded.slice(1);
    if (!hash) {
      rest = rest.replace(/0+$/, '');
    }
    const dot = rest.length > 0 || hash ? '.' : '';
    const expSign = exp < 0 ? '-' : '+';
    const expAbs = Math.abs(exp).toString().padStart(2, '0');
    digits = firstDigit + dot + rest + (upper ? 'E' : 'e') + expSign + expAbs;
  }
  const zeroPad = flags.has('0') && !flags.has('-');
  return assembleNumeric(sign, '', digits, width, flags.has('-'), zeroPad);
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let result = '';
  let argIndex = 0;
  const re = /%([-+ 0#]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc%])/g;
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
    const flags: Flags = new Set(flagsStr.split('').filter((c) => c !== ''));
    const width = widthStr ? parseInt(widthStr, 10) : 0;
    const precision = precStr !== undefined ? (precStr === '' ? 0 : parseInt(precStr, 10)) : undefined;
    const arg = args[argIndex++];

    switch (conv) {
      case 'd':
      case 'i':
        result += fmtDI(flags, width, precision, arg as number | bigint);
        break;
      case 'x':
      case 'X':
      case 'o':
        result += fmtXO(conv, flags, width, precision, arg as number | bigint);
        break;
      case 'e':
      case 'E':
        result += fmtEG(conv, flags, width, precision, arg as number);
        break;
      case 'f':
      case 'F':
        result += fmtF(conv, flags, width, precision, arg as number);
        break;
      case 'g':
      case 'G':
        result += fmtG(conv, flags, width, precision, arg as number);
        break;
      case 's': {
        let s = String(arg);
        if (precision !== undefined) s = s.slice(0, precision);
        result += padText(s, width, flags.has('-'));
        break;
      }
      case 'c': {
        const s = String(arg);
        result += padText(s, width, flags.has('-'));
        break;
      }
    }
  }
  result += fmt.slice(lastIndex);
  return result;
}
