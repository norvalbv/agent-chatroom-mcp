// Exact decimal digits (integer form) of a finite positive double: value === BigInt(digits) / 10^fracLen
function getExactDigits(absX: number): { digits: string; fracLen: number } {
  if (absX === 0) return { digits: '0', fracLen: 0 };
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setFloat64(0, absX);
  const hi = BigInt(view.getUint32(0));
  const lo = BigInt(view.getUint32(4));
  const bits = (hi << 32n) | lo;
  const expBits = Number((bits >> 52n) & 0x7ffn);
  const mantissaBits = bits & 0xfffffffffffffn;
  let mantissa: bigint;
  let exp: number;
  if (expBits === 0) {
    mantissa = mantissaBits;
    exp = -1074;
  } else {
    mantissa = mantissaBits | (1n << 52n);
    exp = expBits - 1075;
  }
  if (mantissa === 0n) return { digits: '0', fracLen: 0 };
  if (exp >= 0) {
    return { digits: (mantissa << BigInt(exp)).toString(), fracLen: 0 };
  }
  const k = -exp;
  const numerator = mantissa * 5n ** BigInt(k);
  return { digits: numerator.toString(), fracLen: k };
}

// Round the exact decimal value digits/10^fracLen to newFracLen digits after the point,
// using round-half-to-even. Returns the resulting digit string (interpreted with newFracLen
// digits after the point; may be longer than expected due to carry).
function roundExact(digits: string, fracLen: number, newFracLen: number): { digits: string; fracLen: number } {
  let d = digits;
  if (d.length <= fracLen) d = d.padStart(fracLen + 1, '0');
  if (newFracLen >= fracLen) {
    return { digits: d + '0'.repeat(newFracLen - fracLen), fracLen: newFracLen };
  }
  const dropCount = fracLen - newFracLen;
  const keepLen = d.length - dropCount;
  let kept = d.slice(0, keepLen);
  const dropped = d.slice(keepLen);
  if (kept === '') kept = '0';
  let roundUp = false;
  const first = dropped[0];
  if (first > '5') roundUp = true;
  else if (first === '5') {
    if (/[1-9]/.test(dropped.slice(1))) roundUp = true;
    else {
      const lastKept = kept[kept.length - 1];
      roundUp = parseInt(lastKept, 10) % 2 === 1;
    }
  }
  if (roundUp) {
    let incremented = (BigInt(kept) + 1n).toString();
    if (incremented.length < kept.length) incremented = incremented.padStart(kept.length, '0');
    kept = incremented;
  }
  return { digits: kept, fracLen: newFracLen };
}

// Strip leading zeros from an exact-digit string and report the decimal exponent of the
// first significant digit relative to the decimal point (digits/10^fracLen has fracLen
// digits after the point).
function normalize(digits: string, fracLen: number): { digits: string; exp: number } {
  let idx = 0;
  while (idx < digits.length - 1 && digits[idx] === '0') idx++;
  const trimmed = digits.slice(idx);
  const exp = digits.length - fracLen - 1 - idx;
  return { digits: trimmed, exp };
}

function padNumber(sign: string, prefix: string, digits: string, width: number, zeroPad: boolean, leftAlign: boolean): string {
  const body = sign + prefix + digits;
  if (body.length >= width) return body;
  if (leftAlign) return body + ' '.repeat(width - body.length);
  if (zeroPad) return sign + prefix + '0'.repeat(width - body.length) + digits;
  return ' '.repeat(width - body.length) + body;
}

function stringPad(text: string, width: number, leftAlign: boolean): string {
  if (text.length >= width) return text;
  const pad = ' '.repeat(width - text.length);
  return leftAlign ? text + pad : pad + text;
}

function stripLeadingZeros(s: string): string {
  const stripped = s.replace(/^0+(?=\d)/, '');
  return stripped === '' ? '0' : stripped;
}

function toBigIntArg(arg: number | bigint): bigint {
  return typeof arg === 'bigint' ? arg : BigInt(arg);
}

function convert(conv: string, flags: Set<string>, width: number, precision: number | undefined, arg: number | bigint | string): string {
  const leftAlign = flags.has('-');

  if (conv === 'd' || conv === 'i') {
    const bi = toBigIntArg(arg as number | bigint);
    const neg = bi < 0n;
    let digits = (neg ? -bi : bi).toString();
    if (precision !== undefined) {
      digits = precision === 0 && bi === 0n ? '' : digits.padStart(precision, '0');
    }
    const sign = neg ? '-' : flags.has('+') ? '+' : flags.has(' ') ? ' ' : '';
    const zeroPad = flags.has('0') && !leftAlign && precision === undefined;
    return padNumber(sign, '', digits, width, zeroPad, leftAlign);
  }

  if (conv === 'x' || conv === 'X' || conv === 'o') {
    const bi = toBigIntArg(arg as number | bigint);
    const base = conv === 'o' ? 8 : 16;
    let digits = bi.toString(base);
    if (conv === 'X') digits = digits.toUpperCase();
    if (precision !== undefined) {
      digits = precision === 0 && bi === 0n ? '' : digits.padStart(precision, '0');
    }
    let prefix = '';
    if (flags.has('#')) {
      if (conv === 'o') {
        if (digits === '' || digits[0] !== '0') digits = '0' + digits;
      } else if (bi !== 0n) {
        prefix = conv === 'X' ? '0X' : '0x';
      }
    }
    const zeroPad = flags.has('0') && !leftAlign && precision === undefined;
    return padNumber('', prefix, digits, width, zeroPad, leftAlign);
  }

  if (conv === 'e' || conv === 'E' || conv === 'f' || conv === 'F' || conv === 'g' || conv === 'G') {
    const value = arg as number;
    const upper = conv === 'E' || conv === 'F' || conv === 'G';
    const isNan = Number.isNaN(value);
    const isInf = !isNan && !Number.isFinite(value);

    let sign: string;
    if (isNan) sign = '';
    else {
      const negBit = Object.is(value, -0) || value < 0;
      sign = negBit ? '-' : flags.has('+') ? '+' : flags.has(' ') ? ' ' : '';
    }

    if (isNan || isInf) {
      const text = isNan ? (upper ? 'NAN' : 'nan') : upper ? 'INF' : 'inf';
      return padNumber(sign, '', text, width, false, leftAlign);
    }

    const absVal = Math.abs(value);
    const exact = getExactDigits(absVal);
    const zeroPad = flags.has('0') && !leftAlign;
    const hash = flags.has('#');

    if (conv === 'f' || conv === 'F') {
      const prec = precision === undefined ? 6 : precision;
      const { digits: kept } = roundExact(exact.digits, exact.fracLen, prec);
      const L = kept.length;
      const intPart = stripLeadingZeros(L > prec ? kept.slice(0, L - prec) : '0');
      const fracPart = L > prec ? kept.slice(L - prec) : kept.padStart(prec, '0');
      const text = intPart + (prec > 0 || hash ? '.' + fracPart : '');
      return padNumber(sign, '', text, width, zeroPad, leftAlign);
    }

    if (conv === 'e' || conv === 'E') {
      const prec = precision === undefined ? 6 : precision;
      const eLetter = upper ? 'E' : 'e';
      let firstDigit: string;
      let fracDigits: string;
      let expVal: number;
      if (absVal === 0) {
        firstDigit = '0';
        fracDigits = '0'.repeat(prec);
        expVal = 0;
      } else {
        const norm = normalize(exact.digits, exact.fracLen);
        const { digits: kept } = roundExact(norm.digits, norm.digits.length - 1, prec);
        const carry = kept.length - prec - 1;
        firstDigit = kept[0];
        fracDigits = kept.slice(1, 1 + prec);
        expVal = norm.exp + carry;
      }
      const expSign = expVal < 0 ? '-' : '+';
      const expDigits = Math.abs(expVal).toString().padStart(2, '0');
      const text = firstDigit + (prec > 0 || hash ? '.' + fracDigits : '') + eLetter + expSign + expDigits;
      return padNumber(sign, '', text, width, zeroPad, leftAlign);
    }

    // g, G
    const P = precision === undefined ? 6 : precision === 0 ? 1 : precision;
    const eLetter = upper ? 'E' : 'e';
    let firstDigit: string;
    let fracDigits: string;
    let expVal: number;
    if (absVal === 0) {
      firstDigit = '0';
      fracDigits = '0'.repeat(P - 1);
      expVal = 0;
    } else {
      const norm = normalize(exact.digits, exact.fracLen);
      const { digits: kept } = roundExact(norm.digits, norm.digits.length - 1, P - 1);
      const carry = kept.length - (P - 1) - 1;
      firstDigit = kept[0];
      fracDigits = kept.slice(1, 1 + (P - 1));
      expVal = norm.exp + carry;
    }

    let text: string;
    if (P > expVal && expVal >= -4) {
      const fprec = P - 1 - expVal;
      const { digits: kept } = roundExact(exact.digits, exact.fracLen, fprec);
      const L = kept.length;
      const intPart = stripLeadingZeros(L > fprec ? kept.slice(0, L - fprec) : '0');
      const fracPart = L > fprec ? kept.slice(L - fprec) : kept.padStart(fprec, '0');
      const frac = hash ? fracPart : fracPart.replace(/0+$/, '');
      text = intPart + (frac.length > 0 || hash ? '.' + frac : '');
    } else {
      const frac = hash ? fracDigits : fracDigits.replace(/0+$/, '');
      const expSign = expVal < 0 ? '-' : '+';
      const expDigitsStr = Math.abs(expVal).toString().padStart(2, '0');
      text = firstDigit + (frac.length > 0 || hash ? '.' + frac : '') + eLetter + expSign + expDigitsStr;
    }
    return padNumber(sign, '', text, width, zeroPad, leftAlign);
  }

  if (conv === 's') {
    let str = arg as string;
    if (precision !== undefined) str = str.slice(0, precision);
    return stringPad(str, width, leftAlign);
  }

  if (conv === 'c') {
    return stringPad(arg as string, width, leftAlign);
  }

  throw new Error(`unsupported conversion: ${conv}`);
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  const re = /%([-+ 0#]*)(\d*)(\.\d*)?([diouxXeEfFgGsc%])/g;
  let result = '';
  let lastIndex = 0;
  let argIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(fmt))) {
    result += fmt.slice(lastIndex, m.index);
    lastIndex = re.lastIndex;
    const [, flagsStr, widthStr, precStr, conv] = m;
    if (conv === '%') {
      result += '%';
      continue;
    }
    const flags = new Set(flagsStr.split(''));
    const width = widthStr ? parseInt(widthStr, 10) : 0;
    const precision = precStr !== undefined ? (precStr.length > 1 ? parseInt(precStr.slice(1), 10) : 0) : undefined;
    const arg = args[argIndex++];
    result += convert(conv, flags, width, precision, arg);
  }
  result += fmt.slice(lastIndex);
  return result;
}
