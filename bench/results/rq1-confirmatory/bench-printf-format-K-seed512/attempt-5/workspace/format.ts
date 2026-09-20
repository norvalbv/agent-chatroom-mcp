type Flags = {
  minus: boolean;
  plus: boolean;
  space: boolean;
  zero: boolean;
  hash: boolean;
};

type Decomposed = { N: bigint; k: number };

function decompose(ax: number): Decomposed {
  // ax is a non-negative finite number (magnitude)
  if (ax === 0) return { N: 0n, k: 0 };
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setFloat64(0, ax);
  const high = view.getUint32(0);
  const low = view.getUint32(4);
  const exponent = (high >>> 20) & 0x7ff;
  const mantissaHigh = high & 0xfffff;
  let mantissa = (BigInt(mantissaHigh) << 32n) | BigInt(low);
  let e: number;
  if (exponent === 0) {
    e = -1074;
  } else {
    mantissa = mantissa | (1n << 52n);
    e = exponent - 1075;
  }
  if (e >= 0) {
    return { N: mantissa << BigInt(e), k: 0 };
  } else {
    const p = -e;
    return { N: mantissa * 5n ** BigInt(p), k: p };
  }
}

function roundBigIntDiv(N: bigint, dropDigits: number): bigint {
  const P = 10n ** BigInt(dropDigits);
  const q = N / P;
  const r = N % P;
  const twice = r * 2n;
  if (twice > P) return q + 1n;
  if (twice < P) return q;
  return q % 2n === 0n ? q : q + 1n;
}

function fFormat(N: bigint, k: number, precision: number): { intPart: string; fracPart: string } {
  const d = precision;
  let M: bigint;
  if (d >= k) {
    M = N * 10n ** BigInt(d - k);
  } else {
    M = roundBigIntDiv(N, k - d);
  }
  let s = M.toString();
  if (d === 0) return { intPart: s, fracPart: '' };
  if (s.length <= d) s = '0'.repeat(d - s.length + 1) + s;
  return { intPart: s.slice(0, s.length - d), fracPart: s.slice(s.length - d) };
}

function eFormat(N: bigint, k: number, precision: number): { mantissa: string; exponent: number } {
  const keep = precision + 1;
  if (N === 0n) return { mantissa: '0'.repeat(keep), exponent: 0 };
  const numStr = N.toString();
  const len = numStr.length;
  const X0 = len - k - 1;
  if (len <= keep) {
    return { mantissa: numStr + '0'.repeat(keep - len), exponent: X0 };
  }
  const dropDigits = len - keep;
  const M = roundBigIntDiv(N, dropDigits);
  let s = M.toString();
  let exponent = X0;
  if (s.length > keep) {
    exponent = X0 + 1;
    s = s.slice(0, keep);
  } else if (s.length < keep) {
    s = '0'.repeat(keep - s.length) + s;
  }
  return { mantissa: s, exponent };
}

function signChar(negative: boolean, flags: Flags): string {
  if (negative) return '-';
  if (flags.plus) return '+';
  if (flags.space) return ' ';
  return '';
}

function padNumeric(
  sign: string,
  prefix: string,
  body: string,
  flags: Flags,
  width: number,
  zeroPadAllowed: boolean
): string {
  const content = sign + prefix + body;
  if (content.length >= width) return content;
  const pad = width - content.length;
  if (flags.minus) return content + ' '.repeat(pad);
  if (flags.zero && zeroPadAllowed) return sign + prefix + '0'.repeat(pad) + body;
  return ' '.repeat(pad) + content;
}

function toBig(v: number | bigint): bigint {
  return typeof v === 'bigint' ? v : BigInt(v);
}

function formatIntConversion(
  conv: string,
  arg: number | bigint,
  flags: Flags,
  width: number,
  precision: number | null
): string {
  const big = toBig(arg);

  if (conv === 'd' || conv === 'i') {
    const negative = big < 0n;
    const mag = negative ? -big : big;
    let digits: string;
    if (precision === null) {
      digits = mag.toString();
    } else if (mag === 0n && precision === 0) {
      digits = '';
    } else {
      digits = mag.toString();
      if (digits.length < precision) digits = '0'.repeat(precision - digits.length) + digits;
    }
    const sign = signChar(negative, flags);
    return padNumeric(sign, '', digits, flags, width, precision === null);
  }

  // x, X, o : non-negative integer
  const mag = big;
  const base = conv === 'o' ? 8 : 16;
  let digits: string;
  if (precision === null) {
    digits = mag === 0n ? '0' : mag.toString(base);
  } else if (mag === 0n && precision === 0) {
    digits = '';
  } else {
    digits = mag.toString(base);
    if (digits.length < precision) digits = '0'.repeat(precision - digits.length) + digits;
  }
  if (conv === 'X') digits = digits.toUpperCase();

  let prefix = '';
  if (flags.hash) {
    if (conv === 'o') {
      if (digits.length === 0 || digits[0] !== '0') digits = '0' + digits;
    } else if (mag !== 0n) {
      prefix = conv === 'X' ? '0X' : '0x';
    }
  }

  return padNumeric('', prefix, digits, flags, width, precision === null);
}

function stripTrailingZeros(intPart: string, fracPart: string, hash: boolean): string {
  if (hash) return fracPart.length > 0 ? intPart + '.' + fracPart : intPart + '.';
  let frac = fracPart.replace(/0+$/, '');
  return frac.length > 0 ? intPart + '.' + frac : intPart;
}

function formatFloatConversion(
  conv: string,
  arg: number,
  flags: Flags,
  width: number,
  precision: number | null
): string {
  const upper = conv === conv.toUpperCase();
  const isNaNVal = Number.isNaN(arg);
  const isInf = !isNaNVal && !Number.isFinite(arg);

  if (isNaNVal) {
    const text = upper ? 'NAN' : 'nan';
    return padNumeric('', '', text, flags, width, false);
  }

  const negative = arg < 0 || Object.is(arg, -0);
  const sign = signChar(negative, flags);

  if (isInf) {
    const text = upper ? 'INF' : 'inf';
    return padNumeric(sign, '', text, flags, width, false);
  }

  const ax = Math.abs(arg);
  const { N, k } = decompose(ax);
  const lower = conv.toLowerCase();

  if (lower === 'f') {
    const prec = precision === null ? 6 : precision;
    const { intPart, fracPart } = fFormat(N, k, prec);
    const body = prec > 0 || flags.hash ? intPart + '.' + fracPart : intPart;
    return padNumeric(sign, '', body, flags, width, true);
  }

  if (lower === 'e') {
    const prec = precision === null ? 6 : precision;
    const { mantissa, exponent } = eFormat(N, k, prec);
    const first = mantissa[0];
    const rest = mantissa.slice(1);
    const dot = prec > 0 || flags.hash ? '.' : '';
    const expLetter = upper ? 'E' : 'e';
    const expSign = exponent < 0 ? '-' : '+';
    const expAbs = Math.abs(exponent).toString().padStart(2, '0');
    const body = first + dot + rest + expLetter + expSign + expAbs;
    return padNumeric(sign, '', body, flags, width, true);
  }

  // g / G
  let P = precision === null ? 6 : precision;
  if (P === 0) P = 1;
  const { exponent: X } = eFormat(N, k, P - 1);
  let body: string;
  if (P > X && X >= -4) {
    const fprec = P - 1 - X;
    const { intPart, fracPart } = fFormat(N, k, Math.max(fprec, 0));
    body = stripTrailingZeros(intPart, fracPart, flags.hash);
  } else {
    const { mantissa, exponent } = eFormat(N, k, P - 1);
    const first = mantissa[0];
    const rest = mantissa.slice(1);
    const mantissaBody = stripTrailingZeros(first, rest, flags.hash);
    const expLetter = upper ? 'E' : 'e';
    const expSign = exponent < 0 ? '-' : '+';
    const expAbs = Math.abs(exponent).toString().padStart(2, '0');
    body = mantissaBody + expLetter + expSign + expAbs;
  }
  return padNumeric(sign, '', body, flags, width, true);
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

    // ch === '%'
    let j = i + 1;
    if (fmt[j] === '%') {
      result += '%';
      i = j + 1;
      continue;
    }

    const flags: Flags = { minus: false, plus: false, space: false, zero: false, hash: false };
    while (j < n && '-+ 0#'.includes(fmt[j])) {
      switch (fmt[j]) {
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
      j++;
    }

    let widthStr = '';
    while (j < n && /\d/.test(fmt[j])) {
      widthStr += fmt[j];
      j++;
    }
    const width = widthStr === '' ? 0 : parseInt(widthStr, 10);

    let precision: number | null = null;
    if (fmt[j] === '.') {
      j++;
      let precStr = '';
      while (j < n && /\d/.test(fmt[j])) {
        precStr += fmt[j];
        j++;
      }
      precision = precStr === '' ? 0 : parseInt(precStr, 10);
    }

    const conv = fmt[j];
    j++;
    i = j;

    const arg = args[argIndex++];

    if (conv === 'd' || conv === 'i' || conv === 'x' || conv === 'X' || conv === 'o') {
      result += formatIntConversion(conv, arg as number | bigint, flags, width, precision);
    } else if (
      conv === 'e' ||
      conv === 'E' ||
      conv === 'f' ||
      conv === 'F' ||
      conv === 'g' ||
      conv === 'G'
    ) {
      result += formatFloatConversion(conv, arg as number, flags, width, precision);
    } else if (conv === 's') {
      let s = arg as string;
      if (precision !== null) s = s.slice(0, precision);
      const pad = width - s.length;
      if (pad > 0) {
        result += flags.minus ? s + ' '.repeat(pad) : ' '.repeat(pad) + s;
      } else {
        result += s;
      }
    } else if (conv === 'c') {
      const s = arg as string;
      const pad = width - s.length;
      if (pad > 0) {
        result += flags.minus ? s + ' '.repeat(pad) : ' '.repeat(pad) + s;
      } else {
        result += s;
      }
    }
  }

  return result;
}
