type Flags = {
  minus: boolean;
  plus: boolean;
  space: boolean;
  zero: boolean;
  hash: boolean;
};

function incrementDigitString(s: string): string {
  const arr = s.split('');
  let i = arr.length - 1;
  while (i >= 0) {
    if (arr[i] === '9') {
      arr[i] = '0';
      i--;
    } else {
      arr[i] = String(Number(arr[i]) + 1);
      return arr.join('');
    }
  }
  return '1' + arr.join('');
}

// Rounds a decimal digit string to n digits using round-half-to-even.
// Returns digits of length n, or n+1 if rounding overflowed (e.g. "999" -> "1000").
function roundDigits(digits: string, n: number): { digits: string; carry: boolean } {
  if (digits.length <= n) {
    return { digits: digits.padEnd(n, '0'), carry: false };
  }
  const kept = digits.slice(0, n);
  const rest = digits.slice(n);
  const firstRest = rest[0];
  let roundUp: boolean;
  if (firstRest > '5') {
    roundUp = true;
  } else if (firstRest < '5') {
    roundUp = false;
  } else {
    const restHasNonzeroAfter = /[1-9]/.test(rest.slice(1));
    if (restHasNonzeroAfter) {
      roundUp = true;
    } else {
      const lastKept = kept[n - 1];
      roundUp = Number(lastKept) % 2 === 1;
    }
  }
  if (!roundUp) {
    return { digits: kept, carry: false };
  }
  const incremented = incrementDigitString(kept);
  if (incremented.length > n) {
    return { digits: incremented, carry: true };
  }
  return { digits: incremented, carry: false };
}

function decomposeDouble(absValue: number): { intPart: string; fracPart: string } {
  if (absValue === 0) {
    return { intPart: '0', fracPart: '' };
  }
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setFloat64(0, absValue, false);
  const hi = dv.getUint32(0, false);
  const lo = dv.getUint32(4, false);
  const biasedExp = (hi >>> 20) & 0x7ff;
  const mantHi = hi & 0xfffff;
  let mantissa = (BigInt(mantHi) << 32n) | BigInt(lo);
  let exp2: number;
  if (biasedExp === 0) {
    exp2 = -1074;
  } else {
    mantissa |= 1n << 52n;
    exp2 = biasedExp - 1075;
  }
  if (exp2 >= 0) {
    const intVal = mantissa << BigInt(exp2);
    return { intPart: intVal.toString(), fracPart: '' };
  }
  const e = -exp2;
  const numerator = mantissa * 5n ** BigInt(e);
  let s = numerator.toString();
  if (s.length <= e) s = s.padStart(e + 1, '0');
  const intPart = s.slice(0, s.length - e);
  const fracPart = s.slice(s.length - e);
  return { intPart, fracPart };
}

// value = 0.digits * 10^exp, digits has no leading zeros (digits = '0', exp = 1 for zero).
function normalize(intPart: string, fracPart: string): { digits: string; exp: number } {
  const full = intPart + fracPart;
  const decPointPos = intPart.length;
  let k = 0;
  while (k < full.length && full[k] === '0') k++;
  if (k === full.length) {
    return { digits: '0', exp: 1 };
  }
  return { digits: full.slice(k), exp: decPointPos - k };
}

function roundFrac(intPart: string, fracPart: string, p: number): { intPart: string; fracPart: string } {
  if (fracPart.length <= p) {
    return { intPart, fracPart: fracPart.padEnd(p, '0') };
  }
  const combined = intPart + fracPart;
  const n = intPart.length + p;
  const { digits, carry } = roundDigits(combined, n);
  if (carry) {
    return { intPart: digits.slice(0, intPart.length + 1), fracPart: digits.slice(intPart.length + 1) };
  }
  return { intPart: digits.slice(0, intPart.length), fracPart: digits.slice(intPart.length) };
}

function roundExp(digits: string, exp: number, n: number): { digits: string; exp: number } {
  const { digits: rounded, carry } = roundDigits(digits, n);
  if (carry) {
    return { digits: rounded.slice(0, n), exp: exp + 1 };
  }
  return { digits: rounded, exp };
}

function buildFromNormalized(digits: string, exp2: number): { intPart: string; fracPart: string } {
  if (exp2 <= 0) {
    return { intPart: '0', fracPart: '0'.repeat(-exp2) + digits };
  }
  if (exp2 >= digits.length) {
    return { intPart: digits + '0'.repeat(exp2 - digits.length), fracPart: '' };
  }
  return { intPart: digits.slice(0, exp2), fracPart: digits.slice(exp2) };
}

function stripTrailingZeros(s: string): string {
  return s.replace(/0+$/, '');
}

function applyWidth(text: string, width: number, leftAlign: boolean): string {
  if (text.length >= width) return text;
  const pad = ' '.repeat(width - text.length);
  return leftAlign ? text + pad : pad + text;
}

function padNumeric(
  sign: string,
  prefix: string,
  digits: string,
  width: number,
  zeroFlag: boolean,
  leftAlign: boolean
): string {
  const body = sign + prefix + digits;
  if (body.length >= width) return body;
  const padLen = width - body.length;
  if (leftAlign) return body + ' '.repeat(padLen);
  if (zeroFlag) return sign + prefix + '0'.repeat(padLen) + digits;
  return ' '.repeat(padLen) + body;
}

function toBigIntArg(arg: number | bigint | string): bigint {
  return typeof arg === 'bigint' ? arg : BigInt(arg as number);
}

function convertDI(arg: number | bigint | string, flags: Flags, width: number, precision: number | undefined): string {
  const n = toBigIntArg(arg);
  const neg = n < 0n;
  const mag = neg ? -n : n;
  let digits = mag.toString();
  if (precision !== undefined) {
    if (precision === 0 && mag === 0n) {
      digits = '';
    } else {
      digits = digits.padStart(precision, '0');
    }
  }
  const sign = neg ? '-' : flags.plus ? '+' : flags.space ? ' ' : '';
  const zeroFlag = flags.zero && !flags.minus && precision === undefined;
  return padNumeric(sign, '', digits, width, zeroFlag, flags.minus);
}

function convertXXO(
  conv: 'x' | 'X' | 'o',
  arg: number | bigint | string,
  flags: Flags,
  width: number,
  precision: number | undefined
): string {
  const n = toBigIntArg(arg);
  let digits: string;
  if (conv === 'o') {
    digits = n.toString(8);
  } else {
    digits = n.toString(16);
    if (conv === 'X') digits = digits.toUpperCase();
  }
  if (precision !== undefined) {
    if (precision === 0 && n === 0n) {
      digits = '';
    } else {
      digits = digits.padStart(precision, '0');
    }
  }
  let prefix = '';
  if (flags.hash) {
    if (conv === 'o') {
      if (digits.length === 0 || digits[0] !== '0') {
        digits = '0' + digits;
      }
    } else if (n !== 0n) {
      prefix = conv === 'x' ? '0x' : '0X';
    }
  }
  const zeroFlag = flags.zero && !flags.minus && precision === undefined;
  return padNumeric('', prefix, digits, width, zeroFlag, flags.minus);
}

function convertEFG(
  conv: 'e' | 'E' | 'f' | 'F' | 'g' | 'G',
  arg: number,
  flags: Flags,
  width: number,
  precision: number | undefined
): string {
  const isUpper = conv === 'E' || conv === 'F' || conv === 'G';
  const isNaNVal = Number.isNaN(arg);
  const isNeg = !isNaNVal && (arg < 0 || Object.is(arg, -0));

  if (isNaNVal || !Number.isFinite(arg)) {
    const sign = isNaNVal ? '' : isNeg ? '-' : flags.plus ? '+' : flags.space ? ' ' : '';
    const word = isNaNVal ? (isUpper ? 'NAN' : 'nan') : isUpper ? 'INF' : 'inf';
    return applyWidth(sign + word, width, flags.minus);
  }

  const sign = isNeg ? '-' : flags.plus ? '+' : flags.space ? ' ' : '';
  const zeroFlag = flags.zero && !flags.minus;
  const { intPart, fracPart } = decomposeDouble(Math.abs(arg));

  if (conv === 'f' || conv === 'F') {
    const p = precision === undefined ? 6 : precision;
    const { intPart: ri, fracPart: rf } = roundFrac(intPart, fracPart, p);
    const fracSection = p > 0 ? '.' + rf : flags.hash ? '.' : '';
    const body = ri + fracSection;
    return padNumeric(sign, '', body, width, zeroFlag, flags.minus);
  }

  if (conv === 'e' || conv === 'E') {
    const p = precision === undefined ? 6 : precision;
    const n = p + 1;
    const { digits, exp } = normalize(intPart, fracPart);
    const { digits: rd, exp: rexp } = roundExp(digits, exp, n);
    const d0 = rd[0];
    const rest = rd.slice(1);
    const fracSection = p > 0 ? '.' + rest : flags.hash ? '.' : '';
    const expVal = rexp - 1;
    const expSign = expVal < 0 ? '-' : '+';
    const expAbs = String(Math.abs(expVal)).padStart(2, '0');
    const letter = conv === 'E' ? 'E' : 'e';
    const body = d0 + fracSection + letter + expSign + expAbs;
    return padNumeric(sign, '', body, width, zeroFlag, flags.minus);
  }

  // g, G
  const P = precision === undefined ? 6 : precision === 0 ? 1 : precision;
  const { digits, exp } = normalize(intPart, fracPart);
  const { digits: rd, exp: rexp } = roundExp(digits, exp, P);
  const X = rexp - 1;
  let body: string;
  if (P > X && X >= -4) {
    const { intPart: fi, fracPart: ff } = buildFromNormalized(rd, rexp);
    const fracKept = flags.hash ? ff : stripTrailingZeros(ff);
    const fracSection = fracKept.length > 0 ? '.' + fracKept : flags.hash ? '.' : '';
    body = fi + fracSection;
  } else {
    const d0 = rd[0];
    const rest = rd.slice(1);
    const restKept = flags.hash ? rest : stripTrailingZeros(rest);
    const fracSection = restKept.length > 0 ? '.' + restKept : flags.hash ? '.' : '';
    const expSign = X < 0 ? '-' : '+';
    const expAbs = String(Math.abs(X)).padStart(2, '0');
    const letter = conv === 'G' ? 'E' : 'e';
    body = d0 + fracSection + letter + expSign + expAbs;
  }
  return padNumeric(sign, '', body, width, zeroFlag, flags.minus);
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let result = '';
  let argIndex = 0;
  let lastEnd = 0;
  const re = /%([-+0 #]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc%])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(fmt)) !== null) {
    result += fmt.slice(lastEnd, m.index);
    lastEnd = re.lastIndex;
    const [, flagsStr, widthStr, precStr, conv] = m;

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

    switch (conv) {
      case 'd':
      case 'i':
        result += convertDI(arg, flags, width, precision);
        break;
      case 'x':
      case 'X':
      case 'o':
        result += convertXXO(conv, arg, flags, width, precision);
        break;
      case 'e':
      case 'E':
      case 'f':
      case 'F':
      case 'g':
      case 'G':
        result += convertEFG(conv, arg as number, flags, width, precision);
        break;
      case 's': {
        let s = arg as string;
        if (precision !== undefined) s = s.slice(0, precision);
        result += applyWidth(s, width, flags.minus);
        break;
      }
      case 'c':
        result += applyWidth(arg as string, width, flags.minus);
        break;
    }
  }
  result += fmt.slice(lastEnd);
  return result;
}
