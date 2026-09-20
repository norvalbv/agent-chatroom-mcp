type Flags = {
  minus: boolean;
  plus: boolean;
  space: boolean;
  zero: boolean;
  hash: boolean;
};

function decomposeDouble(x: number): { M: bigint; E: number } {
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const exponent = (hi >>> 20) & 0x7ff;
  const mantissaHigh = hi & 0xfffff;
  const mantissa = (BigInt(mantissaHigh) << 32n) | BigInt(lo >>> 0);
  if (exponent === 0) {
    return { M: mantissa, E: -1074 };
  }
  return { M: mantissa | (1n << 52n), E: exponent - 1075 };
}

function pow10(n: number): bigint {
  return 10n ** BigInt(n);
}
function pow2(n: number): bigint {
  return 2n ** BigInt(n);
}

// round(M * 2^E * 10^p) with ties-to-even, returns a nonnegative BigInt
function roundValueTimesPow10(M: bigint, E: number, p: number): bigint {
  if (M === 0n) return 0n;
  const numerator = M * pow2(Math.max(E, 0)) * pow10(Math.max(p, 0));
  const denominator = pow2(Math.max(-E, 0)) * pow10(Math.max(-p, 0));
  let q = numerator / denominator;
  const r = numerator % denominator;
  const twice = r * 2n;
  if (twice > denominator) {
    q += 1n;
  } else if (twice === denominator) {
    if (q % 2n === 1n) q += 1n;
  }
  return q;
}

// Returns n correctly-rounded significant digits of M*2^E, plus the decimal
// exponent X such that value ~= digits[0].digits[1:] * 10^X.
function getRoundedDigits(M: bigint, E: number, n: number): { digits: string; exponent: number } {
  const approxLog10 = Math.log10(Number(M)) + E * Math.log10(2);
  let exp10 = Math.floor(approxLog10);
  for (let i = 0; i < 10; i++) {
    const p = n - 1 - exp10;
    const D = roundValueTimesPow10(M, E, p);
    const s = D.toString();
    if (s.length === n) {
      return { digits: s, exponent: exp10 };
    } else if (s.length > n) {
      exp10 += s.length - n;
    } else {
      exp10 -= n - s.length;
    }
  }
  // fallback (should not happen)
  const p = n - 1 - exp10;
  const D = roundValueTimesPow10(M, E, p);
  return { digits: D.toString().padStart(n, '0'), exponent: exp10 };
}

function applyWidth(sign: string, prefix: string, digits: string, width: number, flags: Flags): string {
  const body = sign + prefix + digits;
  if (body.length >= width) return body;
  const pad = width - body.length;
  if (flags.minus) return body + ' '.repeat(pad);
  if (flags.zero) return sign + prefix + '0'.repeat(pad) + digits;
  return ' '.repeat(pad) + body;
}

function padPlain(body: string, width: number, leftAlign: boolean): string {
  if (body.length >= width) return body;
  const pad = width - body.length;
  return leftAlign ? body + ' '.repeat(pad) : ' '.repeat(pad) + body;
}

function signFor(neg: boolean, flags: Flags): string {
  if (neg) return '-';
  if (flags.plus) return '+';
  if (flags.space) return ' ';
  return '';
}

function isNegSign(x: number): boolean {
  return x < 0 || Object.is(x, -0);
}

function formatIntBody(mag: bigint, precision: number | undefined): string {
  if (precision !== undefined && precision === 0 && mag === 0n) return '';
  let digits = mag.toString(10);
  if (precision !== undefined && digits.length < precision) {
    digits = digits.padStart(precision, '0');
  }
  return digits;
}

function formatDI(arg: number | bigint, flags: Flags, width: number, precision: number | undefined): string {
  let neg: boolean;
  let mag: bigint;
  if (typeof arg === 'bigint') {
    neg = arg < 0n;
    mag = neg ? -arg : arg;
  } else {
    neg = arg < 0;
    mag = BigInt(Math.abs(arg));
  }
  const digits = formatIntBody(mag, precision);
  const sign = signFor(neg, flags);
  const zeroOk = flags.zero && precision === undefined;
  const useFlags: Flags = { ...flags, zero: zeroOk };
  return applyWidth(sign, '', digits, width, useFlags);
}

function formatXO(arg: number | bigint, base: 16 | 8, upper: boolean, flags: Flags, width: number, precision: number | undefined): string {
  const mag = typeof arg === 'bigint' ? arg : BigInt(arg);
  let digits = mag.toString(base);
  if (upper) digits = digits.toUpperCase();
  if (precision !== undefined) {
    if (precision === 0 && mag === 0n) {
      digits = '';
    } else {
      digits = digits.padStart(precision, '0');
    }
  }
  let prefix = '';
  if (flags.hash) {
    if (base === 16) {
      if (mag !== 0n) prefix = upper ? '0X' : '0x';
    } else {
      if (digits === '' || digits[0] !== '0') {
        digits = '0' + digits;
      }
    }
  }
  const zeroOk = flags.zero && precision === undefined;
  const useFlags: Flags = { ...flags, zero: zeroOk };
  return applyWidth('', prefix, digits, width, useFlags);
}

function expString(exponent: number): string {
  const sign = exponent >= 0 ? '+' : '-';
  const abs = Math.abs(exponent).toString().padStart(2, '0');
  return sign + abs;
}

function specialFloat(x: number, upper: boolean): string | null {
  if (Number.isNaN(x)) return upper ? 'NAN' : 'nan';
  if (!Number.isFinite(x)) return upper ? 'INF' : 'inf';
  return null;
}

function formatE(x: number, flags: Flags, width: number, precision: number | undefined, upper: boolean): string {
  const p = precision === undefined ? 6 : precision;
  const special = specialFloat(x, upper);
  if (special !== null) {
    const sign = Number.isNaN(x) ? '' : signFor(isNegSign(x), flags);
    return applyWidth(sign, '', special, width, { ...flags, zero: false });
  }
  const neg = isNegSign(x);
  const mag = Math.abs(x);
  let digits: string;
  let exponent: number;
  if (mag === 0) {
    digits = '0'.repeat(p + 1);
    exponent = 0;
  } else {
    const { M, E } = decomposeDouble(mag);
    const r = getRoundedDigits(M, E, p + 1);
    digits = r.digits;
    exponent = r.exponent;
  }
  const first = digits[0];
  const rest = digits.slice(1);
  const mantissa = first + (rest.length > 0 ? '.' + rest : flags.hash ? '.' : '');
  const eLetter = upper ? 'E' : 'e';
  const body = mantissa + eLetter + expString(exponent);
  const sign = signFor(neg, flags);
  return applyWidth(sign, '', body, width, flags);
}

function formatF(x: number, flags: Flags, width: number, precision: number | undefined, upper: boolean): string {
  const p = precision === undefined ? 6 : precision;
  const special = specialFloat(x, upper);
  if (special !== null) {
    const sign = Number.isNaN(x) ? '' : signFor(isNegSign(x), flags);
    return applyWidth(sign, '', special, width, { ...flags, zero: false });
  }
  const neg = isNegSign(x);
  const mag = Math.abs(x);
  let intPart: string;
  let fracPart: string;
  if (mag === 0) {
    intPart = '0';
    fracPart = '0'.repeat(p);
  } else {
    const { M, E } = decomposeDouble(mag);
    const D = roundValueTimesPow10(M, E, p);
    let s = D.toString();
    if (s.length <= p) s = s.padStart(p + 1, '0');
    if (p === 0) {
      intPart = s;
      fracPart = '';
    } else {
      intPart = s.slice(0, s.length - p);
      fracPart = s.slice(s.length - p);
    }
  }
  const body = intPart + (p > 0 ? '.' + fracPart : flags.hash ? '.' : '');
  const sign = signFor(neg, flags);
  return applyWidth(sign, '', body, width, flags);
}

function formatG(x: number, flags: Flags, width: number, precision: number | undefined, upper: boolean): string {
  const rawP = precision === undefined ? 6 : precision;
  const P = rawP === 0 ? 1 : rawP;
  const special = specialFloat(x, upper);
  if (special !== null) {
    const sign = Number.isNaN(x) ? '' : signFor(isNegSign(x), flags);
    return applyWidth(sign, '', special, width, { ...flags, zero: false });
  }
  const neg = isNegSign(x);
  const mag = Math.abs(x);
  let digits: string;
  let X: number;
  if (mag === 0) {
    digits = '0'.repeat(P);
    X = 0;
  } else {
    const { M, E } = decomposeDouble(mag);
    const r = getRoundedDigits(M, E, P);
    digits = r.digits;
    X = r.exponent;
  }
  let body: string;
  if (P > X && X >= -4) {
    const pointPos = X + 1;
    let intPart: string;
    let fracPart: string;
    if (pointPos <= 0) {
      intPart = '0';
      fracPart = '0'.repeat(-pointPos) + digits;
    } else if (pointPos >= P) {
      intPart = digits.padEnd(pointPos, '0');
      fracPart = '';
    } else {
      intPart = digits.slice(0, pointPos);
      fracPart = digits.slice(pointPos);
    }
    if (!flags.hash) {
      fracPart = fracPart.replace(/0+$/, '');
    }
    body = intPart + (fracPart.length > 0 ? '.' + fracPart : flags.hash ? '.' : '');
  } else {
    let rest = digits.slice(1);
    if (!flags.hash) {
      rest = rest.replace(/0+$/, '');
    }
    const mantissa = digits[0] + (rest.length > 0 ? '.' + rest : flags.hash ? '.' : '');
    const eLetter = upper ? 'E' : 'e';
    body = mantissa + eLetter + expString(X);
  }
  const sign = signFor(neg, flags);
  return applyWidth(sign, '', body, width, flags);
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let result = '';
  let argIndex = 0;
  const re = /%([-+0 #]*)(\d*)(\.\d*)?([diouxXeEfFgGsc%])/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(fmt)) !== null) {
    result += fmt.slice(lastIndex, match.index);
    lastIndex = re.lastIndex;
    const [, flagStr, widthStr, precStr, conv] = match;
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
    const width = widthStr ? parseInt(widthStr, 10) : 0;
    let precision: number | undefined;
    if (precStr !== undefined) {
      precision = precStr.length > 1 ? parseInt(precStr.slice(1), 10) : 0;
    }
    const arg = args[argIndex++];
    switch (conv) {
      case 'd':
      case 'i':
        result += formatDI(arg as number | bigint, flags, width, precision);
        break;
      case 'x':
        result += formatXO(arg as number | bigint, 16, false, flags, width, precision);
        break;
      case 'X':
        result += formatXO(arg as number | bigint, 16, true, flags, width, precision);
        break;
      case 'o':
        result += formatXO(arg as number | bigint, 8, false, flags, width, precision);
        break;
      case 'e':
        result += formatE(arg as number, flags, width, precision, false);
        break;
      case 'E':
        result += formatE(arg as number, flags, width, precision, true);
        break;
      case 'f':
        result += formatF(arg as number, flags, width, precision, false);
        break;
      case 'F':
        result += formatF(arg as number, flags, width, precision, true);
        break;
      case 'g':
        result += formatG(arg as number, flags, width, precision, false);
        break;
      case 'G':
        result += formatG(arg as number, flags, width, precision, true);
        break;
      case 's': {
        let s = arg as string;
        if (precision !== undefined) s = s.slice(0, precision);
        result += padPlain(s, width, flags.minus);
        break;
      }
      case 'c': {
        const s = arg as string;
        result += padPlain(s, width, flags.minus);
        break;
      }
    }
  }
  result += fmt.slice(lastIndex);
  return result;
}
