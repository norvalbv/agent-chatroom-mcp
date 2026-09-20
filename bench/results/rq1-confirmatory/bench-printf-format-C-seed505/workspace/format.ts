function floatBits(value: number): { sign: 0 | 1; rawExp: number; mantissa: bigint } {
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setFloat64(0, value);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const sign = ((hi >>> 31) & 1) as 0 | 1;
  const rawExp = (hi >>> 20) & 0x7ff;
  const mantHi = hi & 0xfffff;
  const mantissa = (BigInt(mantHi) << 32n) | BigInt(lo >>> 0);
  return { sign, rawExp, mantissa };
}

function exactDigits(absValue: number): { intDigits: string; fracDigits: string } {
  if (absValue === 0) return { intDigits: '0', fracDigits: '' };
  const { rawExp, mantissa } = floatBits(absValue);
  let M: bigint;
  let E: number;
  if (rawExp === 0) {
    M = mantissa;
    E = -1074;
  } else {
    M = mantissa | (1n << 52n);
    E = rawExp - 1075;
  }
  if (E >= 0) {
    const intVal = M << BigInt(E);
    return { intDigits: intVal.toString(), fracDigits: '' };
  }
  const shift = -E;
  const numerator = M * 5n ** BigInt(shift);
  let numStr = numerator.toString();
  if (numStr.length <= shift) {
    numStr = '0'.repeat(shift - numStr.length + 1) + numStr;
  }
  const intPart = numStr.slice(0, numStr.length - shift);
  const fracPart = numStr.slice(numStr.length - shift);
  return { intDigits: intPart, fracDigits: fracPart };
}

function incrementDigits(s: string): string {
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

function decideRoundUp(rest: string, lastKeptDigit: string): boolean {
  const first = rest[0];
  if (first < '5') return false;
  if (first > '5') return true;
  if (/[1-9]/.test(rest.slice(1))) return true;
  return Number(lastKeptDigit) % 2 === 1;
}

function roundFixed(intDigits: string, fracDigits: string, k: number): { intDigits: string; fracDigits: string } {
  if (fracDigits.length <= k) {
    return { intDigits, fracDigits: fracDigits.padEnd(k, '0') };
  }
  const keep = fracDigits.slice(0, k);
  const rest = fracDigits.slice(k);
  const lastKept = k === 0 ? intDigits[intDigits.length - 1] : keep[keep.length - 1];
  const roundUp = decideRoundUp(rest, lastKept);
  if (!roundUp) return { intDigits, fracDigits: keep };
  const combined = intDigits + keep;
  const incremented = incrementDigits(combined);
  if (incremented.length > combined.length) {
    const newInt = incremented.slice(0, intDigits.length + 1);
    const newFrac = incremented.slice(intDigits.length + 1);
    return { intDigits: newInt, fracDigits: newFrac };
  }
  const newInt = incremented.slice(0, intDigits.length);
  const newFrac = incremented.slice(intDigits.length);
  return { intDigits: newInt, fracDigits: newFrac };
}

function roundSignificant(intDigits: string, fracDigits: string, P: number): { digits: string; exp: number } {
  const full = intDigits + fracDigits;
  const pointPos = intDigits.length;
  const firstNonZero = full.search(/[1-9]/);
  if (firstNonZero === -1) {
    return { digits: '0'.repeat(P), exp: 0 };
  }
  const sig = full.slice(firstNonZero);
  const exp = pointPos - firstNonZero - 1;
  if (sig.length <= P) {
    return { digits: sig.padEnd(P, '0'), exp };
  }
  const keep = sig.slice(0, P);
  const rest = sig.slice(P);
  const roundUp = decideRoundUp(rest, keep[keep.length - 1]);
  if (!roundUp) return { digits: keep, exp };
  const incremented = incrementDigits(keep);
  if (incremented.length > keep.length) {
    return { digits: incremented.slice(0, P), exp: exp + 1 };
  }
  return { digits: incremented, exp };
}

function padNumeric(
  sign: string,
  prefix: string,
  digits: string,
  width: number,
  flags: Set<string>,
  allowZeroPad: boolean,
): string {
  const body = sign + prefix + digits;
  if (body.length >= width) return body;
  const padLen = width - body.length;
  if (flags.has('-')) return body + ' '.repeat(padLen);
  if (allowZeroPad && flags.has('0')) return sign + prefix + '0'.repeat(padLen) + digits;
  return ' '.repeat(padLen) + body;
}

function formatIntConv(
  value: number | bigint,
  conv: string,
  flags: Set<string>,
  width: number,
  precisionGiven: boolean,
  precision: number,
): string {
  const big = typeof value === 'bigint' ? value : BigInt(value);
  const allowZero = !precisionGiven;
  if (conv === 'd' || conv === 'i') {
    const neg = big < 0n;
    const abs = neg ? -big : big;
    let digits = abs.toString(10);
    if (precisionGiven) {
      digits = precision === 0 && abs === 0n ? '' : digits.padStart(precision, '0');
    }
    const sign = neg ? '-' : flags.has('+') ? '+' : flags.has(' ') ? ' ' : '';
    return padNumeric(sign, '', digits, width, flags, allowZero);
  }
  if (conv === 'o') {
    let digits = big.toString(8);
    if (precisionGiven) {
      digits = precision === 0 && big === 0n ? '' : digits.padStart(precision, '0');
    }
    if (flags.has('#') && digits[0] !== '0') digits = '0' + digits;
    return padNumeric('', '', digits, width, flags, allowZero);
  }
  let digits = big.toString(16);
  if (conv === 'X') digits = digits.toUpperCase();
  if (precisionGiven) {
    digits = precision === 0 && big === 0n ? '' : digits.padStart(precision, '0');
  }
  const prefix = flags.has('#') && big !== 0n ? (conv === 'X' ? '0X' : '0x') : '';
  return padNumeric('', prefix, digits, width, flags, allowZero);
}

function formatFloatConv(
  value: number,
  conv: string,
  flags: Set<string>,
  width: number,
  precisionGiven: boolean,
  precision: number,
): string {
  const upper = conv === conv.toUpperCase();
  if (Number.isNaN(value)) {
    const text = upper ? 'NAN' : 'nan';
    return padNumeric('', '', text, width, flags, false);
  }
  const { sign: signBit } = floatBits(value);
  const isNeg = signBit === 1;
  if (!Number.isFinite(value)) {
    const text = upper ? 'INF' : 'inf';
    const sign = isNeg ? '-' : flags.has('+') ? '+' : flags.has(' ') ? ' ' : '';
    return padNumeric(sign, '', text, width, flags, false);
  }
  const absVal = Math.abs(value);
  const sign = isNeg ? '-' : flags.has('+') ? '+' : flags.has(' ') ? ' ' : '';
  const prec = precisionGiven ? precision : 6;
  let bodyDigits: string;

  if (conv === 'f' || conv === 'F') {
    const { intDigits, fracDigits } = exactDigits(absVal);
    const rounded = roundFixed(intDigits, fracDigits, prec);
    bodyDigits = rounded.intDigits;
    if (prec > 0 || flags.has('#')) bodyDigits += '.' + rounded.fracDigits;
  } else if (conv === 'e' || conv === 'E') {
    const { intDigits, fracDigits } = exactDigits(absVal);
    const { digits, exp } = roundSignificant(intDigits, fracDigits, prec + 1);
    let mantissa = digits[0];
    if (prec > 0 || flags.has('#')) mantissa += '.' + digits.slice(1);
    const expSign = exp < 0 ? '-' : '+';
    const expAbs = Math.abs(exp).toString().padStart(2, '0');
    bodyDigits = mantissa + (conv === 'E' ? 'E' : 'e') + expSign + expAbs;
  } else {
    const P = prec === 0 ? 1 : prec;
    const { intDigits, fracDigits } = exactDigits(absVal);
    const { digits, exp: X } = roundSignificant(intDigits, fracDigits, P);
    if (P > X && X >= -4) {
      const fPrec = P - 1 - X;
      const rounded = roundFixed(intDigits, fracDigits, fPrec);
      let fracPart = rounded.fracDigits;
      if (!flags.has('#')) fracPart = fracPart.replace(/0+$/, '');
      bodyDigits = rounded.intDigits;
      if (fracPart.length > 0 || flags.has('#')) bodyDigits += '.' + fracPart;
    } else {
      let fracPart = digits.slice(1);
      if (!flags.has('#')) fracPart = fracPart.replace(/0+$/, '');
      let mantissa = digits[0];
      if (fracPart.length > 0 || flags.has('#')) mantissa += '.' + fracPart;
      const expSign = X < 0 ? '-' : '+';
      const expAbs = Math.abs(X).toString().padStart(2, '0');
      bodyDigits = mantissa + (conv === 'G' ? 'E' : 'e') + expSign + expAbs;
    }
  }
  return padNumeric(sign, '', bodyDigits, width, flags, true);
}

function formatStringConv(
  value: string,
  conv: string,
  flags: Set<string>,
  width: number,
  precisionGiven: boolean,
  precision: number,
): string {
  const text = conv === 'c' ? value : precisionGiven ? value.slice(0, precision) : value;
  if (text.length >= width) return text;
  const padLen = width - text.length;
  if (flags.has('-')) return text + ' '.repeat(padLen);
  return ' '.repeat(padLen) + text;
}

const SPEC_RE = /%([-+0 #]*)(\d*)(\.\d*)?([diouxXeEfFgGsc%])/g;

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let result = '';
  let argIndex = 0;
  let lastIndex = 0;
  SPEC_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = SPEC_RE.exec(fmt)) !== null) {
    result += fmt.slice(lastIndex, m.index);
    lastIndex = SPEC_RE.lastIndex;
    const [, flagStr, widthStr, precStr, conv] = m;
    if (conv === '%') {
      result += '%';
      continue;
    }
    const flags = new Set(flagStr.split(''));
    const width = widthStr === '' ? 0 : parseInt(widthStr, 10);
    const precisionGiven = precStr !== undefined;
    const precision = precisionGiven ? (precStr === '.' ? 0 : parseInt(precStr.slice(1), 10)) : 0;
    const arg = args[argIndex++];

    if (conv === 'd' || conv === 'i' || conv === 'x' || conv === 'X' || conv === 'o') {
      result += formatIntConv(arg as number | bigint, conv, flags, width, precisionGiven, precision);
    } else if ('eEfFgG'.includes(conv)) {
      result += formatFloatConv(arg as number, conv, flags, width, precisionGiven, precision);
    } else {
      result += formatStringConv(arg as string, conv, flags, width, precisionGiven, precision);
    }
  }
  result += fmt.slice(lastIndex);
  return result;
}
