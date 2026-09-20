function decomposeDouble(x: number): { M: bigint; E: number } {
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  const mantHi = hi & 0xfffff;
  const mantissa = (BigInt(mantHi) << 32n) | BigInt(lo);
  if (expBits === 0) {
    return { M: mantissa, E: -1074 };
  }
  return { M: mantissa | (1n << 52n), E: expBits - 1075 };
}

function roundDiv(num: bigint, den: bigint): bigint {
  if (den === 1n) return num;
  const q = num / den;
  const r = num % den;
  const twice = r * 2n;
  if (twice < den) return q;
  if (twice > den) return q + 1n;
  return q % 2n === 0n ? q : q + 1n;
}

// Computes round(M * 2^E * 10^k) with ties-to-even, using the exact value.
function roundToInt(M: bigint, E: number, k: number): bigint {
  const a = E + k;
  let num = M;
  let den = 1n;
  if (a >= 0) num *= 2n ** BigInt(a);
  else den *= 2n ** BigInt(-a);
  if (k >= 0) num *= 5n ** BigInt(k);
  else den *= 5n ** BigInt(-k);
  return roundDiv(num, den);
}

function getSignificantDigits(abs: number, numDigits: number): { digits: string; X: number } {
  if (abs === 0) return { digits: '0'.repeat(numDigits), X: 0 };
  const { M, E } = decomposeDouble(abs);
  let X = Math.floor(Math.log10(abs));
  for (let iter = 0; iter < 50; iter++) {
    const k = numDigits - 1 - X;
    const N = roundToInt(M, E, k);
    const s = N.toString();
    if (s.length === numDigits) return { digits: s, X };
    if (s.length > numDigits) {
      X++;
      continue;
    }
    X--;
  }
  throw new Error('unreachable');
}

function convF(abs: number, p: number, hash: boolean): string {
  if (abs === 0) {
    const frac = '0'.repeat(p);
    return '0' + (p > 0 || hash ? '.' + frac : '');
  }
  const { M, E } = decomposeDouble(abs);
  const N = roundToInt(M, E, p);
  let digits = N.toString();
  if (digits.length < p + 1) digits = digits.padStart(p + 1, '0');
  const intPart = digits.slice(0, digits.length - p);
  const fracPart = p > 0 ? digits.slice(digits.length - p) : '';
  return intPart + (p > 0 || hash ? '.' + fracPart : '');
}

function convE(abs: number, p: number, hash: boolean, upper: boolean): string {
  const numDigits = p + 1;
  const { digits, X } = getSignificantDigits(abs, numDigits);
  const fracPart = p > 0 ? digits.slice(1) : '';
  const mantissa = digits[0] + (p > 0 || hash ? '.' + fracPart : '');
  const expSign = X >= 0 ? '+' : '-';
  const expAbs = Math.abs(X).toString().padStart(2, '0');
  return mantissa + (upper ? 'E' : 'e') + expSign + expAbs;
}

function convG(abs: number, precision: number, hash: boolean, upper: boolean): string {
  const P = precision === 0 ? 1 : precision;
  const { digits, X } = getSignificantDigits(abs, P);
  if (P > X && X >= -4) {
    let intPart: string;
    let fracPart: string;
    if (X >= 0) {
      intPart = digits.slice(0, X + 1);
      fracPart = digits.slice(X + 1);
    } else {
      intPart = '0';
      fracPart = '0'.repeat(-X - 1) + digits;
    }
    if (!hash) fracPart = fracPart.replace(/0+$/, '');
    return intPart + (fracPart.length > 0 || hash ? '.' + fracPart : '');
  }
  let fracPart = digits.slice(1);
  if (!hash) fracPart = fracPart.replace(/0+$/, '');
  const mantissa = digits[0] + (fracPart.length > 0 || hash ? '.' + fracPart : '');
  const expSign = X >= 0 ? '+' : '-';
  const expAbs = Math.abs(X).toString().padStart(2, '0');
  return mantissa + (upper ? 'E' : 'e') + expSign + expAbs;
}

function assembleNumeric(
  sign: string,
  prefix: string,
  body: string,
  width: number | undefined,
  left: boolean,
  zeroPad: boolean,
): string {
  const w = width ?? 0;
  const core = sign + prefix + body;
  if (core.length >= w) return core;
  const padLen = w - core.length;
  if (left) return core + ' '.repeat(padLen);
  if (zeroPad) return sign + prefix + '0'.repeat(padLen) + body;
  return ' '.repeat(padLen) + core;
}

function assembleText(body: string, width: number | undefined, left: boolean): string {
  const w = width ?? 0;
  if (body.length >= w) return body;
  const padLen = w - body.length;
  return left ? body + ' '.repeat(padLen) : ' '.repeat(padLen) + body;
}

function convDI(
  argVal: number | bigint,
  flags: string,
  width: number | undefined,
  precision: number | undefined,
): string {
  const v = typeof argVal === 'bigint' ? argVal : BigInt(argVal);
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const plus = flags.includes('+');
  const spaceFlag = flags.includes(' ');
  const zero = flags.includes('0');
  const left = flags.includes('-');
  let digits: string;
  if (precision !== undefined) {
    digits = precision === 0 && abs === 0n ? '' : abs.toString().padStart(precision, '0');
  } else {
    digits = abs.toString();
  }
  const sign = neg ? '-' : plus ? '+' : spaceFlag ? ' ' : '';
  const useZero = zero && !left && precision === undefined;
  return assembleNumeric(sign, '', digits, width, left, useZero);
}

function convHexOct(
  argVal: number | bigint,
  flags: string,
  width: number | undefined,
  precision: number | undefined,
  conv: 'x' | 'X' | 'o',
): string {
  const v = typeof argVal === 'bigint' ? argVal : BigInt(argVal);
  const left = flags.includes('-');
  const zero = flags.includes('0');
  const hash = flags.includes('#');
  const base = conv === 'o' ? 8 : 16;
  let natural = v.toString(base);
  if (conv === 'X') natural = natural.toUpperCase();
  let digits: string;
  if (precision !== undefined) {
    digits = precision === 0 && v === 0n ? '' : natural.padStart(precision, '0');
  } else {
    digits = natural;
  }
  if (conv === 'o' && hash) {
    if (digits.length === 0 || digits[0] !== '0') digits = '0' + digits;
  }
  let prefix = '';
  if ((conv === 'x' || conv === 'X') && hash && v !== 0n) prefix = conv === 'x' ? '0x' : '0X';
  const useZero = zero && !left && precision === undefined;
  return assembleNumeric('', prefix, digits, width, left, useZero);
}

function formatFloatConv(
  x: number,
  flags: string,
  width: number | undefined,
  precision: number | undefined,
  conv: 'e' | 'E' | 'f' | 'F' | 'g' | 'G',
): string {
  const plus = flags.includes('+');
  const spaceFlag = flags.includes(' ');
  const hash = flags.includes('#');
  const zero = flags.includes('0');
  const left = flags.includes('-');
  const isNaNVal = Number.isNaN(x);
  const isInf = !isNaNVal && !isFinite(x);
  const signBit = Object.is(x, -0) || x < 0;
  const upper = conv === 'E' || conv === 'F' || conv === 'G';

  let sign = '';
  let body: string;
  let useZeroPad = zero && !left;

  if (isNaNVal) {
    body = upper ? 'NAN' : 'nan';
    useZeroPad = false;
  } else {
    sign = signBit ? '-' : plus ? '+' : spaceFlag ? ' ' : '';
    if (isInf) {
      body = upper ? 'INF' : 'inf';
      useZeroPad = false;
    } else {
      const abs = Math.abs(x);
      const p = precision === undefined ? 6 : precision;
      const base = conv.toLowerCase();
      if (base === 'f') body = convF(abs, p, hash);
      else if (base === 'e') body = convE(abs, p, hash, upper);
      else body = convG(abs, p, hash, upper);
    }
  }
  return assembleNumeric(sign, '', body, width, left, useZeroPad);
}

function convS(argVal: string, flags: string, width: number | undefined, precision: number | undefined): string {
  let s = String(argVal);
  if (precision !== undefined) s = s.slice(0, precision);
  const left = flags.includes('-');
  return assembleText(s, width, left);
}

function convC(argVal: string, flags: string, width: number | undefined): string {
  const s = String(argVal);
  const left = flags.includes('-');
  return assembleText(s, width, left);
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  const re = /%([-+0 #]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc%])/g;
  let result = '';
  let lastIndex = 0;
  let argIdx = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(fmt))) {
    result += fmt.slice(lastIndex, m.index);
    lastIndex = re.lastIndex;
    const [, flags, widthStr, precStr, conv] = m;
    if (conv === '%') {
      result += '%';
      continue;
    }
    const width = widthStr ? parseInt(widthStr, 10) : undefined;
    const precision = precStr === undefined ? undefined : precStr === '' ? 0 : parseInt(precStr, 10);
    const arg = args[argIdx++];
    switch (conv) {
      case 'd':
      case 'i':
        result += convDI(arg as number | bigint, flags, width, precision);
        break;
      case 'x':
      case 'X':
      case 'o':
        result += convHexOct(arg as number | bigint, flags, width, precision, conv);
        break;
      case 'e':
      case 'E':
      case 'f':
      case 'F':
      case 'g':
      case 'G':
        result += formatFloatConv(arg as number, flags, width, precision, conv);
        break;
      case 's':
        result += convS(arg as string, flags, width, precision);
        break;
      case 'c':
        result += convC(arg as string, flags, width);
        break;
    }
  }
  result += fmt.slice(lastIndex);
  return result;
}
