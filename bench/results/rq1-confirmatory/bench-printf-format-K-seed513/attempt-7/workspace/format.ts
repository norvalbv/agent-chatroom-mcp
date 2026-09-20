type Arg = number | bigint | string;

interface DoubleParts {
  sign: -1 | 1;
  mantissa: bigint;
  exponent: number;
}

function decomposeDouble(x: number): DoubleParts {
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const sign: -1 | 1 = hi >>> 31 ? -1 : 1;
  const expBits = (hi >>> 20) & 0x7ff;
  const mantHi = hi & 0xfffff;
  let mantissa = (BigInt(mantHi) << 32n) | BigInt(lo);
  let exponent: number;
  if (expBits === 0) {
    exponent = -1074;
  } else {
    mantissa |= 1n << 52n;
    exponent = expBits - 1075;
  }
  return { sign, mantissa, exponent };
}

// Computes round(mantissa * 2^exponent * 10^k) with ties-to-even, exactly.
function roundExact(mantissa: bigint, exponent: number, k: number): bigint {
  if (mantissa === 0n) return 0n;
  const e2 = exponent + k;
  const e5 = k;
  let num = mantissa;
  let den = 1n;
  if (e5 >= 0) num *= 5n ** BigInt(e5);
  else den *= 5n ** BigInt(-e5);
  if (e2 >= 0) num *= 2n ** BigInt(e2);
  else den *= 2n ** BigInt(-e2);
  const q = num / den;
  const r = num % den;
  const twice = r * 2n;
  if (twice < den) return q;
  if (twice > den) return q + 1n;
  return q % 2n === 0n ? q : q + 1n;
}

function fStyleDigits(mantissa: bigint, exponent: number, precision: number): { intPart: string; fracPart: string } {
  const N = roundExact(mantissa, exponent, precision);
  const s = N.toString().padStart(precision + 1, '0');
  const cut = s.length - precision;
  return { intPart: s.slice(0, cut), fracPart: s.slice(cut) };
}

function eStyleDigits(mantissa: bigint, exponent: number, p: number): { digits: string; E: number } {
  if (mantissa === 0n) {
    return { digits: '0'.repeat(p + 1), E: 0 };
  }
  const log2val = exponent + Math.log2(Number(mantissa));
  let E = Math.floor(log2val * Math.log10(2));
  let digits = '';
  for (let iter = 0; iter < 8; iter++) {
    const N = roundExact(mantissa, exponent, p - E);
    digits = N.toString();
    if (digits.length === p + 1) break;
    E += digits.length - (p + 1);
  }
  return { digits, E };
}

function assembleNumeric(sign: string, prefix: string, digits: string, width: number, leftAlign: boolean, zeroPad: boolean): string {
  const bodyLen = sign.length + prefix.length + digits.length;
  if (bodyLen >= width) return sign + prefix + digits;
  const padLen = width - bodyLen;
  if (leftAlign) return sign + prefix + digits + ' '.repeat(padLen);
  if (zeroPad) return sign + prefix + '0'.repeat(padLen) + digits;
  return ' '.repeat(padLen) + sign + prefix + digits;
}

function padPlain(str: string, width: number, leftAlign: boolean): string {
  if (str.length >= width) return str;
  const padLen = width - str.length;
  return leftAlign ? str + ' '.repeat(padLen) : ' '.repeat(padLen) + str;
}

function signStringFloat(negative: boolean, hasPlus: boolean, hasSpace: boolean): string {
  if (negative) return '-';
  if (hasPlus) return '+';
  if (hasSpace) return ' ';
  return '';
}

function formatFloat(
  conv: 'e' | 'E' | 'f' | 'F' | 'g' | 'G',
  x: number,
  precisionGiven: number,
  hasHash: boolean,
  hasPlus: boolean,
  hasSpace: boolean
): { sign: string; body: string; isSpecial: boolean } {
  const upper = conv === 'E' || conv === 'F' || conv === 'G';

  if (Number.isNaN(x)) {
    return { sign: '', body: upper ? 'NAN' : 'nan', isSpecial: true };
  }
  if (!Number.isFinite(x)) {
    const negative = x < 0;
    return { sign: signStringFloat(negative, hasPlus, hasSpace), body: upper ? 'INF' : 'inf', isSpecial: true };
  }

  const { sign: signBit, mantissa, exponent } = decomposeDouble(x);
  const negative = signBit === -1;
  const sign = signStringFloat(negative, hasPlus, hasSpace);

  if (conv === 'f' || conv === 'F') {
    const precision = precisionGiven >= 0 ? precisionGiven : 6;
    const { intPart, fracPart } = fStyleDigits(mantissa, exponent, precision);
    let body: string;
    if (precision > 0) body = `${intPart}.${fracPart}`;
    else if (hasHash) body = `${intPart}.`;
    else body = intPart;
    return { sign, body, isSpecial: false };
  }

  if (conv === 'e' || conv === 'E') {
    const precision = precisionGiven >= 0 ? precisionGiven : 6;
    const { digits, E } = eStyleDigits(mantissa, exponent, precision);
    const leading = digits[0];
    const frac = digits.slice(1);
    let mantissaStr: string;
    if (precision > 0) mantissaStr = `${leading}.${frac}`;
    else if (hasHash) mantissaStr = `${leading}.`;
    else mantissaStr = leading;
    const expLetter = conv === 'E' ? 'E' : 'e';
    const expSign = E < 0 ? '-' : '+';
    const expAbs = Math.abs(E).toString().padStart(2, '0');
    return { sign, body: `${mantissaStr}${expLetter}${expSign}${expAbs}`, isSpecial: false };
  }

  // g, G
  let P = precisionGiven >= 0 ? precisionGiven : 6;
  if (P === 0) P = 1;
  const { digits: digits0, E: X } = eStyleDigits(mantissa, exponent, P - 1);

  let body: string;
  if (P > X && X >= -4) {
    const precision2 = P - 1 - X;
    const { intPart, fracPart } = fStyleDigits(mantissa, exponent, precision2);
    let frac = fracPart;
    if (!hasHash) frac = frac.replace(/0+$/, '');
    if (frac.length > 0) body = `${intPart}.${frac}`;
    else if (hasHash) body = `${intPart}.`;
    else body = intPart;
  } else {
    const leading = digits0[0];
    let frac = digits0.slice(1);
    if (!hasHash) frac = frac.replace(/0+$/, '');
    const expLetter = conv === 'G' ? 'E' : 'e';
    const expSign = X < 0 ? '-' : '+';
    const expAbs = Math.abs(X).toString().padStart(2, '0');
    let mantissaStr: string;
    if (frac.length > 0) mantissaStr = `${leading}.${frac}`;
    else if (hasHash) mantissaStr = `${leading}.`;
    else mantissaStr = leading;
    body = `${mantissaStr}${expLetter}${expSign}${expAbs}`;
  }

  return { sign, body, isSpecial: false };
}

export function format(fmt: string, ...args: Arg[]): string {
  const re = /%([-+0 #]*)(\d*)(\.(\d*))?([diouxXeEfFgGsc%])/g;
  let result = '';
  let lastIndex = 0;
  let argIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = re.exec(fmt)) !== null) {
    result += fmt.slice(lastIndex, match.index);
    lastIndex = re.lastIndex;

    const flags = match[1];
    const widthStr = match[2];
    const precisionGroup = match[3];
    const precisionDigits = match[4];
    const conv = match[5];

    if (conv === '%') {
      result += '%';
      continue;
    }

    const hasMinus = flags.includes('-');
    const hasPlus = flags.includes('+');
    const hasSpace = flags.includes(' ');
    const hasZero = flags.includes('0');
    const hasHash = flags.includes('#');
    const width = widthStr === '' ? 0 : parseInt(widthStr, 10);
    const precision = precisionGroup === undefined ? -1 : precisionDigits === '' ? 0 : parseInt(precisionDigits, 10);

    const arg = args[argIndex++];

    if (conv === 'd' || conv === 'i') {
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
      let digits: string;
      if (precision >= 0) {
        if (precision === 0 && magStr === '0') digits = '';
        else digits = magStr.padStart(precision, '0');
      } else {
        digits = magStr;
      }
      const sign = isNeg ? '-' : hasPlus ? '+' : hasSpace ? ' ' : '';
      const zeroPad = hasZero && !hasMinus && precision < 0;
      result += assembleNumeric(sign, '', digits, width, hasMinus, zeroPad);
      continue;
    }

    if (conv === 'x' || conv === 'X' || conv === 'o') {
      const bv = typeof arg === 'bigint' ? arg : BigInt(arg as number);
      let digitsRaw = bv.toString(conv === 'o' ? 8 : 16);
      if (conv === 'X') digitsRaw = digitsRaw.toUpperCase();
      let digits: string;
      if (precision >= 0) {
        if (precision === 0 && bv === 0n) digits = '';
        else digits = digitsRaw.padStart(precision, '0');
      } else {
        digits = digitsRaw;
      }
      let prefix = '';
      if (hasHash) {
        if (conv === 'o') {
          if (digits.length === 0 || digits[0] !== '0') digits = '0' + digits;
        } else if (bv !== 0n) {
          prefix = conv === 'x' ? '0x' : '0X';
        }
      }
      const zeroPad = hasZero && !hasMinus && precision < 0;
      result += assembleNumeric('', prefix, digits, width, hasMinus, zeroPad);
      continue;
    }

    if (conv === 'e' || conv === 'E' || conv === 'f' || conv === 'F' || conv === 'g' || conv === 'G') {
      const x = arg as number;
      const { sign, body, isSpecial } = formatFloat(conv, x, precision, hasHash, hasPlus, hasSpace);
      const zeroPad = hasZero && !hasMinus && !isSpecial;
      result += assembleNumeric(sign, '', body, width, hasMinus, zeroPad);
      continue;
    }

    if (conv === 's') {
      let str = arg as string;
      if (precision >= 0) str = str.slice(0, precision);
      result += padPlain(str, width, hasMinus);
      continue;
    }

    if (conv === 'c') {
      const str = arg as string;
      result += padPlain(str, width, hasMinus);
      continue;
    }
  }

  result += fmt.slice(lastIndex);
  return result;
}
