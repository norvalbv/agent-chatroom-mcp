type Flags = Set<string>;

function decompose(v: number): { m: bigint; e: number } {
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setFloat64(0, Math.abs(v));
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  const mantHi = hi & 0xfffff;
  const mant = (BigInt(mantHi) << 32n) | BigInt(lo);
  if (expBits === 0) {
    return { m: mant, e: -1074 };
  }
  return { m: mant | (1n << 52n), e: expBits - 1075 };
}

function toFraction(m: bigint, e: number): { N: bigint; D: bigint } {
  if (e >= 0) return { N: m << BigInt(e), D: 1n };
  return { N: m, D: 1n << BigInt(-e) };
}

function scaleBy10(N: bigint, D: bigint, k: number): [bigint, bigint] {
  if (k >= 0) return [N * 10n ** BigInt(k), D];
  return [N, D * 10n ** BigInt(-k)];
}

function roundDiv(num: bigint, den: bigint): bigint {
  let q = num / den;
  const r = num % den;
  const twice = r * 2n;
  if (twice > den) q += 1n;
  else if (twice === den && q % 2n === 1n) q += 1n;
  return q;
}

function fixedRound(N: bigint, D: bigint, p: number): bigint {
  const [num, den] = scaleBy10(N, D, p);
  return roundDiv(num, den);
}

function eStyleDigits(m: bigint, e: number, sig: number): { digits: string; E: number } {
  if (m === 0n) return { digits: '0'.repeat(sig), E: 0 };
  const { N, D } = toFraction(m, e);
  let E = Math.floor(e * Math.log10(2) + Math.log10(Number(m)));
  for (let iter = 0; iter < 8; iter++) {
    const k = sig - 1 - E;
    const [num, den] = scaleBy10(N, D, k);
    const digits = roundDiv(num, den);
    const s = digits.toString();
    if (s.length > sig) {
      E += 1;
      continue;
    }
    if (s.length < sig) {
      E -= 1;
      continue;
    }
    return { digits: s, E };
  }
  throw new Error('unreachable');
}

function padNumeric(
  sign: string,
  prefix: string,
  digits: string,
  width: number,
  zeroFlag: boolean,
  leftAlign: boolean
): string {
  const core = sign + prefix + digits;
  if (core.length >= width) return core;
  const padLen = width - core.length;
  if (leftAlign) return core + ' '.repeat(padLen);
  if (zeroFlag) return sign + prefix + '0'.repeat(padLen) + digits;
  return ' '.repeat(padLen) + core;
}

function padText(text: string, width: number, leftAlign: boolean): string {
  if (text.length >= width) return text;
  const pad = ' '.repeat(width - text.length);
  return leftAlign ? text + pad : pad + text;
}

function signFor(negative: boolean, flags: Flags): string {
  if (negative) return '-';
  if (flags.has('+')) return '+';
  if (flags.has(' ')) return ' ';
  return '';
}

function formatDI(flags: Flags, width: number, precision: number | undefined, arg: number | bigint): string {
  const value: bigint = typeof arg === 'bigint' ? arg : BigInt(arg);
  const negative = value < 0n;
  const magnitude = negative ? -value : value;
  let digitStr = magnitude.toString();
  if (precision !== undefined) {
    if (precision === 0 && magnitude === 0n) digitStr = '';
    else digitStr = digitStr.padStart(precision, '0');
  }
  const sign = signFor(negative, flags);
  const zeroFlag = flags.has('0') && !flags.has('-') && precision === undefined;
  return padNumeric(sign, '', digitStr, width, zeroFlag, flags.has('-'));
}

function formatXXO(conv: string, flags: Flags, width: number, precision: number | undefined, arg: number | bigint): string {
  const value: bigint = typeof arg === 'bigint' ? arg : BigInt(arg);
  let digitStr = conv === 'o' ? value.toString(8) : value.toString(16);
  if (conv === 'X') digitStr = digitStr.toUpperCase();
  if (precision !== undefined) {
    if (precision === 0 && value === 0n) digitStr = '';
    else digitStr = digitStr.padStart(precision, '0');
  }
  let prefix = '';
  if (flags.has('#')) {
    if (conv === 'x' && value !== 0n) prefix = '0x';
    else if (conv === 'X' && value !== 0n) prefix = '0X';
    else if (conv === 'o') {
      if (digitStr.length === 0 || digitStr[0] !== '0') digitStr = '0' + digitStr;
    }
  }
  const zeroFlag = flags.has('0') && !flags.has('-') && precision === undefined;
  return padNumeric('', prefix, digitStr, width, zeroFlag, flags.has('-'));
}

function specialFloatText(num: number, conv: string): string {
  const upper = conv === conv.toUpperCase();
  if (Number.isNaN(num)) return upper ? 'NAN' : 'nan';
  return upper ? 'INF' : 'inf';
}

function formatEE(conv: string, flags: Flags, width: number, precision: number | undefined, arg: number): string {
  const num = arg;
  const negative = num < 0 || Object.is(num, -0);
  if (Number.isNaN(num)) {
    return padNumeric('', '', specialFloatText(num, conv), width, false, flags.has('-'));
  }
  if (!Number.isFinite(num)) {
    const sign = signFor(negative, flags);
    return padNumeric(sign, '', specialFloatText(num, conv), width, false, flags.has('-'));
  }
  const P = precision !== undefined ? precision : 6;
  const { m, e } = decompose(num);
  const { digits, E } = eStyleDigits(m, e, P + 1);
  const intDigit = digits[0];
  const fracDigits = digits.slice(1);
  const dot = P > 0 || flags.has('#') ? '.' : '';
  const expSign = E < 0 ? '-' : '+';
  const expAbs = Math.abs(E).toString().padStart(2, '0');
  const body = intDigit + dot + fracDigits + (conv === 'E' ? 'E' : 'e') + expSign + expAbs;
  const sign = signFor(negative, flags);
  const zeroFlag = flags.has('0') && !flags.has('-');
  return padNumeric(sign, '', body, width, zeroFlag, flags.has('-'));
}

function formatFF(conv: string, flags: Flags, width: number, precision: number | undefined, arg: number): string {
  const num = arg;
  const negative = num < 0 || Object.is(num, -0);
  if (Number.isNaN(num)) {
    return padNumeric('', '', specialFloatText(num, conv), width, false, flags.has('-'));
  }
  if (!Number.isFinite(num)) {
    const sign = signFor(negative, flags);
    return padNumeric(sign, '', specialFloatText(num, conv), width, false, flags.has('-'));
  }
  const P = precision !== undefined ? precision : 6;
  const { m, e } = decompose(num);
  const { N, D } = toFraction(m, e);
  const R = fixedRound(N, D, P);
  let intPart: string;
  let fracPart: string;
  if (P === 0) {
    intPart = R.toString();
    fracPart = '';
  } else {
    const s = R.toString().padStart(P + 1, '0');
    intPart = s.slice(0, s.length - P);
    fracPart = s.slice(s.length - P);
  }
  const dot = P > 0 || flags.has('#') ? '.' : '';
  const body = intPart + dot + fracPart;
  const sign = signFor(negative, flags);
  const zeroFlag = flags.has('0') && !flags.has('-');
  return padNumeric(sign, '', body, width, zeroFlag, flags.has('-'));
}

function formatGG(conv: string, flags: Flags, width: number, precision: number | undefined, arg: number): string {
  const num = arg;
  const negative = num < 0 || Object.is(num, -0);
  if (Number.isNaN(num)) {
    return padNumeric('', '', specialFloatText(num, conv), width, false, flags.has('-'));
  }
  if (!Number.isFinite(num)) {
    const sign = signFor(negative, flags);
    return padNumeric(sign, '', specialFloatText(num, conv), width, false, flags.has('-'));
  }
  let P = precision !== undefined ? precision : 6;
  if (P === 0) P = 1;
  const { m, e } = decompose(num);
  const { digits, E } = eStyleDigits(m, e, P);
  const expLetter = conv === 'G' ? 'E' : 'e';
  let body: string;
  if (P > E && E >= -4) {
    const fp = P - 1 - E;
    const { N, D } = toFraction(m, e);
    const R = fixedRound(N, D, fp);
    let intPart: string;
    let fracPart: string;
    if (fp === 0) {
      intPart = R.toString();
      fracPart = '';
    } else {
      const s = R.toString().padStart(fp + 1, '0');
      intPart = s.slice(0, s.length - fp);
      fracPart = s.slice(s.length - fp);
    }
    if (!flags.has('#')) {
      fracPart = fracPart.replace(/0+$/, '');
    }
    const dot = fracPart.length > 0 || flags.has('#') ? '.' : '';
    body = intPart + dot + fracPart;
  } else {
    const intDigit = digits[0];
    let fracDigits = digits.slice(1);
    if (!flags.has('#')) {
      fracDigits = fracDigits.replace(/0+$/, '');
    }
    const dot = fracDigits.length > 0 || flags.has('#') ? '.' : '';
    const expSign = E < 0 ? '-' : '+';
    const expAbs = Math.abs(E).toString().padStart(2, '0');
    body = intDigit + dot + fracDigits + expLetter + expSign + expAbs;
  }
  const sign = signFor(negative, flags);
  const zeroFlag = flags.has('0') && !flags.has('-');
  return padNumeric(sign, '', body, width, zeroFlag, flags.has('-'));
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let result = '';
  let argIndex = 0;
  let i = 0;
  const re = /%([-+0 #]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc%])/y;
  while (i < fmt.length) {
    if (fmt[i] !== '%') {
      result += fmt[i];
      i++;
      continue;
    }
    re.lastIndex = i;
    const m = re.exec(fmt);
    if (!m) {
      result += fmt[i];
      i++;
      continue;
    }
    const [full, flagsStr, widthStr, precStr, conv] = m;
    i += full.length;
    if (conv === '%') {
      result += '%';
      continue;
    }
    const flags: Flags = new Set(flagsStr.split(''));
    const width = widthStr ? parseInt(widthStr, 10) : 0;
    const precision = precStr !== undefined ? (precStr === '' ? 0 : parseInt(precStr, 10)) : undefined;
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
        result += formatEE(conv, flags, width, precision, arg as number);
        break;
      case 'f':
      case 'F':
        result += formatFF(conv, flags, width, precision, arg as number);
        break;
      case 'g':
      case 'G':
        result += formatGG(conv, flags, width, precision, arg as number);
        break;
      case 's': {
        let text = arg as string;
        if (precision !== undefined) text = text.slice(0, precision);
        result += padText(text, width, flags.has('-'));
        break;
      }
      case 'c':
        result += padText(arg as string, width, flags.has('-'));
        break;
    }
  }
  return result;
}
