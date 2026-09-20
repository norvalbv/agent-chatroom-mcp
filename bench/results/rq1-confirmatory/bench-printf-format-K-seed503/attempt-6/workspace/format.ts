type Flags = {
  minus: boolean;
  plus: boolean;
  space: boolean;
  zero: boolean;
  hash: boolean;
};

function pad(
  sign: string,
  prefix: string,
  digits: string,
  width: number,
  minus: boolean,
  zero: boolean
): string {
  const body = sign + prefix + digits;
  if (body.length >= width) return body;
  const padLen = width - body.length;
  if (minus) return body + ' '.repeat(padLen);
  if (zero) return sign + prefix + '0'.repeat(padLen) + digits;
  return ' '.repeat(padLen) + body;
}

function formatInt(arg: number | bigint, flags: Flags, width: number, precision: number | undefined): string {
  const v = typeof arg === 'bigint' ? arg : BigInt(arg);
  const neg = v < 0n;
  const mag = neg ? -v : v;
  let digits = mag.toString(10);
  if (precision !== undefined) {
    if (precision === 0 && mag === 0n) digits = '';
    else digits = digits.padStart(precision, '0');
  }
  const sign = neg ? '-' : flags.plus ? '+' : flags.space ? ' ' : '';
  const zero = flags.zero && !flags.minus && precision === undefined;
  return pad(sign, '', digits, width, flags.minus, zero);
}

function formatHexOct(
  arg: number | bigint,
  flags: Flags,
  width: number,
  precision: number | undefined,
  base: 8 | 16,
  upper: boolean
): string {
  const v = typeof arg === 'bigint' ? arg : BigInt(arg);
  let digits = v.toString(base);
  if (upper) digits = digits.toUpperCase();
  if (precision !== undefined) {
    if (precision === 0 && v === 0n) digits = '';
    else digits = digits.padStart(precision, '0');
  }
  if (flags.hash && base === 8) {
    if (digits.length === 0 || digits[0] !== '0') digits = '0' + digits;
  }
  let prefix = '';
  if (flags.hash && base === 16 && v !== 0n) {
    prefix = upper ? '0X' : '0x';
  }
  const zero = flags.zero && !flags.minus && precision === undefined;
  return pad('', prefix, digits, width, flags.minus, zero);
}

function formatString(str: string, flags: Flags, width: number, precision: number | undefined): string {
  const s = precision !== undefined ? str.slice(0, precision) : str;
  if (s.length >= width) return s;
  const padLen = width - s.length;
  return flags.minus ? s + ' '.repeat(padLen) : ' '.repeat(padLen) + s;
}

function decompose(x: number): { mantissa: bigint; exp2: number } {
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setFloat64(0, x);
  const bits = view.getBigUint64(0);
  const exponentBits = Number((bits >> 52n) & 0x7ffn);
  const mantissaBits = bits & 0xfffffffffffffn;
  if (exponentBits === 0) return { mantissa: mantissaBits, exp2: -1074 };
  return { mantissa: mantissaBits | (1n << 52n), exp2: exponentBits - 1075 };
}

// Computes round(mantissa * 2^exp2 * 10^n) using the exact rational value,
// with ties broken to even, since the exact binary value determines rounding.
function scaledRound(mantissa: bigint, exp2: number, n: number): bigint {
  let numerator = mantissa;
  let denominator = 1n;
  if (n >= 0) numerator *= 5n ** BigInt(n);
  else denominator *= 5n ** BigInt(-n);
  const e = exp2 + n;
  if (e >= 0) numerator *= 2n ** BigInt(e);
  else denominator *= 2n ** BigInt(-e);
  if (denominator === 1n) return numerator;
  const q = numerator / denominator;
  const r = numerator % denominator;
  const twice = r * 2n;
  if (twice < denominator) return q;
  if (twice > denominator) return q + 1n;
  return q % 2n === 0n ? q : q + 1n;
}

function fParts(magnitude: number, p: number): { intPart: string; fracPart: string } {
  const { mantissa, exp2 } = decompose(magnitude);
  const R = scaledRound(mantissa, exp2, p);
  let s = R.toString();
  if (s.length < p + 1) s = s.padStart(p + 1, '0');
  if (p === 0) return { intPart: s, fracPart: '' };
  return { intPart: s.slice(0, s.length - p), fracPart: s.slice(s.length - p) };
}

function computeEDigits(magnitude: number, p: number): { digits: string; E: number } {
  if (magnitude === 0) return { digits: '0'.repeat(p + 1), E: 0 };
  const { mantissa, exp2 } = decompose(magnitude);
  let E = Math.floor(Math.log10(magnitude));
  for (let i = 0; i < 50; i++) {
    const R = scaledRound(mantissa, exp2, p - E);
    const s = R.toString();
    if (s.length > p + 1) {
      E++;
      continue;
    }
    if (s.length < p + 1) {
      E--;
      continue;
    }
    return { digits: s, E };
  }
  throw new Error('failed to converge on exponent');
}

function trimTrailing(s: string): string {
  if (!s.includes('.')) return s;
  s = s.replace(/0+$/, '');
  if (s.endsWith('.')) s = s.slice(0, -1);
  return s;
}

function formatFloat(x: number, conv: string, flags: Flags, width: number, precision: number | undefined): string {
  const upper = conv === 'E' || conv === 'F' || conv === 'G';
  const isNaNVal = Number.isNaN(x);
  const neg = !isNaNVal && (x < 0 || Object.is(x, -0));
  let sign = '';
  if (!isNaNVal) {
    if (neg) sign = '-';
    else if (flags.plus) sign = '+';
    else if (flags.space) sign = ' ';
  }
  let body: string;
  let finite = true;
  if (isNaNVal) {
    finite = false;
    body = upper ? 'NAN' : 'nan';
  } else if (!Number.isFinite(x)) {
    finite = false;
    body = upper ? 'INF' : 'inf';
  } else {
    const magnitude = Math.abs(x);
    const lower = conv.toLowerCase();
    if (lower === 'f') {
      const p = precision === undefined ? 6 : precision;
      const { intPart, fracPart } = fParts(magnitude, p);
      body = intPart + (p > 0 ? '.' + fracPart : flags.hash ? '.' : '');
    } else if (lower === 'e') {
      const p = precision === undefined ? 6 : precision;
      const { digits, E } = computeEDigits(magnitude, p);
      const first = digits[0];
      const rest = digits.slice(1);
      const mantissaPart = first + (p > 0 ? '.' + rest : flags.hash ? '.' : '');
      const expSign = E < 0 ? '-' : '+';
      const expAbs = Math.abs(E).toString().padStart(2, '0');
      body = mantissaPart + (upper ? 'E' : 'e') + expSign + expAbs;
    } else {
      const P = precision === undefined ? 6 : precision === 0 ? 1 : precision;
      const { E: X } = computeEDigits(magnitude, P - 1);
      if (P > X && X >= -4) {
        const p2 = P - 1 - X;
        const { intPart, fracPart } = fParts(magnitude, p2);
        let mantissaBody = intPart + (p2 > 0 ? '.' + fracPart : flags.hash ? '.' : '');
        if (!flags.hash) mantissaBody = trimTrailing(mantissaBody);
        body = mantissaBody;
      } else {
        const p2 = P - 1;
        const { digits, E: E2 } = computeEDigits(magnitude, p2);
        const first = digits[0];
        const rest = digits.slice(1);
        let mp = first + (p2 > 0 ? '.' + rest : flags.hash ? '.' : '');
        if (!flags.hash) mp = trimTrailing(mp);
        const expSign = E2 < 0 ? '-' : '+';
        const expAbs = Math.abs(E2).toString().padStart(2, '0');
        body = mp + (upper ? 'E' : 'e') + expSign + expAbs;
      }
    }
  }
  const zero = flags.zero && !flags.minus && finite;
  return pad(sign, '', body, width, flags.minus, zero);
}

function formatOne(
  conv: string,
  flags: Flags,
  width: number,
  precision: number | undefined,
  arg: number | bigint | string
): string {
  switch (conv) {
    case 'd':
    case 'i':
      return formatInt(arg as number | bigint, flags, width, precision);
    case 'x':
      return formatHexOct(arg as number | bigint, flags, width, precision, 16, false);
    case 'X':
      return formatHexOct(arg as number | bigint, flags, width, precision, 16, true);
    case 'o':
      return formatHexOct(arg as number | bigint, flags, width, precision, 8, false);
    case 'e':
    case 'E':
    case 'f':
    case 'F':
    case 'g':
    case 'G':
      return formatFloat(Number(arg), conv, flags, width, precision);
    case 's':
      return formatString(String(arg), flags, width, precision);
    case 'c':
      return formatString(String(arg), flags, width, undefined);
    default:
      throw new Error(`unsupported conversion: ${conv}`);
  }
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  const re = /%([-+ 0#]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc%])/g;
  let result = '';
  let lastIndex = 0;
  let argIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(fmt)) !== null) {
    result += fmt.slice(lastIndex, m.index);
    lastIndex = re.lastIndex;
    const [, flagsStr, widthStr, precStr, conv] = m;
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
    result += formatOne(conv, flags, width, precision, arg);
  }
  result += fmt.slice(lastIndex);
  return result;
}
