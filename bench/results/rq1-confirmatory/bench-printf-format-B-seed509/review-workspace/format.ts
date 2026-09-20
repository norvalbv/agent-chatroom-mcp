type Flags = {
  minus: boolean;
  plus: boolean;
  space: boolean;
  zero: boolean;
  hash: boolean;
};

function decomposeDouble(abs: number): { mantissa: bigint; e: number } {
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setFloat64(0, abs);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const expField = (hi >>> 20) & 0x7ff;
  const mantHigh = BigInt(hi & 0xfffff);
  const mantLow = BigInt(lo >>> 0);
  const mantissaField = (mantHigh << 32n) | mantLow;
  if (expField === 0) {
    return { mantissa: mantissaField, e: -1074 };
  }
  return { mantissa: mantissaField | (1n << 52n), e: expField - 1075 };
}

// Computes round(mantissa * 2^e * 10^scale) using round-half-to-even, exactly.
function roundToScale(mantissa: bigint, e: number, scale: number): bigint {
  if (mantissa === 0n) return 0n;
  const e2 = e + scale;
  const p5 = scale;
  let n: bigint;
  let d: bigint;
  if (p5 >= 0) {
    const m = mantissa * 5n ** BigInt(p5);
    if (e2 >= 0) {
      return m * 2n ** BigInt(e2);
    }
    n = m;
    d = 2n ** BigInt(-e2);
  } else {
    const p5abs = 5n ** BigInt(-p5);
    if (e2 >= 0) {
      n = mantissa * 2n ** BigInt(e2);
      d = p5abs;
    } else {
      n = mantissa;
      d = 2n ** BigInt(-e2) * p5abs;
    }
  }
  const q = n / d;
  const r = n % d;
  const twiceR = r * 2n;
  if (twiceR < d) return q;
  if (twiceR > d) return q + 1n;
  return q % 2n === 0n ? q : q + 1n;
}

function getSignificantDigits(
  mantissa: bigint,
  e: number,
  sigDigits: number
): { digits: string; exponent: number } {
  if (mantissa === 0n) {
    return { digits: '0'.repeat(sigDigits), exponent: 0 };
  }
  let x = Math.floor(Math.log10(Number(mantissa)) + e * Math.log10(2));
  for (let attempt = 0; attempt < 20; attempt++) {
    const scale = sigDigits - 1 - x;
    const n = roundToScale(mantissa, e, scale);
    let digits = n.toString();
    if (digits.length === sigDigits) {
      return { digits, exponent: x };
    }
    if (digits.length === sigDigits + 1) {
      digits = digits.slice(0, sigDigits);
      return { digits, exponent: x + 1 };
    }
    x -= sigDigits - digits.length;
  }
  throw new Error('unreachable');
}

function formatFStyle(mantissa: bigint, e: number, p: number, hash: boolean): string {
  const n = roundToScale(mantissa, e, p);
  const scale = 10n ** BigInt(p);
  const intPart = (n / scale).toString();
  if (p === 0) return intPart + (hash ? '.' : '');
  const fracPart = (n % scale).toString().padStart(p, '0');
  return intPart + '.' + fracPart;
}

function formatEStyle(
  mantissa: bigint,
  e: number,
  p: number,
  hash: boolean,
  upperE: boolean
): string {
  const sig = p + 1;
  const { digits, exponent } = getSignificantDigits(mantissa, e, sig);
  const first = digits[0];
  const rest = digits.slice(1);
  const mantissaPart = first + (p > 0 ? '.' + rest : hash ? '.' : '');
  const expSign = exponent >= 0 ? '+' : '-';
  const expDigits = Math.abs(exponent).toString().padStart(2, '0');
  return mantissaPart + (upperE ? 'E' : 'e') + expSign + expDigits;
}

function trimTrailingZeros(raw: string, isF: boolean): string {
  if (isF) {
    if (!raw.includes('.')) return raw;
    let s = raw.replace(/0+$/, '');
    if (s.endsWith('.')) s = s.slice(0, -1);
    return s;
  }
  const idx = raw.search(/[eE]/);
  let mant = raw.slice(0, idx);
  const rest = raw.slice(idx);
  if (mant.includes('.')) {
    mant = mant.replace(/0+$/, '');
    if (mant.endsWith('.')) mant = mant.slice(0, -1);
  }
  return mant + rest;
}

function formatGStyle(
  mantissa: bigint,
  e: number,
  p0: number,
  hash: boolean,
  upperG: boolean
): string {
  const p = p0 === 0 ? 1 : p0;
  const { exponent: x } = getSignificantDigits(mantissa, e, p);
  let raw: string;
  let isF: boolean;
  if (p > x && x >= -4) {
    isF = true;
    raw = formatFStyle(mantissa, e, p - 1 - x, true);
  } else {
    isF = false;
    raw = formatEStyle(mantissa, e, p - 1, true, upperG);
  }
  if (!hash) {
    raw = trimTrailingZeros(raw, isF);
  }
  return raw;
}

function isNegativeNumber(x: number): boolean {
  return x < 0 || Object.is(x, -0);
}

function signChar(neg: boolean, flags: Flags): string {
  return neg ? '-' : flags.plus ? '+' : flags.space ? ' ' : '';
}

function pad(
  sign: string,
  prefix: string,
  digits: string,
  width: number,
  flags: Flags,
  zeroEligible: boolean
): string {
  const body = sign + prefix + digits;
  const len = body.length;
  if (len >= width) return body;
  const padLen = width - len;
  if (flags.minus) return body + ' '.repeat(padLen);
  if (flags.zero && zeroEligible) return sign + prefix + '0'.repeat(padLen) + digits;
  return ' '.repeat(padLen) + body;
}

function formatDI(
  flags: Flags,
  width: number,
  precision: number | null,
  value: number | bigint
): string {
  const n = typeof value === 'bigint' ? value : BigInt(value);
  const neg = n < 0n;
  const mag = neg ? -n : n;
  let digits = mag.toString();
  if (precision !== null) {
    if (precision === 0 && mag === 0n) {
      digits = '';
    } else if (digits.length < precision) {
      digits = digits.padStart(precision, '0');
    }
  }
  const sign = signChar(neg, flags);
  const zeroEligible = precision === null;
  return pad(sign, '', digits, width, flags, zeroEligible);
}

function formatXXO(
  conv: string,
  flags: Flags,
  width: number,
  precision: number | null,
  value: number | bigint
): string {
  const n = typeof value === 'bigint' ? value : BigInt(value);
  const base = conv === 'o' ? 8 : 16;
  let digits = n.toString(base);
  if (conv === 'X') digits = digits.toUpperCase();
  if (precision !== null) {
    if (precision === 0 && n === 0n) {
      digits = '';
    } else if (digits.length < precision) {
      digits = digits.padStart(precision, '0');
    }
  }
  let prefix = '';
  if (flags.hash) {
    if (conv === 'o') {
      if (digits.length === 0 || digits[0] !== '0') digits = '0' + digits;
    } else if (n !== 0n) {
      prefix = conv === 'X' ? '0X' : '0x';
    }
  }
  const zeroEligible = precision === null;
  return pad('', prefix, digits, width, flags, zeroEligible);
}

function formatFloat(
  conv: string,
  flags: Flags,
  width: number,
  precision: number | null,
  value: number
): string {
  const upper = conv === 'F' || conv === 'E' || conv === 'G';
  if (Number.isNaN(value)) {
    const text = upper ? 'NAN' : 'nan';
    return pad('', '', text, width, flags, false);
  }
  const neg = isNegativeNumber(value);
  const sign = signChar(neg, flags);
  if (!Number.isFinite(value)) {
    const text = upper ? 'INF' : 'inf';
    return pad(sign, '', text, width, flags, false);
  }
  const abs = Math.abs(value);
  const { mantissa, e } = decomposeDouble(abs);
  let digits: string;
  const p = precision === null ? 6 : precision;
  switch (conv) {
    case 'f':
    case 'F':
      digits = formatFStyle(mantissa, e, p, flags.hash);
      break;
    case 'e':
    case 'E':
      digits = formatEStyle(mantissa, e, p, flags.hash, conv === 'E');
      break;
    default:
      digits = formatGStyle(mantissa, e, p, flags.hash, conv === 'G');
      break;
  }
  return pad(sign, '', digits, width, flags, true);
}

function formatS(flags: Flags, width: number, precision: number | null, value: string): string {
  const text = precision !== null ? value.slice(0, precision) : value;
  return pad('', '', text, width, flags, false);
}

function formatC(flags: Flags, width: number, value: string): string {
  return pad('', '', value, width, flags, false);
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let result = '';
  let argIndex = 0;
  let i = 0;
  const n = fmt.length;
  while (i < n) {
    const c = fmt[i];
    if (c !== '%') {
      result += c;
      i++;
      continue;
    }
    i++;
    if (fmt[i] === '%') {
      result += '%';
      i++;
      continue;
    }
    const flags: Flags = { minus: false, plus: false, space: false, zero: false, hash: false };
    while (i < n) {
      const ch = fmt[i];
      if (ch === '-') flags.minus = true;
      else if (ch === '+') flags.plus = true;
      else if (ch === ' ') flags.space = true;
      else if (ch === '0') flags.zero = true;
      else if (ch === '#') flags.hash = true;
      else break;
      i++;
    }
    let widthStr = '';
    while (i < n && fmt[i] >= '0' && fmt[i] <= '9') {
      widthStr += fmt[i];
      i++;
    }
    const width = widthStr ? parseInt(widthStr, 10) : 0;
    let precision: number | null = null;
    if (fmt[i] === '.') {
      i++;
      let precStr = '';
      while (i < n && fmt[i] >= '0' && fmt[i] <= '9') {
        precStr += fmt[i];
        i++;
      }
      precision = precStr ? parseInt(precStr, 10) : 0;
    }
    const conv = fmt[i];
    i++;
    const arg = args[argIndex++];
    switch (conv) {
      case 'd':
      case 'i':
        result += formatDI(flags, width, precision, arg as number | bigint);
        break;
      case 'x':
      case 'X':
      case 'o':
        result += formatXXO(conv, flags, width, precision, arg as number | bigint);
        break;
      case 'e':
      case 'E':
      case 'f':
      case 'F':
      case 'g':
      case 'G':
        result += formatFloat(conv, flags, width, precision, arg as number);
        break;
      case 's':
        result += formatS(flags, width, precision, arg as string);
        break;
      case 'c':
        result += formatC(flags, width, arg as string);
        break;
      default:
        throw new Error(`unsupported conversion: ${conv}`);
    }
  }
  return result;
}
