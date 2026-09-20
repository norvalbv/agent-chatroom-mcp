type FlagSet = Set<string>;

function decomposeAbsDouble(x: number): { mantissa: bigint; exp2: number } {
  if (x === 0) return { mantissa: 0n, exp2: 0 };
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, x);
  const bits = buf.getBigUint64(0);
  const expBits = Number((bits >> 52n) & 0x7ffn);
  const mantissaBits = bits & 0xfffffffffffffn;
  if (expBits === 0) {
    return { mantissa: mantissaBits, exp2: -1074 };
  }
  return { mantissa: mantissaBits | (1n << 52n), exp2: expBits - 1075 };
}

function roundDiv(num: bigint, den: bigint): bigint {
  const q = num / den;
  const r = num % den;
  const twice = r * 2n;
  if (twice < den) return q;
  if (twice > den) return q + 1n;
  return q % 2n === 0n ? q : q + 1n;
}

// round(mantissa * 2^exp2 * 10^k)
function scaledValue(mantissa: bigint, exp2: number, k: number): bigint {
  let num = mantissa;
  let den = 1n;
  if (exp2 >= 0) num *= 2n ** BigInt(exp2);
  else den *= 2n ** BigInt(-exp2);
  if (k >= 0) num *= 10n ** BigInt(k);
  else den *= 10n ** BigInt(-k);
  return roundDiv(num, den);
}

// compare mantissa*2^exp2 to 10^E
function compareToPow10(mantissa: bigint, exp2: number, E: number): number {
  let num = mantissa;
  let den = 1n;
  if (exp2 >= 0) num *= 2n ** BigInt(exp2);
  else den *= 2n ** BigInt(-exp2);
  if (E >= 0) den *= 10n ** BigInt(E);
  else num *= 10n ** BigInt(-E);
  if (num < den) return -1;
  if (num > den) return 1;
  return 0;
}

function findExponent(mantissa: bigint, exp2: number, x: number): number {
  let guess = Math.floor(Math.log10(x));
  while (compareToPow10(mantissa, exp2, guess) < 0) guess--;
  while (compareToPow10(mantissa, exp2, guess + 1) >= 0) guess++;
  return guess;
}

function sciDigits(
  mantissa: bigint,
  exp2: number,
  x: number,
  P: number
): { first: string; fraction: string; E: number } {
  if (x === 0) return { first: '0', fraction: '0'.repeat(P), E: 0 };
  let E = findExponent(mantissa, exp2, x);
  let N = scaledValue(mantissa, exp2, P - E);
  const maxN = 10n ** BigInt(P + 1);
  if (N >= maxN) {
    N = N / 10n;
    E += 1;
  }
  const s = N.toString(10);
  return { first: s[0], fraction: s.slice(1), E };
}

function formatFixed(mantissa: bigint, exp2: number, x: number, P: number, hasHash: boolean): string {
  let intPart: string;
  let frac: string;
  if (x === 0) {
    intPart = '0';
    frac = '0'.repeat(P);
  } else if (P === 0) {
    const N = scaledValue(mantissa, exp2, 0);
    intPart = N.toString(10);
    frac = '';
  } else {
    const N = scaledValue(mantissa, exp2, P);
    let s = N.toString(10);
    if (s.length <= P) s = s.padStart(P + 1, '0');
    intPart = s.slice(0, s.length - P);
    frac = s.slice(s.length - P);
  }
  const dp = P > 0 ? '.' + frac : hasHash ? '.' : '';
  return intPart + dp;
}

function stripTrailingZeros(s: string, hasHash: boolean): string {
  if (hasHash) return s;
  if (!s.includes('.')) return s;
  s = s.replace(/0+$/, '');
  if (s.endsWith('.')) s = s.slice(0, -1);
  return s;
}

function pad(prefix: string, digits: string, width: number | undefined, flags: FlagSet, allowZero: boolean): string {
  const body = prefix + digits;
  if (width === undefined || body.length >= width) return body;
  const fillLen = width - body.length;
  if (flags.has('-')) return body + ' '.repeat(fillLen);
  if (allowZero) return prefix + '0'.repeat(fillLen) + digits;
  return ' '.repeat(fillLen) + body;
}

function formatInt(value: number | bigint, flags: FlagSet, width: number | undefined, precision: number | undefined): string {
  let neg: boolean;
  let mag: bigint;
  if (typeof value === 'bigint') {
    neg = value < 0n;
    mag = neg ? -value : value;
  } else {
    neg = value < 0;
    mag = BigInt(Math.abs(value));
  }
  const magStr = mag.toString(10);
  let digits: string;
  if (precision === 0 && mag === 0n) digits = '';
  else if (precision !== undefined) digits = magStr.padStart(precision, '0');
  else digits = magStr;
  const sign = neg ? '-' : flags.has('+') ? '+' : flags.has(' ') ? ' ' : '';
  const allowZero = flags.has('0') && !flags.has('-') && precision === undefined;
  return pad(sign, digits, width, flags, allowZero);
}

function formatBase(
  value: number | bigint,
  flags: FlagSet,
  width: number | undefined,
  precision: number | undefined,
  conv: 'x' | 'X' | 'o'
): string {
  const mag: bigint = typeof value === 'bigint' ? value : BigInt(value);
  const base = conv === 'o' ? 8 : 16;
  let magStr = mag.toString(base);
  if (conv === 'X') magStr = magStr.toUpperCase();
  let digits: string;
  if (precision === 0 && mag === 0n) digits = '';
  else if (precision !== undefined) digits = magStr.padStart(precision, '0');
  else digits = magStr;
  let prefix = '';
  if (flags.has('#')) {
    if (conv === 'x') prefix = mag !== 0n ? '0x' : '';
    else if (conv === 'X') prefix = mag !== 0n ? '0X' : '';
    else if (digits === '' || digits[0] !== '0') digits = '0' + digits;
  }
  const allowZero = flags.has('0') && !flags.has('-') && precision === undefined;
  return pad(prefix, digits, width, flags, allowZero);
}

function formatFloatConv(
  value: number,
  conv: 'e' | 'E' | 'f' | 'F' | 'g' | 'G',
  flags: FlagSet,
  precision: number | undefined,
  width: number | undefined
): string {
  const upper = conv === 'E' || conv === 'F' || conv === 'G';
  let signChar = '';
  let bodyNoSign: string;
  let allowZeroPad = true;

  if (Number.isNaN(value)) {
    bodyNoSign = upper ? 'NAN' : 'nan';
    allowZeroPad = false;
  } else {
    const negative = value < 0 || Object.is(value, -0);
    signChar = negative ? '-' : flags.has('+') ? '+' : flags.has(' ') ? ' ' : '';
    if (!Number.isFinite(value)) {
      bodyNoSign = upper ? 'INF' : 'inf';
      allowZeroPad = false;
    } else {
      const x = Math.abs(value);
      const { mantissa, exp2 } = decomposeAbsDouble(x);
      const hasHash = flags.has('#');
      if (conv === 'f' || conv === 'F') {
        const P = precision ?? 6;
        bodyNoSign = formatFixed(mantissa, exp2, x, P, hasHash);
      } else if (conv === 'e' || conv === 'E') {
        const P = precision ?? 6;
        const d = sciDigits(mantissa, exp2, x, P);
        const dp = P > 0 ? '.' + d.fraction : hasHash ? '.' : '';
        const expSign = d.E >= 0 ? '+' : '-';
        const expDigits = String(Math.abs(d.E)).padStart(2, '0');
        bodyNoSign = d.first + dp + (upper ? 'E' : 'e') + expSign + expDigits;
      } else {
        const Praw = precision ?? 6;
        const P = Praw === 0 ? 1 : Praw;
        const sci = sciDigits(mantissa, exp2, x, P - 1);
        const X = sci.E;
        if (P > X && X >= -4) {
          const body = formatFixed(mantissa, exp2, x, P - 1 - X, hasHash);
          bodyNoSign = stripTrailingZeros(body, hasHash);
        } else {
          const dp = P - 1 > 0 ? '.' + sci.fraction : hasHash ? '.' : '';
          let mantissaStr = sci.first + dp;
          mantissaStr = stripTrailingZeros(mantissaStr, hasHash);
          const expSign = sci.E >= 0 ? '+' : '-';
          const expDigits = String(Math.abs(sci.E)).padStart(2, '0');
          bodyNoSign = mantissaStr + (upper ? 'E' : 'e') + expSign + expDigits;
        }
      }
    }
  }

  const allowZero = allowZeroPad && flags.has('0') && !flags.has('-');
  return pad(signChar, bodyNoSign, width, flags, allowZero);
}

function formatStr(value: string, flags: FlagSet, width: number | undefined, precision: number | undefined): string {
  let s = String(value);
  if (precision !== undefined) s = s.slice(0, precision);
  return pad('', s, width, flags, false);
}

function formatChar(value: string, flags: FlagSet, width: number | undefined): string {
  return pad('', String(value), width, flags, false);
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let result = '';
  let argIndex = 0;
  let lastIndex = 0;
  const re = /%([-+0# ]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc%])/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(fmt))) {
    result += fmt.slice(lastIndex, match.index);
    lastIndex = match.index + match[0].length;
    const [, flagsStr, widthStr, precStr, conv] = match;
    if (conv === '%') {
      result += '%';
      continue;
    }
    const flags: FlagSet = new Set(flagsStr.split('').filter((c) => c !== ''));
    const width = widthStr ? parseInt(widthStr, 10) : undefined;
    const precision = precStr !== undefined ? (precStr === '' ? 0 : parseInt(precStr, 10)) : undefined;
    const value = args[argIndex++];

    switch (conv) {
      case 'd':
      case 'i':
        result += formatInt(value as number | bigint, flags, width, precision);
        break;
      case 'x':
      case 'X':
      case 'o':
        result += formatBase(value as number | bigint, flags, width, precision, conv);
        break;
      case 'e':
      case 'E':
      case 'f':
      case 'F':
      case 'g':
      case 'G':
        result += formatFloatConv(value as number, conv, flags, precision, width);
        break;
      case 's':
        result += formatStr(value as string, flags, width, precision);
        break;
      case 'c':
        result += formatChar(value as string, flags, width);
        break;
    }
  }
  result += fmt.slice(lastIndex);
  return result;
}
