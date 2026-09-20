type Flags = {
  minus: boolean;
  plus: boolean;
  space: boolean;
  zero: boolean;
  hash: boolean;
};

function roundDiv(n: bigint, d: bigint): bigint {
  const q = n / d;
  const r = n % d;
  const twiceR = r * 2n;
  if (twiceR < d) return q;
  if (twiceR > d) return q + 1n;
  return q % 2n === 0n ? q : q + 1n;
}

function decomposeToRational(x: number): { num: bigint; den: bigint } {
  if (x === 0) return { num: 0n, den: 1n };
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  const mantHigh = hi & 0xfffff;
  let mantissa = (BigInt(mantHigh) << 32n) | BigInt(lo);
  let exp: number;
  if (expBits === 0) {
    exp = -1074;
  } else {
    mantissa |= 1n << 52n;
    exp = expBits - 1075;
  }
  if (exp >= 0) {
    return { num: mantissa << BigInt(exp), den: 1n };
  }
  return { num: mantissa, den: 1n << BigInt(-exp) };
}

function padNumeric(sign: string, prefix: string, digits: string, width: number, flags: { minus: boolean; zero: boolean }): string {
  const bodyLen = sign.length + prefix.length + digits.length;
  if (bodyLen >= width) return sign + prefix + digits;
  const padLen = width - bodyLen;
  if (flags.minus) return sign + prefix + digits + ' '.repeat(padLen);
  if (flags.zero) return sign + prefix + '0'.repeat(padLen) + digits;
  return ' '.repeat(padLen) + sign + prefix + digits;
}

function padText(s: string, width: number, minus: boolean): string {
  if (s.length >= width) return s;
  const pad = ' '.repeat(width - s.length);
  return minus ? s + pad : pad + s;
}

function formatF(num: bigint, den: bigint, p: number, hash: boolean): string {
  const scaledNum = num * 10n ** BigInt(p);
  const rounded = roundDiv(scaledNum, den);
  let s = rounded.toString();
  if (s.length <= p) s = s.padStart(p + 1, '0');
  const intPart = p === 0 ? s : s.slice(0, s.length - p);
  const fracPart = p === 0 ? '' : s.slice(s.length - p);
  if (p === 0) return hash ? intPart + '.' : intPart;
  return intPart + '.' + fracPart;
}

function sigDigitsAndExp(num: bigint, den: bigint, sig: number, hintExp: number): { digits: string; exp: number } {
  if (num === 0n) {
    return { digits: '0'.repeat(sig), exp: 0 };
  }
  let E = hintExp;
  for (let iter = 0; iter < 30; iter++) {
    const k = sig - 1 - E;
    let scaledNum: bigint, scaledDen: bigint;
    if (k >= 0) {
      scaledNum = num * 10n ** BigInt(k);
      scaledDen = den;
    } else {
      scaledNum = num;
      scaledDen = den * 10n ** BigInt(-k);
    }
    const rounded = roundDiv(scaledNum, scaledDen);
    const s = rounded.toString();
    const diff = s.length - sig;
    if (diff === 0) return { digits: s, exp: E };
    if (diff === 1) {
      E += 1;
      return { digits: s.slice(0, sig), exp: E };
    }
    E += diff;
  }
  throw new Error('exponent search failed to converge');
}

function formatExpTail(exp: number, upper: boolean): string {
  const expSign = exp < 0 ? '-' : '+';
  let expDigits = Math.abs(exp).toString();
  if (expDigits.length < 2) expDigits = expDigits.padStart(2, '0');
  return (upper ? 'E' : 'e') + expSign + expDigits;
}

function formatE(num: bigint, den: bigint, mag: number, p: number, hash: boolean, upper: boolean): string {
  const sig = p + 1;
  const hintExp = num === 0n ? 0 : Math.floor(Math.log10(mag));
  const { digits, exp } = sigDigitsAndExp(num, den, sig, hintExp);
  let mantissa = digits[0];
  if (p > 0) mantissa += '.' + digits.slice(1);
  else if (hash) mantissa += '.';
  return mantissa + formatExpTail(exp, upper);
}

function digitsToFixed(digits: string, X: number, fprec: number, hash: boolean): string {
  let intPart: string, frac: string;
  if (X >= 0) {
    if (digits.length > X + 1) {
      intPart = digits.slice(0, X + 1);
      frac = digits.slice(X + 1);
    } else {
      intPart = digits.padEnd(X + 1, '0');
      frac = '';
    }
  } else {
    intPart = '0';
    frac = '0'.repeat(-X - 1) + digits;
  }
  if (frac.length < fprec) frac = frac.padEnd(fprec, '0');
  frac = frac.slice(0, fprec);
  if (fprec > 0) return intPart + '.' + frac;
  return hash ? intPart + '.' : intPart;
}

function stripTrailingZeros(s: string): string {
  const eIdx = s.search(/[eE]/);
  const mantissaPart = eIdx === -1 ? s : s.slice(0, eIdx);
  const rest = eIdx === -1 ? '' : s.slice(eIdx);
  if (!mantissaPart.includes('.')) return s;
  let m = mantissaPart.replace(/0+$/, '');
  if (m.endsWith('.')) m = m.slice(0, -1);
  return m + rest;
}

function formatG(num: bigint, den: bigint, mag: number, P: number, hash: boolean, upper: boolean): string {
  const hintExp = num === 0n ? 0 : Math.floor(Math.log10(mag));
  const { digits, exp: X } = sigDigitsAndExp(num, den, P, hintExp);
  let body: string;
  if (P > X && X >= -4) {
    const fprec = P - 1 - X;
    body = digitsToFixed(digits, X, fprec, hash);
  } else {
    let mantissa = digits[0];
    if (P > 1) mantissa += '.' + digits.slice(1);
    else if (hash) mantissa += '.';
    body = mantissa + formatExpTail(X, upper);
  }
  if (!hash) body = stripTrailingZeros(body);
  return body;
}

function getSign(x: number, flags: Flags): string {
  const negative = x < 0 || Object.is(x, -0);
  if (negative) return '-';
  if (flags.plus) return '+';
  if (flags.space) return ' ';
  return '';
}

function formatFloat(x: number, conv: string, flags: Flags, width: number, precision: number | undefined): string {
  const isUpper = conv === conv.toUpperCase();

  if (Number.isNaN(x)) {
    const body = isUpper ? 'NAN' : 'nan';
    return padNumeric('', '', body, width, { minus: flags.minus, zero: false });
  }

  const sign = getSign(x, flags);

  if (!Number.isFinite(x)) {
    const body = isUpper ? 'INF' : 'inf';
    return padNumeric(sign, '', body, width, { minus: flags.minus, zero: false });
  }

  const mag = Math.abs(x);
  const { num, den } = decomposeToRational(mag);

  let body: string;
  if (conv === 'f' || conv === 'F') {
    const p = precision === undefined ? 6 : precision;
    body = formatF(num, den, p, flags.hash);
  } else if (conv === 'e' || conv === 'E') {
    const p = precision === undefined ? 6 : precision;
    body = formatE(num, den, mag, p, flags.hash, isUpper);
  } else {
    let P = precision === undefined ? 6 : precision;
    if (P === 0) P = 1;
    body = formatG(num, den, mag, P, flags.hash, isUpper);
  }

  return padNumeric(sign, '', body, width, flags);
}

function toBigIntArg(arg: number | bigint | string): bigint {
  return typeof arg === 'bigint' ? arg : BigInt(arg as number);
}

function formatInt(arg: number | bigint | string, flags: Flags, width: number, precision: number | undefined): string {
  const n = toBigIntArg(arg);
  const neg = n < 0n;
  const mag = neg ? -n : n;
  let digits = mag.toString();
  if (precision !== undefined) {
    if (precision === 0 && mag === 0n) digits = '';
    else digits = digits.padStart(precision, '0');
  }
  const sign = neg ? '-' : flags.plus ? '+' : flags.space ? ' ' : '';
  const zero = flags.zero && precision === undefined;
  return padNumeric(sign, '', digits, width, { minus: flags.minus, zero });
}

function formatHexOct(arg: number | bigint | string, conv: string, flags: Flags, width: number, precision: number | undefined): string {
  const n = toBigIntArg(arg);
  const base = conv === 'o' ? 8 : 16;
  let baseDigits = n.toString(base);
  if (conv === 'X') baseDigits = baseDigits.toUpperCase();

  const digitsForPrecision = (p: number | undefined): string => {
    if (p === undefined) return baseDigits;
    if (p === 0 && n === 0n) return '';
    return baseDigits.padStart(p, '0');
  };

  let effPrecision = precision;
  let digits = digitsForPrecision(effPrecision);

  let prefix = '';
  if (flags.hash) {
    if (conv === 'x' || conv === 'X') {
      if (n !== 0n) prefix = conv === 'x' ? '0x' : '0X';
    } else {
      if (digits.length === 0 || digits[0] !== '0') {
        effPrecision = digits.length + 1;
        digits = digitsForPrecision(effPrecision);
      }
    }
  }

  const zero = flags.zero && precision === undefined;
  return padNumeric('', prefix, digits, width, { minus: flags.minus, zero });
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let argIndex = 0;
  let result = '';
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

    if (conv === 'd' || conv === 'i') {
      result += formatInt(arg, flags, width, precision);
    } else if (conv === 'x' || conv === 'X' || conv === 'o') {
      result += formatHexOct(arg, conv, flags, width, precision);
    } else if (conv === 'e' || conv === 'E' || conv === 'f' || conv === 'F' || conv === 'g' || conv === 'G') {
      result += formatFloat(Number(arg), conv, flags, width, precision);
    } else if (conv === 's') {
      let s = String(arg);
      if (precision !== undefined) s = s.slice(0, precision);
      result += padText(s, width, flags.minus);
    } else if (conv === 'c') {
      const s = String(arg);
      result += padText(s, width, flags.minus);
    }
  }
  result += fmt.slice(lastIndex);
  return result;
}
