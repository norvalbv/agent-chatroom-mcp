type Flags = {
  minus: boolean;
  plus: boolean;
  space: boolean;
  zero: boolean;
  hash: boolean;
};

function roundHalfEven(n: bigint, drop: number): bigint {
  if (drop <= 0) return n * 10n ** BigInt(-drop);
  const divisor = 10n ** BigInt(drop);
  const q = n / divisor;
  const r = n % divisor;
  const twice = r * 2n;
  if (twice > divisor) return q + 1n;
  if (twice < divisor) return q;
  return q % 2n === 0n ? q : q + 1n;
}

function decompose(x: number): { m: bigint; e: number } {
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setFloat64(0, x);
  const bits = dv.getBigUint64(0, false);
  const expBits = Number((bits >> 52n) & 0x7ffn);
  const mantissaBits = bits & 0xfffffffffffffn;
  if (expBits === 0) {
    return { m: mantissaBits, e: 1 - 1023 - 52 };
  }
  return { m: mantissaBits | (1n << 52n), e: expBits - 1023 - 52 };
}

function exactDecimalParts(absX: number): { intPart: string; fracPart: string } {
  if (absX === 0) return { intPart: '0', fracPart: '' };
  const { m, e } = decompose(absX);
  if (e >= 0) {
    const n = m << BigInt(e);
    return { intPart: n.toString(), fracPart: '' };
  }
  const k = -e;
  const n = m * 5n ** BigInt(k);
  let s = n.toString();
  if (s.length <= k) s = s.padStart(k + 1, '0');
  return { intPart: s.slice(0, s.length - k), fracPart: s.slice(s.length - k) };
}

function signFor(negative: boolean, flags: Flags): string {
  if (negative) return '-';
  if (flags.plus) return '+';
  if (flags.space) return ' ';
  return '';
}

function pad(sign: string, prefix: string, digits: string, width: number, flags: Flags, zeroOk: boolean): string {
  const body = sign + prefix + digits;
  if (body.length >= width) return body;
  const padLen = width - body.length;
  if (flags.minus) return body + ' '.repeat(padLen);
  if (flags.zero && zeroOk) return sign + prefix + '0'.repeat(padLen) + digits;
  return ' '.repeat(padLen) + body;
}

function toBigIntMagnitude(value: number | bigint): { neg: boolean; abs: bigint } {
  if (typeof value === 'bigint') {
    return value < 0n ? { neg: true, abs: -value } : { neg: false, abs: value };
  }
  const neg = value < 0;
  return { neg, abs: BigInt(Math.abs(value)) };
}

function convertDecimal(value: number | bigint, precision: number | null): { sign: string; digits: string } {
  return convertDecimalWith(value, precision, { minus: false, plus: false, space: false, zero: false, hash: false });
}

function convertDecimalWith(
  value: number | bigint,
  precision: number | null,
  flags: Flags
): { sign: string; digits: string } {
  const { neg, abs } = toBigIntMagnitude(value);
  let digits: string;
  if (precision !== null && precision === 0 && abs === 0n) {
    digits = '';
  } else {
    digits = abs.toString();
    if (precision !== null) digits = digits.padStart(precision, '0');
  }
  const sign = signFor(neg, flags);
  return { sign, digits };
}

function convertRadix(
  value: number | bigint,
  precision: number | null,
  flags: Flags,
  base: 16 | 8,
  upper: boolean
): { prefix: string; digits: string } {
  const abs = typeof value === 'bigint' ? value : BigInt(value);
  let digits: string;
  if (precision !== null && precision === 0 && abs === 0n) {
    digits = '';
  } else {
    digits = abs.toString(base);
    if (upper) digits = digits.toUpperCase();
    if (precision !== null) digits = digits.padStart(precision, '0');
  }
  let prefix = '';
  if (flags.hash) {
    if (base === 16) {
      if (abs !== 0n) prefix = upper ? '0X' : '0x';
    } else {
      if (digits.length === 0 || digits[0] !== '0') digits = '0' + digits;
    }
  }
  return { prefix, digits };
}

function roundSignificant(sigDigits: string, p: number): { digits: string; expAdjust: number } {
  const sigLen = sigDigits.length;
  const s = BigInt(sigDigits);
  const drop = sigLen - p;
  let r: bigint;
  if (drop <= 0) {
    r = s * 10n ** BigInt(-drop);
  } else {
    r = roundHalfEven(s, drop);
  }
  let rStr = r.toString();
  if (rStr.length < p) rStr = rStr.padStart(p, '0');
  let expAdjust = 0;
  if (rStr.length > p) {
    expAdjust = rStr.length - p;
    rStr = rStr.slice(0, p);
  }
  return { digits: rStr, expAdjust };
}

function getSignificant(absX: number, p: number): { digits: string; exponent: number } {
  if (absX === 0) {
    return { digits: '0'.repeat(p), exponent: 0 };
  }
  const { intPart, fracPart } = exactDecimalParts(absX);
  const full = intPart + fracPart;
  const pointPos = intPart.length;
  let firstIdx = 0;
  while (firstIdx < full.length && full[firstIdx] === '0') firstIdx++;
  const sigDigits = full.slice(firstIdx);
  let exponent = pointPos - 1 - firstIdx;
  const { digits, expAdjust } = roundSignificant(sigDigits, p);
  exponent += expAdjust;
  return { digits, exponent };
}

function formatFStyle(absX: number, precision: number, hash: boolean): string {
  const { intPart, fracPart } = exactDecimalParts(absX);
  const k = fracPart.length;
  const n = precision;
  const full = intPart + fracPart;
  const nBig = BigInt(full === '' ? '0' : full);
  let r: bigint;
  if (n <= k) {
    r = roundHalfEven(nBig, k - n);
  } else {
    r = nBig * 10n ** BigInt(n - k);
  }
  let rStr = r.toString();
  let intStr: string;
  let fracStr: string;
  if (n === 0) {
    intStr = rStr === '' ? '0' : rStr;
    fracStr = '';
  } else {
    if (rStr.length <= n) rStr = rStr.padStart(n + 1, '0');
    intStr = rStr.slice(0, rStr.length - n);
    fracStr = rStr.slice(rStr.length - n);
  }
  if (intStr === '') intStr = '0';
  return intStr + (n > 0 || hash ? '.' + fracStr : '');
}

function formatEStyle(absX: number, precision: number, hash: boolean, upperE: boolean): string {
  const p = precision + 1;
  const { digits, exponent } = getSignificant(absX, p);
  const first = digits[0];
  const rest = digits.slice(1);
  const expSign = exponent < 0 ? '-' : '+';
  let expDigits = Math.abs(exponent).toString();
  if (expDigits.length < 2) expDigits = expDigits.padStart(2, '0');
  return first + (precision > 0 || hash ? '.' + rest : '') + (upperE ? 'E' : 'e') + expSign + expDigits;
}

function stripTrailingZeros(s: string): string {
  if (!s.includes('.')) return s;
  let end = s.length;
  while (end > 0 && s[end - 1] === '0') end--;
  if (end > 0 && s[end - 1] === '.') end--;
  return s.slice(0, end);
}

function stripTrailingZerosExp(s: string, eChar: string): string {
  const idx = s.indexOf(eChar);
  const mantissa = s.slice(0, idx);
  const rest = s.slice(idx);
  return stripTrailingZeros(mantissa) + rest;
}

function convertFloat(
  conv: string,
  x: number,
  precisionGiven: number | null,
  flags: Flags
): { negative: boolean; unsigned: string; isSpecial: boolean } {
  const upper = conv === 'E' || conv === 'F' || conv === 'G';
  const negative = x < 0 || Object.is(x, -0);

  if (Number.isNaN(x)) {
    return { negative: false, unsigned: upper ? 'NAN' : 'nan', isSpecial: true };
  }
  if (!Number.isFinite(x)) {
    return { negative, unsigned: upper ? 'INF' : 'inf', isSpecial: true };
  }

  const absX = Math.abs(x);
  const kind = conv.toLowerCase();

  if (kind === 'f') {
    const precision = precisionGiven === null ? 6 : precisionGiven;
    return { negative, unsigned: formatFStyle(absX, precision, flags.hash), isSpecial: false };
  }
  if (kind === 'e') {
    const precision = precisionGiven === null ? 6 : precisionGiven;
    return { negative, unsigned: formatEStyle(absX, precision, flags.hash, upper), isSpecial: false };
  }
  // g / G
  const precisionArg = precisionGiven === null ? 6 : precisionGiven;
  const p = precisionArg === 0 ? 1 : precisionArg;
  const { exponent: xExp } = getSignificant(absX, p);
  let unsigned: string;
  if (p > xExp && xExp >= -4) {
    const precisionF = p - 1 - xExp;
    unsigned = formatFStyle(absX, precisionF, flags.hash);
    if (!flags.hash) unsigned = stripTrailingZeros(unsigned);
  } else {
    const precisionE = p - 1;
    unsigned = formatEStyle(absX, precisionE, flags.hash, upper);
    if (!flags.hash) unsigned = stripTrailingZerosExp(unsigned, upper ? 'E' : 'e');
  }
  return { negative, unsigned, isSpecial: false };
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let result = '';
  let argIndex = 0;
  let i = 0;
  const specRe = /^%([-+0 #]*)(\d*)(\.(\d*))?([diouxXeEfFgGsc%])/;

  while (i < fmt.length) {
    const ch = fmt[i];
    if (ch !== '%') {
      result += ch;
      i++;
      continue;
    }
    const m = specRe.exec(fmt.slice(i));
    if (!m) {
      result += ch;
      i++;
      continue;
    }
    const [full, flagStr, widthStr, precStr, precDigits, conv] = m;
    i += full.length;

    if (conv === '%') {
      result += '%';
      continue;
    }

    const flags: Flags = {
      minus: flagStr.includes('-'),
      plus: flagStr.includes('+'),
      space: flagStr.includes(' '),
      zero: flagStr.includes('0'),
      hash: flagStr.includes('#'),
    };
    const width = widthStr === '' ? 0 : parseInt(widthStr, 10);
    const precision: number | null = precStr === undefined ? null : precDigits === '' ? 0 : parseInt(precDigits, 10);

    const arg = args[argIndex++];

    if (conv === 'd' || conv === 'i') {
      const { sign, digits } = convertDecimalWith(arg as number | bigint, precision, flags);
      result += pad(sign, '', digits, width, flags, precision === null);
    } else if (conv === 'x' || conv === 'X' || conv === 'o') {
      const base = conv === 'o' ? 8 : 16;
      const upper = conv === 'X';
      const { prefix, digits } = convertRadix(arg as number | bigint, precision, flags, base, upper);
      result += pad('', prefix, digits, width, flags, precision === null);
    } else if (conv === 'e' || conv === 'E' || conv === 'f' || conv === 'F' || conv === 'g' || conv === 'G') {
      const { negative, unsigned, isSpecial } = convertFloat(conv, arg as number, precision, flags);
      const sign = negative ? '-' : flags.plus ? '+' : flags.space ? ' ' : '';
      result += pad(sign, '', unsigned, width, flags, !isSpecial);
    } else if (conv === 's') {
      let s = String(arg);
      if (precision !== null) s = s.slice(0, precision);
      const bodyFlags: Flags = { ...flags, zero: false };
      result += pad('', '', s, width, bodyFlags, false);
    } else if (conv === 'c') {
      const s = String(arg);
      const bodyFlags: Flags = { ...flags, zero: false };
      result += pad('', '', s, width, bodyFlags, false);
    }
  }

  return result;
}
