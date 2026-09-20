type Flags = {
  minus: boolean;
  plus: boolean;
  space: boolean;
  zero: boolean;
  hash: boolean;
};

function parseFlags(s: string): Flags {
  return {
    minus: s.includes('-'),
    plus: s.includes('+'),
    space: s.includes(' '),
    zero: s.includes('0'),
    hash: s.includes('#'),
  };
}

function toBigInt(v: number | bigint): bigint {
  return typeof v === 'bigint' ? v : BigInt(v);
}

function padNumeric(
  prefix: string,
  digits: string,
  width: number,
  leftAlign: boolean,
  zeroPad: boolean
): string {
  const body = prefix + digits;
  if (body.length >= width) return body;
  const padLen = width - body.length;
  if (leftAlign) return body + ' '.repeat(padLen);
  if (zeroPad) return prefix + '0'.repeat(padLen) + digits;
  return ' '.repeat(padLen) + body;
}

function padPlain(text: string, width: number, leftAlign: boolean): string {
  if (text.length >= width) return text;
  const padLen = width - text.length;
  return leftAlign ? text + ' '.repeat(padLen) : ' '.repeat(padLen) + text;
}

// --- exact decimal conversion of IEEE754 doubles ---

function decompose(value: number): { M: bigint; E: number } {
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setFloat64(0, value);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  const mantHi = hi & 0xfffff;
  let mant = (BigInt(mantHi) << 32n) | BigInt(lo);
  if (expBits === 0) {
    return { M: mant, E: -1074 };
  }
  mant |= 1n << 52n;
  return { M: mant, E: expBits - 1075 };
}

// round(value * 10^k) with ties-to-even, value == M * 2^E, M >= 0
function roundExact(M: bigint, E: number, k: number): bigint {
  let num = M;
  let den = 1n;
  if (k >= 0) num *= 5n ** BigInt(k);
  else den *= 5n ** BigInt(-k);
  const p2 = E + k;
  if (p2 >= 0) num <<= BigInt(p2);
  else den <<= BigInt(-p2);
  let q = num / den;
  const r = num - q * den;
  const twice = r * 2n;
  if (twice > den || (twice === den && q % 2n === 1n)) q += 1n;
  return q;
}

// is M*2^E >= 10^X ?
function geTenPow(M: bigint, E: number, X: number): boolean {
  let lhsNum = M;
  let lhsDen = 1n;
  if (E >= 0) lhsNum <<= BigInt(E);
  else lhsDen <<= BigInt(-E);
  let rhsNum: bigint;
  let rhsDen: bigint;
  if (X >= 0) {
    rhsNum = 10n ** BigInt(X);
    rhsDen = 1n;
  } else {
    rhsNum = 1n;
    rhsDen = 10n ** BigInt(-X);
  }
  return lhsNum * rhsDen >= rhsNum * lhsDen;
}

function computeExponent(value: number, M: bigint, E: number): number {
  let X = Math.floor(Math.log10(value));
  if (!isFinite(X)) X = 0;
  while (!geTenPow(M, E, X)) X--;
  while (geTenPow(M, E, X + 1)) X++;
  return X;
}

function eStyleDigits(
  value: number,
  M: bigint,
  E: number,
  p: number
): { digits: string; X: number } {
  let X = value === 0 ? 0 : computeExponent(value, M, E);
  const k = p - X;
  let Q = roundExact(M, E, k);
  const expectedLen = p + 1;
  let s = Q.toString();
  if (s.length > expectedLen) {
    X += s.length - expectedLen;
    s = s.slice(0, expectedLen);
  } else if (s.length < expectedLen) {
    s = s.padStart(expectedLen, '0');
  }
  return { digits: s, X };
}

function fStyleDigits(
  M: bigint,
  E: number,
  precision: number
): { intPart: string; fracPart: string } {
  const Q = roundExact(M, E, precision);
  if (precision === 0) {
    return { intPart: Q.toString(), fracPart: '' };
  }
  const s = Q.toString().padStart(precision + 1, '0');
  const fracPart = s.slice(s.length - precision);
  const intPart = s.slice(0, s.length - precision) || '0';
  return { intPart, fracPart };
}

function signStr(isNegative: boolean, flags: Flags): string {
  if (isNegative) return '-';
  if (flags.plus) return '+';
  if (flags.space) return ' ';
  return '';
}

function formatFloatSpecials(
  value: number,
  conv: string,
  flags: Flags,
  width: number
): string | null {
  if (Number.isNaN(value)) {
    const text = conv === conv.toUpperCase() ? 'NAN' : 'nan';
    return padPlain(text, width, flags.minus);
  }
  if (!isFinite(value)) {
    const neg = value < 0;
    const sign = signStr(neg, flags);
    const text = conv === conv.toUpperCase() ? 'INF' : 'inf';
    return padPlain(sign + text, width, flags.minus);
  }
  return null;
}

function formatE(
  value: number,
  upper: boolean,
  flags: Flags,
  width: number,
  precision: number
): string {
  const neg = value < 0 || Object.is(value, -0);
  const abs = Math.abs(value);
  const { M, E } = decompose(abs);
  const { digits, X } = eStyleDigits(abs, M, E, precision);
  const first = digits[0];
  const rest = digits.slice(1);
  const dot = precision > 0 || flags.hash ? '.' : '';
  const expSign = X < 0 ? '-' : '+';
  const expAbs = Math.abs(X).toString().padStart(2, '0');
  const text = first + dot + rest + (upper ? 'E' : 'e') + expSign + expAbs;
  const sign = signStr(neg, flags);
  const zeroPad = flags.zero && !flags.minus;
  return padNumeric(sign, text, width, flags.minus, zeroPad);
}

function formatF(
  value: number,
  flags: Flags,
  width: number,
  precision: number
): string {
  const neg = value < 0 || Object.is(value, -0);
  const abs = Math.abs(value);
  const { M, E } = decompose(abs);
  const { intPart, fracPart } = fStyleDigits(M, E, precision);
  const dot = precision > 0 || flags.hash ? '.' : '';
  const text = intPart + dot + fracPart;
  const sign = signStr(neg, flags);
  const zeroPad = flags.zero && !flags.minus;
  return padNumeric(sign, text, width, flags.minus, zeroPad);
}

function formatG(
  value: number,
  upper: boolean,
  flags: Flags,
  width: number,
  precisionArg: number | undefined
): string {
  const P = precisionArg === undefined ? 6 : precisionArg === 0 ? 1 : precisionArg;
  const neg = value < 0 || Object.is(value, -0);
  const abs = Math.abs(value);
  const { M, E } = decompose(abs);
  const { digits, X } = eStyleDigits(abs, M, E, P - 1);

  let text: string;
  if (P > X && X >= -4) {
    const fPrecision = P - 1 - X;
    const { intPart, fracPart } = fStyleDigits(M, E, fPrecision);
    if (flags.hash) {
      text = fracPart.length > 0 ? intPart + '.' + fracPart : intPart + '.';
    } else {
      let frac = fracPart.replace(/0+$/, '');
      text = frac.length > 0 ? intPart + '.' + frac : intPart;
    }
  } else {
    const first = digits[0];
    const rest = digits.slice(1);
    const expSign = X < 0 ? '-' : '+';
    const expAbs = Math.abs(X).toString().padStart(2, '0');
    const expPart = (upper ? 'E' : 'e') + expSign + expAbs;
    if (flags.hash) {
      text = (rest.length > 0 ? first + '.' + rest : first + '.') + expPart;
    } else {
      const trimmedRest = rest.replace(/0+$/, '');
      text = (trimmedRest.length > 0 ? first + '.' + trimmedRest : first) + expPart;
    }
  }

  const sign = signStr(neg, flags);
  const zeroPad = flags.zero && !flags.minus;
  return padNumeric(sign, text, width, flags.minus, zeroPad);
}

function formatInt(
  arg: number | bigint,
  conv: string,
  flags: Flags,
  width: number,
  precision: number | undefined
): string {
  const bi = toBigInt(arg);

  if (conv === 'd' || conv === 'i') {
    const neg = bi < 0n;
    const mag = neg ? -bi : bi;
    let digits: string;
    if (precision === 0 && mag === 0n) {
      digits = '';
    } else if (precision !== undefined) {
      digits = mag.toString().padStart(precision, '0');
    } else {
      digits = mag.toString();
    }
    const sign = signStr(neg, flags);
    const zeroPad = flags.zero && !flags.minus && precision === undefined;
    return padNumeric(sign, digits, width, flags.minus, zeroPad);
  }

  // x, X, o
  const mag = bi;
  const base = conv === 'o' ? 8 : 16;
  let digits: string;
  if (precision === 0 && mag === 0n) {
    digits = '';
  } else if (precision !== undefined) {
    digits = mag.toString(base).padStart(precision, '0');
  } else {
    digits = mag.toString(base);
  }
  if (conv === 'X') digits = digits.toUpperCase();

  if (flags.hash) {
    if (conv === 'o') {
      if (digits.length === 0 || digits[0] !== '0') digits = '0' + digits;
    }
  }

  let prefix = '';
  if (flags.hash && (conv === 'x' || conv === 'X') && mag !== 0n) {
    prefix = conv === 'X' ? '0X' : '0x';
  }

  const zeroPad = flags.zero && !flags.minus && precision === undefined;
  return padNumeric(prefix, digits, width, flags.minus, zeroPad);
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let argIndex = 0;
  const regex = /%([-+0# ]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc%])/g;

  return fmt.replace(regex, (_match, flagsStr, widthStr, precStr, conv) => {
    if (conv === '%') return '%';

    const flags = parseFlags(flagsStr);
    const width = widthStr === '' ? 0 : parseInt(widthStr, 10);
    const precision =
      precStr === undefined ? undefined : precStr === '' ? 0 : parseInt(precStr, 10);

    const arg = args[argIndex++];

    if (conv === 'd' || conv === 'i' || conv === 'x' || conv === 'X' || conv === 'o') {
      return formatInt(arg as number | bigint, conv, flags, width, precision);
    }

    if (conv === 's') {
      let s = arg as string;
      if (precision !== undefined) s = s.slice(0, precision);
      return padPlain(s, width, flags.minus);
    }

    if (conv === 'c') {
      const s = arg as string;
      return padPlain(s, width, flags.minus);
    }

    // float conversions
    const value = arg as number;
    const special = formatFloatSpecials(value, conv, flags, width);
    if (special !== null) return special;

    const p = precision === undefined ? 6 : precision;

    switch (conv) {
      case 'e':
        return formatE(value, false, flags, width, p);
      case 'E':
        return formatE(value, true, flags, width, p);
      case 'f':
        return formatF(value, flags, width, p);
      case 'F':
        return formatF(value, flags, width, p);
      case 'g':
        return formatG(value, false, flags, width, precision);
      case 'G':
        return formatG(value, true, flags, width, precision);
      default:
        throw new Error(`unsupported conversion: ${conv}`);
    }
  });
}
