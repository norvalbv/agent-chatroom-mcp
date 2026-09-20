type Flags = {
  minus: boolean;
  plus: boolean;
  space: boolean;
  zero: boolean;
  hash: boolean;
};

function parseFlags(s: string): Flags {
  return {
    minus: s.includes('-'),
    plus: s.includes('+'),
    space: s.includes(' '),
    zero: s.includes('0'),
    hash: s.includes('#'),
  };
}

function applyPad(
  sign: string,
  prefix: string,
  digits: string,
  width: number,
  minus: boolean,
  zeroPad: boolean
): string {
  const content = sign + prefix + digits;
  const padLen = width - content.length;
  if (padLen <= 0) return content;
  if (minus) return content + ' '.repeat(padLen);
  if (zeroPad) return sign + prefix + '0'.repeat(padLen) + digits;
  return ' '.repeat(padLen) + content;
}

// Rounds a decimal digit string to `keep` digits (keep >= 1), using
// round-half-to-even, based on the exact digits that follow (no hidden
// precision loss since the input digit string is an exact representation).
function roundAt(digits: string, keep: number): { digits: string; carried: boolean } {
  if (keep >= digits.length) {
    return { digits: digits.padEnd(keep, '0'), carried: false };
  }
  const kept = digits.slice(0, keep);
  const nextDigit = digits[keep];
  const restNonZero = /[1-9]/.test(digits.slice(keep + 1));
  let roundUp: boolean;
  if (nextDigit > '5') roundUp = true;
  else if (nextDigit < '5') roundUp = false;
  else roundUp = restNonZero || Number(kept[keep - 1]) % 2 === 1;
  if (!roundUp) return { digits: kept, carried: false };
  const arr = kept.split('');
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
  if (i < 0) return { digits: '1' + arr.join(''), carried: true };
  return { digits: arr.join(''), carried: false };
}

function decomposeDouble(x: number): { mantissa: bigint; exp: number } {
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const biasedExp = (hi >>> 20) & 0x7ff;
  const mantHi = BigInt(hi & 0xfffff);
  const mantLo = BigInt(lo);
  const bits = (mantHi << 32n) | mantLo;
  if (biasedExp === 0) return { mantissa: bits, exp: -1074 };
  return { mantissa: bits | (1n << 52n), exp: biasedExp - 1075 };
}

// Exact (unrounded) decimal digits of a positive finite double.
function exactDecimalParts(x: number): { intPart: string; fracPart: string } {
  const { mantissa, exp } = decomposeDouble(x);
  if (mantissa === 0n) return { intPart: '0', fracPart: '' };
  if (exp >= 0) {
    return { intPart: (mantissa << BigInt(exp)).toString(), fracPart: '' };
  }
  const k = -exp;
  const numerator = mantissa * 5n ** BigInt(k);
  let numStr = numerator.toString();
  if (numStr.length <= k) numStr = numStr.padStart(k + 1, '0');
  return {
    intPart: numStr.slice(0, numStr.length - k),
    fracPart: numStr.slice(numStr.length - k),
  };
}

function toBigInt(v: number | bigint): bigint {
  return typeof v === 'bigint' ? v : BigInt(v);
}

function fmtInt(value: number | bigint, flags: Flags, width: number, precision?: number): string {
  const big = toBigInt(value);
  const neg = big < 0n;
  const mag = neg ? -big : big;
  let digits = mag.toString();
  if (precision !== undefined) {
    digits = precision === 0 && mag === 0n ? '' : digits.padStart(precision, '0');
  }
  const sign = neg ? '-' : flags.plus ? '+' : flags.space ? ' ' : '';
  const zeroPad = flags.zero && !flags.minus && precision === undefined;
  return applyPad(sign, '', digits, width, flags.minus, zeroPad);
}

function fmtRadix(
  value: number | bigint,
  radix: 16 | 8,
  upper: boolean,
  flags: Flags,
  width: number,
  precision: number | undefined
): string {
  const big = toBigInt(value);
  let digits = big.toString(radix);
  if (upper) digits = digits.toUpperCase();
  let p = precision;
  if (flags.hash && radix === 8) {
    const required = big > 0n ? digits.length + 1 : 1;
    p = Math.max(p ?? 0, required);
  }
  if (p !== undefined) {
    digits = p === 0 && big === 0n ? '' : digits.padStart(p, '0');
  }
  let prefix = '';
  if (flags.hash && radix === 16 && big !== 0n) prefix = upper ? '0X' : '0x';
  const zeroPad = flags.zero && !flags.minus && precision === undefined;
  return applyPad('', prefix, digits, width, flags.minus, zeroPad);
}

function significantDigits(abs: number, count: number): { digits: string; exponent: number } {
  if (abs === 0) return { digits: '0'.repeat(count), exponent: 0 };
  const { intPart, fracPart } = exactDecimalParts(abs);
  const allDigits = intPart + fracPart;
  const firstNonZero = allDigits.search(/[1-9]/);
  const exponent = intPart.length - 1 - firstNonZero;
  const sigDigitsRaw = allDigits.slice(firstNonZero);
  const rounded = roundAt(sigDigitsRaw, count);
  return { digits: rounded.digits, exponent: exponent + (rounded.carried ? 1 : 0) };
}

function signOf(value: number, flags: Flags): string {
  const neg = Object.is(value, -0) || value < 0;
  return neg ? '-' : flags.plus ? '+' : flags.space ? ' ' : '';
}

function fmtExp(
  value: number,
  upper: boolean,
  flags: Flags,
  width: number,
  precision: number | undefined
): string {
  const p = precision === undefined ? 6 : precision;
  if (Number.isNaN(value)) {
    return applyPad('', '', upper ? 'NAN' : 'nan', width, flags.minus, false);
  }
  const sign = signOf(value, flags);
  if (!Number.isFinite(value)) {
    return applyPad(sign, '', upper ? 'INF' : 'inf', width, flags.minus, false);
  }
  const abs = Math.abs(value);
  const { digits, exponent } = significantDigits(abs, p + 1);
  const fracDigits = digits.slice(1);
  const mantissa = p > 0 || flags.hash ? digits[0] + '.' + fracDigits : digits[0];
  const expSign = exponent < 0 ? '-' : '+';
  const expAbs = Math.abs(exponent).toString().padStart(2, '0');
  const body = mantissa + (upper ? 'E' : 'e') + expSign + expAbs;
  const zeroPad = flags.zero && !flags.minus;
  return applyPad(sign, '', body, width, flags.minus, zeroPad);
}

function fmtFixed(
  value: number,
  upper: boolean,
  flags: Flags,
  width: number,
  precision: number | undefined
): string {
  const p = precision === undefined ? 6 : precision;
  if (Number.isNaN(value)) {
    return applyPad('', '', upper ? 'NAN' : 'nan', width, flags.minus, false);
  }
  const sign = signOf(value, flags);
  if (!Number.isFinite(value)) {
    return applyPad(sign, '', upper ? 'INF' : 'inf', width, flags.minus, false);
  }
  const abs = Math.abs(value);
  const { intPart, fracPart } = exactDecimalParts(abs);
  const keep = intPart.length + p;
  const combined = intPart + fracPart;
  const rounded = roundAt(combined, keep);
  const newIntLen = intPart.length + (rounded.carried ? 1 : 0);
  const intDigits = rounded.digits.slice(0, newIntLen);
  const fracDigits = rounded.digits.slice(newIntLen);
  const body = p > 0 || flags.hash ? intDigits + '.' + fracDigits : intDigits;
  const zeroPad = flags.zero && !flags.minus;
  return applyPad(sign, '', body, width, flags.minus, zeroPad);
}

function fmtGeneral(
  value: number,
  upper: boolean,
  flags: Flags,
  width: number,
  precision: number | undefined
): string {
  let p = precision === undefined ? 6 : precision;
  if (p === 0) p = 1;
  if (Number.isNaN(value)) {
    return applyPad('', '', upper ? 'NAN' : 'nan', width, flags.minus, false);
  }
  const sign = signOf(value, flags);
  if (!Number.isFinite(value)) {
    return applyPad(sign, '', upper ? 'INF' : 'inf', width, flags.minus, false);
  }
  const abs = Math.abs(value);
  const { digits, exponent: X } = significantDigits(abs, p);
  let body: string;
  if (X >= -4 && X < p) {
    let intDigits: string;
    let fracDigits: string;
    if (X >= 0) {
      intDigits = digits.slice(0, X + 1);
      fracDigits = digits.slice(X + 1);
    } else {
      intDigits = '0';
      fracDigits = '0'.repeat(-X - 1) + digits;
    }
    if (!flags.hash) fracDigits = fracDigits.replace(/0+$/, '');
    body = fracDigits.length > 0 || flags.hash ? intDigits + '.' + fracDigits : intDigits;
  } else {
    let fracDigits = digits.slice(1);
    if (!flags.hash) fracDigits = fracDigits.replace(/0+$/, '');
    const mantissa = fracDigits.length > 0 || flags.hash ? digits[0] + '.' + fracDigits : digits[0];
    const expSign = X < 0 ? '-' : '+';
    const expAbs = Math.abs(X).toString().padStart(2, '0');
    body = mantissa + (upper ? 'E' : 'e') + expSign + expAbs;
  }
  const zeroPad = flags.zero && !flags.minus;
  return applyPad(sign, '', body, width, flags.minus, zeroPad);
}

function fmtString(value: string, flags: Flags, width: number, precision: number | undefined): string {
  const s = precision !== undefined ? value.slice(0, precision) : value;
  return applyPad('', '', s, width, flags.minus, false);
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  const re = /%%|%([-+ 0#]*)(\d*)(\.\d*)?([diouxXeEfFgGsc])/g;
  let result = '';
  let lastIndex = 0;
  let argIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(fmt)) !== null) {
    result += fmt.slice(lastIndex, match.index);
    lastIndex = re.lastIndex;
    if (match[0] === '%%') {
      result += '%';
      continue;
    }
    const flags = parseFlags(match[1]);
    const width = match[2] === '' ? 0 : parseInt(match[2], 10);
    const precision =
      match[3] === undefined ? undefined : match[3].length === 1 ? 0 : parseInt(match[3].slice(1), 10);
    const conv = match[4];
    const arg = args[argIndex++];
    switch (conv) {
      case 'd':
      case 'i':
        result += fmtInt(arg as number | bigint, flags, width, precision);
        break;
      case 'x':
        result += fmtRadix(arg as number | bigint, 16, false, flags, width, precision);
        break;
      case 'X':
        result += fmtRadix(arg as number | bigint, 16, true, flags, width, precision);
        break;
      case 'o':
        result += fmtRadix(arg as number | bigint, 8, false, flags, width, precision);
        break;
      case 'e':
        result += fmtExp(arg as number, false, flags, width, precision);
        break;
      case 'E':
        result += fmtExp(arg as number, true, flags, width, precision);
        break;
      case 'f':
        result += fmtFixed(arg as number, false, flags, width, precision);
        break;
      case 'F':
        result += fmtFixed(arg as number, true, flags, width, precision);
        break;
      case 'g':
        result += fmtGeneral(arg as number, false, flags, width, precision);
        break;
      case 'G':
        result += fmtGeneral(arg as number, true, flags, width, precision);
        break;
      case 's':
        result += fmtString(arg as string, flags, width, precision);
        break;
      case 'c':
        result += fmtString(arg as string, flags, width, undefined);
        break;
    }
  }
  result += fmt.slice(lastIndex);
  return result;
}
