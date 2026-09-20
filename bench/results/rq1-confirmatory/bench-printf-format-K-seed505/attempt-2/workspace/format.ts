type Flags = {
  minus: boolean;
  plus: boolean;
  space: boolean;
  zero: boolean;
  hash: boolean;
};

function decompose(x: number): { num: bigint; k: number } {
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  const mantHi = BigInt(hi & 0xfffff);
  const mant = (mantHi << 32n) | BigInt(lo);
  let M: bigint;
  let e: number;
  if (expBits === 0) {
    M = mant;
    e = -1074;
  } else {
    M = mant | (1n << 52n);
    e = expBits - 1075;
  }
  if (e >= 0) {
    return { num: M << BigInt(e), k: 0 };
  }
  const k = -e;
  return { num: M * 5n ** BigInt(k), k };
}

function roundDiv(num: bigint, D: bigint): bigint {
  const q = num / D;
  const r = num % D;
  const twice = r * 2n;
  if (twice < D) return q;
  if (twice > D) return q + 1n;
  return q % 2n === 0n ? q : q + 1n;
}

function fScaled(num: bigint, k: number, prec: number): bigint {
  const shift = k - prec;
  if (shift <= 0) {
    return num * 10n ** BigInt(-shift);
  }
  return roundDiv(num, 10n ** BigInt(shift));
}

function fBody(num: bigint, k: number, prec: number, hash: boolean): string {
  const target = fScaled(num, k, prec);
  const divisor = 10n ** BigInt(prec);
  const intPart = target / divisor;
  const fracPart = target % divisor;
  let s = intPart.toString();
  if (prec > 0) {
    s += '.' + fracPart.toString().padStart(prec, '0');
  } else if (hash) {
    s += '.';
  }
  return s;
}

function eRound(num: bigint, k: number, prec: number): { digits: string; exp: number } {
  const s = num.toString();
  const len = s.length;
  let E0 = len - 1 - k;
  const shift = prec - len + 1;
  let target: bigint;
  if (shift >= 0) {
    target = num * 10n ** BigInt(shift);
  } else {
    target = roundDiv(num, 10n ** BigInt(-shift));
  }
  let digits = target.toString();
  if (digits.length > prec + 1) {
    target = target / 10n;
    E0 += 1;
    digits = target.toString();
  }
  digits = digits.padStart(prec + 1, '0');
  return { digits, exp: E0 };
}

function eBody(num: bigint, k: number, prec: number, hash: boolean, upperE: boolean): string {
  let digits: string;
  let exp: number;
  if (num === 0n) {
    digits = '0'.repeat(prec + 1);
    exp = 0;
  } else {
    const r = eRound(num, k, prec);
    digits = r.digits;
    exp = r.exp;
  }
  let s = digits[0];
  if (prec > 0) {
    s += '.' + digits.slice(1);
  } else if (hash) {
    s += '.';
  }
  const eChar = upperE ? 'E' : 'e';
  const expSign = exp < 0 ? '-' : '+';
  const expAbs = Math.abs(exp).toString().padStart(2, '0');
  return s + eChar + expSign + expAbs;
}

function stripTrailingZeros(s: string): string {
  const m = s.match(/^([^eE]*)([eE].*)?$/);
  let mantissa = m![1];
  const suffix = m![2] ?? '';
  if (mantissa.includes('.')) {
    mantissa = mantissa.replace(/0+$/, '');
    mantissa = mantissa.replace(/\.$/, '');
  }
  return mantissa + suffix;
}

function gBody(num: bigint, k: number, P: number, hash: boolean, upper: boolean): string {
  const prec = P - 1;
  let X: number;
  if (num === 0n) {
    X = 0;
  } else {
    X = eRound(num, k, prec).exp;
  }
  let body: string;
  if (P > X && X >= -4) {
    const fprec = P - 1 - X;
    body = fBody(num, k, fprec, hash);
  } else {
    body = eBody(num, k, prec, hash, upper);
  }
  if (!hash) body = stripTrailingZeros(body);
  return body;
}

function padNum(sign: string, prefix: string, digits: string, width: number, minus: boolean, zero: boolean): string {
  const body = sign + prefix + digits;
  if (body.length >= width) return body;
  if (minus) return body + ' '.repeat(width - body.length);
  if (zero) return sign + prefix + '0'.repeat(width - body.length) + digits;
  return ' '.repeat(width - body.length) + body;
}

function padStr(s: string, width: number, minus: boolean): string {
  if (s.length >= width) return s;
  const pad = ' '.repeat(width - s.length);
  return minus ? s + pad : pad + s;
}

function formatOne(
  conv: string,
  flags: Flags,
  width: number,
  precision: number | undefined,
  hasPrecision: boolean,
  arg: number | bigint | string,
): string {
  if (conv === 'd' || conv === 'i') {
    const val = typeof arg === 'bigint' ? arg : BigInt(arg as number);
    const neg = val < 0n;
    let digits = (neg ? -val : val).toString();
    if (hasPrecision) {
      digits = precision === 0 && val === 0n ? '' : digits.padStart(precision!, '0');
    }
    const sign = neg ? '-' : flags.plus ? '+' : flags.space ? ' ' : '';
    const zeroOk = flags.zero && !flags.minus && !hasPrecision;
    return padNum(sign, '', digits, width, flags.minus, zeroOk);
  }

  if (conv === 'x' || conv === 'X' || conv === 'o') {
    const val = typeof arg === 'bigint' ? arg : BigInt(arg as number);
    let digits = val.toString(conv === 'o' ? 8 : 16);
    if (conv === 'X') digits = digits.toUpperCase();
    if (hasPrecision) {
      digits = precision === 0 && val === 0n ? '' : digits.padStart(precision!, '0');
    }
    let prefix = '';
    if (flags.hash) {
      if (conv === 'o') {
        if (digits === '' || digits[0] !== '0') {
          digits = '0' + digits;
        }
      } else if (val !== 0n) {
        prefix = conv === 'x' ? '0x' : '0X';
      }
    }
    const zeroOk = flags.zero && !flags.minus && !hasPrecision;
    return padNum('', prefix, digits, width, flags.minus, zeroOk);
  }

  if (conv === 'e' || conv === 'E' || conv === 'f' || conv === 'F' || conv === 'g' || conv === 'G') {
    const val = arg as number;
    const isUpper = conv === 'E' || conv === 'F' || conv === 'G';
    const isNaNVal = Number.isNaN(val);
    const negBit = !isNaNVal && (val < 0 || Object.is(val, -0));
    const absVal = isNaNVal ? NaN : Math.abs(val);
    let signStr = '';
    if (!isNaNVal) {
      signStr = negBit ? '-' : flags.plus ? '+' : flags.space ? ' ' : '';
    }

    let body: string;
    let isSpecial = false;
    if (isNaNVal) {
      body = isUpper ? 'NAN' : 'nan';
      isSpecial = true;
    } else if (!Number.isFinite(absVal)) {
      body = isUpper ? 'INF' : 'inf';
      isSpecial = true;
    } else {
      const { num, k } = decompose(absVal);
      if (conv === 'f' || conv === 'F') {
        const prec = precision ?? 6;
        body = fBody(num, k, prec, flags.hash);
      } else if (conv === 'e' || conv === 'E') {
        const prec = precision ?? 6;
        body = eBody(num, k, prec, flags.hash, isUpper);
      } else {
        const P = precision === undefined ? 6 : precision === 0 ? 1 : precision;
        body = gBody(num, k, P, flags.hash, isUpper);
      }
    }
    const zeroOk = flags.zero && !flags.minus && !isSpecial;
    return padNum(signStr, '', body, width, flags.minus, zeroOk);
  }

  if (conv === 's') {
    let str = arg as string;
    if (hasPrecision) str = str.slice(0, precision);
    return padStr(str, width, flags.minus);
  }

  if (conv === 'c') {
    return padStr(arg as string, width, flags.minus);
  }

  throw new Error(`unsupported conversion: ${conv}`);
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let argIndex = 0;
  let result = '';
  let lastIndex = 0;
  const re = /%([-+0 #]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc%])/g;
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
    const hasPrecision = precStr !== undefined;
    const precision = hasPrecision ? (precStr === '' ? 0 : parseInt(precStr, 10)) : undefined;
    const arg = args[argIndex++];
    result += formatOne(conv, flags, width, precision, hasPrecision, arg);
  }
  result += fmt.slice(lastIndex);
  return result;
}
