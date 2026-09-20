type Flags = {
  minus: boolean;
  plus: boolean;
  space: boolean;
  zero: boolean;
  hash: boolean;
};

function decomposeDouble(v: number): { mantissa: bigint; exp: number } {
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setFloat64(0, v);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const rawExp = (hi >>> 20) & 0x7ff;
  const mantHi = hi & 0xfffff;
  const mantissaBits = (BigInt(mantHi) << 32n) | BigInt(lo);
  if (rawExp === 0) {
    return { mantissa: mantissaBits, exp: -1074 };
  }
  return { mantissa: mantissaBits | (1n << 52n), exp: rawExp - 1075 };
}

function divRoundHalfEven(num: bigint, den: bigint): bigint {
  if (den === 1n) return num;
  const q = num / den;
  const r = num % den;
  const twice = r * 2n;
  if (twice < den) return q;
  if (twice > den) return q + 1n;
  return q % 2n === 0n ? q : q + 1n;
}

// returns round_half_even(mantissa * 2^exp * 10^p)
function scaledRound(mantissa: bigint, exp: number, p: number): bigint {
  let num: bigint;
  let den: bigint;
  if (p >= 0) {
    const e2 = exp + p;
    const five = 5n ** BigInt(p);
    if (e2 >= 0) {
      num = mantissa * 2n ** BigInt(e2) * five;
      den = 1n;
    } else {
      num = mantissa * five;
      den = 2n ** BigInt(-e2);
    }
  } else {
    const q = -p;
    const five = 5n ** BigInt(q);
    const e2 = exp - q;
    if (e2 >= 0) {
      num = mantissa * 2n ** BigInt(e2);
      den = five;
    } else {
      num = mantissa;
      den = five * 2n ** BigInt(-e2);
    }
  }
  return divRoundHalfEven(num, den);
}

function formatFixed(magnitude: number, precision: number, hashFlag: boolean): string {
  const { mantissa, exp } = decomposeDouble(magnitude);
  const scaled = scaledRound(mantissa, exp, precision);
  let s = scaled.toString();
  if (s.length <= precision) s = '0'.repeat(precision - s.length + 1) + s;
  const intPart = precision > 0 ? s.slice(0, s.length - precision) : s;
  const fracPart = precision > 0 ? s.slice(s.length - precision) : '';
  if (precision > 0 || hashFlag) return intPart + '.' + fracPart;
  return intPart;
}

function getDigitsAndExponent(magnitude: number, n: number): { digitStr: string; exp: number } {
  if (magnitude === 0) return { digitStr: '0'.repeat(n), exp: 0 };
  const { mantissa, exp } = decomposeDouble(magnitude);
  const est = Math.floor(Math.log10(magnitude));
  let x = est;
  let p = n - 1 - x;
  let d = scaledRound(mantissa, exp, p);
  const lower = 10n ** BigInt(n - 1);
  const upper = 10n ** BigInt(n);
  while (d >= upper) {
    x++;
    p--;
    d = scaledRound(mantissa, exp, p);
  }
  while (d < lower) {
    x--;
    p++;
    d = scaledRound(mantissa, exp, p);
  }
  let digitStr = d.toString();
  if (digitStr.length < n) digitStr = '0'.repeat(n - digitStr.length) + digitStr;
  return { digitStr, exp: x };
}

function formatExp(magnitude: number, precision: number, hashFlag: boolean, upper: boolean): string {
  const n = precision + 1;
  const { digitStr, exp } = getDigitsAndExponent(magnitude, n);
  const first = digitStr[0];
  const rest = digitStr.slice(1);
  const mantissa = precision > 0 || hashFlag ? first + '.' + rest : first;
  const expSign = exp < 0 ? '-' : '+';
  let expAbs = Math.abs(exp).toString();
  if (expAbs.length < 2) expAbs = '0'.repeat(2 - expAbs.length) + expAbs;
  return mantissa + (upper ? 'E' : 'e') + expSign + expAbs;
}

function stripFrac(s: string): string {
  if (!s.includes('.')) return s;
  s = s.replace(/0+$/, '');
  if (s.endsWith('.')) s = s.slice(0, -1);
  return s;
}

function formatGeneral(magnitude: number, precisionRaw: number | null, hashFlag: boolean, upper: boolean): string {
  const p = precisionRaw === null ? 6 : precisionRaw === 0 ? 1 : precisionRaw;
  let x: number;
  if (magnitude === 0) {
    x = 0;
  } else {
    x = getDigitsAndExponent(magnitude, p).exp;
  }
  let body: string;
  let hasExp: boolean;
  if (p > x && x >= -4) {
    hasExp = false;
    body = formatFixed(magnitude, p - 1 - x, hashFlag);
  } else {
    hasExp = true;
    body = formatExp(magnitude, p - 1, hashFlag, upper);
  }
  if (hashFlag) return body;
  if (hasExp) {
    const idx = body.search(/[eE]/);
    const mantissa = stripFrac(body.slice(0, idx));
    return mantissa + body.slice(idx);
  }
  return stripFrac(body);
}

function padSpaces(body: string, width: number, leftFlag: boolean): string {
  if (body.length >= width) return body;
  const pad = ' '.repeat(width - body.length);
  return leftFlag ? body + pad : pad + body;
}

function padNumeric(
  sign: string,
  prefix: string,
  digits: string,
  width: number,
  zeroFlag: boolean,
  leftFlag: boolean,
  zeroIgnored: boolean,
): string {
  const body = sign + prefix + digits;
  if (body.length >= width) return body;
  const padLen = width - body.length;
  if (leftFlag) return body + ' '.repeat(padLen);
  if (zeroFlag && !zeroIgnored) return sign + prefix + '0'.repeat(padLen) + digits;
  return ' '.repeat(padLen) + body;
}

function intMagnitude(arg: number | bigint): { mag: bigint; neg: boolean } {
  if (typeof arg === 'bigint') return { mag: arg < 0n ? -arg : arg, neg: arg < 0n };
  return { mag: BigInt(Math.abs(arg)), neg: arg < 0 };
}

function formatDI(arg: number | bigint, flags: Flags, width: number, precision: number | null): string {
  const { mag, neg } = intMagnitude(arg);
  let digits = mag.toString(10);
  const precisionGiven = precision !== null;
  if (precisionGiven) {
    if (precision === 0 && mag === 0n) digits = '';
    else if (digits.length < (precision as number)) digits = '0'.repeat((precision as number) - digits.length) + digits;
  }
  const sign = neg ? '-' : flags.plus ? '+' : flags.space ? ' ' : '';
  return padNumeric(sign, '', digits, width, flags.zero, flags.minus, precisionGiven);
}

function formatXXO(conv: string, arg: number | bigint, flags: Flags, width: number, precision: number | null): string {
  const mag = typeof arg === 'bigint' ? arg : BigInt(arg);
  const base = conv === 'o' ? 8 : 16;
  let digits = mag.toString(base);
  if (conv === 'X') digits = digits.toUpperCase();
  const precisionGiven = precision !== null;
  if (precisionGiven) {
    if (precision === 0 && mag === 0n) digits = '';
    else if (digits.length < (precision as number)) digits = '0'.repeat((precision as number) - digits.length) + digits;
  }
  let prefix = '';
  if (flags.hash) {
    if (conv === 'o') {
      if (digits.length === 0 || digits[0] !== '0') digits = '0' + digits;
    } else if (mag !== 0n) {
      prefix = conv === 'X' ? '0X' : '0x';
    }
  }
  return padNumeric('', prefix, digits, width, flags.zero, flags.minus, precisionGiven);
}

function formatFloatConv(
  conv: string,
  value: number,
  flags: Flags,
  width: number,
  precision: number | null,
): string {
  const upper = conv === conv.toUpperCase();
  const lower = conv.toLowerCase();
  if (Number.isNaN(value)) {
    const text = upper ? 'NAN' : 'nan';
    return padSpaces(text, width, flags.minus);
  }
  if (!Number.isFinite(value)) {
    const neg = value < 0;
    const sign = neg ? '-' : flags.plus ? '+' : flags.space ? ' ' : '';
    const text = upper ? 'INF' : 'inf';
    return padSpaces(sign + text, width, flags.minus);
  }
  const neg = value < 0 || Object.is(value, -0);
  const sign = neg ? '-' : flags.plus ? '+' : flags.space ? ' ' : '';
  const magnitude = Math.abs(value);
  let body: string;
  if (lower === 'f') {
    body = formatFixed(magnitude, precision === null ? 6 : precision, flags.hash);
  } else if (lower === 'e') {
    body = formatExp(magnitude, precision === null ? 6 : precision, flags.hash, upper);
  } else {
    body = formatGeneral(magnitude, precision, flags.hash, upper);
  }
  return padNumeric(sign, '', body, width, flags.zero, flags.minus, false);
}

function formatS(arg: string, flags: Flags, width: number, precision: number | null): string {
  const s = precision === null ? arg : arg.slice(0, precision);
  return padSpaces(s, width, flags.minus);
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let argIndex = 0;
  let result = '';
  const re = /%([-+0 #]*)(\d*)(\.\d*)?([diouxXeEfFgGsc%])/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(fmt)) !== null) {
    result += fmt.slice(lastIndex, m.index);
    lastIndex = re.lastIndex;
    const flagsStr = m[1];
    const widthStr = m[2];
    const precStr = m[3];
    const conv = m[4];
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
    const precision = precStr === undefined ? null : precStr.length > 1 ? parseInt(precStr.slice(1), 10) : 0;
    const arg = args[argIndex++];
    switch (conv) {
      case 'd':
      case 'i':
        result += formatDI(arg as number | bigint, flags, width, precision);
        break;
      case 'x':
      case 'X':
      case 'o':
        result += formatXXO(conv, arg as number | bigint, flags, width, precision);
        break;
      case 'e':
      case 'E':
      case 'f':
      case 'F':
      case 'g':
      case 'G':
        result += formatFloatConv(conv, arg as number, flags, width, precision);
        break;
      case 's':
        result += formatS(arg as string, flags, width, precision);
        break;
      case 'c':
        result += padSpaces(arg as string, width, flags.minus);
        break;
    }
  }
  result += fmt.slice(lastIndex);
  return result;
}
