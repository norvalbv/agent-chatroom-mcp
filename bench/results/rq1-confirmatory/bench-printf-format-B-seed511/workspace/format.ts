type Flags = {
  minus: boolean;
  plus: boolean;
  space: boolean;
  zero: boolean;
  hash: boolean;
};

function decompose(absValue: number): { m: bigint; e: number } {
  const buf = new ArrayBuffer(8);
  new Float64Array(buf)[0] = absValue;
  const bits = new BigUint64Array(buf)[0];
  const expBits = Number((bits >> 52n) & 0x7ffn);
  const fracBits = bits & 0xfffffffffffffn;
  if (expBits === 0) {
    return { m: fracBits, e: -1074 };
  }
  return { m: fracBits | (1n << 52n), e: expBits - 1075 };
}

function toExactDecimal(m: bigint, e: number): { digits: string; pointPos: number } {
  if (m === 0n) return { digits: '0', pointPos: 1 };
  if (e >= 0) {
    const v = m << BigInt(e);
    const digits = v.toString();
    return { digits, pointPos: digits.length };
  }
  const n = -e;
  const num = m * 5n ** BigInt(n);
  let digits = num.toString();
  if (digits.length <= n) digits = '0'.repeat(n + 1 - digits.length) + digits;
  return { digits, pointPos: digits.length - n };
}

function digitAt(digits: string, pointPos: number, exp: number): string {
  const idx = pointPos - 1 - exp;
  return idx >= 0 && idx < digits.length ? digits[idx] : '0';
}

function sliceExp(digits: string, pointPos: number, fromExp: number, toExp: number): string {
  let s = '';
  for (let ex = fromExp; ex >= toExp; ex--) s += digitAt(digits, pointPos, ex);
  return s;
}

function firstNonZeroExp(digits: string, pointPos: number): number {
  for (let i = 0; i < digits.length; i++) {
    if (digits[i] !== '0') return pointPos - 1 - i;
  }
  return 0;
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
      break;
    }
  }
  if (i < 0) arr.unshift('1');
  return arr.join('');
}

function roundAt(
  digits: string,
  pointPos: number,
  lastKeptExp: number,
): { digits: string; pointPos: number } {
  const keepIdx = pointPos - 1 - lastKeptExp;
  const getIdx = (i: number) => (i >= 0 && i < digits.length ? digits[i] : '0');
  const nextIdx = keepIdx + 1;
  const nextDigit = getIdx(nextIdx);
  let roundUp = false;
  if (nextDigit > '5') {
    roundUp = true;
  } else if (nextDigit === '5') {
    let rest = false;
    for (let i = nextIdx + 1; i < digits.length; i++) {
      if (digits[i] !== '0') {
        rest = true;
        break;
      }
    }
    roundUp = rest ? true : Number(getIdx(keepIdx)) % 2 === 1;
  }
  const keptArr: string[] = [];
  for (let i = 0; i <= keepIdx; i++) keptArr.push(getIdx(i));
  const kept = keptArr.join('') || '0';
  const newDigits = roundUp ? incrementDigitString(kept) : kept;
  const newLen = newDigits.length;
  return { digits: newDigits, pointPos: lastKeptExp + newLen };
}

function formatFBody(absValue: number, precision: number, hash: boolean): string {
  const { m, e } = decompose(absValue);
  const ed = toExactDecimal(m, e);
  const rounded = roundAt(ed.digits, ed.pointPos, -precision);
  const intPart =
    rounded.pointPos > 0 ? sliceExp(rounded.digits, rounded.pointPos, rounded.pointPos - 1, 0) : '0';
  const fracPart = precision > 0 ? sliceExp(rounded.digits, rounded.pointPos, -1, -precision) : '';
  return intPart + (precision > 0 || hash ? '.' + fracPart : '');
}

function formatEBody(absValue: number, precision: number, hash: boolean, upper: boolean): string {
  const { m, e } = decompose(absValue);
  const ed = toExactDecimal(m, e);
  const topExp0 = firstNonZeroExp(ed.digits, ed.pointPos);
  const P = precision + 1;
  const rounded = roundAt(ed.digits, ed.pointPos, topExp0 - P + 1);
  const topExp = firstNonZeroExp(rounded.digits, rounded.pointPos);
  const digitsForE = sliceExp(rounded.digits, rounded.pointPos, topExp, topExp - P + 1);
  const first = digitsForE[0];
  const rest = digitsForE.slice(1);
  const mantissa = first + (precision > 0 || hash ? '.' + rest : '');
  const expAbs = Math.abs(topExp);
  const expStr = (topExp < 0 ? '-' : '+') + String(expAbs).padStart(2, '0');
  return mantissa + (upper ? 'E' : 'e') + expStr;
}

function stripTrailingZerosFrac(s: string): string {
  if (!s.includes('.')) return s;
  s = s.replace(/0+$/, '');
  if (s.endsWith('.')) s = s.slice(0, -1);
  return s;
}

function formatGBody(absValue: number, precisionParam: number, hash: boolean, upper: boolean): string {
  const P = precisionParam === 0 ? 1 : precisionParam;
  const { m, e } = decompose(absValue);
  const ed = toExactDecimal(m, e);
  const topExp0 = firstNonZeroExp(ed.digits, ed.pointPos);
  const rounded = roundAt(ed.digits, ed.pointPos, topExp0 - P + 1);
  const X = firstNonZeroExp(rounded.digits, rounded.pointPos);
  const digitsForP = sliceExp(rounded.digits, rounded.pointPos, X, X - P + 1);
  const useF = P > X && X >= -4;
  let body: string;
  if (useF) {
    const Q = P - 1 - X;
    const pp = X + 1;
    const intPart = pp > 0 ? sliceExp(digitsForP, pp, pp - 1, 0) : '0';
    const fracPart = Q > 0 ? sliceExp(digitsForP, pp, -1, -Q) : '';
    body = intPart + (Q > 0 || hash ? '.' + fracPart : '');
    if (!hash) body = stripTrailingZerosFrac(body);
  } else {
    const first = digitsForP[0];
    const rest = digitsForP.slice(1);
    const expAbs = Math.abs(X);
    const expStr = (X < 0 ? '-' : '+') + String(expAbs).padStart(2, '0');
    let mantissa = first + (P - 1 > 0 || hash ? '.' + rest : '');
    if (!hash) mantissa = stripTrailingZerosFrac(mantissa);
    body = mantissa + (upper ? 'E' : 'e') + expStr;
  }
  return body;
}

function padNumeric(
  sign: string,
  prefix: string,
  digits: string,
  width: number,
  minus: boolean,
  zeroFill: boolean,
): string {
  let body = sign + prefix + digits;
  if (body.length < width) {
    if (zeroFill) {
      digits = '0'.repeat(width - body.length) + digits;
      body = sign + prefix + digits;
    } else if (!minus) {
      body = ' '.repeat(width - body.length) + body;
    } else {
      body = body + ' '.repeat(width - body.length);
    }
  }
  return body;
}

function padText(text: string, width: number, minus: boolean): string {
  if (text.length >= width) return text;
  const padding = ' '.repeat(width - text.length);
  return minus ? text + padding : padding + text;
}

function toMagnitude(arg: number | bigint): { neg: boolean; mag: bigint } {
  if (typeof arg === 'bigint') {
    return arg < 0n ? { neg: true, mag: -arg } : { neg: false, mag: arg };
  }
  const neg = arg < 0;
  return { neg, mag: BigInt(Math.abs(arg)) };
}

function convDI(flags: Flags, width: number, precision: number | undefined, arg: number | bigint): string {
  const { neg, mag } = toMagnitude(arg);
  const sign = neg ? '-' : flags.plus ? '+' : flags.space ? ' ' : '';
  let digits: string;
  if (precision === 0 && mag === 0n) digits = '';
  else if (precision !== undefined) digits = mag.toString().padStart(precision, '0');
  else digits = mag.toString();
  const zeroFill = flags.zero && !flags.minus && precision === undefined;
  return padNumeric(sign, '', digits, width, flags.minus, zeroFill);
}

function convXO(
  conv: string,
  flags: Flags,
  width: number,
  precision: number | undefined,
  arg: number | bigint,
): string {
  const mag = typeof arg === 'bigint' ? arg : BigInt(arg);
  const radix = conv === 'o' ? 8 : 16;
  let base = mag.toString(radix);
  if (conv === 'X') base = base.toUpperCase();
  let digits: string;
  if (precision === 0 && mag === 0n) digits = '';
  else if (precision !== undefined) digits = base.padStart(precision, '0');
  else digits = base;
  let prefix = '';
  if (flags.hash) {
    if (conv === 'o') {
      if (digits === '' || digits[0] !== '0') digits = '0' + digits;
    } else if (mag !== 0n) {
      prefix = conv === 'X' ? '0X' : '0x';
    }
  }
  const zeroFill = flags.zero && !flags.minus && precision === undefined;
  return padNumeric('', prefix, digits, width, flags.minus, zeroFill);
}

function convFloat(
  conv: string,
  flags: Flags,
  width: number,
  precision: number | undefined,
  arg: number,
): string {
  const upper = conv === conv.toUpperCase();
  const isNaNVal = Number.isNaN(arg);
  const isInf = !isNaNVal && !isFinite(arg);
  const neg = !isNaNVal && (arg < 0 || Object.is(arg, -0));
  if (isNaNVal) {
    const text = upper ? 'NAN' : 'nan';
    return padNumeric('', '', text, width, flags.minus, false);
  }
  const sign = neg ? '-' : flags.plus ? '+' : flags.space ? ' ' : '';
  if (isInf) {
    const text = upper ? 'INF' : 'inf';
    return padNumeric(sign, '', text, width, flags.minus, false);
  }
  const prec = precision === undefined ? 6 : precision;
  const abs = Math.abs(arg);
  const lower = conv.toLowerCase();
  let digits: string;
  if (lower === 'f') digits = formatFBody(abs, prec, flags.hash);
  else if (lower === 'e') digits = formatEBody(abs, prec, flags.hash, upper);
  else digits = formatGBody(abs, prec, flags.hash, upper);
  const zeroFill = flags.zero && !flags.minus;
  return padNumeric(sign, '', digits, width, flags.minus, zeroFill);
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let out = '';
  let argIndex = 0;
  const specRe = /%([-+0# ]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc%])/y;
  let i = 0;
  while (i < fmt.length) {
    if (fmt[i] !== '%') {
      out += fmt[i];
      i++;
      continue;
    }
    specRe.lastIndex = i;
    const m = specRe.exec(fmt);
    if (!m) throw new Error('invalid format string');
    const [full, flagsStr, widthStr, precStr, conv] = m;
    i += full.length;
    if (conv === '%') {
      out += '%';
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
    switch (conv) {
      case 'd':
      case 'i':
        out += convDI(flags, width, precision, arg as number | bigint);
        break;
      case 'x':
      case 'X':
      case 'o':
        out += convXO(conv, flags, width, precision, arg as number | bigint);
        break;
      case 'e':
      case 'E':
      case 'f':
      case 'F':
      case 'g':
      case 'G':
        out += convFloat(conv, flags, width, precision, arg as number);
        break;
      case 's': {
        let text = arg as string;
        if (precision !== undefined) text = text.slice(0, precision);
        out += padText(text, width, flags.minus);
        break;
      }
      case 'c':
        out += padText(arg as string, width, flags.minus);
        break;
      default:
        throw new Error(`unsupported conversion: ${conv}`);
    }
  }
  return out;
}
