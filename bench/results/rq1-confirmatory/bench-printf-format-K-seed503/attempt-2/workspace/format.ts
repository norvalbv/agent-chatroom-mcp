type Flags = {
  minus: boolean;
  plus: boolean;
  space: boolean;
  zero: boolean;
  hash: boolean;
};

function divRoundEven(num: bigint, den: bigint): bigint {
  let q = num / den;
  const r = num % den;
  const twice = r * 2n;
  if (twice > den || (twice === den && (q & 1n) === 1n)) q += 1n;
  return q;
}

// Decomposes |x| (finite, nonzero) into N, m such that |x| == N / 10^m exactly.
function decompose(x: number): { N: bigint; m: number } {
  if (x === 0) return { N: 0n, m: 0 };
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setFloat64(0, Math.abs(x));
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const biasedExp = (hi >>> 20) & 0x7ff;
  let mantissa = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let exp2: number;
  if (biasedExp === 0) {
    exp2 = -1074;
  } else {
    mantissa |= 1n << 52n;
    exp2 = biasedExp - 1075;
  }
  if (exp2 >= 0) {
    return { N: mantissa << BigInt(exp2), m: 0 };
  }
  const shift = -exp2;
  return { N: mantissa * 5n ** BigInt(shift), m: shift };
}

function roundFrac(N: bigint, m: number, d: number): bigint {
  if (d >= m) return N * 10n ** BigInt(d - m);
  return divRoundEven(N, 10n ** BigInt(m - d));
}

function roundSig(
  N: bigint,
  L: number,
  E0: number,
  sig: number
): { ds: string; exponent: number } {
  const drop = L - sig;
  let q: bigint;
  if (drop <= 0) {
    q = N * 10n ** BigInt(-drop);
  } else {
    q = divRoundEven(N, 10n ** BigInt(drop));
  }
  let ds = q.toString();
  const exponent = E0 + (ds.length - sig);
  if (ds.length > sig) ds = ds.slice(0, sig);
  else if (ds.length < sig) ds = ds.padEnd(sig, '0');
  return { ds, exponent };
}

function signBit(x: number): boolean {
  return x < 0 || Object.is(x, -0);
}

function signChar(negative: boolean, flags: Flags): string {
  return negative ? '-' : flags.plus ? '+' : flags.space ? ' ' : '';
}

// core (no sign) for %f style, given exact N/10^m and fractional-digit count.
function fCore(N: bigint, m: number, prec: number, hash: boolean): string {
  let intPart: string;
  let fracPart: string;
  if (N === 0n) {
    intPart = '0';
    fracPart = '0'.repeat(prec);
  } else {
    const R = roundFrac(N, m, prec);
    let rs = R.toString();
    if (rs.length <= prec) rs = rs.padStart(prec + 1, '0');
    intPart = rs.slice(0, rs.length - prec) || '0';
    fracPart = prec > 0 ? rs.slice(rs.length - prec) : '';
  }
  const dot = prec > 0 || hash ? '.' : '';
  return intPart + dot + fracPart;
}

// core (no sign) for %e style, given exact N/10^m and fractional-digit count.
function eCore(
  N: bigint,
  m: number,
  prec: number,
  hash: boolean,
  upper: boolean
): string {
  const sig = prec + 1;
  let ds: string;
  let exponent: number;
  if (N === 0n) {
    ds = '0'.repeat(sig);
    exponent = 0;
  } else {
    const L = N.toString().length;
    const E0 = L - 1 - m;
    const r = roundSig(N, L, E0, sig);
    ds = r.ds;
    exponent = r.exponent;
  }
  const first = ds[0];
  const rest = ds.slice(1);
  const dot = prec > 0 || hash ? '.' : '';
  const letter = upper ? 'E' : 'e';
  const expSign = exponent < 0 ? '-' : '+';
  const expAbs = Math.abs(exponent).toString().padStart(2, '0');
  return first + dot + rest + letter + expSign + expAbs;
}

function stripTrailingZeros(core: string): string {
  const eIdx = core.search(/[eE]/);
  let mantissa = eIdx === -1 ? core : core.slice(0, eIdx);
  const rest = eIdx === -1 ? '' : core.slice(eIdx);
  if (mantissa.includes('.')) {
    mantissa = mantissa.replace(/0+$/, '');
    if (mantissa.endsWith('.')) mantissa = mantissa.slice(0, -1);
  }
  return mantissa + rest;
}

type NumResult = { sign: string; prefix: string; body: string; noZeroPad?: boolean };

function specialFloat(x: number, flags: Flags, upper: boolean): NumResult | null {
  if (Number.isNaN(x)) {
    return { sign: '', prefix: '', body: upper ? 'NAN' : 'nan', noZeroPad: true };
  }
  if (!Number.isFinite(x)) {
    const sign = signChar(signBit(x), flags);
    return { sign, prefix: '', body: upper ? 'INF' : 'inf', noZeroPad: true };
  }
  return null;
}

function formatF(x: number, precision: number | undefined, flags: Flags, upper: boolean): NumResult {
  const special = specialFloat(x, flags, upper);
  if (special) return special;
  const prec = precision === undefined ? 6 : precision;
  const { N, m } = decompose(x);
  const sign = signChar(signBit(x), flags);
  const body = fCore(N, m, prec, flags.hash);
  return { sign, prefix: '', body };
}

function formatE(x: number, precision: number | undefined, flags: Flags, upper: boolean): NumResult {
  const special = specialFloat(x, flags, upper);
  if (special) return special;
  const prec = precision === undefined ? 6 : precision;
  const { N, m } = decompose(x);
  const sign = signChar(signBit(x), flags);
  const body = eCore(N, m, prec, flags.hash, upper);
  return { sign, prefix: '', body };
}

function formatG(x: number, precision: number | undefined, flags: Flags, upper: boolean): NumResult {
  const special = specialFloat(x, flags, upper);
  if (special) return special;
  const P = precision === undefined ? 6 : precision === 0 ? 1 : precision;
  const { N, m } = decompose(x);
  const sign = signChar(signBit(x), flags);
  let X: number;
  if (N === 0n) {
    X = 0;
  } else {
    const L = N.toString().length;
    const E0 = L - 1 - m;
    X = roundSig(N, L, E0, P).exponent;
  }
  let core: string;
  if (P > X && X >= -4) {
    core = fCore(N, m, P - 1 - X, flags.hash);
  } else {
    core = eCore(N, m, P - 1, flags.hash, upper);
  }
  if (!flags.hash) core = stripTrailingZeros(core);
  return { sign, prefix: '', body: core };
}

function intInfo(value: number | bigint): { negative: boolean; magnitude: bigint } {
  if (typeof value === 'bigint') {
    return { negative: value < 0n, magnitude: value < 0n ? -value : value };
  }
  const negative = value < 0;
  const magnitude = BigInt(negative ? -value : value);
  return { negative, magnitude };
}

function intDigits(magnitude: bigint, base: number, precision: number | undefined): string {
  const natural = magnitude === 0n ? '' : magnitude.toString(base);
  if (precision === undefined) return magnitude === 0n ? '0' : natural;
  if (precision === 0 && magnitude === 0n) return '';
  return natural.length >= precision ? natural : natural.padStart(precision, '0');
}

function formatD(value: number | bigint, precision: number | undefined, flags: Flags): NumResult {
  const { negative, magnitude } = intInfo(value);
  const digits = intDigits(magnitude, 10, precision);
  const sign = signChar(negative, flags);
  return { sign, prefix: '', body: digits };
}

function formatXO(
  value: number | bigint,
  conv: 'x' | 'X' | 'o',
  precision: number | undefined,
  flags: Flags
): NumResult {
  const { magnitude } = intInfo(value);
  const base = conv === 'o' ? 8 : 16;
  let digits = intDigits(magnitude, base, precision);
  if (conv === 'x' || conv === 'X') {
    if (conv === 'X') digits = digits.toUpperCase();
    const prefix = flags.hash && magnitude !== 0n ? (conv === 'x' ? '0x' : '0X') : '';
    return { sign: '', prefix, body: digits };
  }
  // octal
  if (flags.hash && (digits.length === 0 || digits[0] !== '0')) {
    digits = intDigits(magnitude, 8, digits.length + 1);
  }
  return { sign: '', prefix: '', body: digits };
}

function padNumeric(r: NumResult, width: number, flags: Flags, zeroAllowed: boolean): string {
  const core = r.sign + r.prefix + r.body;
  if (core.length >= width) return core;
  const padLen = width - core.length;
  if (flags.minus) return core + ' '.repeat(padLen);
  if (flags.zero && zeroAllowed && !r.noZeroPad) {
    return r.sign + r.prefix + '0'.repeat(padLen) + r.body;
  }
  return ' '.repeat(padLen) + core;
}

function padText(str: string, width: number, flags: Flags): string {
  if (str.length >= width) return str;
  const pad = ' '.repeat(width - str.length);
  return flags.minus ? str + pad : pad + str;
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let argIndex = 0;
  const re = /%([-+ 0#]*)(\d*)(\.(\d*))?([diouxXeEfFgGsc%])/g;
  let result = '';
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(fmt)) !== null) {
    result += fmt.slice(lastIndex, m.index);
    lastIndex = re.lastIndex;
    const flagsStr = m[1];
    const widthStr = m[2];
    const precGroup = m[3];
    const precDigits = m[4];
    const conv = m[5];

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
    const precision = precGroup !== undefined ? (precDigits === '' ? 0 : parseInt(precDigits, 10)) : undefined;

    const arg = args[argIndex++];

    if (conv === 's') {
      let str = arg as string;
      if (precision !== undefined) str = str.slice(0, precision);
      result += padText(str, width, flags);
      continue;
    }
    if (conv === 'c') {
      result += padText(arg as string, width, flags);
      continue;
    }

    let r: NumResult;
    let zeroAllowed = true;
    if (conv === 'd' || conv === 'i') {
      r = formatD(arg as number | bigint, precision, flags);
      zeroAllowed = precision === undefined;
    } else if (conv === 'x' || conv === 'X' || conv === 'o') {
      r = formatXO(arg as number | bigint, conv, precision, flags);
      zeroAllowed = precision === undefined;
    } else if (conv === 'f' || conv === 'F') {
      r = formatF(arg as number, precision, flags, conv === 'F');
    } else if (conv === 'e' || conv === 'E') {
      r = formatE(arg as number, precision, flags, conv === 'E');
    } else {
      // g, G
      r = formatG(arg as number, precision, flags, conv === 'G');
    }
    result += padNumeric(r, width, flags, zeroAllowed);
  }
  result += fmt.slice(lastIndex);
  return result;
}
