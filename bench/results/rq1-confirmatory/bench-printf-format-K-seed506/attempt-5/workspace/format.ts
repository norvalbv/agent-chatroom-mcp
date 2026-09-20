// Exact decomposition of a finite double x >= 0 into value = M * 2^E (M, E are exact).
function decompose(x: number): { M: bigint; E: number } {
  if (x === 0) return { M: 0n, E: 0 };
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  const mantHi = hi & 0xfffff;
  const mantissa = (BigInt(mantHi) << 32n) | BigInt(lo);
  if (expBits === 0) {
    return { M: mantissa, E: -1074 };
  }
  return { M: mantissa | (1n << 52n), E: expBits - 1075 };
}

// Correctly-rounded (round-half-to-even, exact) value of round(M * 2^E * 10^n).
function scaledRound(M: bigint, E: number, n: number): bigint {
  if (M === 0n) return 0n;
  const posE = E + n;
  let numerator = M;
  let denominator = 1n;
  if (posE >= 0) numerator *= 2n ** BigInt(posE);
  else denominator *= 2n ** BigInt(-posE);
  if (n >= 0) numerator *= 5n ** BigInt(n);
  else denominator *= 5n ** BigInt(-n);
  const q = numerator / denominator;
  const r = numerator - q * denominator;
  const twiceR = r * 2n;
  if (twiceR < denominator) return q;
  if (twiceR > denominator) return q + 1n;
  return q % 2n === 0n ? q : q + 1n;
}

// Digits for f-style rounding to p fractional digits.
function fDigits(M: bigint, E: number, p: number): { intPart: string; fracPart: string } {
  const R = scaledRound(M, E, p);
  let s = R.toString();
  if (s.length <= p) s = '0'.repeat(p - s.length + 1) + s;
  const intPart = s.slice(0, s.length - p) || '0';
  const fracPart = p === 0 ? '' : s.slice(s.length - p);
  return { intPart, fracPart: p === 0 ? '' : fracPart };
}

// P correctly-rounded significant digits and decimal exponent (value = d.ddd * 10^exp).
function eDigits(M: bigint, E: number, absX: number, P: number): { digits: string; exp: number } {
  if (M === 0n) return { digits: '0'.repeat(P), exp: 0 };
  let exp = Math.floor(Math.log10(absX));
  for (;;) {
    const n = P - 1 - exp;
    const R = scaledRound(M, E, n);
    const s = R.toString();
    if (s.length > P) {
      exp += 1;
      continue;
    }
    if (s.length < P) {
      exp -= 1;
      continue;
    }
    return { digits: s, exp };
  }
}

function pad(signStr: string, prefix: string, body: string, width: number, zeroPad: boolean, leftAlign: boolean): string {
  const core = signStr + prefix + body;
  if (core.length >= width) return core;
  const padLen = width - core.length;
  if (leftAlign) return core + ' '.repeat(padLen);
  if (zeroPad) return signStr + prefix + '0'.repeat(padLen) + body;
  return ' '.repeat(padLen) + core;
}

function toBigIntAbs(v: number | bigint): { negative: boolean; abs: bigint } {
  if (typeof v === 'bigint') {
    return { negative: v < 0n, abs: v < 0n ? -v : v };
  }
  return { negative: v < 0, abs: BigInt(Math.abs(v)) };
}

function signFor(negative: boolean, flags: Set<string>): string {
  if (negative) return '-';
  if (flags.has('+')) return '+';
  if (flags.has(' ')) return ' ';
  return '';
}

function expStr(exp: number): string {
  const sign = exp < 0 ? '-' : '+';
  const abs = Math.abs(exp).toString();
  return sign + (abs.length < 2 ? '0' + abs : abs);
}

function formatFloat(conv: string, v: number, precision: number | null, flags: Set<string>, width: number): string {
  const upper = conv === 'E' || conv === 'F' || conv === 'G';
  const negative = v < 0 || Object.is(v, -0);
  const hash = flags.has('#');

  if (Number.isNaN(v)) {
    return pad('', '', upper ? 'NAN' : 'nan', width, false, flags.has('-'));
  }
  const signStr = signFor(negative, flags);
  if (!Number.isFinite(v)) {
    return pad(signStr, '', upper ? 'INF' : 'inf', width, false, flags.has('-'));
  }

  const { M, E } = decompose(Math.abs(v));
  let digitsPart: string;

  if (conv === 'e' || conv === 'E') {
    const p = precision === null ? 6 : precision;
    const P = p + 1;
    const { digits, exp } = eDigits(M, E, Math.abs(v), P);
    let frac = digits.slice(1);
    const mantissaStr = frac.length > 0 ? digits[0] + '.' + frac : hash ? digits[0] + '.' : digits[0];
    digitsPart = mantissaStr + (upper ? 'E' : 'e') + expStr(exp);
  } else if (conv === 'f' || conv === 'F') {
    const p = precision === null ? 6 : precision;
    const { intPart, fracPart } = fDigits(M, E, p);
    digitsPart = fracPart.length > 0 ? intPart + '.' + fracPart : hash ? intPart + '.' : intPart;
  } else {
    let p = precision === null ? 6 : precision;
    if (p === 0) p = 1;
    const P = p;
    const { digits, exp } = eDigits(M, E, Math.abs(v), P);
    if (P > exp && exp >= -4) {
      const fp = P - 1 - exp;
      const { intPart, fracPart } = fDigits(M, E, fp);
      let frac = fracPart;
      if (!hash) frac = frac.replace(/0+$/, '');
      digitsPart = frac.length > 0 ? intPart + '.' + frac : hash ? intPart + '.' : intPart;
    } else {
      let frac = digits.slice(1);
      if (!hash) frac = frac.replace(/0+$/, '');
      const mantissaStr = frac.length > 0 ? digits[0] + '.' + frac : hash ? digits[0] + '.' : digits[0];
      digitsPart = mantissaStr + (conv === 'G' ? 'E' : 'e') + expStr(exp);
    }
  }

  const zeroPad = flags.has('0') && !flags.has('-');
  return pad(signStr, '', digitsPart, width, zeroPad, flags.has('-'));
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  const re = /%([-+0 #]*)(\d*)(?:\.(\d*))?([dixXoeEfFgGsc%])/g;
  let result = '';
  let lastIndex = 0;
  let argIndex = 0;
  let m: RegExpExecArray | null;

  while ((m = re.exec(fmt)) !== null) {
    result += fmt.slice(lastIndex, m.index);
    lastIndex = re.lastIndex;
    const [, flagsStr, widthStr, precStr, conv] = m;

    if (conv === '%') {
      result += '%';
      continue;
    }

    const flags = new Set(flagsStr.split(''));
    const width = widthStr ? parseInt(widthStr, 10) : 0;
    const precision = precStr !== undefined ? (precStr === '' ? 0 : parseInt(precStr, 10)) : null;

    if (conv === 'd' || conv === 'i') {
      const v = args[argIndex++] as number | bigint;
      const { negative, abs } = toBigIntAbs(v);
      let digits = abs.toString();
      if (precision !== null) {
        if (precision === 0 && abs === 0n) digits = '';
        else if (digits.length < precision) digits = '0'.repeat(precision - digits.length) + digits;
      }
      const signStr = signFor(negative, flags);
      const zeroPad = flags.has('0') && !flags.has('-') && precision === null;
      result += pad(signStr, '', digits, width, zeroPad, flags.has('-'));
    } else if (conv === 'x' || conv === 'X' || conv === 'o') {
      const v = args[argIndex++] as number | bigint;
      const abs = typeof v === 'bigint' ? v : BigInt(v);
      let digits = conv === 'o' ? abs.toString(8) : abs.toString(16);
      if (conv === 'X') digits = digits.toUpperCase();
      if (precision !== null) {
        if (precision === 0 && abs === 0n) digits = '';
        else if (digits.length < precision) digits = '0'.repeat(precision - digits.length) + digits;
      }
      let prefix = '';
      if (flags.has('#')) {
        if (conv !== 'o') {
          if (abs !== 0n) prefix = conv === 'x' ? '0x' : '0X';
        } else if (digits.length === 0 || digits[0] !== '0') {
          digits = '0' + digits;
        }
      }
      const zeroPad = flags.has('0') && !flags.has('-') && precision === null;
      result += pad('', prefix, digits, width, zeroPad, flags.has('-'));
    } else if (conv === 'e' || conv === 'E' || conv === 'f' || conv === 'F' || conv === 'g' || conv === 'G') {
      const v = args[argIndex++] as number;
      result += formatFloat(conv, v, precision, flags, width);
    } else if (conv === 's') {
      const v = args[argIndex++] as string;
      const s = precision !== null ? v.slice(0, precision) : v;
      result += pad('', '', s, width, false, flags.has('-'));
    } else if (conv === 'c') {
      const v = args[argIndex++] as string;
      result += pad('', '', v, width, false, flags.has('-'));
    }
  }

  result += fmt.slice(lastIndex);
  return result;
}
