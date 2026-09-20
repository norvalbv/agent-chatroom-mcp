type Flags = { dash: boolean; plus: boolean; space: boolean; zero: boolean; hash: boolean };

function decompose(abs: number): { M: bigint; E: number } {
  if (abs === 0) return { M: 0n, E: 0 };
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setFloat64(0, abs);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const biasedExp = (hi >>> 20) & 0x7ff;
  const mantHi = hi & 0xfffff;
  let M: bigint;
  let E: number;
  if (biasedExp === 0) {
    M = (BigInt(mantHi) << 32n) | BigInt(lo);
    E = -1074;
  } else {
    M = (1n << 52n) | (BigInt(mantHi) << 32n) | BigInt(lo);
    E = biasedExp - 1075;
  }
  return { M, E };
}

// Rounds M * 2^E * 10^k to the nearest integer, ties to even, exactly.
function roundScaled(M: bigint, E: number, k: number): bigint {
  if (M === 0n) return 0n;
  let numerator = M;
  let exp2 = E + k;
  let exp5 = k;
  if (exp5 >= 0) {
    numerator *= 5n ** BigInt(exp5);
    exp5 = 0;
  }
  let denom5 = 1n;
  if (exp5 < 0) denom5 = 5n ** BigInt(-exp5);
  let denom2 = 1n;
  if (exp2 >= 0) {
    numerator *= 2n ** BigInt(exp2);
  } else {
    denom2 = 2n ** BigInt(-exp2);
  }
  const denom = denom5 * denom2;
  if (denom === 1n) return numerator;
  const q = numerator / denom;
  const r = numerator % denom;
  const twice = r * 2n;
  if (twice < denom) return q;
  if (twice > denom) return q + 1n;
  return q % 2n === 0n ? q : q + 1n;
}

// Returns N significant decimal digits of M*2^E (M != 0), and the decimal
// exponent of the leading digit, using exact round-half-to-even.
function significantDigits(M: bigint, E: number, N: number, xAbs: number): { digits: string; exp: number } {
  let X0 = Math.floor(Math.log10(xAbs));
  for (let attempt = 0; attempt < 20; attempt++) {
    const k = N - 1 - X0;
    const D = roundScaled(M, E, k);
    if (D === 0n) {
      X0 -= 1;
      continue;
    }
    const s = D.toString();
    if (s.length === N) return { digits: s, exp: X0 };
    X0 += s.length - N;
  }
  throw new Error('unreachable: significantDigits did not converge');
}

function padNumeric(sign: string, prefix: string, digits: string, width: number, dash: boolean, zero: boolean): string {
  const bodyLen = sign.length + prefix.length + digits.length;
  if (bodyLen >= width) return sign + prefix + digits;
  const padLen = width - bodyLen;
  if (dash) return sign + prefix + digits + ' '.repeat(padLen);
  if (zero) return sign + prefix + '0'.repeat(padLen) + digits;
  return ' '.repeat(padLen) + sign + prefix + digits;
}

function toBigIntMagnitude(arg: number | bigint): { neg: boolean; mag: bigint } {
  if (typeof arg === 'bigint') return arg < 0n ? { neg: true, mag: -arg } : { neg: false, mag: arg };
  const neg = arg < 0;
  return { neg, mag: BigInt(Math.trunc(Math.abs(arg))) };
}

function formatInt(conv: string, arg: number | bigint, flags: Flags, width: number, precision: number | undefined): string {
  if (conv === 'd' || conv === 'i') {
    const { neg, mag } = toBigIntMagnitude(arg);
    let digits = mag.toString();
    if (precision !== undefined) {
      digits = mag === 0n && precision === 0 ? '' : digits.padStart(precision, '0');
    }
    const sign = neg ? '-' : flags.plus ? '+' : flags.space ? ' ' : '';
    const zeroEff = flags.zero && precision === undefined;
    return padNumeric(sign, '', digits, width, flags.dash, zeroEff);
  }
  const mag = typeof arg === 'bigint' ? arg : BigInt(Math.trunc(arg));
  if (conv === 'x' || conv === 'X') {
    let digits = mag.toString(16);
    if (conv === 'X') digits = digits.toUpperCase();
    if (precision !== undefined) {
      digits = mag === 0n && precision === 0 ? '' : digits.padStart(precision, '0');
    }
    const prefix = flags.hash && mag !== 0n ? (conv === 'x' ? '0x' : '0X') : '';
    const zeroEff = flags.zero && precision === undefined;
    return padNumeric('', prefix, digits, width, flags.dash, zeroEff);
  }
  // o
  let digits = mag.toString(8);
  if (precision !== undefined) {
    digits = mag === 0n && precision === 0 ? '' : digits.padStart(precision, '0');
  }
  if (flags.hash) {
    if (digits.length === 0 || digits[0] !== '0') digits = '0' + digits;
  }
  const zeroEff = flags.zero && precision === undefined;
  return padNumeric('', '', digits, width, flags.dash, zeroEff);
}

function buildFixedBody(M: bigint, E: number, prec: number, hash: boolean): string {
  const D = roundScaled(M, E, prec);
  const s = D.toString().padStart(prec + 1, '0');
  const intPart = prec === 0 ? s : s.slice(0, s.length - prec);
  const fracPart = prec === 0 ? '' : s.slice(s.length - prec);
  return intPart + (prec > 0 || hash ? '.' + fracPart : '');
}

function buildSciBody(
  M: bigint,
  E: number,
  prec: number,
  hash: boolean,
  upper: boolean,
  xAbs: number,
): { body: string; exp: number } {
  let digits: string;
  let expX: number;
  if (M === 0n) {
    digits = '0'.repeat(prec + 1);
    expX = 0;
  } else {
    const r = significantDigits(M, E, prec + 1, xAbs);
    digits = r.digits;
    expX = r.exp;
  }
  const first = digits[0];
  const frac = digits.slice(1);
  const mantissa = first + (prec > 0 || hash ? '.' + frac : '');
  const eChar = upper ? 'E' : 'e';
  const expSign = expX < 0 ? '-' : '+';
  const expAbs = Math.abs(expX).toString().padStart(2, '0');
  return { body: mantissa + eChar + expSign + expAbs, exp: expX };
}

function trimGBody(body: string): string {
  const eIdx = body.search(/[eE]/);
  let mantissa = eIdx >= 0 ? body.slice(0, eIdx) : body;
  const suffix = eIdx >= 0 ? body.slice(eIdx) : '';
  if (mantissa.includes('.')) {
    mantissa = mantissa.replace(/0+$/, '');
    if (mantissa.endsWith('.')) mantissa = mantissa.slice(0, -1);
  }
  return mantissa + suffix;
}

function formatG(M: bigint, E: number, xAbs: number, P: number, hash: boolean, upper: boolean): string {
  const X = M === 0n ? 0 : significantDigits(M, E, P, xAbs).exp;
  let body: string;
  if (P > X && X >= -4) {
    body = buildFixedBody(M, E, P - 1 - X, hash);
  } else {
    body = buildSciBody(M, E, P - 1, hash, upper, xAbs).body;
  }
  if (!hash) body = trimGBody(body);
  return body;
}

function formatFloat(x: number, conv: string, flags: Flags, width: number, precision: number | undefined): string {
  const upper = conv === 'E' || conv === 'F' || conv === 'G';
  if (Number.isNaN(x)) {
    const body = upper ? 'NAN' : 'nan';
    return padNumeric('', '', body, width, flags.dash, false);
  }
  const negative = x < 0 || Object.is(x, -0);
  const sign = negative ? '-' : flags.plus ? '+' : flags.space ? ' ' : '';
  if (!Number.isFinite(x)) {
    const body = upper ? 'INF' : 'inf';
    return padNumeric(sign, '', body, width, flags.dash, false);
  }
  const xAbs = Math.abs(x);
  const { M, E } = decompose(xAbs);
  const lower = conv.toLowerCase();
  let body: string;
  if (lower === 'f') {
    body = buildFixedBody(M, E, precision ?? 6, flags.hash);
  } else if (lower === 'e') {
    body = buildSciBody(M, E, precision ?? 6, flags.hash, upper, xAbs).body;
  } else {
    const P = precision === undefined ? 6 : precision === 0 ? 1 : precision;
    body = formatG(M, E, xAbs, P, flags.hash, upper);
  }
  return padNumeric(sign, '', body, width, flags.dash, flags.zero);
}

function formatStr(conv: string, arg: string, flags: Flags, width: number, precision: number | undefined): string {
  const str = conv === 'c' ? arg : precision !== undefined ? arg.slice(0, precision) : arg;
  if (str.length >= width) return str;
  const pad = ' '.repeat(width - str.length);
  return flags.dash ? str + pad : pad + str;
}

function formatOne(
  conv: string,
  arg: number | bigint | string,
  flags: Flags,
  width: number,
  precision: number | undefined,
): string {
  switch (conv) {
    case 'd':
    case 'i':
    case 'x':
    case 'X':
    case 'o':
      return formatInt(conv, arg as number | bigint, flags, width, precision);
    case 'e':
    case 'E':
    case 'f':
    case 'F':
    case 'g':
    case 'G':
      return formatFloat(arg as number, conv, flags, width, precision);
    case 's':
    case 'c':
      return formatStr(conv, arg as string, flags, width, precision);
    default:
      throw new Error(`unsupported conversion: ${conv}`);
  }
}

const SPEC_RE = /%([-+0 #]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc%])/y;

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let result = '';
  let argIndex = 0;
  let i = 0;
  while (i < fmt.length) {
    if (fmt[i] !== '%') {
      result += fmt[i];
      i++;
      continue;
    }
    SPEC_RE.lastIndex = i;
    const m = SPEC_RE.exec(fmt);
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
      dash: flagsStr.includes('-'),
      plus: flagsStr.includes('+'),
      space: flagsStr.includes(' '),
      zero: flagsStr.includes('0'),
      hash: flagsStr.includes('#'),
    };
    const width = widthStr ? parseInt(widthStr, 10) : 0;
    const precision = precStr !== undefined ? (precStr === '' ? 0 : parseInt(precStr, 10)) : undefined;
    const arg = args[argIndex++];
    result += formatOne(conv, arg, flags, width, precision);
  }
  return result;
}
