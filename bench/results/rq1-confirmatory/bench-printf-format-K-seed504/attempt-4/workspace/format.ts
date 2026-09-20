// ---- low level helpers -----------------------------------------------

function decompose(absX: number): { mantissa: bigint; exponent: number } {
  if (absX === 0) return { mantissa: 0n, exponent: 0 };
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setFloat64(0, absX, false);
  const bits = view.getBigUint64(0, false);
  const expBits = Number((bits >> 52n) & 0x7ffn);
  const fracBits = bits & 0xfffffffffffffn;
  if (expBits === 0) {
    return { mantissa: fracBits, exponent: -1074 };
  }
  const mantissa = fracBits | (1n << 52n);
  const exponent = expBits - 1075;
  return { mantissa, exponent };
}

// round(mantissa * 2^exponent * 10^k) to nearest integer, ties to even
function scaledRound(mantissa: bigint, exponent: number, k: number): bigint {
  if (mantissa === 0n) return 0n;
  const p2 = exponent + k;
  const numPow2 = p2 > 0 ? p2 : 0;
  const denPow2 = p2 < 0 ? -p2 : 0;
  const numPow5 = k > 0 ? k : 0;
  const denPow5 = k < 0 ? -k : 0;
  const num = mantissa * 5n ** BigInt(numPow5) * 2n ** BigInt(numPow2);
  const den = 5n ** BigInt(denPow5) * 2n ** BigInt(denPow2);
  let q = num / den;
  const r = num % den;
  const twiceR = r * 2n;
  if (twiceR > den || (twiceR === den && q % 2n !== 0n)) q += 1n;
  return q;
}

function padLeft(s: string, len: number): string {
  while (s.length < len) s = '0' + s;
  return s;
}

function fBody(mantissa: bigint, exponent: number, prec: number, forceDot: boolean): string {
  const rounded = scaledRound(mantissa, exponent, prec);
  const s = padLeft(rounded.toString(), prec + 1);
  const intPart = s.slice(0, s.length - prec);
  if (prec > 0) return intPart + '.' + s.slice(s.length - prec);
  return intPart + (forceDot ? '.' : '');
}

function getExpDigits(mantissa: bigint, exponent: number, p: number): { digits: string; E: number } {
  if (mantissa === 0n) return { digits: '0'.repeat(p + 1), E: 0 };
  const mNum = Number(mantissa);
  let E = Math.floor(Math.log10(mNum) + exponent * Math.log10(2));
  let digits = scaledRound(mantissa, exponent, p - E).toString();
  let guard = 0;
  while (digits.length !== p + 1 && guard < 20) {
    if (digits.length > p + 1) E++;
    else E--;
    digits = scaledRound(mantissa, exponent, p - E).toString();
    guard++;
  }
  return { digits, E };
}

function formatExponent(E: number, upper: boolean): string {
  const eLetter = upper ? 'E' : 'e';
  const expSign = E < 0 ? '-' : '+';
  let expAbs = Math.abs(E).toString();
  if (expAbs.length < 2) expAbs = '0' + expAbs;
  return eLetter + expSign + expAbs;
}

function eBody(mantissa: bigint, exponent: number, prec: number, forceDot: boolean, upper: boolean): string {
  const { digits, E } = getExpDigits(mantissa, exponent, prec);
  const first = digits[0];
  const rest = digits.slice(1);
  const mantissaPart = prec > 0 ? first + '.' + rest : first + (forceDot ? '.' : '');
  return mantissaPart + formatExponent(E, upper);
}

function stripZeros(s: string): string {
  if (!s.includes('.')) return s;
  s = s.replace(/0+$/, '');
  if (s.endsWith('.')) s = s.slice(0, -1);
  return s;
}

function gBody(mantissa: bigint, exponent: number, precArg: number, hasHash: boolean, upper: boolean): string {
  const P = precArg === 0 ? 1 : precArg;
  const { digits, E } = getExpDigits(mantissa, exponent, P - 1);
  let raw: string;
  let isExp: boolean;
  if (P > E && E >= -4) {
    raw = fBody(mantissa, exponent, P - 1 - E, true);
    isExp = false;
  } else {
    const first = digits[0];
    const rest = digits.slice(1);
    const mantissaPart = first + '.' + rest;
    raw = mantissaPart + formatExponent(E, upper);
    isExp = true;
  }
  if (hasHash) return raw;
  if (isExp) {
    const eIdx = raw.search(/[eE]/);
    const mant = stripZeros(raw.slice(0, eIdx));
    return mant + raw.slice(eIdx);
  }
  return stripZeros(raw);
}

function getSign(negative: boolean, flags: Set<string>, isNaNVal: boolean): string {
  if (isNaNVal) return '';
  if (negative) return '-';
  if (flags.has('+')) return '+';
  if (flags.has(' ')) return ' ';
  return '';
}

function composePadded(prefix: string, body: string, width: number, padZero: boolean, leftAlign: boolean): string {
  const total = prefix + body;
  if (total.length >= width) return total;
  const padLen = width - total.length;
  if (leftAlign) return total + ' '.repeat(padLen);
  if (padZero) return prefix + '0'.repeat(padLen) + body;
  return ' '.repeat(padLen) + total;
}

// ---- conversions --------------------------------------------------------

function intDigits(magnitude: bigint, precision: number | undefined): string {
  if (precision === undefined) return magnitude.toString();
  if (precision === 0 && magnitude === 0n) return '';
  return padLeft(magnitude.toString(), precision);
}

function formatInt(
  flags: Set<string>,
  width: number,
  precision: number | undefined,
  precisionGiven: boolean,
  leftAlign: boolean,
  arg: number | bigint
): string {
  const big = typeof arg === 'bigint' ? arg : BigInt(arg);
  const negative = big < 0n;
  const magnitude = negative ? -big : big;
  const digits = intDigits(magnitude, precision);
  const sign = getSign(negative, flags, false);
  const padZero = flags.has('0') && !leftAlign && !precisionGiven;
  return composePadded(sign, digits, width, padZero, leftAlign);
}

function formatIntBase(
  conv: string,
  flags: Set<string>,
  width: number,
  precision: number | undefined,
  precisionGiven: boolean,
  leftAlign: boolean,
  arg: number | bigint
): string {
  const big = typeof arg === 'bigint' ? arg : BigInt(arg);
  let digits = conv === 'o' ? big.toString(8) : big.toString(16);
  if (conv === 'X') digits = digits.toUpperCase();
  if (precisionGiven) {
    if (precision === 0 && big === 0n) digits = '';
    else digits = padLeft(digits, precision as number);
  }
  let prefix = '';
  if (flags.has('#')) {
    if (conv === 'o') {
      if (digits.length === 0 || digits[0] !== '0') digits = '0' + digits;
    } else if (big !== 0n) {
      prefix = conv === 'x' ? '0x' : '0X';
    }
  }
  const padZero = flags.has('0') && !leftAlign && !precisionGiven;
  return composePadded(prefix, digits, width, padZero, leftAlign);
}

function formatFloat(
  conv: string,
  flags: Set<string>,
  width: number,
  precision: number | undefined,
  leftAlign: boolean,
  arg: number
): string {
  const upper = conv === 'E' || conv === 'F' || conv === 'G';
  const base = conv.toLowerCase();
  const hasHash = flags.has('#');
  const isNaNVal = Number.isNaN(arg);
  const negative = !isNaNVal && (arg < 0 || Object.is(arg, -0));
  let bodyText: string;
  let nonFinite = false;
  if (isNaNVal) {
    bodyText = upper ? 'NAN' : 'nan';
    nonFinite = true;
  } else if (!isFinite(arg)) {
    bodyText = upper ? 'INF' : 'inf';
    nonFinite = true;
  } else {
    const { mantissa, exponent } = decompose(Math.abs(arg));
    const prec = precision ?? 6;
    if (base === 'f') bodyText = fBody(mantissa, exponent, prec, hasHash);
    else if (base === 'e') bodyText = eBody(mantissa, exponent, prec, hasHash, upper);
    else bodyText = gBody(mantissa, exponent, prec, hasHash, upper);
  }
  const sign = getSign(negative, flags, isNaNVal);
  const padZero = flags.has('0') && !leftAlign && !nonFinite;
  return composePadded(sign, bodyText, width, padZero, leftAlign);
}

function formatString(width: number, precision: number | undefined, leftAlign: boolean, arg: string): string {
  const s = precision !== undefined ? arg.slice(0, precision) : arg;
  return composePadded('', s, width, false, leftAlign);
}

function formatChar(width: number, leftAlign: boolean, arg: string): string {
  return composePadded('', arg, width, false, leftAlign);
}

// ---- main entry -----------------------------------------------------

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let result = '';
  let argIndex = 0;
  const re = /%([-+0# ]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc%])/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(fmt)) !== null) {
    result += fmt.slice(lastIndex, m.index);
    lastIndex = re.lastIndex;
    const [, flagsStr, widthStr, precStr, conv] = m;
    if (conv === '%') {
      result += '%';
      continue;
    }
    const flags = new Set(flagsStr.split('').filter((c) => c !== ''));
    const width = widthStr ? parseInt(widthStr, 10) : 0;
    const precisionGiven = precStr !== undefined;
    const precision = precisionGiven ? (precStr === '' ? 0 : parseInt(precStr, 10)) : undefined;
    const leftAlign = flags.has('-');
    const arg = args[argIndex++];

    switch (conv) {
      case 'd':
      case 'i':
        result += formatInt(flags, width, precision, precisionGiven, leftAlign, arg as number | bigint);
        break;
      case 'x':
      case 'X':
      case 'o':
        result += formatIntBase(conv, flags, width, precision, precisionGiven, leftAlign, arg as number | bigint);
        break;
      case 'e':
      case 'E':
      case 'f':
      case 'F':
      case 'g':
      case 'G':
        result += formatFloat(conv, flags, width, precision, leftAlign, arg as number);
        break;
      case 's':
        result += formatString(width, precision, leftAlign, arg as string);
        break;
      case 'c':
        result += formatChar(width, leftAlign, arg as string);
        break;
    }
  }
  result += fmt.slice(lastIndex);
  return result;
}
