interface Flags {
  minus: boolean;
  plus: boolean;
  space: boolean;
  zero: boolean;
  hash: boolean;
}

function decomposeDouble(abs: number): { intDigits: string; fracDigits: string } {
  if (abs === 0) return { intDigits: '0', fracDigits: '' };
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setFloat64(0, abs);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  const mantHigh = hi & 0xfffff;
  const mantissa = (BigInt(mantHigh) << 32n) | BigInt(lo);
  let M: bigint;
  let E: number;
  if (expBits === 0) {
    M = mantissa;
    E = -1074;
  } else {
    M = mantissa | (1n << 52n);
    E = expBits - 1075;
  }
  if (E >= 0) {
    const intVal = M << BigInt(E);
    return { intDigits: intVal.toString(), fracDigits: '' };
  }
  const k = -E;
  const numerator = M * 5n ** BigInt(k);
  let s = numerator.toString();
  if (s.length <= k) s = '0'.repeat(k - s.length + 1) + s;
  const intDigits = s.slice(0, s.length - k) || '0';
  const fracDigits = s.slice(s.length - k);
  return { intDigits, fracDigits };
}

function decideRoundUp(rest: string, lastKept: string): boolean {
  if (rest.length === 0) return false;
  const first = rest[0];
  if (first < '5') return false;
  if (first > '5') return true;
  for (let i = 1; i < rest.length; i++) {
    if (rest[i] !== '0') return true;
  }
  return parseInt(lastKept, 10) % 2 === 1;
}

function roundFrac(intDigits: string, fracDigits: string, fracLen: number): { intDigits: string; fracDigits: string } {
  if (fracLen >= fracDigits.length) {
    return { intDigits, fracDigits: fracDigits.padEnd(fracLen, '0') };
  }
  const keep = fracDigits.slice(0, fracLen);
  const rest = fracDigits.slice(fracLen);
  const lastKept = keep.length > 0 ? keep[keep.length - 1] : intDigits[intDigits.length - 1];
  if (!decideRoundUp(rest, lastKept)) {
    return { intDigits, fracDigits: keep };
  }
  const combinedStr = intDigits + keep;
  let resultStr = (BigInt(combinedStr) + 1n).toString();
  if (resultStr.length < combinedStr.length) {
    resultStr = resultStr.padStart(combinedStr.length, '0');
  }
  const newIntLen = intDigits.length + (resultStr.length - combinedStr.length);
  return { intDigits: resultStr.slice(0, newIntLen) || '0', fracDigits: resultStr.slice(newIntLen) };
}

function roundSignificant(intDigits: string, fracDigits: string, sig: number): { digits: string; exp: number } {
  const full = intDigits + fracDigits;
  const pointPos = intDigits.length;
  const firstNonZero = full.search(/[1-9]/);
  if (firstNonZero === -1) {
    return { digits: '0'.repeat(sig), exp: 0 };
  }
  const exp = pointPos - 1 - firstNonZero;
  let kept = full.slice(firstNonZero, firstNonZero + sig);
  if (kept.length < sig) kept = kept.padEnd(sig, '0');
  const rest = full.slice(firstNonZero + sig);
  const lastKept = kept[kept.length - 1];
  if (!decideRoundUp(rest, lastKept)) {
    return { digits: kept, exp };
  }
  let resultStr = (BigInt(kept) + 1n).toString();
  let finalExp = exp;
  if (resultStr.length > sig) {
    finalExp += 1;
    resultStr = resultStr.slice(0, sig);
  } else {
    resultStr = resultStr.padStart(sig, '0');
  }
  return { digits: resultStr, exp: finalExp };
}

function numSign(negative: boolean, isNaNVal: boolean, flags: Flags): string {
  if (isNaNVal) return '';
  if (negative) return '-';
  if (flags.plus) return '+';
  if (flags.space) return ' ';
  return '';
}

function padNumeric(sign: string, prefix: string, digits: string, width: number, flags: Flags, zeroAllowed: boolean): string {
  const core = prefix + digits;
  const total = sign + core;
  if (total.length >= width) return total;
  const padLen = width - total.length;
  if (flags.minus) return total + ' '.repeat(padLen);
  if (flags.zero && zeroAllowed) return sign + prefix + '0'.repeat(padLen) + digits;
  return ' '.repeat(padLen) + total;
}

function padStr(s: string, width: number, minus: boolean): string {
  if (s.length >= width) return s;
  const pad = ' '.repeat(width - s.length);
  return minus ? s + pad : pad + s;
}

function formatInfNan(n: number, isUpper: boolean, flags: Flags, width: number): string {
  const isNaNVal = Number.isNaN(n);
  const word = isNaNVal ? 'nan' : 'inf';
  const text = isUpper ? word.toUpperCase() : word;
  const negative = !isNaNVal && n < 0;
  const sign = numSign(negative, isNaNVal, flags);
  const total = sign + text;
  if (total.length >= width) return total;
  const pad = ' '.repeat(width - total.length);
  return flags.minus ? total + pad : pad + total;
}

function convertOne(
  conv: string,
  flags: Flags,
  width: number,
  precision: number | undefined,
  arg: number | bigint | string
): string {
  switch (conv) {
    case 'd':
    case 'i': {
      let isNeg: boolean;
      let magStr: string;
      if (typeof arg === 'bigint') {
        isNeg = arg < 0n;
        magStr = (isNeg ? -arg : arg).toString();
      } else {
        const n = arg as number;
        isNeg = n < 0;
        magStr = Math.abs(n).toString();
      }
      if (precision !== undefined) {
        if (precision === 0 && magStr === '0') magStr = '';
        else magStr = magStr.padStart(precision, '0');
      }
      const sign = isNeg ? '-' : flags.plus ? '+' : flags.space ? ' ' : '';
      return padNumeric(sign, '', magStr, width, flags, precision === undefined);
    }
    case 'x':
    case 'X':
    case 'o': {
      const big = typeof arg === 'bigint' ? arg : BigInt(Math.trunc(arg as number));
      let digitsStr = big.toString(conv === 'o' ? 8 : 16);
      if (conv === 'X') digitsStr = digitsStr.toUpperCase();
      if (precision !== undefined) {
        if (precision === 0 && big === 0n) digitsStr = '';
        else digitsStr = digitsStr.padStart(precision, '0');
      }
      let prefix = '';
      if (flags.hash) {
        if ((conv === 'x' || conv === 'X') && big !== 0n) prefix = conv === 'x' ? '0x' : '0X';
        if (conv === 'o' && (digitsStr === '' || digitsStr[0] !== '0')) digitsStr = '0' + digitsStr;
      }
      return padNumeric('', prefix, digitsStr, width, flags, precision === undefined);
    }
    case 'f':
    case 'F': {
      const n = arg as number;
      const isUpper = conv === 'F';
      if (!isFinite(n)) return formatInfNan(n, isUpper, flags, width);
      const negative = n < 0 || Object.is(n, -0);
      const abs = Math.abs(n);
      const prec = precision === undefined ? 6 : precision;
      const { intDigits, fracDigits } = decomposeDouble(abs);
      const rounded = roundFrac(intDigits, fracDigits, prec);
      const sign = numSign(negative, false, flags);
      const body = rounded.intDigits + (prec > 0 ? '.' + rounded.fracDigits : flags.hash ? '.' : '');
      return padNumeric(sign, '', body, width, flags, true);
    }
    case 'e':
    case 'E': {
      const n = arg as number;
      const isUpper = conv === 'E';
      if (!isFinite(n)) return formatInfNan(n, isUpper, flags, width);
      const negative = n < 0 || Object.is(n, -0);
      const abs = Math.abs(n);
      const prec = precision === undefined ? 6 : precision;
      const { intDigits, fracDigits } = decomposeDouble(abs);
      const { digits, exp } = roundSignificant(intDigits, fracDigits, prec + 1);
      const sign = numSign(negative, false, flags);
      const rest = digits.slice(1);
      const fracPart = prec > 0 ? '.' + rest : flags.hash ? '.' : '';
      const expSign = exp < 0 ? '-' : '+';
      const expDigits = Math.abs(exp).toString().padStart(2, '0');
      const body = digits[0] + fracPart + (isUpper ? 'E' : 'e') + expSign + expDigits;
      return padNumeric(sign, '', body, width, flags, true);
    }
    case 'g':
    case 'G': {
      const n = arg as number;
      const isUpper = conv === 'G';
      if (!isFinite(n)) return formatInfNan(n, isUpper, flags, width);
      const negative = n < 0 || Object.is(n, -0);
      const abs = Math.abs(n);
      const P = precision === undefined ? 6 : precision === 0 ? 1 : precision;
      const { intDigits, fracDigits } = decomposeDouble(abs);
      const { digits, exp: X } = roundSignificant(intDigits, fracDigits, P);
      const sign = numSign(negative, false, flags);
      let body: string;
      if (P > X && X >= -4) {
        const intPartLen = X + 1;
        let intStr: string;
        let fracStr: string;
        if (intPartLen <= 0) {
          intStr = '0';
          fracStr = '0'.repeat(-intPartLen) + digits;
        } else {
          intStr = digits.slice(0, intPartLen);
          fracStr = digits.slice(intPartLen);
        }
        if (!flags.hash) fracStr = fracStr.replace(/0+$/, '');
        body = intStr + (fracStr.length > 0 ? '.' + fracStr : flags.hash ? '.' : '');
      } else {
        let rest = digits.slice(1);
        if (!flags.hash) rest = rest.replace(/0+$/, '');
        const fracPart = rest.length > 0 ? '.' + rest : flags.hash ? '.' : '';
        const expSign = X < 0 ? '-' : '+';
        const expDigits = Math.abs(X).toString().padStart(2, '0');
        body = digits[0] + fracPart + (isUpper ? 'E' : 'e') + expSign + expDigits;
      }
      return padNumeric(sign, '', body, width, flags, true);
    }
    case 's': {
      let s = String(arg);
      if (precision !== undefined) s = s.slice(0, precision);
      return padStr(s, width, flags.minus);
    }
    case 'c': {
      const s = String(arg);
      return padStr(s, width, flags.minus);
    }
    default:
      throw new Error(`unsupported conversion: ${conv}`);
  }
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  const specRe = /^([-+0# ]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc%])/;
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
    const rest = fmt.slice(i + 1);
    const m = specRe.exec(rest);
    if (!m) {
      result += ch;
      i++;
      continue;
    }
    const [full, flagsStr, widthStr, precStr, conv] = m;
    i += 1 + full.length;
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
    const precision = precStr !== undefined ? (precStr === '' ? 0 : parseInt(precStr, 10)) : undefined;
    const arg = args[argIndex++];
    result += convertOne(conv, flags, width, precision, arg);
  }
  return result;
}
