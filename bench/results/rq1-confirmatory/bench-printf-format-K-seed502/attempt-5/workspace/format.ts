type Flags = {
  minus: boolean;
  plus: boolean;
  space: boolean;
  zero: boolean;
  hash: boolean;
};

function roundHalfEven(N: bigint, diff: number): bigint {
  const divisor = 10n ** BigInt(diff);
  const q = N / divisor;
  const r = N % divisor;
  const twiceR = r * 2n;
  if (twiceR < divisor) return q;
  if (twiceR > divisor) return q + 1n;
  return q % 2n === 0n ? q : q + 1n;
}

function scaleToDigits(N: bigint, s: number, newScale: number): bigint {
  if (newScale >= s) return N * 10n ** BigInt(newScale - s);
  return roundHalfEven(N, s - newScale);
}

function exactDecimal(value: number): { N: bigint; s: number } {
  if (value === 0) return { N: 0n, s: 0 };
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setFloat64(0, value);
  const hi = view.getUint32(0);
  const lo = view.getUint32(4);
  const exp = (hi >>> 20) & 0x7ff;
  const mantHi = hi & 0xfffff;
  const mantissa = (BigInt(mantHi) << 32n) | BigInt(lo);
  let M: bigint;
  let E: number;
  if (exp === 0) {
    M = mantissa;
    E = -1074;
  } else {
    M = mantissa | (1n << 52n);
    E = exp - 1075;
  }
  if (E >= 0) {
    return { N: M << BigInt(E), s: 0 };
  }
  return { N: M * 5n ** BigInt(-E), s: -E };
}

function fBody(absValue: number, p: number, hashFlag: boolean): string {
  const { N, s } = exactDecimal(absValue);
  const scaled = scaleToDigits(N, s, p);
  const str = scaled.toString().padStart(p + 1, '0');
  const cut = str.length - p;
  const intPart = str.slice(0, cut);
  if (p > 0) return intPart + '.' + str.slice(cut);
  return intPart + (hashFlag ? '.' : '');
}

function buildMantissa(digitsStr: string, p: number, hashFlag: boolean): string {
  const first = digitsStr[0];
  const rest = digitsStr.slice(1);
  if (p > 0) return first + '.' + rest;
  return first + (hashFlag ? '.' : '');
}

function eDigitsAndExponent(absValue: number, target: number): { digitsStr: string; X: number } {
  if (absValue === 0) return { digitsStr: '0'.repeat(target), X: 0 };
  const { N, s } = exactDecimal(absValue);
  const Lstr = N.toString();
  const L = Lstr.length;
  let Nr: bigint;
  if (L <= target) Nr = N * 10n ** BigInt(target - L);
  else Nr = roundHalfEven(N, L - target);
  let digitsStr = Nr.toString();
  let X = L - 1 - s;
  if (digitsStr.length > target) {
    digitsStr = digitsStr.slice(0, target);
    X += 1;
  } else if (digitsStr.length < target) {
    digitsStr = digitsStr.padStart(target, '0');
  }
  return { digitsStr, X };
}

function eBody(absValue: number, p: number, hashFlag: boolean): { mantissa: string; exponent: number } {
  const { digitsStr, X } = eDigitsAndExponent(absValue, p + 1);
  return { mantissa: buildMantissa(digitsStr, p, hashFlag), exponent: X };
}

function stripTrailingZeros(s: string): string {
  if (!s.includes('.')) return s;
  s = s.replace(/0+$/, '');
  if (s.endsWith('.')) s = s.slice(0, -1);
  return s;
}

function gBody(absValue: number, P: number, hashFlag: boolean): { body: string; isF: boolean; exponent: number } {
  const { digitsStr, X } = eDigitsAndExponent(absValue, P);
  const p = P - 1;
  const isF = P > X && X >= -4;
  let body: string;
  if (isF) {
    const newScale = P - 1 - X;
    body = fBody(absValue, newScale, true);
  } else {
    body = buildMantissa(digitsStr, p, true);
  }
  if (!hashFlag) body = stripTrailingZeros(body);
  return { body, isF, exponent: X };
}

function padNumeric(signPrefix: string, digits: string, width: number, leftAlign: boolean, zeroPad: boolean): string {
  const body = signPrefix + digits;
  if (body.length >= width) return body;
  const padLen = width - body.length;
  if (leftAlign) return body + ' '.repeat(padLen);
  if (zeroPad) return signPrefix + '0'.repeat(padLen) + digits;
  return ' '.repeat(padLen) + body;
}

function padGeneric(s: string, width: number, leftAlign: boolean): string {
  if (s.length >= width) return s;
  const pad = ' '.repeat(width - s.length);
  return leftAlign ? s + pad : pad + s;
}

function toMagnitudeBigInt(arg: number | bigint): { neg: boolean; mag: bigint } {
  if (typeof arg === 'bigint') {
    return arg < 0n ? { neg: true, mag: -arg } : { neg: false, mag: arg };
  }
  const neg = arg < 0;
  return { neg, mag: BigInt(Math.abs(arg)) };
}

function formatDI(arg: number | bigint, flags: Flags, width: number | undefined, precision: number | undefined): string {
  const { neg, mag } = toMagnitudeBigInt(arg);
  let digStr = mag.toString();
  if (precision !== undefined) {
    if (precision === 0 && mag === 0n) digStr = '';
    else digStr = digStr.padStart(precision, '0');
  }
  const sign = neg ? '-' : flags.plus ? '+' : flags.space ? ' ' : '';
  const zeroPad = flags.zero && !flags.minus && precision === undefined;
  return padNumeric(sign, digStr, width ?? 0, flags.minus, zeroPad);
}

function formatXO(arg: number | bigint, conv: string, flags: Flags, width: number | undefined, precision: number | undefined): string {
  const { mag } = toMagnitudeBigInt(arg);
  let digStr: string;
  if (conv === 'o') digStr = mag.toString(8);
  else digStr = mag.toString(16);
  if (conv === 'X') digStr = digStr.toUpperCase();
  if (precision !== undefined) {
    if (precision === 0 && mag === 0n) digStr = '';
    else digStr = digStr.padStart(precision, '0');
  }
  let prefix = '';
  if (flags.hash) {
    if (conv === 'o') {
      if (digStr === '' || digStr[0] !== '0') digStr = '0' + digStr;
    } else if (mag !== 0n) {
      prefix = conv === 'X' ? '0X' : '0x';
    }
  }
  const zeroPad = flags.zero && !flags.minus && precision === undefined;
  return padNumeric(prefix, digStr, width ?? 0, flags.minus, zeroPad);
}

function formatFloat(
  value: number,
  conv: string,
  flags: Flags,
  width: number | undefined,
  precision: number | undefined
): string {
  const isUpper = conv >= 'A' && conv <= 'Z';
  const lower = conv.toLowerCase();
  const isNaNVal = Number.isNaN(value);
  const isNeg = !isNaNVal && (value < 0 || Object.is(value, -0));
  const sign = isNaNVal ? '' : isNeg ? '-' : flags.plus ? '+' : flags.space ? ' ' : '';

  let bodyNoSign: string;
  let zeroPadEligible = false;

  if (isNaNVal) {
    bodyNoSign = isUpper ? 'NAN' : 'nan';
  } else if (!Number.isFinite(value)) {
    bodyNoSign = isUpper ? 'INF' : 'inf';
  } else {
    zeroPadEligible = true;
    const absValue = Math.abs(value);
    if (lower === 'f') {
      const p = precision === undefined ? 6 : precision;
      bodyNoSign = fBody(absValue, p, flags.hash);
    } else if (lower === 'e') {
      const p = precision === undefined ? 6 : precision;
      const { mantissa, exponent } = eBody(absValue, p, flags.hash);
      const expLetter = isUpper ? 'E' : 'e';
      const expSign = exponent < 0 ? '-' : '+';
      const expDigits = Math.abs(exponent).toString().padStart(2, '0');
      bodyNoSign = mantissa + expLetter + expSign + expDigits;
    } else {
      let P = precision === undefined ? 6 : precision === 0 ? 1 : precision;
      const { body, isF, exponent } = gBody(absValue, P, flags.hash);
      if (isF) {
        bodyNoSign = body;
      } else {
        const expLetter = isUpper ? 'E' : 'e';
        const expSign = exponent < 0 ? '-' : '+';
        const expDigits = Math.abs(exponent).toString().padStart(2, '0');
        bodyNoSign = body + expLetter + expSign + expDigits;
      }
    }
  }

  const zeroPad = flags.zero && !flags.minus && zeroPadEligible;
  return padNumeric(sign, bodyNoSign, width ?? 0, flags.minus, zeroPad);
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
    i++; // skip '%'
    if (fmt[i] === '%') {
      result += '%';
      i++;
      continue;
    }
    const flags: Flags = { minus: false, plus: false, space: false, zero: false, hash: false };
    while (i < n && '-+ 0#'.includes(fmt[i])) {
      switch (fmt[i]) {
        case '-':
          flags.minus = true;
          break;
        case '+':
          flags.plus = true;
          break;
        case ' ':
          flags.space = true;
          break;
        case '0':
          flags.zero = true;
          break;
        case '#':
          flags.hash = true;
          break;
      }
      i++;
    }
    let widthStr = '';
    while (i < n && fmt[i] >= '0' && fmt[i] <= '9') {
      widthStr += fmt[i];
      i++;
    }
    const width = widthStr === '' ? undefined : parseInt(widthStr, 10);
    let precision: number | undefined = undefined;
    if (fmt[i] === '.') {
      i++;
      let precStr = '';
      while (i < n && fmt[i] >= '0' && fmt[i] <= '9') {
        precStr += fmt[i];
        i++;
      }
      precision = precStr === '' ? 0 : parseInt(precStr, 10);
    }
    const conv = fmt[i];
    i++;
    const arg = args[argIndex++];
    switch (conv) {
      case 'd':
      case 'i':
        result += formatDI(arg as number | bigint, flags, width, precision);
        break;
      case 'x':
      case 'X':
      case 'o':
        result += formatXO(arg as number | bigint, conv, flags, width, precision);
        break;
      case 'e':
      case 'E':
      case 'f':
      case 'F':
      case 'g':
      case 'G':
        result += formatFloat(arg as number, conv, flags, width, precision);
        break;
      case 's': {
        let s = String(arg);
        if (precision !== undefined) s = s.slice(0, precision);
        result += padGeneric(s, width ?? 0, flags.minus);
        break;
      }
      case 'c': {
        const s = String(arg);
        result += padGeneric(s, width ?? 0, flags.minus);
        break;
      }
      default:
        break;
    }
  }
  return result;
}
