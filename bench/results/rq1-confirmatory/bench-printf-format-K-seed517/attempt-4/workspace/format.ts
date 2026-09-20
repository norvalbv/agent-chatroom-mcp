type Flags = {
  minus: boolean;
  plus: boolean;
  space: boolean;
  zero: boolean;
  hash: boolean;
};

type Spec = {
  flags: Flags;
  width: number | null;
  precision: number | null;
  conv: string;
  end: number;
};

function parseSpec(fmt: string, start: number): Spec {
  let i = start;
  const flags: Flags = { minus: false, plus: false, space: false, zero: false, hash: false };
  while (i < fmt.length) {
    const c = fmt[i];
    if (c === '-') flags.minus = true;
    else if (c === '+') flags.plus = true;
    else if (c === ' ') flags.space = true;
    else if (c === '0') flags.zero = true;
    else if (c === '#') flags.hash = true;
    else break;
    i++;
  }
  let width: number | null = null;
  let widthStart = i;
  while (i < fmt.length && fmt[i] >= '0' && fmt[i] <= '9') i++;
  if (i > widthStart) width = parseInt(fmt.slice(widthStart, i), 10);

  let precision: number | null = null;
  if (fmt[i] === '.') {
    i++;
    let precStart = i;
    while (i < fmt.length && fmt[i] >= '0' && fmt[i] <= '9') i++;
    precision = i > precStart ? parseInt(fmt.slice(precStart, i), 10) : 0;
  }

  const conv = fmt[i];
  i++;
  return { flags, width, precision, conv, end: i };
}

function signStr(isNegative: boolean, plusFlag: boolean, spaceFlag: boolean): string {
  if (isNegative) return '-';
  if (plusFlag) return '+';
  if (spaceFlag) return ' ';
  return '';
}

function assemble(prefix: string, body: string, width: number | null, leftAlign: boolean, zeroPad: boolean): string {
  const total = prefix.length + body.length;
  if (width === null || total >= width) return prefix + body;
  const padLen = width - total;
  if (leftAlign) return prefix + body + ' '.repeat(padLen);
  if (zeroPad) return prefix + '0'.repeat(padLen) + body;
  return ' '.repeat(padLen) + prefix + body;
}

function exactDecimalParts(x: number): { sign: string; intDigits: string; fracDigits: string } {
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setFloat64(0, x);
  const hi = view.getUint32(0);
  const lo = view.getUint32(4);
  const signBit = hi >>> 31;
  const sign = signBit ? '-' : '';
  const expBits = (hi >>> 20) & 0x7ff;
  const mantHi = hi & 0xfffff;
  let mantissa = (BigInt(mantHi) << 32n) | BigInt(lo);
  let exp2: number;
  if (expBits === 0) {
    exp2 = -1074;
  } else {
    mantissa = mantissa | (1n << 52n);
    exp2 = expBits - 1075;
  }
  if (mantissa === 0n) {
    return { sign, intDigits: '0', fracDigits: '' };
  }
  let intDigits: string;
  let fracDigits: string;
  if (exp2 >= 0) {
    const intVal = mantissa << BigInt(exp2);
    intDigits = intVal.toString();
    fracDigits = '';
  } else {
    const k = -exp2;
    const numerator = mantissa * 5n ** BigInt(k);
    let digits = numerator.toString();
    if (digits.length <= k) {
      digits = '0'.repeat(k - digits.length + 1) + digits;
    }
    intDigits = digits.slice(0, digits.length - k);
    fracDigits = digits.slice(digits.length - k);
    if (intDigits === '') intDigits = '0';
  }
  return { sign, intDigits, fracDigits };
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

function decideRoundUp(lastKeptDigit: string, remainder: string): boolean {
  if (remainder.length === 0) return false;
  const first = remainder[0];
  if (first < '5') return false;
  if (first > '5') return true;
  const restAllZero = /^0*$/.test(remainder.slice(1));
  if (!restAllZero) return true;
  return Number(lastKeptDigit) % 2 === 1;
}

function roundFixed(intDigits: string, fracDigits: string, precision: number): { intDigits: string; fracDigits: string } {
  if (precision >= fracDigits.length) {
    return { intDigits, fracDigits: fracDigits + '0'.repeat(precision - fracDigits.length) };
  }
  const combined = intDigits + fracDigits;
  const cutIndex = intDigits.length + precision;
  let kept = combined.slice(0, cutIndex);
  const remainder = combined.slice(cutIndex);
  const lastKept = kept[kept.length - 1];
  if (decideRoundUp(lastKept, remainder)) {
    kept = incrementDigitString(kept);
  }
  const extra = kept.length - cutIndex;
  const newIntLen = intDigits.length + extra;
  let newIntDigits = kept.slice(0, newIntLen);
  const newFracDigits = kept.slice(newIntLen);
  if (newIntDigits === '') newIntDigits = '0';
  return { intDigits: newIntDigits, fracDigits: newFracDigits };
}

function roundSignificant(intDigits: string, fracDigits: string, sigCount: number): { digits: string; exponent: number } {
  const combined = intDigits + fracDigits;
  const pointPos = intDigits.length;
  let fsig = -1;
  for (let i = 0; i < combined.length; i++) {
    if (combined[i] !== '0') {
      fsig = i;
      break;
    }
  }
  if (fsig === -1) {
    return { digits: '0'.repeat(sigCount), exponent: 0 };
  }
  const trimmed = combined.slice(fsig);
  let exponent = pointPos - 1 - fsig;
  let kept: string;
  if (trimmed.length <= sigCount) {
    kept = trimmed + '0'.repeat(sigCount - trimmed.length);
  } else {
    kept = trimmed.slice(0, sigCount);
    const remainder = trimmed.slice(sigCount);
    const lastKept = kept[kept.length - 1];
    if (decideRoundUp(lastKept, remainder)) {
      kept = incrementDigitString(kept);
      if (kept.length > sigCount) {
        kept = kept.slice(0, sigCount);
        exponent += 1;
      }
    }
  }
  return { digits: kept, exponent };
}

function formatExpBody(digits: string, exponent: number, precision: number, hash: boolean, upper: boolean): string {
  const firstDigit = digits[0];
  const restDigits = digits.slice(1);
  let fracPart = '';
  if (precision > 0) fracPart = '.' + restDigits;
  else if (hash) fracPart = '.';
  const expSign = exponent < 0 ? '-' : '+';
  let expAbs = Math.abs(exponent).toString();
  if (expAbs.length < 2) expAbs = '0' + expAbs;
  const eChar = upper ? 'E' : 'e';
  return firstDigit + fracPart + eChar + expSign + expAbs;
}

function formatNumeric(val: number, spec: Spec): string {
  const { flags, width, conv } = spec;
  const upper = conv === conv.toUpperCase();

  if (Number.isNaN(val)) {
    const body = upper ? 'NAN' : 'nan';
    return assemble('', body, width, flags.minus, false);
  }
  if (!Number.isFinite(val)) {
    const isNeg = val < 0;
    const body = upper ? 'INF' : 'inf';
    const sign = signStr(isNeg, flags.plus, flags.space);
    return assemble(sign, body, width, flags.minus, false);
  }

  const parts = exactDecimalParts(val);
  const isNeg = parts.sign === '-';
  const sign = signStr(isNeg, flags.plus, flags.space);
  const zeroPad = flags.zero && !flags.minus;

  if (conv === 'e' || conv === 'E') {
    const precision = spec.precision === null ? 6 : spec.precision;
    const { digits, exponent } = roundSignificant(parts.intDigits, parts.fracDigits, precision + 1);
    const body = formatExpBody(digits, exponent, precision, flags.hash, conv === 'E');
    return assemble(sign, body, width, flags.minus, zeroPad);
  }

  if (conv === 'f' || conv === 'F') {
    const precision = spec.precision === null ? 6 : spec.precision;
    const { intDigits, fracDigits } = roundFixed(parts.intDigits, parts.fracDigits, precision);
    let body = intDigits;
    if (precision > 0) body += '.' + fracDigits;
    else if (flags.hash) body += '.';
    return assemble(sign, body, width, flags.minus, zeroPad);
  }

  // g, G
  let P = spec.precision === null ? 6 : spec.precision;
  if (P === 0) P = 1;
  const { digits, exponent } = roundSignificant(parts.intDigits, parts.fracDigits, P);
  let body: string;
  if (P > exponent && exponent >= -4) {
    let intPart: string;
    let fracPart: string;
    if (exponent >= 0) {
      if (exponent + 1 >= digits.length) {
        intPart = digits + '0'.repeat(exponent + 1 - digits.length);
        fracPart = '';
      } else {
        intPart = digits.slice(0, exponent + 1);
        fracPart = digits.slice(exponent + 1);
      }
    } else {
      intPart = '0';
      fracPart = '0'.repeat(-exponent - 1) + digits;
    }
    if (!flags.hash) {
      fracPart = fracPart.replace(/0+$/, '');
      body = fracPart.length > 0 ? intPart + '.' + fracPart : intPart;
    } else {
      body = intPart + '.' + fracPart;
    }
  } else {
    let restDigits = digits.slice(1);
    if (!flags.hash) restDigits = restDigits.replace(/0+$/, '');
    body = formatExpBody(digits[0] + restDigits, exponent, restDigits.length, flags.hash, conv === 'G');
  }
  return assemble(sign, body, width, flags.minus, zeroPad);
}

function formatInteger(val: number | bigint, spec: Spec): string {
  const { flags, width, precision, conv } = spec;
  let big: bigint = typeof val === 'bigint' ? val : BigInt(val);

  if (conv === 'd' || conv === 'i') {
    const isNeg = big < 0n;
    const abs = isNeg ? -big : big;
    let digits = abs.toString();
    if (precision !== null) {
      if (precision === 0 && abs === 0n) digits = '';
      else if (digits.length < precision) digits = '0'.repeat(precision - digits.length) + digits;
    }
    const sign = signStr(isNeg, flags.plus, flags.space);
    const zeroPad = flags.zero && !flags.minus && precision === null;
    return assemble(sign, digits, width, flags.minus, zeroPad);
  }

  // x, X, o
  const base = conv === 'o' ? 8 : 16;
  let digits = big.toString(base);
  if (conv === 'X') digits = digits.toUpperCase();
  if (precision !== null) {
    if (precision === 0 && big === 0n) digits = '';
    else if (digits.length < precision) digits = '0'.repeat(precision - digits.length) + digits;
  }
  let prefix = '';
  if (flags.hash) {
    if ((conv === 'x' || conv === 'X') && big !== 0n) prefix = conv === 'x' ? '0x' : '0X';
    if (conv === 'o' && (digits.length === 0 || digits[0] !== '0')) {
      digits = '0' + digits;
    }
  }
  const zeroPad = flags.zero && !flags.minus && precision === null;
  return assemble(prefix, digits, width, flags.minus, zeroPad);
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let result = '';
  let argIndex = 0;
  let i = 0;
  while (i < fmt.length) {
    const c = fmt[i];
    if (c !== '%') {
      result += c;
      i++;
      continue;
    }
    const spec = parseSpec(fmt, i + 1);
    if (spec.conv === '%') {
      result += '%';
      i = spec.end;
      continue;
    }
    const arg = args[argIndex++];
    switch (spec.conv) {
      case 'd':
      case 'i':
      case 'x':
      case 'X':
      case 'o':
        result += formatInteger(arg as number | bigint, spec);
        break;
      case 'e':
      case 'E':
      case 'f':
      case 'F':
      case 'g':
      case 'G':
        result += formatNumeric(arg as number, spec);
        break;
      case 's': {
        let s = arg as string;
        if (spec.precision !== null) s = s.slice(0, spec.precision);
        result += assemble('', s, spec.width, spec.flags.minus, false);
        break;
      }
      case 'c':
        result += assemble('', arg as string, spec.width, spec.flags.minus, false);
        break;
    }
    i = spec.end;
  }
  return result;
}
