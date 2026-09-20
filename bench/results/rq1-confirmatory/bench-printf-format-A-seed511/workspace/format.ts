export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let out = '';
  let argIndex = 0;
  let i = 0;
  const len = fmt.length;

  while (i < len) {
    const ch = fmt[i];
    if (ch !== '%') {
      out += ch;
      i++;
      continue;
    }

    i++; // skip '%'
    if (fmt[i] === '%') {
      out += '%';
      i++;
      continue;
    }

    // flags
    const flags = new Set<string>();
    while (i < len && '-+ 0#'.includes(fmt[i])) {
      flags.add(fmt[i]);
      i++;
    }

    // width
    let width: number | undefined;
    let widthStr = '';
    while (i < len && fmt[i] >= '0' && fmt[i] <= '9') {
      widthStr += fmt[i];
      i++;
    }
    if (widthStr !== '') width = parseInt(widthStr, 10);

    // precision
    let precision: number | undefined;
    if (fmt[i] === '.') {
      i++;
      let precStr = '';
      while (i < len && fmt[i] >= '0' && fmt[i] <= '9') {
        precStr += fmt[i];
        i++;
      }
      precision = precStr === '' ? 0 : parseInt(precStr, 10);
    }

    const conv = fmt[i];
    i++;

    const arg = args[argIndex++];
    out += convert(conv, flags, width, precision, arg);
  }

  return out;
}

function toBigInt(v: number | bigint): bigint {
  return typeof v === 'bigint' ? v : BigInt(v);
}

// Decompose a non-negative finite double into mantissa * 2^exp2 (exact).
function decompose(x: number): { mantissa: bigint; exp2: number } {
  if (x === 0) return { mantissa: 0n, exp2: 0 };
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, x);
  const hi = buf.getUint32(0);
  const lo = buf.getUint32(4);
  const E = (hi >>> 20) & 0x7ff;
  const mHigh = hi & 0xfffff;
  const M = (BigInt(mHigh) << 32n) | BigInt(lo);
  if (E === 0) {
    return { mantissa: M, exp2: -1074 };
  }
  return { mantissa: M | (1n << 52n), exp2: E - 1075 };
}

// Represent a non-negative finite double exactly as numerator / 10^fracLen.
function toExactDecimal(x: number): { numerator: bigint; fracLen: number } {
  if (x === 0) return { numerator: 0n, fracLen: 0 };
  const { mantissa, exp2 } = decompose(x);
  if (exp2 >= 0) {
    return { numerator: mantissa << BigInt(exp2), fracLen: 0 };
  }
  const k = -exp2;
  return { numerator: mantissa * 5n ** BigInt(k), fracLen: k };
}

// Round N (a non-negative integer) by dropping its last `dropCount` decimal
// digits, using round-half-to-even. dropCount may be <= 0 (no-op / pad).
function roundDrop(N: bigint, dropCount: number): bigint {
  if (dropCount <= 0) return N * 10n ** BigInt(-dropCount);
  const divisor = 10n ** BigInt(dropCount);
  const q = N / divisor;
  const r = N % divisor;
  const twice = r * 2n;
  if (twice > divisor) return q + 1n;
  if (twice < divisor) return q;
  return q % 2n === 0n ? q : q + 1n;
}

// Round a non-negative finite double to `sig` significant decimal digits.
// Returns the digit string (length sig) and the base-10 exponent X such that
// value ~= d1.d2...dsig * 10^X.
function roundSignificant(x: number, sig: number): { digits: string; exponent: number } {
  if (x === 0) return { digits: '0'.repeat(sig), exponent: 0 };
  const { numerator: N, fracLen: k } = toExactDecimal(x);
  const s = N.toString();
  const n = s.length;
  let exponent = n - 1 - k;
  let digits: string;
  if (n > sig) {
    const rounded = roundDrop(N, n - sig);
    let s2 = rounded.toString();
    if (s2.length > sig) {
      exponent += 1;
      s2 = s2.slice(0, sig);
    } else if (s2.length < sig) {
      s2 = s2.padStart(sig, '0');
    }
    digits = s2;
  } else if (n < sig) {
    digits = (N * 10n ** BigInt(sig - n)).toString().padStart(sig, '0');
  } else {
    digits = s;
  }
  return { digits, exponent };
}

function padNumeric(
  sign: string,
  prefix: string,
  digits: string,
  width: number | undefined,
  zeroFlag: boolean,
  leftAlign: boolean,
): string {
  const bodyLen = sign.length + prefix.length + digits.length;
  if (width === undefined || bodyLen >= width) {
    return sign + prefix + digits;
  }
  if (leftAlign) {
    return (sign + prefix + digits).padEnd(width);
  }
  if (zeroFlag) {
    return sign + prefix + digits.padStart(digits.length + (width - bodyLen), '0');
  }
  return (sign + prefix + digits).padStart(width);
}

function signFor(negative: boolean, flags: Set<string>): string {
  if (negative) return '-';
  if (flags.has('+')) return '+';
  if (flags.has(' ')) return ' ';
  return '';
}

function convert(
  conv: string,
  flags: Set<string>,
  width: number | undefined,
  precision: number | undefined,
  arg: number | bigint | string,
): string {
  const leftAlign = flags.has('-');
  const zeroFlag = flags.has('0');
  const hash = flags.has('#');

  switch (conv) {
    case 'd':
    case 'i': {
      const value = toBigInt(arg as number | bigint);
      const negative = value < 0n;
      const magnitude = negative ? -value : value;
      let digits: string;
      if (precision !== undefined) {
        if (precision === 0 && magnitude === 0n) {
          digits = '';
        } else {
          digits = magnitude.toString(10).padStart(precision, '0');
        }
      } else {
        digits = magnitude.toString(10);
      }
      const sign = signFor(negative, flags);
      const useZero = zeroFlag && !leftAlign && precision === undefined;
      return padNumeric(sign, '', digits, width, useZero, leftAlign);
    }

    case 'x':
    case 'X':
    case 'o': {
      const value = toBigInt(arg as number | bigint);
      const base = conv === 'o' ? 8 : 16;
      let digits = value.toString(base);
      if (conv === 'X') digits = digits.toUpperCase();
      if (precision !== undefined) {
        if (precision === 0 && value === 0n) {
          digits = '';
        } else {
          digits = digits.padStart(precision, '0');
        }
      }
      let prefix = '';
      if (hash) {
        if ((conv === 'x' || conv === 'X') && value !== 0n) {
          prefix = conv === 'X' ? '0X' : '0x';
        } else if (conv === 'o') {
          if (!digits.startsWith('0')) {
            digits = digits.padStart(digits.length + 1, '0');
          }
        }
      }
      const useZero = zeroFlag && !leftAlign && precision === undefined;
      return padNumeric('', prefix, digits, width, useZero, leftAlign);
    }

    case 'e':
    case 'E':
    case 'f':
    case 'F':
    case 'g':
    case 'G': {
      const x = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      if (Number.isNaN(x)) {
        const text = upper ? 'NAN' : 'nan';
        return padNumeric('', '', text, width, false, leftAlign);
      }
      const negative = x < 0 || Object.is(x, -0);
      const sign = signFor(negative, flags);
      if (!Number.isFinite(x)) {
        const text = upper ? 'INF' : 'inf';
        return padNumeric(sign, '', text, width, false, leftAlign);
      }
      const absX = Math.abs(x);
      const useZero = zeroFlag && !leftAlign;

      if (conv === 'f' || conv === 'F') {
        const p = precision === undefined ? 6 : precision;
        const { numerator: N, fracLen: k } = toExactDecimal(absX);
        const newN = k > p ? roundDrop(N, k - p) : N * 10n ** BigInt(p - k);
        const s = newN.toString().padStart(p + 1, '0');
        const intPart = p > 0 ? s.slice(0, s.length - p) : s;
        const fracPart = p > 0 ? s.slice(s.length - p) : '';
        const dot = p > 0 || hash ? '.' : '';
        const digits = intPart + dot + fracPart;
        return padNumeric(sign, '', digits, width, useZero, leftAlign);
      }

      if (conv === 'e' || conv === 'E') {
        const p = precision === undefined ? 6 : precision;
        const { digits: sigDigits, exponent } = roundSignificant(absX, p + 1);
        const first = sigDigits[0];
        const rest = sigDigits.slice(1);
        const dot = p > 0 || hash ? '.' : '';
        const expSign = exponent < 0 ? '-' : '+';
        const expAbs = Math.abs(exponent).toString().padStart(2, '0');
        const digits = first + dot + rest + (upper ? 'E' : 'e') + expSign + expAbs;
        return padNumeric(sign, '', digits, width, useZero, leftAlign);
      }

      // g, G
      {
        const given = precision === undefined ? 6 : precision === 0 ? 1 : precision;
        const { digits: sigDigits, exponent: X } = roundSignificant(absX, given);
        let digits: string;
        if (given > X && X >= -4) {
          // f-style
          let intPart: string;
          let fracPart: string;
          if (X >= 0) {
            intPart = sigDigits.slice(0, X + 1);
            fracPart = sigDigits.slice(X + 1);
          } else {
            intPart = '0';
            fracPart = '0'.repeat(-X - 1) + sigDigits;
          }
          if (!hash) {
            fracPart = fracPart.replace(/0+$/, '');
          }
          digits = fracPart.length > 0 || hash ? intPart + '.' + fracPart : intPart;
        } else {
          // e-style
          const first = sigDigits[0];
          let rest = sigDigits.slice(1);
          if (!hash) {
            rest = rest.replace(/0+$/, '');
          }
          const mantissa = rest.length > 0 || hash ? first + '.' + rest : first;
          const expSign = X < 0 ? '-' : '+';
          const expAbs = Math.abs(X).toString().padStart(2, '0');
          digits = mantissa + (upper ? 'E' : 'e') + expSign + expAbs;
        }
        return padNumeric(sign, '', digits, width, useZero, leftAlign);
      }
    }

    case 's': {
      let text = arg as string;
      if (precision !== undefined) text = text.slice(0, precision);
      if (width === undefined || text.length >= width) return text;
      return leftAlign ? text.padEnd(width) : text.padStart(width);
    }

    case 'c': {
      const text = arg as string;
      if (width === undefined || text.length >= width) return text;
      return leftAlign ? text.padEnd(width) : text.padStart(width);
    }

    default:
      throw new Error(`unsupported conversion: %${conv}`);
  }
}
