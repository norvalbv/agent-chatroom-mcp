type Flags = {
  flagMinus: boolean;
  flagPlus: boolean;
  flagSpace: boolean;
  flagZero: boolean;
  flagHash: boolean;
  width: number;
  precision: number | null;
};

function pow2(n: bigint): bigint {
  return 2n ** n;
}

function pow5(n: bigint): bigint {
  return 5n ** n;
}

// Computes round(M * 2^E * 10^k) using exact rational arithmetic with
// round-half-to-even, for M >= 0 and any integers E, k.
function scaledRound(M: bigint, E: bigint, k: bigint): bigint {
  const ek = E + k;
  let numPow2 = 0n;
  let denPow2 = 0n;
  if (ek >= 0n) numPow2 = ek;
  else denPow2 = -ek;
  let numPow5 = 0n;
  let denPow5 = 0n;
  if (k >= 0n) numPow5 = k;
  else denPow5 = -k;
  const num = M * pow2(numPow2) * pow5(numPow5);
  const den = pow2(denPow2) * pow5(denPow5);
  let q = num / den;
  const r = num % den;
  const twice = r * 2n;
  if (twice > den) q += 1n;
  else if (twice === den && q % 2n !== 0n) q += 1n;
  return q;
}

function decompose(x: number): { isNeg: boolean; M: bigint; E: bigint } {
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setFloat64(0, x);
  const hi = view.getUint32(0);
  const lo = view.getUint32(4);
  const isNeg = hi >>> 31 === 1;
  const expBits = (hi >>> 20) & 0x7ff;
  const mantHi = hi & 0xfffff;
  const mantissa = (BigInt(mantHi) << 32n) | BigInt(lo);
  let M: bigint;
  let E: bigint;
  if (expBits === 0) {
    M = mantissa;
    E = -1074n;
  } else {
    M = mantissa | (1n << 52n);
    E = BigInt(expBits) - 1075n;
  }
  return { isNeg, M, E };
}

function computeSignificantDigits(
  M: bigint,
  E: bigint,
  sigDigits: number
): { digits: string; exp: number } {
  if (M === 0n) return { digits: '0'.repeat(sigDigits), exp: 0 };
  let exp0 = Math.floor(Math.log10(Number(M)) + Number(E) * Math.log10(2));
  let dStr = '';
  for (let iter = 0; iter < 10; iter++) {
    const k = BigInt(sigDigits - 1 - exp0);
    const d = scaledRound(M, E, k);
    dStr = d.toString();
    if (dStr.length === sigDigits) break;
    exp0 += dStr.length - sigDigits;
  }
  return { digits: dStr, exp: exp0 };
}

function computeFixedDigits(
  M: bigint,
  E: bigint,
  precision: number
): { intPart: string; fracPart: string } {
  if (M === 0n) return { intPart: '0', fracPart: '0'.repeat(precision) };
  const d = scaledRound(M, E, BigInt(precision));
  let s = d.toString();
  if (s.length <= precision) s = s.padStart(precision + 1, '0');
  const intPart = s.slice(0, s.length - precision) || '0';
  const fracPart = precision > 0 ? s.slice(s.length - precision) : '';
  return { intPart, fracPart };
}

function computeSign(isNeg: boolean, flagPlus: boolean, flagSpace: boolean): string {
  if (isNeg) return '-';
  if (flagPlus) return '+';
  if (flagSpace) return ' ';
  return '';
}

function padNumeric(
  sign: string,
  prefix: string,
  digits: string,
  width: number,
  flagMinus: boolean,
  zeroPad: boolean
): string {
  const bodyLen = sign.length + prefix.length + digits.length;
  if (bodyLen >= width) return sign + prefix + digits;
  const pad = width - bodyLen;
  if (flagMinus) return sign + prefix + digits + ' '.repeat(pad);
  if (zeroPad) return sign + prefix + '0'.repeat(pad) + digits;
  return ' '.repeat(pad) + sign + prefix + digits;
}

function padText(text: string, width: number, flagMinus: boolean): string {
  if (text.length >= width) return text;
  const pad = ' '.repeat(width - text.length);
  return flagMinus ? text + pad : pad + text;
}

function toBigIntValue(arg: number | bigint): bigint {
  return typeof arg === 'bigint' ? arg : BigInt(arg as number);
}

function formatE(
  value: number,
  precision: number,
  upper: boolean,
  flagHash: boolean,
  flagPlus: boolean,
  flagSpace: boolean
): { sign: string; body: string } {
  const { isNeg, M, E } = decompose(value);
  const sig = computeSignificantDigits(M, E, precision + 1);
  const digits = sig.digits;
  const exp = sig.exp;
  const frac = digits.slice(1);
  const mantissa = digits[0] + (precision > 0 ? '.' + frac : flagHash ? '.' : '');
  const expSign = exp < 0 ? '-' : '+';
  const expAbs = Math.abs(exp).toString().padStart(2, '0');
  const body = mantissa + (upper ? 'E' : 'e') + expSign + expAbs;
  const sign = computeSign(isNeg, flagPlus, flagSpace);
  return { sign, body };
}

function formatF(
  value: number,
  precision: number,
  flagHash: boolean,
  flagPlus: boolean,
  flagSpace: boolean
): { sign: string; body: string } {
  const { isNeg, M, E } = decompose(value);
  const { intPart, fracPart } = computeFixedDigits(M, E, precision);
  const body = intPart + (precision > 0 ? '.' + fracPart : flagHash ? '.' : '');
  const sign = computeSign(isNeg, flagPlus, flagSpace);
  return { sign, body };
}

function formatG(
  value: number,
  precision: number | null,
  upper: boolean,
  flagHash: boolean,
  flagPlus: boolean,
  flagSpace: boolean
): { sign: string; body: string } {
  const pSpec = precision === null ? 6 : precision;
  const P = pSpec === 0 ? 1 : pSpec;
  const { isNeg, M, E } = decompose(value);
  const { digits, exp: X } = computeSignificantDigits(M, E, P);
  let body: string;
  if (P > X && X >= -4) {
    let intPart: string;
    let fracPart: string;
    if (X >= 0) {
      intPart = digits.slice(0, X + 1);
      fracPart = digits.slice(X + 1);
    } else {
      intPart = '0';
      fracPart = '0'.repeat(-X - 1) + digits;
    }
    if (!flagHash) fracPart = fracPart.replace(/0+$/, '');
    body = intPart + (fracPart.length > 0 ? '.' + fracPart : flagHash ? '.' : '');
  } else {
    let frac = digits.slice(1);
    if (!flagHash) frac = frac.replace(/0+$/, '');
    const mantissa = digits[0] + (frac.length > 0 ? '.' + frac : flagHash ? '.' : '');
    const expSign = X < 0 ? '-' : '+';
    const expAbs = Math.abs(X).toString().padStart(2, '0');
    body = mantissa + (upper ? 'E' : 'e') + expSign + expAbs;
  }
  const sign = computeSign(isNeg, flagPlus, flagSpace);
  return { sign, body };
}

function formatOne(conv: string, arg: number | bigint | string, flags: Flags): string {
  const { flagMinus, flagPlus, flagSpace, flagZero, flagHash, width, precision } = flags;

  if (conv === 'd' || conv === 'i') {
    const value = toBigIntValue(arg as number | bigint);
    const neg = value < 0n;
    const abs = neg ? -value : value;
    let digits = abs.toString(10);
    if (precision !== null) {
      digits = precision === 0 && abs === 0n ? '' : digits.padStart(precision, '0');
    }
    const sign = neg ? '-' : flagPlus ? '+' : flagSpace ? ' ' : '';
    const effectiveZero = flagZero && !flagMinus && precision === null;
    return padNumeric(sign, '', digits, width, flagMinus, effectiveZero);
  }

  if (conv === 'x' || conv === 'X') {
    const upper = conv === 'X';
    const absVal = toBigIntValue(arg as number | bigint);
    let digits = absVal.toString(16);
    if (upper) digits = digits.toUpperCase();
    if (precision !== null) {
      digits = precision === 0 && absVal === 0n ? '' : digits.padStart(precision, '0');
    }
    let prefix = '';
    if (flagHash && absVal !== 0n) prefix = upper ? '0X' : '0x';
    const effectiveZero = flagZero && !flagMinus && precision === null;
    return padNumeric('', prefix, digits, width, flagMinus, effectiveZero);
  }

  if (conv === 'o') {
    const absVal = toBigIntValue(arg as number | bigint);
    let digits = absVal.toString(8);
    if (precision !== null) {
      digits = precision === 0 && absVal === 0n ? '' : digits.padStart(precision, '0');
    }
    if (flagHash) {
      if (digits === '' || digits[0] !== '0') digits = '0' + digits;
    }
    const effectiveZero = flagZero && !flagMinus && precision === null;
    return padNumeric('', '', digits, width, flagMinus, effectiveZero);
  }

  if (
    conv === 'e' ||
    conv === 'E' ||
    conv === 'f' ||
    conv === 'F' ||
    conv === 'g' ||
    conv === 'G'
  ) {
    const value = arg as number;
    const upperConv = conv === 'E' || conv === 'F' || conv === 'G';
    if (Number.isNaN(value)) {
      const text = upperConv ? 'NAN' : 'nan';
      return padNumeric('', '', text, width, flagMinus, false);
    }
    if (!Number.isFinite(value)) {
      const isNeg = value < 0;
      const text = upperConv ? 'INF' : 'inf';
      const sign = isNeg ? '-' : flagPlus ? '+' : flagSpace ? ' ' : '';
      return padNumeric(sign, '', text, width, flagMinus, false);
    }
    let sign: string;
    let body: string;
    if (conv === 'e' || conv === 'E') {
      const r = formatE(value, precision === null ? 6 : precision, conv === 'E', flagHash, flagPlus, flagSpace);
      sign = r.sign;
      body = r.body;
    } else if (conv === 'f' || conv === 'F') {
      const r = formatF(value, precision === null ? 6 : precision, flagHash, flagPlus, flagSpace);
      sign = r.sign;
      body = r.body;
    } else {
      const r = formatG(value, precision, conv === 'G', flagHash, flagPlus, flagSpace);
      sign = r.sign;
      body = r.body;
    }
    const effectiveZero = flagZero && !flagMinus;
    return padNumeric(sign, '', body, width, flagMinus, effectiveZero);
  }

  if (conv === 's') {
    let s = arg as string;
    if (precision !== null) s = s.slice(0, precision);
    return padText(s, width, flagMinus);
  }

  if (conv === 'c') {
    return padText(arg as string, width, flagMinus);
  }

  throw new Error(`unsupported conversion: ${conv}`);
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let result = '';
  let argIndex = 0;
  let i = 0;
  const n = fmt.length;
  while (i < n) {
    const ch = fmt[i];
    if (ch !== '%') {
      result += ch;
      i++;
      continue;
    }
    let j = i + 1;
    let flagMinus = false;
    let flagPlus = false;
    let flagSpace = false;
    let flagZero = false;
    let flagHash = false;
    while (j < n) {
      const c = fmt[j];
      if (c === '-') flagMinus = true;
      else if (c === '+') flagPlus = true;
      else if (c === ' ') flagSpace = true;
      else if (c === '0') flagZero = true;
      else if (c === '#') flagHash = true;
      else break;
      j++;
    }
    let widthStr = '';
    while (j < n && fmt[j] >= '0' && fmt[j] <= '9') {
      widthStr += fmt[j];
      j++;
    }
    const width = widthStr === '' ? 0 : parseInt(widthStr, 10);
    let precision: number | null = null;
    if (fmt[j] === '.') {
      j++;
      let precStr = '';
      while (j < n && fmt[j] >= '0' && fmt[j] <= '9') {
        precStr += fmt[j];
        j++;
      }
      precision = precStr === '' ? 0 : parseInt(precStr, 10);
    }
    const conv = fmt[j];
    j++;
    i = j;
    if (conv === '%') {
      result += '%';
      continue;
    }
    const arg = args[argIndex++];
    result += formatOne(conv, arg, {
      flagMinus,
      flagPlus,
      flagSpace,
      flagZero,
      flagHash,
      width,
      precision,
    });
  }
  return result;
}
