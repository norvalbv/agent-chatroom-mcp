type Arg = number | bigint | string;

function decomposeDouble(x: number): { sign: number; M: bigint; E: number } {
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setFloat64(0, x);
  const bits = view.getBigUint64(0);
  const sign = Number((bits >> 63n) & 1n);
  const expBits = (bits >> 52n) & 0x7ffn;
  const mantBits = bits & 0xfffffffffffffn;
  let M: bigint;
  let E: number;
  if (expBits === 0n) {
    M = mantBits;
    E = -1074;
  } else {
    M = mantBits | (1n << 52n);
    E = Number(expBits) - 1075;
  }
  return { sign, M, E };
}

// round(M * 2^E * 10^p) to nearest integer, ties to even. p, E may be negative.
function scaledRound(M: bigint, E: number, p: number): bigint {
  if (M === 0n) return 0n;
  const e2 = E + p;
  const numPow2 = e2 > 0 ? e2 : 0;
  const denPow2 = e2 < 0 ? -e2 : 0;
  const numPow5 = p > 0 ? p : 0;
  const denPow5 = p < 0 ? -p : 0;
  const N = M * (2n ** BigInt(numPow2)) * (5n ** BigInt(numPow5));
  const D = (2n ** BigInt(denPow2)) * (5n ** BigInt(denPow5));
  let q = N / D;
  const r = N % D;
  const twice = r * 2n;
  if (twice > D) q += 1n;
  else if (twice === D && q % 2n === 1n) q += 1n;
  return q;
}

function buildFixedDigits(M: bigint, E: number, p: number): { intPart: string; fracPart: string } {
  const rounded = scaledRound(M, E, p);
  let digitsStr = rounded.toString();
  if (digitsStr.length < p + 1) digitsStr = digitsStr.padStart(p + 1, '0');
  if (p > 0) {
    return { intPart: digitsStr.slice(0, digitsStr.length - p), fracPart: digitsStr.slice(digitsStr.length - p) };
  }
  return { intPart: digitsStr, fracPart: '' };
}

function computeExpAndDigits(M: bigint, E: number, p: number): { digits: string; X: number } {
  if (M === 0n) {
    return { digits: '0'.repeat(p + 1), X: 0 };
  }
  const log10M = Math.log10(Number(M));
  let Xest = Math.floor(log10M + E * Math.log10(2));
  let digits = scaledRound(M, E, p - Xest);
  let digStr = digits.toString();
  let guard = 0;
  while (digStr.length !== p + 1 && guard < 20) {
    if (digStr.length > p + 1) Xest++;
    else Xest--;
    digits = scaledRound(M, E, p - Xest);
    digStr = digits.toString();
    guard++;
  }
  return { digits: digStr, X: Xest };
}

function padNumeric(signPrefix: string, digits: string, width: number, leftAlign: boolean, zeroPad: boolean): string {
  const body = signPrefix + digits;
  if (body.length >= width) return body;
  const padLen = width - body.length;
  if (leftAlign) return body + ' '.repeat(padLen);
  if (zeroPad) return signPrefix + '0'.repeat(padLen) + digits;
  return ' '.repeat(padLen) + body;
}

function padSimple(str: string, width: number, leftAlign: boolean): string {
  if (str.length >= width) return str;
  const pad = ' '.repeat(width - str.length);
  return leftAlign ? str + pad : pad + str;
}

function toBigIntArg(arg: Arg): bigint {
  if (typeof arg === 'bigint') return arg;
  return BigInt(Math.trunc(arg as number));
}

function fmtDI(flags: string, width: number, precision: number | null, arg: Arg): string {
  const value = toBigIntArg(arg);
  const neg = value < 0n;
  const mag = neg ? -value : value;
  let digits = mag.toString();
  if (precision !== null) {
    if (precision === 0 && mag === 0n) digits = '';
    else digits = digits.padStart(precision, '0');
  }
  const sign = neg ? '-' : flags.includes('+') ? '+' : flags.includes(' ') ? ' ' : '';
  const zeroPad = flags.includes('0') && !flags.includes('-') && precision === null;
  return padNumeric(sign, digits, width, flags.includes('-'), zeroPad);
}

function fmtXXO(conv: string, flags: string, width: number, precision: number | null, arg: Arg): string {
  const value = toBigIntArg(arg);
  const base = conv === 'o' ? 8 : 16;
  let digits = value.toString(base);
  if (conv === 'X') digits = digits.toUpperCase();
  if (precision !== null) {
    if (precision === 0 && value === 0n) digits = '';
    else digits = digits.padStart(precision, '0');
  }
  let prefix = '';
  if (flags.includes('#')) {
    if (conv === 'o') {
      if (digits.length === 0 || digits[0] !== '0') digits = '0' + digits;
    } else if (value !== 0n) {
      prefix = conv === 'x' ? '0x' : '0X';
    }
  }
  const zeroPad = flags.includes('0') && !flags.includes('-') && precision === null;
  return padNumeric(prefix, digits, width, flags.includes('-'), zeroPad);
}

function signFor(signBit: number, flags: string): string {
  return signBit ? '-' : flags.includes('+') ? '+' : flags.includes(' ') ? ' ' : '';
}

function fmtFloat(conv: string, flags: string, width: number, precision: number | null, arg: Arg): string {
  const upper = conv === conv.toUpperCase();
  const x = arg as number;

  if (Number.isNaN(x)) {
    const body = upper ? 'NAN' : 'nan';
    return padSimple(body, width, flags.includes('-'));
  }

  if (!Number.isFinite(x)) {
    const signBit = x < 0 ? 1 : 0;
    const sign = signFor(signBit, flags);
    const body = upper ? 'INF' : 'inf';
    return padNumeric(sign, body, width, flags.includes('-'), false);
  }

  const { sign: signBit, M, E } = decomposeDouble(x);
  const sign = signFor(signBit, flags);
  const hash = flags.includes('#');
  const zeroPad = flags.includes('0') && !flags.includes('-');

  let numStr: string;

  if (conv === 'f' || conv === 'F') {
    const p = precision === null ? 6 : precision;
    const { intPart, fracPart } = buildFixedDigits(M, E, p);
    numStr = intPart + ((p > 0 || hash) ? '.' + fracPart : '');
  } else if (conv === 'e' || conv === 'E') {
    const p = precision === null ? 6 : precision;
    const { digits, X } = computeExpAndDigits(M, E, p);
    const intDigit = digits[0];
    const fracDigits = digits.slice(1);
    const mantissa = intDigit + ((p > 0 || hash) ? '.' + fracDigits : '');
    const expChar = upper ? 'E' : 'e';
    const expSign = X < 0 ? '-' : '+';
    const expAbs = Math.abs(X).toString().padStart(2, '0');
    numStr = mantissa + expChar + expSign + expAbs;
  } else {
    // g, G
    let P = precision === null ? 6 : precision;
    if (P === 0) P = 1;
    let X: number;
    if (M === 0n) X = 0;
    else X = computeExpAndDigits(M, E, P - 1).X;

    if (P > X && X >= -4) {
      const fp = P - 1 - X;
      const { intPart, fracPart } = buildFixedDigits(M, E, fp);
      let frac = fracPart;
      if (!hash) {
        frac = frac.replace(/0+$/, '');
      }
      numStr = intPart + ((frac.length > 0 || hash) ? '.' + frac : '');
    } else {
      const { digits, X: X2 } = computeExpAndDigits(M, E, P - 1);
      const intDigit = digits[0];
      let fracDigits = digits.slice(1);
      if (!hash) {
        fracDigits = fracDigits.replace(/0+$/, '');
      }
      const mantissa = intDigit + ((fracDigits.length > 0 || hash) ? '.' + fracDigits : '');
      const expChar = upper ? 'E' : 'e';
      const expSign = X2 < 0 ? '-' : '+';
      const expAbs = Math.abs(X2).toString().padStart(2, '0');
      numStr = mantissa + expChar + expSign + expAbs;
    }
  }

  return padNumeric(sign, numStr, width, flags.includes('-'), zeroPad);
}

function formatOne(conv: string, flags: string, width: number, precision: number | null, arg: Arg): string {
  switch (conv) {
    case 'd':
    case 'i':
      return fmtDI(flags, width, precision, arg);
    case 'x':
    case 'X':
    case 'o':
      return fmtXXO(conv, flags, width, precision, arg);
    case 'e':
    case 'E':
    case 'f':
    case 'F':
    case 'g':
    case 'G':
      return fmtFloat(conv, flags, width, precision, arg);
    case 's': {
      let str = arg as string;
      if (precision !== null) str = str.slice(0, precision);
      return padSimple(str, width, flags.includes('-'));
    }
    case 'c': {
      const str = arg as string;
      return padSimple(str, width, flags.includes('-'));
    }
    default:
      throw new Error(`unsupported conversion: ${conv}`);
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
    i++; // skip %
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
    const width = widthStr === '' ? 0 : parseInt(widthStr, 10);
    const arg = args[argIndex++];
    result += formatOne(conv, flags, width, precision, arg);
  }
  return result;
}
