type Flags = {
  minus: boolean;
  plus: boolean;
  space: boolean;
  zero: boolean;
  hash: boolean;
};

function parseFlags(flagsStr: string): Flags {
  return {
    minus: flagsStr.includes('-'),
    plus: flagsStr.includes('+'),
    space: flagsStr.includes(' '),
    zero: flagsStr.includes('0'),
    hash: flagsStr.includes('#'),
  };
}

function padNumeric(
  sign: string,
  prefix: string,
  digits: string,
  width: number,
  flags: Flags,
  zeroAllowed: boolean,
): string {
  const content = sign + prefix + digits;
  if (content.length >= width) return content;
  const padLen = width - content.length;
  if (flags.minus) return content + ' '.repeat(padLen);
  if (flags.zero && zeroAllowed) return sign + prefix + '0'.repeat(padLen) + digits;
  return ' '.repeat(padLen) + content;
}

function padText(s: string, width: number, minus: boolean): string {
  if (s.length >= width) return s;
  const pad = ' '.repeat(width - s.length);
  return minus ? s + pad : pad + s;
}

// ---- exact decimal representation of a non-negative finite double ----

function exactDecimal(x: number): { intPart: string; fracPart: string } {
  if (x === 0) return { intPart: '0', fracPart: '' };
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setFloat64(0, x);
  const hi = view.getUint32(0);
  const lo = view.getUint32(4);
  const exponent = (hi >>> 20) & 0x7ff;
  const mantissa = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo >>> 0);
  let significand: bigint;
  let e: number;
  if (exponent === 0) {
    significand = mantissa;
    e = -1074;
  } else {
    significand = (1n << 52n) | mantissa;
    e = exponent - 1075;
  }
  if (significand === 0n) return { intPart: '0', fracPart: '' };
  if (e >= 0) {
    const intVal = significand << BigInt(e);
    return { intPart: intVal.toString(), fracPart: '' };
  }
  const shift = -e;
  const numerator = significand * 5n ** BigInt(shift);
  let digits = numerator.toString();
  if (digits.length <= shift) {
    digits = digits.padStart(shift + 1, '0');
  }
  const intPart = digits.slice(0, digits.length - shift);
  const fracPart = digits.slice(digits.length - shift);
  return { intPart, fracPart };
}

function roundDigitString(digits: string, keep: number): { result: string; carryOut: boolean } {
  if (keep >= digits.length) {
    return { result: digits.padEnd(keep, '0'), carryOut: false };
  }
  const kept = digits.slice(0, keep);
  const rest = digits.slice(keep);
  const firstRest = rest[0];
  let roundUp: boolean;
  if (firstRest > '5') {
    roundUp = true;
  } else if (firstRest < '5') {
    roundUp = false;
  } else {
    const restHasNonzero = /[1-9]/.test(rest.slice(1));
    if (restHasNonzero) {
      roundUp = true;
    } else {
      const lastKeptDigit = keep > 0 ? kept[keep - 1] : '0';
      roundUp = Number(lastKeptDigit) % 2 === 1;
    }
  }
  if (!roundUp) return { result: kept, carryOut: false };
  const arr = kept.split('');
  let i = arr.length - 1;
  while (i >= 0) {
    if (arr[i] === '9') {
      arr[i] = '0';
      i--;
    } else {
      arr[i] = String(Number(arr[i]) + 1);
      break;
    }
  }
  if (i < 0) return { result: arr.join(''), carryOut: true };
  return { result: arr.join(''), carryOut: false };
}

function roundFixed(intPart: string, fracPart: string, n: number): { intPart: string; fracPart: string } {
  if (fracPart.length <= n) {
    return { intPart, fracPart: fracPart.padEnd(n, '0') };
  }
  const combined = intPart + fracPart;
  const cut = intPart.length + n;
  const { result, carryOut } = roundDigitString(combined, cut);
  const newCombined = (carryOut ? '1' : '') + result;
  const effLen = intPart.length + (carryOut ? 1 : 0);
  return { intPart: newCombined.slice(0, effLen) || '0', fracPart: newCombined.slice(effLen) };
}

function roundSignificant(intPart: string, fracPart: string, sig: number): { digits: string; exponent: number } {
  const combined = intPart + fracPart;
  const pointPos = intPart.length;
  let s = 0;
  while (s < combined.length && combined[s] === '0') s++;
  if (s === combined.length) {
    return { digits: '0'.repeat(sig), exponent: 0 };
  }
  const exponent0 = pointPos - 1 - s;
  const digitsFromS = combined.slice(s);
  const { result, carryOut } = roundDigitString(digitsFromS, sig);
  if (carryOut) {
    return { digits: ('1' + result).slice(0, sig), exponent: exponent0 + 1 };
  }
  return { digits: result, exponent: exponent0 };
}

function formatFMag(absX: number, precision: number, hash: boolean): string {
  const { intPart, fracPart } = exactDecimal(absX);
  const r = roundFixed(intPart, fracPart, precision);
  let body = r.intPart;
  if (precision > 0 || hash) body += '.' + r.fracPart;
  return body;
}

function formatEMag(absX: number, precision: number, upper: boolean, hash: boolean): string {
  const { intPart, fracPart } = exactDecimal(absX);
  const { digits, exponent } = roundSignificant(intPart, fracPart, precision + 1);
  const first = digits[0];
  const rest = digits.slice(1);
  let body = first;
  if (precision > 0 || hash) body += '.' + rest;
  const expSign = exponent < 0 ? '-' : '+';
  let expDigits = Math.abs(exponent).toString();
  if (expDigits.length < 2) expDigits = expDigits.padStart(2, '0');
  body += (upper ? 'E' : 'e') + expSign + expDigits;
  return body;
}

function stripTrailingZerosG(body: string, upper: boolean): string {
  const eChar = upper ? 'E' : 'e';
  const eIndex = body.indexOf(eChar);
  let mantissa = eIndex === -1 ? body : body.slice(0, eIndex);
  const suffix = eIndex === -1 ? '' : body.slice(eIndex);
  if (mantissa.includes('.')) {
    mantissa = mantissa.replace(/0+$/, '');
    mantissa = mantissa.replace(/\.$/, '');
  }
  return mantissa + suffix;
}

function formatGMag(absX: number, precision: number, upper: boolean, hash: boolean): string {
  const P = precision === 0 ? 1 : precision;
  const { intPart, fracPart } = exactDecimal(absX);
  const { exponent } = roundSignificant(intPart, fracPart, P);
  let body: string;
  if (P > exponent && exponent >= -4) {
    body = formatFMag(absX, P - 1 - exponent, hash);
  } else {
    body = formatEMag(absX, P - 1, upper, hash);
  }
  if (!hash) {
    body = stripTrailingZerosG(body, upper);
  }
  return body;
}

function signBitSet(x: number): boolean {
  if (x === 0) return Object.is(x, -0);
  return x < 0;
}

function formatFloatConv(
  conv: string,
  flags: Flags,
  width: number,
  precisionArg: number | undefined,
  value: number,
): string {
  const upper = conv === conv.toUpperCase();
  const precision = precisionArg === undefined ? 6 : precisionArg;

  if (Number.isNaN(value)) {
    const text = upper ? 'NAN' : 'nan';
    return padNumeric('', '', text, width, flags, false);
  }
  if (!Number.isFinite(value)) {
    const neg = value < 0;
    const sign = neg ? '-' : flags.plus ? '+' : flags.space ? ' ' : '';
    const text = upper ? 'INF' : 'inf';
    return padNumeric(sign, '', text, width, flags, false);
  }

  const neg = signBitSet(value);
  const sign = neg ? '-' : flags.plus ? '+' : flags.space ? ' ' : '';
  const absVal = Math.abs(value);

  let body: string;
  const lower = conv.toLowerCase();
  if (lower === 'f') {
    body = formatFMag(absVal, precision, flags.hash);
  } else if (lower === 'e') {
    body = formatEMag(absVal, precision, upper, flags.hash);
  } else {
    body = formatGMag(absVal, precision, upper, flags.hash);
  }

  return padNumeric(sign, '', body, width, flags, true);
}

function toBigInt(arg: number | bigint): bigint {
  return typeof arg === 'bigint' ? arg : BigInt(arg);
}

function formatDI(flags: Flags, width: number, precision: number | undefined, arg: number | bigint): string {
  const n = toBigInt(arg);
  const neg = n < 0n;
  const mag = neg ? -n : n;
  let digits: string;
  if (precision !== undefined) {
    if (precision === 0 && mag === 0n) {
      digits = '';
    } else {
      digits = mag.toString(10).padStart(precision, '0');
    }
  } else {
    digits = mag.toString(10);
  }
  const sign = neg ? '-' : flags.plus ? '+' : flags.space ? ' ' : '';
  const zeroAllowed = precision === undefined;
  return padNumeric(sign, '', digits, width, flags, zeroAllowed);
}

function formatXO(conv: string, flags: Flags, width: number, precision: number | undefined, arg: number | bigint): string {
  const n = toBigInt(arg);
  const radix = conv === 'o' ? 8 : 16;
  let digits: string;
  if (precision !== undefined) {
    if (precision === 0 && n === 0n) {
      digits = '';
    } else {
      digits = n.toString(radix).padStart(precision, '0');
    }
  } else {
    digits = n.toString(radix);
  }
  if (conv === 'X') digits = digits.toUpperCase();

  let prefix = '';
  if (flags.hash) {
    if (conv === 'x' && n !== 0n) prefix = '0x';
    else if (conv === 'X' && n !== 0n) prefix = '0X';
    else if (conv === 'o') {
      if (digits.length === 0 || digits[0] !== '0') digits = '0' + digits;
    }
  }
  const zeroAllowed = precision === undefined;
  return padNumeric('', prefix, digits, width, flags, zeroAllowed);
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let out = '';
  let argIndex = 0;
  const re = /%([-+ 0#]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc%])/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(fmt)) !== null) {
    out += fmt.slice(lastIndex, m.index);
    lastIndex = re.lastIndex;
    const [, flagsStr, widthStr, precStr, conv] = m;

    if (conv === '%') {
      out += '%';
      continue;
    }

    const flags = parseFlags(flagsStr);
    const width = widthStr ? parseInt(widthStr, 10) : 0;
    const precision = precStr !== undefined ? (precStr === '' ? 0 : parseInt(precStr, 10)) : undefined;
    const arg = args[argIndex++];

    if (conv === 'd' || conv === 'i') {
      out += formatDI(flags, width, precision, arg as number | bigint);
    } else if (conv === 'x' || conv === 'X' || conv === 'o') {
      out += formatXO(conv, flags, width, precision, arg as number | bigint);
    } else if (conv === 'e' || conv === 'E' || conv === 'f' || conv === 'F' || conv === 'g' || conv === 'G') {
      out += formatFloatConv(conv, flags, width, precision, arg as number);
    } else if (conv === 's') {
      let s = String(arg);
      if (precision !== undefined) s = s.slice(0, precision);
      out += padText(s, width, flags.minus);
    } else if (conv === 'c') {
      out += padText(String(arg), width, flags.minus);
    }
  }
  out += fmt.slice(lastIndex);
  return out;
}
