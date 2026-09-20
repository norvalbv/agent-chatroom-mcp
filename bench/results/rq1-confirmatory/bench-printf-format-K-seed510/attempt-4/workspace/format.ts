// Exact-rounding printf-style formatter. All rounding of floating point
// conversions is done on the exact binary value of the double via BigInt
// arithmetic (round to nearest, ties to even), never via JS's toFixed /
// toPrecision (which do not guarantee this rounding rule).

function pow(base: bigint, exp: number): bigint {
  return exp <= 0 ? 1n : base ** BigInt(exp);
}

// round(mantissa * 2^binExp * 10^p) with ties-to-even, mantissa >= 0.
function scaledRound(mantissa: bigint, binExp: number, p: number): bigint {
  if (mantissa === 0n) return 0n;
  const e2 = binExp + p;
  const e5 = p;
  const numerator = mantissa * pow(2n, e2) * pow(5n, e5);
  const denominator = pow(2n, -e2) * pow(5n, -e5);
  if (denominator === 1n) return numerator;
  const q = numerator / denominator;
  const r = numerator % denominator;
  const twiceR = r * 2n;
  if (twiceR < denominator) return q;
  if (twiceR > denominator) return q + 1n;
  return q % 2n === 0n ? q : q + 1n;
}

function decomposeAbs(x: number): { mantissa: bigint; binExp: number } {
  if (x === 0) return { mantissa: 0n, binExp: 0 };
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const biasedExp = (hi >>> 20) & 0x7ff;
  const mantHigh = hi & 0xfffff;
  const mantBits = (BigInt(mantHigh) << 32n) | BigInt(lo);
  if (biasedExp === 0) return { mantissa: mantBits, binExp: -1074 };
  return { mantissa: mantBits | (1n << 52n), binExp: biasedExp - 1075 };
}

function getSignBit(x: number): boolean {
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setFloat64(0, x);
  return dv.getUint32(0) >>> 31 === 1;
}

function formatFixedDigits(
  mantissa: bigint,
  binExp: number,
  prec: number,
): { intPart: string; fracPart: string } {
  const R = scaledRound(mantissa, binExp, prec);
  let s = R.toString();
  while (s.length <= prec) s = '0' + s;
  const intPart = prec > 0 ? s.slice(0, s.length - prec) : s;
  const fracPart = prec > 0 ? s.slice(s.length - prec) : '';
  return { intPart, fracPart };
}

function getExpAndDigits(
  mantissa: bigint,
  binExp: number,
  sigDigits: number,
): { digits: string; exp: number } {
  if (mantissa === 0n) return { digits: '0'.repeat(sigDigits), exp: 0 };
  let E = Math.floor(Math.log10(Number(mantissa)) + binExp * Math.log10(2));
  const lower = 10n ** BigInt(sigDigits - 1);
  const upper = 10n ** BigInt(sigDigits);
  let R = scaledRound(mantissa, binExp, sigDigits - 1 - E);
  let guard = 0;
  while (R >= upper && guard++ < 20) {
    E++;
    R = scaledRound(mantissa, binExp, sigDigits - 1 - E);
  }
  while (R < lower && guard++ < 20) {
    E--;
    R = scaledRound(mantissa, binExp, sigDigits - 1 - E);
  }
  return { digits: R.toString(), exp: E };
}

function padGeneric(str: string, width: number | null, minus: boolean): string {
  if (width === null || str.length >= width) return str;
  const pad = ' '.repeat(width - str.length);
  return minus ? str + pad : pad + str;
}

function padNumeric(
  sign: string,
  prefix: string,
  digits: string,
  width: number | null,
  zeroFlag: boolean,
  minus: boolean,
): string {
  const body = sign + prefix + digits;
  if (width === null || body.length >= width) return body;
  const padLen = width - body.length;
  if (minus) return body + ' '.repeat(padLen);
  if (zeroFlag) return sign + prefix + '0'.repeat(padLen) + digits;
  return ' '.repeat(padLen) + body;
}

function formatInt(
  conv: string,
  flags: string,
  width: number | null,
  precision: number | null,
  arg: number | bigint,
): string {
  let value = typeof arg === 'bigint' ? arg : BigInt(arg);
  const minus = flags.includes('-');
  const hash = flags.includes('#');
  const plus = flags.includes('+');
  const space = flags.includes(' ');

  let negative = false;
  if (conv === 'd' || conv === 'i') {
    if (value < 0n) {
      negative = true;
      value = -value;
    }
  }

  let digits: string;
  if (conv === 'x' || conv === 'X') digits = value.toString(16);
  else if (conv === 'o') digits = value.toString(8);
  else digits = value.toString(10);
  if (conv === 'X') digits = digits.toUpperCase();

  if (precision !== null) {
    if (value === 0n && precision === 0) digits = '';
    else if (digits.length < precision) digits = '0'.repeat(precision - digits.length) + digits;
  }

  if (hash && conv === 'o') {
    if (digits.length === 0 || digits[0] !== '0') digits = '0' + digits;
  }

  let sign = '';
  if (conv === 'd' || conv === 'i') {
    if (negative) sign = '-';
    else if (plus) sign = '+';
    else if (space) sign = ' ';
  }

  let prefix = '';
  if (hash && (conv === 'x' || conv === 'X') && value !== 0n) {
    prefix = conv === 'x' ? '0x' : '0X';
  }

  const zeroFlag = flags.includes('0') && !minus && precision === null;
  return padNumeric(sign, prefix, digits, width, zeroFlag, minus);
}

function formatFloat(
  conv: string,
  flags: string,
  width: number | null,
  precision: number | null,
  arg: number,
): string {
  const isUpper = conv === 'E' || conv === 'F' || conv === 'G';
  const minus = flags.includes('-');
  const plus = flags.includes('+');
  const space = flags.includes(' ');
  const hash = flags.includes('#');
  const zeroFlag = flags.includes('0') && !minus;

  if (Number.isNaN(arg)) {
    const body = isUpper ? 'NAN' : 'nan';
    return padGeneric(body, width, minus);
  }

  const negBit = getSignBit(arg);
  let sign = '';
  if (negBit) sign = '-';
  else if (plus) sign = '+';
  else if (space) sign = ' ';

  if (!Number.isFinite(arg)) {
    const body = sign + (isUpper ? 'INF' : 'inf');
    return padGeneric(body, width, minus);
  }

  const abs = Math.abs(arg);
  const { mantissa, binExp } = decomposeAbs(abs);

  let bodyDigits: string;
  if (conv === 'f' || conv === 'F') {
    const prec = precision === null ? 6 : precision;
    const { intPart, fracPart } = formatFixedDigits(mantissa, binExp, prec);
    bodyDigits = intPart + (fracPart.length > 0 ? '.' + fracPart : hash ? '.' : '');
  } else if (conv === 'e' || conv === 'E') {
    const prec = precision === null ? 6 : precision;
    const sigDigits = prec + 1;
    const { digits, exp } = getExpAndDigits(mantissa, binExp, sigDigits);
    const d0 = digits[0];
    const rest = digits.slice(1);
    const mant = d0 + (rest.length > 0 ? '.' + rest : hash ? '.' : '');
    const eChar = isUpper ? 'E' : 'e';
    const expSign = exp >= 0 ? '+' : '-';
    const expDigits = Math.abs(exp).toString().padStart(2, '0');
    bodyDigits = mant + eChar + expSign + expDigits;
  } else {
    let P = precision === null ? 6 : precision;
    if (P === 0) P = 1;
    const { digits, exp: X } = getExpAndDigits(mantissa, binExp, P);
    if (P > X && X >= -4) {
      const fprec = P - 1 - X;
      const { intPart, fracPart } = formatFixedDigits(mantissa, binExp, fprec);
      if (hash) {
        bodyDigits = intPart + (fprec > 0 ? '.' + fracPart : '.');
      } else {
        const f = fracPart.replace(/0+$/, '');
        bodyDigits = intPart + (f.length > 0 ? '.' + f : '');
      }
    } else {
      const d0 = digits[0];
      let rest = digits.slice(1);
      const eChar = isUpper ? 'E' : 'e';
      const expSign = X >= 0 ? '+' : '-';
      const expDigits = Math.abs(X).toString().padStart(2, '0');
      if (hash) {
        bodyDigits = d0 + (rest.length > 0 ? '.' + rest : '.') + eChar + expSign + expDigits;
      } else {
        rest = rest.replace(/0+$/, '');
        bodyDigits = d0 + (rest.length > 0 ? '.' + rest : '') + eChar + expSign + expDigits;
      }
    }
  }

  return padNumeric(sign, '', bodyDigits, width, zeroFlag, minus);
}

function formatOne(
  conv: string,
  flags: string,
  width: number | null,
  precision: number | null,
  arg: number | bigint | string,
): string {
  switch (conv) {
    case 'd':
    case 'i':
    case 'x':
    case 'X':
    case 'o':
      return formatInt(conv, flags, width, precision, arg as number | bigint);
    case 'e':
    case 'E':
    case 'f':
    case 'F':
    case 'g':
    case 'G':
      return formatFloat(conv, flags, width, precision, arg as number);
    case 's': {
      let s = arg as string;
      if (precision !== null) s = s.slice(0, precision);
      return padGeneric(s, width, flags.includes('-'));
    }
    case 'c':
      return padGeneric(arg as string, width, flags.includes('-'));
    default:
      throw new Error('unsupported conversion: ' + conv);
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
    i++;
    if (fmt[i] === '%') {
      result += '%';
      i++;
      continue;
    }
    let flags = '';
    while (i < fmt.length && '-+ 0#'.includes(fmt[i])) {
      flags += fmt[i];
      i++;
    }
    let widthStr = '';
    while (i < fmt.length && fmt[i] >= '0' && fmt[i] <= '9') {
      widthStr += fmt[i];
      i++;
    }
    let precision: number | null = null;
    if (fmt[i] === '.') {
      i++;
      let precStr = '';
      while (i < fmt.length && fmt[i] >= '0' && fmt[i] <= '9') {
        precStr += fmt[i];
        i++;
      }
      precision = precStr === '' ? 0 : parseInt(precStr, 10);
    }
    const conv = fmt[i];
    i++;
    const width = widthStr === '' ? null : parseInt(widthStr, 10);
    const arg = args[argIndex++];
    result += formatOne(conv, flags, width, precision, arg);
  }
  return result;
}
