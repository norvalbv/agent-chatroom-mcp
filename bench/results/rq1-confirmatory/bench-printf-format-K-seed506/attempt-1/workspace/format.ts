type Flags = {
  minus: boolean;
  plus: boolean;
  space: boolean;
  zero: boolean;
  hash: boolean;
};

function decompose(ax: number): { m: bigint; e: number } {
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setFloat64(0, ax);
  const hi = view.getUint32(0);
  const lo = view.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  const mantissa = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo >>> 0);
  if (expBits === 0) {
    return { m: mantissa, e: -1074 };
  }
  return { m: mantissa | (1n << 52n), e: expBits - 1023 - 52 };
}

function divRoundHalfEven(num: bigint, den: bigint): bigint {
  const q = num / den;
  const r = num % den;
  const twice = r * 2n;
  if (twice > den) return q + 1n;
  if (twice === den) return q % 2n === 0n ? q : q + 1n;
  return q;
}

// returns round(m * 2^e * 10^k), m >= 0, k any integer
function roundDigits(m: bigint, e: number, k: number): bigint {
  const e2 = e + k;
  if (k >= 0) {
    const num0 = m * 5n ** BigInt(k);
    if (e2 >= 0) return num0 * 2n ** BigInt(e2);
    return divRoundHalfEven(num0, 2n ** BigInt(-e2));
  }
  const den5 = 5n ** BigInt(-k);
  if (e2 >= 0) {
    const num0 = m * 2n ** BigInt(e2);
    return divRoundHalfEven(num0, den5);
  }
  const den = den5 * 2n ** BigInt(-e2);
  return divRoundHalfEven(m, den);
}

function fixedDigits(m: bigint, e: number, p: number): { intPart: string; fracPart: string } {
  const D = roundDigits(m, e, p);
  let digits = D.toString();
  if (digits.length < p + 1) digits = '0'.repeat(p + 1 - digits.length) + digits;
  const cut = digits.length - p;
  return { intPart: digits.slice(0, cut), fracPart: digits.slice(cut) };
}

function expPart(
  ax: number,
  m: bigint,
  e: number,
  p: number
): { digit0: string; frac: string; exp: number; expStr: string } {
  if (ax === 0) {
    return { digit0: '0', frac: '0'.repeat(p), exp: 0, expStr: '+00' };
  }
  let exp = Math.floor(Math.log10(ax));
  for (let iter = 0; iter < 10; iter++) {
    const k = p - exp;
    const D = roundDigits(m, e, k);
    const digits = D.toString();
    if (digits.length === p + 1) {
      const expSign = exp < 0 ? '-' : '+';
      let expAbs = Math.abs(exp).toString();
      if (expAbs.length < 2) expAbs = '0' + expAbs;
      return { digit0: digits[0], frac: digits.slice(1), exp, expStr: expSign + expAbs };
    } else if (digits.length > p + 1) {
      exp += 1;
    } else {
      exp -= 1;
    }
  }
  throw new Error('failed to converge on exponent');
}

function pad(
  sign: string,
  prefix: string,
  digits: string,
  width: number,
  zeroFlag: boolean,
  minusFlag: boolean
): string {
  const core = sign + prefix + digits;
  if (core.length >= width) return core;
  const padLen = width - core.length;
  if (minusFlag) return core + ' '.repeat(padLen);
  if (zeroFlag) return sign + prefix + '0'.repeat(padLen) + digits;
  return ' '.repeat(padLen) + core;
}

function formatDI(
  value: number | bigint,
  flags: Flags,
  width: number,
  precisionGiven: boolean,
  precision: number
): string {
  const big = typeof value === 'bigint' ? value : BigInt(value);
  const negative = big < 0n;
  const abs = negative ? -big : big;
  let digits = abs.toString();
  if (precisionGiven) {
    if (precision === 0 && abs === 0n) digits = '';
    else if (digits.length < precision) digits = '0'.repeat(precision - digits.length) + digits;
  }
  const sign = negative ? '-' : flags.plus ? '+' : flags.space ? ' ' : '';
  const zeroEffective = flags.zero && !flags.minus && !precisionGiven;
  return pad(sign, '', digits, width, zeroEffective, flags.minus);
}

function formatXXO(
  conv: 'x' | 'X' | 'o',
  value: number | bigint,
  flags: Flags,
  width: number,
  precisionGiven: boolean,
  precision: number
): string {
  const big = typeof value === 'bigint' ? value : BigInt(value);
  const base = conv === 'o' ? 8 : 16;
  let digits = big.toString(base);
  if (precisionGiven) {
    if (precision === 0 && big === 0n) digits = '';
    else if (digits.length < precision) digits = '0'.repeat(precision - digits.length) + digits;
  }
  if (conv === 'X') digits = digits.toUpperCase();
  let prefix = '';
  if (flags.hash) {
    if (conv === 'o') {
      if (digits.length === 0 || digits[0] !== '0') digits = '0' + digits;
    } else if (big !== 0n) {
      prefix = conv === 'X' ? '0X' : '0x';
    }
  }
  const zeroEffective = flags.zero && !flags.minus && !precisionGiven;
  return pad('', prefix, digits, width, zeroEffective, flags.minus);
}

function formatFloatConv(
  conv: 'e' | 'E' | 'f' | 'F' | 'g' | 'G',
  value: number,
  flags: Flags,
  width: number,
  precisionGiven: boolean,
  precision: number
): string {
  const upper = conv === 'E' || conv === 'F' || conv === 'G';
  const base = conv.toLowerCase();

  if (Number.isNaN(value)) {
    const text = upper ? 'NAN' : 'nan';
    return pad('', '', text, width, false, flags.minus);
  }

  const negative = value < 0 || Object.is(value, -0);
  const sign = negative ? '-' : flags.plus ? '+' : flags.space ? ' ' : '';

  if (!Number.isFinite(value)) {
    const text = upper ? 'INF' : 'inf';
    return pad(sign, '', text, width, false, flags.minus);
  }

  const ax = Math.abs(value);
  const { m, e } = decompose(ax);

  let body: string;
  if (base === 'f') {
    const p = precisionGiven ? precision : 6;
    const { intPart, fracPart } = fixedDigits(m, e, p);
    const dot = p > 0 || flags.hash ? '.' : '';
    body = intPart + dot + fracPart;
  } else if (base === 'e') {
    const p = precisionGiven ? precision : 6;
    const ed = expPart(ax, m, e, p);
    const dot = p > 0 || flags.hash ? '.' : '';
    body = ed.digit0 + dot + ed.frac + (upper ? 'E' : 'e') + ed.expStr;
  } else {
    const P = precisionGiven ? (precision === 0 ? 1 : precision) : 6;
    const ed0 = expPart(ax, m, e, P - 1);
    const X = ed0.exp;
    if (P > X && X >= -4) {
      const fp = P - 1 - X;
      const { intPart, fracPart } = fixedDigits(m, e, fp);
      let frac = fracPart;
      if (!flags.hash) frac = frac.replace(/0+$/, '');
      const dot = frac.length > 0 || flags.hash ? '.' : '';
      body = intPart + dot + frac;
    } else {
      const ed = expPart(ax, m, e, P - 1);
      let frac = ed.frac;
      if (!flags.hash) frac = frac.replace(/0+$/, '');
      const dot = frac.length > 0 || flags.hash ? '.' : '';
      body = ed.digit0 + dot + frac + (upper ? 'E' : 'e') + ed.expStr;
    }
  }

  const zeroEffective = flags.zero && !flags.minus;
  return pad(sign, '', body, width, zeroEffective, flags.minus);
}

function formatS(value: string, flags: Flags, width: number, precisionGiven: boolean, precision: number): string {
  let text = value;
  if (precisionGiven) text = text.slice(0, precision);
  if (text.length >= width) return text;
  const padLen = width - text.length;
  return flags.minus ? text + ' '.repeat(padLen) : ' '.repeat(padLen) + text;
}

function formatC(value: string, flags: Flags, width: number): string {
  if (value.length >= width) return value;
  const padLen = width - value.length;
  return flags.minus ? value + ' '.repeat(padLen) : ' '.repeat(padLen) + value;
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
    while (j < fmt.length && fmt[j] >= '0' && fmt[j] <= '9') {
      widthStr += fmt[j];
      j++;
    }
    const width = widthStr === '' ? 0 : parseInt(widthStr, 10);

    let precisionGiven = false;
    let precision = 0;
    if (fmt[j] === '.') {
      precisionGiven = true;
      j++;
      let precStr = '';
      while (j < fmt.length && fmt[j] >= '0' && fmt[j] <= '9') {
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

    switch (conv) {
      case 'd':
      case 'i':
        result += formatDI(arg as number | bigint, flags, width, precisionGiven, precision);
        break;
      case 'x':
      case 'X':
      case 'o':
        result += formatXXO(conv, arg as number | bigint, flags, width, precisionGiven, precision);
        break;
      case 'e':
      case 'E':
      case 'f':
      case 'F':
      case 'g':
      case 'G':
        result += formatFloatConv(conv, arg as number, flags, width, precisionGiven, precision);
        break;
      case 's':
        result += formatS(arg as string, flags, width, precisionGiven, precision);
        break;
      case 'c':
        result += formatC(arg as string, flags, width);
        break;
      default:
        throw new Error(`unsupported conversion: ${conv}`);
    }
  }

  return result;
}
