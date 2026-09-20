type Arg = number | bigint | string;

interface Spec {
  flags: string;
  width: number;
  precision: number | null;
  conv: string;
}

function parseSpecs(fmt: string): Array<string | Spec> {
  const parts: Array<string | Spec> = [];
  const re = /%([-+ 0#]*)(\d*)(?:\.(\d*))?([dixXoeEfFgGsc%])/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(fmt)) !== null) {
    if (m.index > last) parts.push(fmt.slice(last, m.index));
    const [, flags, widthStr, precStr, conv] = m;
    parts.push({
      flags,
      width: widthStr ? parseInt(widthStr, 10) : 0,
      precision: precStr === undefined ? null : precStr === '' ? 0 : parseInt(precStr, 10),
      conv,
    });
    last = re.lastIndex;
  }
  if (last < fmt.length) parts.push(fmt.slice(last));
  return parts;
}

function decompose(abs: number): { mantissa: bigint; exp2: number } {
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setFloat64(0, abs);
  const hi = view.getUint32(0);
  const lo = view.getUint32(4);
  const exp = (hi >>> 20) & 0x7ff;
  const mantHi = hi & 0xfffff;
  const mantissaBits = (BigInt(mantHi) << 32n) | BigInt(lo >>> 0);
  if (exp === 0) {
    return { mantissa: mantissaBits, exp2: -1074 };
  }
  return { mantissa: mantissaBits | (1n << 52n), exp2: exp - 1075 };
}

function exactDecimal(abs: number): { numerator: bigint; kFrac: number } {
  if (abs === 0) return { numerator: 0n, kFrac: 0 };
  const { mantissa, exp2 } = decompose(abs);
  if (exp2 >= 0) {
    return { numerator: mantissa << BigInt(exp2), kFrac: 0 };
  }
  const k = -exp2;
  return { numerator: mantissa * 5n ** BigInt(k), kFrac: k };
}

function roundSignificant(numerator: bigint, len: number, sig: number): bigint {
  const dropCount = len - sig;
  if (dropCount <= 0) {
    return numerator * 10n ** BigInt(-dropCount);
  }
  const divisor = 10n ** BigInt(dropCount);
  const rem = numerator % divisor;
  const half = divisor / 2n;
  let q = numerator / divisor;
  if (rem > half || (rem === half && q % 2n === 1n)) q += 1n;
  return q;
}

function roundToFracDigits(numerator: bigint, kFrac: number, p: number): bigint {
  if (p >= kFrac) {
    return numerator * 10n ** BigInt(p - kFrac);
  }
  const dropCount = kFrac - p;
  const divisor = 10n ** BigInt(dropCount);
  const rem = numerator % divisor;
  const half = divisor / 2n;
  let q = numerator / divisor;
  if (rem > half || (rem === half && q % 2n === 1n)) q += 1n;
  return q;
}

function padNumber(
  signAndPrefix: string,
  rest: string,
  width: number,
  hasMinus: boolean,
  useZero: boolean
): string {
  const total = signAndPrefix.length + rest.length;
  if (total >= width) return signAndPrefix + rest;
  const padLen = width - total;
  if (hasMinus) return signAndPrefix + rest + ' '.repeat(padLen);
  if (useZero) return signAndPrefix + '0'.repeat(padLen) + rest;
  return ' '.repeat(padLen) + signAndPrefix + rest;
}

function padGeneric(str: string, width: number, hasMinus: boolean): string {
  if (str.length >= width) return str;
  const padLen = width - str.length;
  return hasMinus ? str + ' '.repeat(padLen) : ' '.repeat(padLen) + str;
}

function toBigInt(arg: Arg): bigint {
  return typeof arg === 'bigint' ? arg : BigInt(arg as number);
}

function formatIntLike(spec: Spec, arg: Arg): string {
  const hasMinus = spec.flags.includes('-');
  const hasPlus = spec.flags.includes('+');
  const hasSpace = spec.flags.includes(' ');
  const hasZero = spec.flags.includes('0');
  const hasHash = spec.flags.includes('#');
  const value = toBigInt(arg);

  if (spec.conv === 'd' || spec.conv === 'i') {
    const neg = value < 0n;
    const abs = neg ? -value : value;
    const precision = spec.precision === null ? 1 : spec.precision;
    let digits: string;
    if (abs === 0n && precision === 0) {
      digits = '';
    } else {
      digits = abs.toString().padStart(precision, '0');
    }
    const sign = neg ? '-' : hasPlus ? '+' : hasSpace ? ' ' : '';
    const useZero = hasZero && !hasMinus && spec.precision === null;
    return padNumber(sign, digits, spec.width, hasMinus, useZero);
  }

  // x, X, o
  const base = spec.conv === 'o' ? 8 : 16;
  const precision = spec.precision === null ? 1 : spec.precision;
  let digits: string;
  if (value === 0n && precision === 0) {
    digits = '';
  } else {
    digits = value.toString(base).padStart(precision, '0');
  }
  if (spec.conv === 'X') digits = digits.toUpperCase();

  let prefix = '';
  if (hasHash) {
    if (spec.conv === 'o') {
      if (digits === '' || digits[0] !== '0') digits = '0' + digits;
    } else if (value !== 0n) {
      prefix = spec.conv === 'X' ? '0X' : '0x';
    }
  }
  const useZero = hasZero && !hasMinus && spec.precision === null;
  return padNumber(prefix, digits, spec.width, hasMinus, useZero);
}

function specialFloatText(
  value: number,
  conv: string,
  hasPlus: boolean,
  hasSpace: boolean
): string | null {
  const upper = conv === conv.toUpperCase();
  if (Number.isNaN(value)) {
    return upper ? 'NAN' : 'nan';
  }
  if (!Number.isFinite(value)) {
    const neg = value < 0;
    const sign = neg ? '-' : hasPlus ? '+' : hasSpace ? ' ' : '';
    return sign + (upper ? 'INF' : 'inf');
  }
  return null;
}

function formatFloat(spec: Spec, arg: Arg): string {
  const value = arg as number;
  const hasMinus = spec.flags.includes('-');
  const hasPlus = spec.flags.includes('+');
  const hasSpace = spec.flags.includes(' ');
  const hasZero = spec.flags.includes('0');
  const hasHash = spec.flags.includes('#');
  const conv = spec.conv;

  const special = specialFloatText(value, conv, hasPlus, hasSpace);
  if (special !== null) {
    return padGeneric(special, spec.width, hasMinus);
  }

  const isNeg = value < 0 || Object.is(value, -0);
  const abs = Math.abs(value);
  const sign = isNeg ? '-' : hasPlus ? '+' : hasSpace ? ' ' : '';
  const { numerator, kFrac } = exactDecimal(abs);

  if (conv === 'e' || conv === 'E') {
    const p = spec.precision === null ? 6 : spec.precision;
    const upper = conv === 'E';
    let firstDigit: string;
    let fracDigits: string;
    let X: number;
    if (numerator === 0n) {
      firstDigit = '0';
      fracDigits = '0'.repeat(p);
      X = 0;
    } else {
      const numStr = numerator.toString();
      const len = numStr.length;
      const Xapprox = len - 1 - kFrac;
      const sig = p + 1;
      const q = roundSignificant(numerator, len, sig);
      const qs = q.toString();
      const exponentAdjust = qs.length - sig;
      const digitsFull = qs.slice(0, sig);
      X = Xapprox + exponentAdjust;
      firstDigit = digitsFull[0];
      fracDigits = digitsFull.slice(1);
    }
    const dotPart = p === 0 ? (hasHash ? '.' : '') : '.' + fracDigits;
    const expSign = X < 0 ? '-' : '+';
    const expAbs = Math.abs(X).toString().padStart(2, '0');
    const eLetter = upper ? 'E' : 'e';
    const rest = firstDigit + dotPart + eLetter + expSign + expAbs;
    const useZero = hasZero && !hasMinus;
    return padNumber(sign, rest, spec.width, hasMinus, useZero);
  }

  if (conv === 'f' || conv === 'F') {
    const p = spec.precision === null ? 6 : spec.precision;
    let intDigits: string;
    let fracDigits: string;
    if (numerator === 0n) {
      intDigits = '0';
      fracDigits = '0'.repeat(p);
    } else {
      const q = roundToFracDigits(numerator, kFrac, p);
      const digits = q.toString().padStart(p + 1, '0');
      if (p > 0) {
        intDigits = digits.slice(0, digits.length - p);
        fracDigits = digits.slice(digits.length - p);
      } else {
        intDigits = digits;
        fracDigits = '';
      }
    }
    const dotPart = p === 0 ? (hasHash ? '.' : '') : '.' + fracDigits;
    const rest = intDigits + dotPart;
    const useZero = hasZero && !hasMinus;
    return padNumber(sign, rest, spec.width, hasMinus, useZero);
  }

  // g, G
  const upper = conv === 'G';
  const P = spec.precision === null ? 6 : spec.precision === 0 ? 1 : spec.precision;

  let rest: string;
  if (numerator === 0n) {
    if (hasHash) {
      const fracDigits = '0'.repeat(P - 1);
      rest = P - 1 === 0 ? '0.' : '0.' + fracDigits;
    } else {
      rest = '0';
    }
  } else {
    const numStr = numerator.toString();
    const len = numStr.length;
    const Xapprox = len - 1 - kFrac;
    const sig = P;
    const q = roundSignificant(numerator, len, sig);
    const qs = q.toString();
    const exponentAdjust = qs.length - sig;
    const digitsFull = qs.slice(0, sig);
    const X = Xapprox + exponentAdjust;

    if (P > X && X >= -4) {
      // f style
      let intDigits: string;
      let fracDigits: string;
      if (X >= 0) {
        intDigits = digitsFull.slice(0, X + 1);
        fracDigits = digitsFull.slice(X + 1);
      } else {
        intDigits = '0';
        fracDigits = '0'.repeat(-X - 1) + digitsFull;
      }
      if (!hasHash) {
        fracDigits = fracDigits.replace(/0+$/, '');
      }
      const dotPart = fracDigits === '' ? (hasHash ? '.' : '') : '.' + fracDigits;
      rest = intDigits + dotPart;
    } else {
      // e style
      const firstDigit = digitsFull[0];
      let fracDigits = digitsFull.slice(1);
      if (!hasHash) {
        fracDigits = fracDigits.replace(/0+$/, '');
      }
      const dotPart = fracDigits === '' ? (hasHash ? '.' : '') : '.' + fracDigits;
      const expSign = X < 0 ? '-' : '+';
      const expAbs = Math.abs(X).toString().padStart(2, '0');
      const eLetter = upper ? 'E' : 'e';
      rest = firstDigit + dotPart + eLetter + expSign + expAbs;
    }
  }

  const useZero = hasZero && !hasMinus;
  return padNumber(sign, rest, spec.width, hasMinus, useZero);
}

function formatString(spec: Spec, arg: Arg): string {
  const hasMinus = spec.flags.includes('-');
  let str = arg as string;
  if (spec.conv === 's' && spec.precision !== null) {
    str = str.slice(0, spec.precision);
  }
  return padGeneric(str, spec.width, hasMinus);
}

export function format(fmt: string, ...args: Arg[]): string {
  const parts = parseSpecs(fmt);
  let argIndex = 0;
  const out: string[] = [];
  for (const part of parts) {
    if (typeof part === 'string') {
      out.push(part);
      continue;
    }
    if (part.conv === '%') {
      out.push('%');
      continue;
    }
    const arg = args[argIndex++];
    switch (part.conv) {
      case 'd':
      case 'i':
      case 'x':
      case 'X':
      case 'o':
        out.push(formatIntLike(part, arg));
        break;
      case 'e':
      case 'E':
      case 'f':
      case 'F':
      case 'g':
      case 'G':
        out.push(formatFloat(part, arg));
        break;
      case 's':
      case 'c':
        out.push(formatString(part, arg));
        break;
    }
  }
  return out.join('');
}
