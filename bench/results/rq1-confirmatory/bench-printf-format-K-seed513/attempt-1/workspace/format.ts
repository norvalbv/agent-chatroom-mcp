interface Flags {
  minus: boolean;
  plus: boolean;
  space: boolean;
  zero: boolean;
  hash: boolean;
}

function parseFlags(s: string): Flags {
  return {
    minus: s.includes('-'),
    plus: s.includes('+'),
    space: s.includes(' '),
    zero: s.includes('0'),
    hash: s.includes('#'),
  };
}

function padWidth(body: string, width: number | undefined, leftAlign: boolean): string {
  if (width === undefined || body.length >= width) return body;
  const pad = ' '.repeat(width - body.length);
  return leftAlign ? body + pad : pad + body;
}

function padNumericWidth(
  sign: string,
  prefix: string,
  digits: string,
  width: number | undefined,
  leftAlign: boolean,
  zeroFlag: boolean,
): string {
  const body = sign + prefix + digits;
  if (width === undefined || body.length >= width) return body;
  const padLen = width - body.length;
  if (leftAlign) return body + ' '.repeat(padLen);
  if (zeroFlag) return sign + prefix + '0'.repeat(padLen) + digits;
  return ' '.repeat(padLen) + body;
}

// ---- integer conversions (d, i) ----

function fmtDI(arg: number | bigint, flags: Flags, width?: number, precision?: number): string {
  let neg: boolean;
  let mag: bigint;
  if (typeof arg === 'bigint') {
    neg = arg < 0n;
    mag = neg ? -arg : arg;
  } else {
    neg = arg < 0;
    mag = BigInt(Math.abs(arg));
  }
  let digits: string;
  if (precision !== undefined) {
    digits = mag === 0n && precision === 0 ? '' : mag.toString().padStart(precision, '0');
  } else {
    digits = mag.toString();
  }
  const sign = neg ? '-' : flags.plus ? '+' : flags.space ? ' ' : '';
  const zeroFlag = flags.zero && !flags.minus && precision === undefined;
  return padNumericWidth(sign, '', digits, width, flags.minus, zeroFlag);
}

// ---- x, X, o ----

function fmtXXO(
  arg: number | bigint,
  conv: 'x' | 'X' | 'o',
  flags: Flags,
  width?: number,
  precision?: number,
): string {
  const mag = typeof arg === 'bigint' ? arg : BigInt(arg);
  const base = conv === 'o' ? 8 : 16;
  let raw = mag.toString(base);
  if (conv === 'X') raw = raw.toUpperCase();

  let prec = precision;
  if (conv === 'o' && flags.hash) {
    let p = prec === undefined ? raw.length : prec;
    if (mag === 0n) p = Math.max(p, 1);
    const padded = raw.padStart(p, '0');
    if (padded[0] !== '0') p = p + 1;
    prec = p;
  }

  let digits: string;
  if (prec !== undefined) {
    digits = mag === 0n && prec === 0 ? '' : raw.padStart(prec, '0');
  } else {
    digits = raw;
  }

  let prefix = '';
  if (flags.hash && (conv === 'x' || conv === 'X') && mag !== 0n) {
    prefix = conv === 'x' ? '0x' : '0X';
  }

  const zeroFlag = flags.zero && !flags.minus && precision === undefined;
  return padNumericWidth('', prefix, digits, width, flags.minus, zeroFlag);
}

// ---- exact-decimal helpers for float conversions ----

function decompose(x: number): { mantissa: bigint; exp: number } {
  if (x === 0) return { mantissa: 0n, exp: 0 };
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  const mantHi = hi & 0xfffff;
  let mantissa = (BigInt(mantHi) << 32n) | BigInt(lo);
  let exp: number;
  if (expBits === 0) {
    exp = -1074;
  } else {
    mantissa |= 1n << 52n;
    exp = expBits - 1075;
  }
  return { mantissa, exp };
}

function toFraction(x: number): { N: bigint; D: bigint } {
  const { mantissa, exp } = decompose(x);
  if (mantissa === 0n) return { N: 0n, D: 1n };
  if (exp >= 0) return { N: mantissa << BigInt(exp), D: 1n };
  return { N: mantissa, D: 1n << BigInt(-exp) };
}

function pow10(k: number): bigint {
  return 10n ** BigInt(k);
}

function scaleFrac(N: bigint, D: bigint, k: number): [bigint, bigint] {
  if (k >= 0) return [N * pow10(k), D];
  return [N, D * pow10(-k)];
}

function roundHalfEven(N: bigint, D: bigint): bigint {
  let q = N / D;
  const r = N % D;
  const twice = r * 2n;
  if (twice > D || (twice === D && q % 2n === 1n)) q += 1n;
  return q;
}

function geqPow10(N: bigint, D: bigint, E: number): boolean {
  if (E >= 0) return N >= D * pow10(E);
  return N * pow10(-E) >= D;
}

function significantDigits(N: bigint, D: bigint, q: number): { digits: string; E: number } {
  if (N === 0n) return { digits: '0'.repeat(q), E: 1 };
  const bitsN = N.toString(2).length;
  const bitsD = D.toString(2).length;
  const approxLog2 = bitsN - bitsD;
  let E = Math.floor(approxLog2 * Math.log10(2)) + 1;
  while (!geqPow10(N, D, E - 1)) E--;
  while (geqPow10(N, D, E)) E++;
  const k = q - E;
  const [sN, sD] = scaleFrac(N, D, k);
  const intVal = roundHalfEven(sN, sD);
  let digits = intVal.toString();
  if (digits.length > q) {
    E += 1;
    digits = digits.slice(0, q);
  } else if (digits.length < q) {
    digits = digits.padStart(q, '0');
  }
  return { digits, E };
}

function fixedDigits(N: bigint, D: bigint, prec: number): { intPart: string; fracPart: string } {
  if (N === 0n) return { intPart: '0', fracPart: '0'.repeat(prec) };
  const [sN, sD] = scaleFrac(N, D, prec);
  let s = roundHalfEven(sN, sD).toString();
  if (s.length <= prec) s = s.padStart(prec + 1, '0');
  if (prec === 0) return { intPart: s, fracPart: '' };
  return { intPart: s.slice(0, s.length - prec), fracPart: s.slice(s.length - prec) };
}

// ---- e, E, f, F, g, G ----

function formatFloat(
  arg: number,
  conv: string,
  flags: Flags,
  width?: number,
  precision?: number,
): string {
  const isUpper = conv === conv.toUpperCase();
  const lower = conv.toLowerCase();
  const isNeg = arg < 0 || Object.is(arg, -0);
  const sign = isNeg ? '-' : flags.plus ? '+' : flags.space ? ' ' : '';

  if (Number.isNaN(arg)) {
    return padWidth(isUpper ? 'NAN' : 'nan', width, flags.minus);
  }
  if (!Number.isFinite(arg)) {
    const body = sign + (isUpper ? 'INF' : 'inf');
    return padWidth(body, width, flags.minus);
  }

  const absVal = Math.abs(arg);
  const { N, D } = toFraction(absVal);

  let digitsBody: string;
  if (lower === 'f') {
    const prec = precision === undefined ? 6 : precision;
    const { intPart, fracPart } = fixedDigits(N, D, prec);
    digitsBody = prec > 0 || flags.hash ? intPart + '.' + fracPart : intPart;
  } else if (lower === 'e') {
    const prec = precision === undefined ? 6 : precision;
    const { digits, E } = significantDigits(N, D, prec + 1);
    const expVal = E - 1;
    const mantissa = prec > 0 || flags.hash ? digits[0] + '.' + digits.slice(1) : digits[0];
    const expSign = expVal < 0 ? '-' : '+';
    const expDigits = Math.abs(expVal).toString().padStart(2, '0');
    digitsBody = mantissa + (isUpper ? 'E' : 'e') + expSign + expDigits;
  } else {
    const P = precision === undefined ? 6 : precision === 0 ? 1 : precision;
    const { digits, E } = significantDigits(N, D, P);
    const X = E - 1;
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
      if (!flags.hash) fracPart = fracPart.replace(/0+$/, '');
      digitsBody = fracPart.length > 0 || flags.hash ? intPart + '.' + fracPart : intPart;
    } else {
      let frac = digits.slice(1);
      if (!flags.hash) frac = frac.replace(/0+$/, '');
      const mantStr = frac.length > 0 || flags.hash ? digits[0] + '.' + frac : digits[0];
      const expSign = X < 0 ? '-' : '+';
      const expDigits = Math.abs(X).toString().padStart(2, '0');
      digitsBody = mantStr + (isUpper ? 'E' : 'e') + expSign + expDigits;
    }
  }

  const zeroFlag = flags.zero && !flags.minus;
  return padNumericWidth(sign, '', digitsBody, width, flags.minus, zeroFlag);
}

// ---- s, c ----

function fmtS(arg: string, flags: Flags, width?: number, precision?: number): string {
  const s = precision !== undefined ? arg.slice(0, precision) : arg;
  return padWidth(s, width, flags.minus);
}

function fmtC(arg: string, flags: Flags, width?: number): string {
  return padWidth(arg, width, flags.minus);
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  const re = /%([-+0 #]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc%])/g;
  let result = '';
  let lastIndex = 0;
  let argIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = re.exec(fmt)) !== null) {
    result += fmt.slice(lastIndex, match.index);
    lastIndex = re.lastIndex;

    const [, flagsStr, widthStr, precStr, conv] = match;

    if (conv === '%') {
      result += '%';
      continue;
    }

    const flags = parseFlags(flagsStr);
    const width = widthStr === '' ? undefined : parseInt(widthStr, 10);
    const precision = precStr === undefined ? undefined : precStr === '' ? 0 : parseInt(precStr, 10);
    const arg = args[argIndex++];

    switch (conv) {
      case 'd':
      case 'i':
        result += fmtDI(arg as number | bigint, flags, width, precision);
        break;
      case 'x':
      case 'X':
      case 'o':
        result += fmtXXO(arg as number | bigint, conv, flags, width, precision);
        break;
      case 'e':
      case 'E':
      case 'f':
      case 'F':
      case 'g':
      case 'G':
        result += formatFloat(arg as number, conv, flags, width, precision);
        break;
      case 's':
        result += fmtS(arg as string, flags, width, precision);
        break;
      case 'c':
        result += fmtC(arg as string, flags, width);
        break;
    }
  }

  result += fmt.slice(lastIndex);
  return result;
}
