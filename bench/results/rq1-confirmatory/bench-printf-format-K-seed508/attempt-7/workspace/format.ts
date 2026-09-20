// Exact decomposition of a non-negative finite double into its exact decimal
// representation: value === Number(intPart + "." + frac) exactly (finite,
// terminating decimal, since binary fractions terminate in base 10).
function decompose(value: number): { intPart: string; frac: string } {
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setFloat64(0, value);
  const bits = view.getBigUint64(0);
  const expBits = (bits >> 52n) & 0x7ffn;
  const mantissaBits = bits & 0xfffffffffffffn;

  let mantissa: bigint;
  let e: number;
  if (expBits === 0n) {
    mantissa = mantissaBits;
    e = -1074;
  } else {
    mantissa = mantissaBits | (1n << 52n);
    e = Number(expBits) - 1023 - 52;
  }

  let numerator: bigint;
  let k: number;
  if (e >= 0) {
    numerator = mantissa * 2n ** BigInt(e);
    k = 0;
  } else {
    numerator = mantissa * 5n ** BigInt(-e);
    k = -e;
  }

  let s = numerator.toString();
  if (k === 0) {
    return { intPart: s, frac: '' };
  }
  if (s.length <= k) {
    s = s.padStart(k + 1, '0');
  }
  return { intPart: s.slice(0, s.length - k), frac: s.slice(s.length - k) };
}

// Round the exact decimal intPart.frac to n fractional digits, using
// round-half-to-even based on the exact (finite) discarded digits.
function roundFrac(
  intPart: string,
  frac: string,
  n: number
): { intPart: string; frac: string } {
  if (n >= frac.length) {
    return { intPart, frac: frac + '0'.repeat(n - frac.length) };
  }
  const keepFrac = frac.slice(0, n);
  const dropped = frac.slice(n);
  const keptStr = intPart + keepFrac;
  const firstDropped = dropped[0];

  let roundUp: boolean;
  if (firstDropped > '5') {
    roundUp = true;
  } else if (firstDropped === '5') {
    if (/[1-9]/.test(dropped.slice(1))) {
      roundUp = true;
    } else {
      const lastKept = keptStr[keptStr.length - 1];
      roundUp = parseInt(lastKept, 10) % 2 === 1;
    }
  } else {
    roundUp = false;
  }

  if (!roundUp) {
    return { intPart, frac: keepFrac };
  }

  const incremented = (BigInt(keptStr) + 1n).toString().padStart(keptStr.length, '0');
  if (incremented.length > keptStr.length) {
    return {
      intPart: incremented.slice(0, intPart.length + 1),
      frac: incremented.slice(intPart.length + 1),
    };
  }
  return {
    intPart: incremented.slice(0, intPart.length),
    frac: incremented.slice(intPart.length),
  };
}

// Round to p+1 significant digits (scientific notation with p digits after
// the point). Returns the p+1 digit string and the base-10 exponent.
function roundSignificant(
  intPart: string,
  frac: string,
  p: number
): { digits: string; exp: number } {
  const allDigits = intPart + frac;
  const decPointPos = intPart.length;
  const firstNonZero = allDigits.search(/[1-9]/);
  if (firstNonZero === -1) {
    return { digits: '0'.repeat(p + 1), exp: 0 };
  }
  const x0 = decPointPos - 1 - firstNonZero;
  const sig = allDigits.slice(firstNonZero);
  const rounded = roundFrac(sig[0], sig.slice(1), p);
  if (rounded.intPart.length > 1) {
    const combined = rounded.intPart + rounded.frac;
    return { digits: combined.slice(0, p + 1), exp: x0 + 1 };
  }
  return { digits: rounded.intPart + rounded.frac, exp: x0 };
}

function isNegativeValue(value: number): boolean {
  return value < 0 || Object.is(value, -0);
}

function padNumber(
  sign: string,
  prefix: string,
  digits: string,
  width: number,
  zeroFlag: boolean,
  leftFlag: boolean
): string {
  const core = sign + prefix + digits;
  if (core.length >= width) return core;
  const padLen = width - core.length;
  if (leftFlag) return core + ' '.repeat(padLen);
  if (zeroFlag) return sign + prefix + '0'.repeat(padLen) + digits;
  return ' '.repeat(padLen) + core;
}

function padText(text: string, width: number, leftFlag: boolean): string {
  if (text.length >= width) return text;
  const pad = ' '.repeat(width - text.length);
  return leftFlag ? text + pad : pad + text;
}

function stripTrailingZeros(frac: string): string {
  return frac.replace(/0+$/, '');
}

function formatFExact(
  intPart: string,
  frac: string,
  precision: number,
  hashFlag: boolean
): string {
  const rounded = roundFrac(intPart, frac, precision);
  if (precision === 0 && !hashFlag) return rounded.intPart;
  return rounded.intPart + '.' + rounded.frac;
}

function formatEExact(
  intPart: string,
  frac: string,
  precision: number,
  hashFlag: boolean,
  upper: boolean
): string {
  const { digits, exp } = roundSignificant(intPart, frac, precision);
  let mantissa = digits[0];
  if (precision > 0 || hashFlag) mantissa += '.' + digits.slice(1);
  const expSign = exp < 0 ? '-' : '+';
  const expAbs = Math.abs(exp).toString().padStart(2, '0');
  return mantissa + (upper ? 'E' : 'e') + expSign + expAbs;
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let argIndex = 0;
  const nextArg = () => args[argIndex++];

  const re = /%([-+0# ]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc%])/g;

  return fmt.replace(re, (_match, flagsStr: string, widthStr: string, precStr: string | undefined, conv: string) => {
    if (conv === '%') return '%';

    const leftFlag = flagsStr.includes('-');
    const plusFlag = flagsStr.includes('+');
    const spaceFlag = flagsStr.includes(' ');
    const hashFlag = flagsStr.includes('#');
    const zeroFlagRaw = flagsStr.includes('0');
    const width = widthStr ? parseInt(widthStr, 10) : 0;
    const precisionGiven = precStr !== undefined;
    const precision = precisionGiven ? (precStr === '' ? 0 : parseInt(precStr, 10)) : undefined;

    switch (conv) {
      case 'd':
      case 'i': {
        const raw = nextArg() as number | bigint;
        const isBig = typeof raw === 'bigint';
        const neg = isBig ? (raw as bigint) < 0n : (raw as number) < 0;
        const magStr = isBig
          ? (neg ? -(raw as bigint) : (raw as bigint)).toString()
          : Math.abs(raw as number).toString();

        let digits: string;
        if (precisionGiven) {
          if (precision === 0 && magStr === '0') digits = '';
          else digits = magStr.padStart(precision as number, '0');
        } else {
          digits = magStr;
        }

        const sign = neg ? '-' : plusFlag ? '+' : spaceFlag ? ' ' : '';
        const zeroFlag = zeroFlagRaw && !precisionGiven && !leftFlag;
        return padNumber(sign, '', digits, width, zeroFlag, leftFlag);
      }

      case 'x':
      case 'X':
      case 'o': {
        const raw = nextArg() as number | bigint;
        const isBig = typeof raw === 'bigint';
        const magStr = isBig
          ? (raw as bigint).toString(conv === 'o' ? 8 : 16)
          : (raw as number).toString(conv === 'o' ? 8 : 16);
        const isZeroVal = isBig ? (raw as bigint) === 0n : (raw as number) === 0;

        let digits: string;
        if (precisionGiven) {
          if (precision === 0 && isZeroVal) digits = '';
          else digits = magStr.padStart(precision as number, '0');
        } else {
          digits = magStr;
        }

        if (conv === 'o' && hashFlag) {
          if (digits.length === 0 || digits[0] !== '0') digits = '0' + digits;
        }

        let prefix = '';
        if (hashFlag && (conv === 'x' || conv === 'X') && !isZeroVal) {
          prefix = conv === 'x' ? '0x' : '0X';
        }
        if (conv === 'X') digits = digits.toUpperCase();

        const zeroFlag = zeroFlagRaw && !precisionGiven && !leftFlag;
        return padNumber('', prefix, digits, width, zeroFlag, leftFlag);
      }

      case 'e':
      case 'E':
      case 'f':
      case 'F':
      case 'g':
      case 'G': {
        const value = nextArg() as number;
        const upper = conv === conv.toUpperCase();

        if (Number.isNaN(value)) {
          const text = upper ? 'NAN' : 'nan';
          return padText(text, width, leftFlag);
        }
        if (!Number.isFinite(value)) {
          const sign = isNegativeValue(value) ? '-' : plusFlag ? '+' : spaceFlag ? ' ' : '';
          const text = sign + (upper ? 'INF' : 'inf');
          return padText(text, width, leftFlag);
        }

        const sign = isNegativeValue(value) ? '-' : plusFlag ? '+' : spaceFlag ? ' ' : '';
        const { intPart, frac } = decompose(Math.abs(value));
        const zeroFlag = zeroFlagRaw && !leftFlag;

        if (conv === 'f' || conv === 'F') {
          const prec = precision !== undefined ? precision : 6;
          const digits = formatFExact(intPart, frac, prec, hashFlag);
          return padNumber(sign, '', digits, width, zeroFlag, leftFlag);
        }

        if (conv === 'e' || conv === 'E') {
          const prec = precision !== undefined ? precision : 6;
          const digits = formatEExact(intPart, frac, prec, hashFlag, upper);
          return padNumber(sign, '', digits, width, zeroFlag, leftFlag);
        }

        // g, G
        let P = precision !== undefined ? precision : 6;
        if (P === 0) P = 1;
        const { exp: X } = roundSignificant(intPart, frac, P - 1);

        let body: string;
        if (P > X && X >= -4) {
          const prec = P - 1 - X;
          const rounded = roundFrac(intPart, frac, prec);
          let f = rounded.frac;
          if (!hashFlag) f = stripTrailingZeros(f);
          body = f.length > 0 || hashFlag ? rounded.intPart + '.' + f : rounded.intPart;
        } else {
          const prec = P - 1;
          const { digits, exp } = roundSignificant(intPart, frac, prec);
          let mantissaFrac = digits.slice(1);
          if (!hashFlag) mantissaFrac = stripTrailingZeros(mantissaFrac);
          const mantissa = mantissaFrac.length > 0 || hashFlag ? digits[0] + '.' + mantissaFrac : digits[0];
          const expSign = exp < 0 ? '-' : '+';
          const expAbs = Math.abs(exp).toString().padStart(2, '0');
          body = mantissa + (upper ? 'E' : 'e') + expSign + expAbs;
        }

        return padNumber(sign, '', body, width, zeroFlag, leftFlag);
      }

      case 's': {
        const value = nextArg() as string;
        const text = precision !== undefined ? value.slice(0, precision) : value;
        return padText(text, width, leftFlag);
      }

      case 'c': {
        const value = nextArg() as string;
        return padText(value, width, leftFlag);
      }

      default:
        return _match;
    }
  });
}
