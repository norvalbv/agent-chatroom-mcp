interface Flags {
  minus: boolean;
  plus: boolean;
  space: boolean;
  zero: boolean;
  hash: boolean;
}

function padNumeric(sign: string, prefix: string, digits: string, width: number, minus: boolean, zero: boolean): string {
  const body = sign + prefix + digits;
  if (body.length >= width) return body;
  const padLen = width - body.length;
  if (minus) return body + ' '.repeat(padLen);
  if (zero) return sign + prefix + '0'.repeat(padLen) + digits;
  return ' '.repeat(padLen) + body;
}

function formatInt(flags: Flags, width: number, precision: number | null, arg: number | bigint): string {
  const v = typeof arg === 'bigint' ? arg : BigInt(arg);
  const isNeg = v < 0n;
  const mag = isNeg ? -v : v;
  let digits: string;
  if (precision !== null && precision === 0 && mag === 0n) {
    digits = '';
  } else {
    digits = mag.toString();
    if (precision !== null) digits = digits.padStart(precision, '0');
  }
  const sign = isNeg ? '-' : flags.plus ? '+' : flags.space ? ' ' : '';
  const zeroOk = flags.zero && precision === null;
  return padNumeric(sign, '', digits, width, flags.minus, zeroOk);
}

function formatUint(conv: 'x' | 'X' | 'o', flags: Flags, width: number, precision: number | null, arg: number | bigint): string {
  const v = typeof arg === 'bigint' ? arg : BigInt(arg);
  let digits: string;
  if (precision !== null && precision === 0 && v === 0n) {
    digits = '';
  } else {
    const base = conv === 'o' ? 8 : 16;
    digits = v.toString(base);
    if (conv === 'X') digits = digits.toUpperCase();
    if (precision !== null) digits = digits.padStart(precision, '0');
  }
  let prefix = '';
  if (flags.hash) {
    if (conv === 'o') {
      if (digits === '' || digits[0] !== '0') digits = '0' + digits;
    } else if (v !== 0n) {
      prefix = conv === 'X' ? '0X' : '0x';
    }
  }
  const zeroOk = flags.zero && precision === null;
  return padNumeric('', prefix, digits, width, flags.minus, zeroOk);
}

function getBits(x: number): bigint {
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setFloat64(0, x);
  return dv.getBigUint64(0);
}

function decompose(mag: number): { M: bigint; E: number } {
  const bits = getBits(mag);
  const exp = Number((bits >> 52n) & 0x7ffn);
  const mant = bits & 0xfffffffffffffn;
  if (exp === 0) return { M: mant, E: -1074 };
  return { M: mant | (1n << 52n), E: exp - 1075 };
}

function toFraction(M: bigint, E: number): { N: bigint; D: bigint } {
  if (E >= 0) return { N: M << BigInt(E), D: 1n };
  return { N: M, D: 1n << BigInt(-E) };
}

function roundHalfEven(N: bigint, D: bigint): bigint {
  const q = N / D;
  const r = N % D;
  const twice = r * 2n;
  if (twice < D) return q;
  if (twice > D) return q + 1n;
  return q % 2n === 0n ? q : q + 1n;
}

function bitLength(n: bigint): number {
  if (n === 0n) return 0;
  return n.toString(2).length;
}

function decimalExponent(N: bigint, D: bigint): number {
  const k = bitLength(D) - 1;
  const log2v = bitLength(N) - 1 - k;
  let guess = Math.floor(log2v * Math.log10(2));
  const geTenPow = (e: number): boolean => {
    if (e >= 0) return N >= D * 10n ** BigInt(e);
    return N * 10n ** BigInt(-e) >= D;
  };
  while (!geTenPow(guess)) guess--;
  while (geTenPow(guess + 1)) guess++;
  return guess;
}

function eDigits(N: bigint, D: bigint, p: number): { exp: number; digits: string } {
  let exp = decimalExponent(N, D);
  const shift = p - exp;
  let numerator: bigint;
  let denom: bigint;
  if (shift >= 0) {
    numerator = N * 10n ** BigInt(shift);
    denom = D;
  } else {
    numerator = N;
    denom = D * 10n ** BigInt(-shift);
  }
  let digitsInt = roundHalfEven(numerator, denom);
  const maxDigits = 10n ** BigInt(p + 1);
  if (digitsInt >= maxDigits) {
    digitsInt = digitsInt / 10n;
    exp += 1;
  }
  const digitsStr = digitsInt.toString().padStart(p + 1, '0');
  return { exp, digits: digitsStr };
}

function fDigits(N: bigint, D: bigint, p: number): { intPart: string; fracPart: string } {
  const numerator = N * 10n ** BigInt(p);
  const scaled = roundHalfEven(numerator, D);
  let s = scaled.toString();
  if (p === 0) return { intPart: s, fracPart: '' };
  if (s.length <= p) s = s.padStart(p + 1, '0');
  return { intPart: s.slice(0, s.length - p), fracPart: s.slice(s.length - p) };
}

function buildE(digits: string, exp: number, p: number, hash: boolean, upper: boolean): string {
  const first = digits[0];
  const rest = digits.slice(1);
  const dot = p === 0 ? (hash ? '.' : '') : '.' + rest;
  const letter = upper ? 'E' : 'e';
  const expSign = exp < 0 ? '-' : '+';
  const expAbs = Math.abs(exp).toString().padStart(2, '0');
  return first + dot + letter + expSign + expAbs;
}

function buildF(intPart: string, fracPart: string, hash: boolean): string {
  const dot = fracPart.length === 0 ? (hash ? '.' : '') : '.' + fracPart;
  return intPart + dot;
}

function trimG(intPart: string, fracPart: string, hash: boolean): string {
  if (hash) return buildF(intPart, fracPart, true);
  const frac = fracPart.replace(/0+$/, '');
  return buildF(intPart, frac, false);
}

function trimGExp(digits: string, exp: number, hash: boolean, upper: boolean): string {
  if (hash) return buildE(digits, exp, digits.length - 1, true, upper);
  const rest = digits.slice(1).replace(/0+$/, '');
  return buildE(digits[0] + rest, exp, rest.length, false, upper);
}

function floatSign(signSet: boolean, isNaN: boolean, flags: Flags): string {
  if (isNaN) return '';
  if (signSet) return '-';
  if (flags.plus) return '+';
  if (flags.space) return ' ';
  return '';
}

function formatFloat(conv: 'e' | 'E' | 'f' | 'F' | 'g' | 'G', flags: Flags, width: number, precision: number | null, x: number): string {
  const upper = conv === 'E' || conv === 'F' || conv === 'G';
  const bits = getBits(x);
  const signSet = bits >> 63n === 1n;
  const isNaN = Number.isNaN(x);
  const sign = floatSign(signSet, isNaN, flags);

  if (isNaN) {
    const body = upper ? 'NAN' : 'nan';
    return padNumeric('', '', body, width, flags.minus, false);
  }
  if (!Number.isFinite(x)) {
    const body = upper ? 'INF' : 'inf';
    return padNumeric(sign, '', body, width, flags.minus, false);
  }

  const mag = Math.abs(x);
  let bodyDigits: string;

  if (conv === 'e' || conv === 'E') {
    const p = precision === null ? 6 : precision;
    if (mag === 0) {
      bodyDigits = buildE('0'.repeat(p + 1), 0, p, flags.hash, upper);
    } else {
      const { M, E } = decompose(mag);
      const { N, D } = toFraction(M, E);
      const { exp, digits } = eDigits(N, D, p);
      bodyDigits = buildE(digits, exp, p, flags.hash, upper);
    }
  } else if (conv === 'f' || conv === 'F') {
    const p = precision === null ? 6 : precision;
    if (mag === 0) {
      bodyDigits = buildF('0', '0'.repeat(p), flags.hash);
    } else {
      const { M, E } = decompose(mag);
      const { N, D } = toFraction(M, E);
      const { intPart, fracPart } = fDigits(N, D, p);
      bodyDigits = buildF(intPart, fracPart, flags.hash);
    }
  } else {
    const P = precision === null ? 6 : precision === 0 ? 1 : precision;
    if (mag === 0) {
      const X = 0;
      const fp = P - 1 - X;
      bodyDigits = trimG('0', '0'.repeat(fp), flags.hash);
    } else {
      const { M, E } = decompose(mag);
      const { N, D } = toFraction(M, E);
      const p = P - 1;
      const { exp: X, digits } = eDigits(N, D, p);
      if (P > X && X >= -4) {
        const fp = P - 1 - X;
        const { intPart, fracPart } = fDigits(N, D, fp);
        bodyDigits = trimG(intPart, fracPart, flags.hash);
      } else {
        bodyDigits = trimGExp(digits, X, flags.hash, upper);
      }
    }
  }

  return padNumeric(sign, '', bodyDigits, width, flags.minus, flags.zero);
}

function formatStr(flags: Flags, width: number, precision: number | null, arg: string): string {
  const text = precision !== null ? arg.slice(0, precision) : arg;
  return padNumeric('', '', text, width, flags.minus, false);
}

function formatChar(flags: Flags, width: number, arg: string): string {
  return padNumeric('', '', arg, width, flags.minus, false);
}

function formatOne(conv: string, flags: Flags, width: number, precision: number | null, arg: number | bigint | string): string {
  switch (conv) {
    case 'd':
    case 'i':
      return formatInt(flags, width, precision, arg as number | bigint);
    case 'x':
    case 'X':
    case 'o':
      return formatUint(conv, flags, width, precision, arg as number | bigint);
    case 'e':
    case 'E':
    case 'f':
    case 'F':
    case 'g':
    case 'G':
      return formatFloat(conv, flags, width, precision, Number(arg));
    case 's':
      return formatStr(flags, width, precision, arg as string);
    case 'c':
      return formatChar(flags, width, arg as string);
    default:
      throw new Error('unsupported conversion: ' + conv);
  }
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let argIndex = 0;
  let result = '';
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
    let precision: number | null = null;
    if (fmt[j] === '.') {
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
    if (conv === '%') {
      result += '%';
      i = j;
      continue;
    }
    const arg = args[argIndex++];
    result += formatOne(conv, flags, width, precision, arg);
    i = j;
  }
  return result;
}
