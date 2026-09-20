function roundDiv(num: bigint, den: bigint): bigint {
  if (den === 1n) return num;
  const q = num / den;
  const r = num % den;
  const twice = r * 2n;
  if (twice < den) return q;
  if (twice > den) return q + 1n;
  return q % 2n === 0n ? q : q + 1n;
}

function roundExact(m: bigint, exp2: number, k: number): bigint {
  let num = m;
  let den = 1n;
  if (exp2 >= 0) num *= 2n ** BigInt(exp2);
  else den *= 2n ** BigInt(-exp2);
  if (k >= 0) num *= 10n ** BigInt(k);
  else den *= 10n ** BigInt(-k);
  return roundDiv(num, den);
}

function decompose(x: number): { m: bigint; exp2: number } {
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  const mantHi = hi & 0xfffff;
  let m = (BigInt(mantHi) << 32n) | BigInt(lo);
  let exp2: number;
  if (expBits === 0) {
    exp2 = -1074;
  } else {
    m |= 1n << 52n;
    exp2 = expBits - 1075;
  }
  return { m, exp2 };
}

function toSignificant(
  m: bigint,
  exp2: number,
  P: number,
  approxLog10: number
): { digits: string; exp: number } {
  let X = Math.floor(approxLog10);
  for (let attempt = 0; attempt < 20; attempt++) {
    const k = P - 1 - X;
    const N = roundExact(m, exp2, k);
    const s = N.toString();
    if (s.length === P) {
      return { digits: s, exp: X };
    } else if (s.length === P + 1) {
      return { digits: s.slice(0, P), exp: X + 1 };
    } else {
      X += s.length - P;
    }
  }
  throw new Error('failed to converge');
}

interface Flags {
  minus: boolean;
  plus: boolean;
  space: boolean;
  zero: boolean;
  hash: boolean;
}

function assemble(
  sign: string,
  prefix: string,
  digits: string,
  width: number,
  flags: Flags,
  zeroEligible: boolean
): string {
  const body = sign + prefix + digits;
  if (body.length >= width) return body;
  const padLen = width - body.length;
  if (flags.minus) return body + ' '.repeat(padLen);
  if (flags.zero && zeroEligible) return sign + prefix + '0'.repeat(padLen) + digits;
  return ' '.repeat(padLen) + body;
}

function formatIntegerDigits(
  absBig: bigint,
  precision: number | undefined,
  base: number,
  upper: boolean
): string {
  let digits = absBig.toString(base);
  if (upper) digits = digits.toUpperCase();
  if (precision !== undefined) {
    if (precision === 0 && absBig === 0n) digits = '';
    else digits = digits.padStart(precision, '0');
  }
  return digits;
}

function stripTrailingZeros(frac: string, hash: boolean): string {
  if (hash) return frac;
  let end = frac.length;
  while (end > 0 && frac[end - 1] === '0') end--;
  return frac.slice(0, end);
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let result = '';
  let argIndex = 0;
  const re = /%([-+ #0]*)(\d*)(?:\.(\d*))?([a-zA-Z%])/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = re.exec(fmt)) !== null) {
    result += fmt.slice(lastIndex, match.index);
    lastIndex = re.lastIndex;
    const [, flagsStr, widthStr, precStr, conv] = match;

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
    const precision =
      precStr === undefined ? undefined : precStr === '' ? 0 : parseInt(precStr, 10);

    const arg = args[argIndex++];

    if (conv === 'd' || conv === 'i') {
      const big = typeof arg === 'bigint' ? arg : BigInt(arg as number);
      const neg = big < 0n;
      const absBig = neg ? -big : big;
      const digits = formatIntegerDigits(absBig, precision, 10, false);
      const sign = neg ? '-' : flags.plus ? '+' : flags.space ? ' ' : '';
      const zeroEligible = !flags.minus && precision === undefined;
      result += assemble(sign, '', digits, width, flags, zeroEligible);
    } else if (conv === 'x' || conv === 'X' || conv === 'o') {
      const absBig = typeof arg === 'bigint' ? arg : BigInt(arg as number);
      let digits = formatIntegerDigits(absBig, precision, conv === 'o' ? 8 : 16, conv === 'X');
      let prefix = '';
      if (conv === 'o') {
        if (flags.hash && (digits === '' || digits[0] !== '0')) digits = '0' + digits;
      } else {
        if (flags.hash && absBig !== 0n) prefix = conv === 'X' ? '0X' : '0x';
      }
      const zeroEligible = !flags.minus && precision === undefined;
      result += assemble('', prefix, digits, width, flags, zeroEligible);
    } else if (conv === 's') {
      const str = arg as string;
      const text = precision !== undefined ? str.slice(0, precision) : str;
      result += assemble('', '', text, width, flags, false);
    } else if (conv === 'c') {
      const text = arg as string;
      result += assemble('', '', text, width, flags, false);
    } else if (conv === 'e' || conv === 'E' || conv === 'f' || conv === 'F' || conv === 'g' || conv === 'G') {
      const value = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      const isNaNVal = Number.isNaN(value);
      const isInf = !isNaNVal && !Number.isFinite(value);
      const negSign = isNaNVal ? false : Object.is(value, -0) ? true : value < 0;
      const sign = negSign ? '-' : flags.plus ? '+' : flags.space ? ' ' : '';

      let text: string;
      let zeroEligible = false;

      if (isNaNVal) {
        text = upper ? 'NAN' : 'nan';
        result += assemble('', '', text, width, flags, false);
        continue;
      } else if (isInf) {
        text = upper ? 'INF' : 'inf';
        result += assemble(sign, '', text, width, flags, false);
        continue;
      }

      const abs = Math.abs(value);
      zeroEligible = !flags.minus;

      if (conv === 'e' || conv === 'E') {
        const prec = precision === undefined ? 6 : precision;
        let digits: string;
        let X: number;
        if (abs === 0) {
          digits = '0'.repeat(prec + 1);
          X = 0;
        } else {
          const { m, exp2 } = decompose(abs);
          const approxLog10 = Math.log10(abs);
          const res = toSignificant(m, exp2, prec + 1, approxLog10);
          digits = res.digits;
          X = res.exp;
        }
        const mantissaDigit = digits[0];
        const frac = digits.slice(1);
        const dot = prec === 0 ? (flags.hash ? '.' : '') : '.';
        const expSign = X >= 0 ? '+' : '-';
        const expDigits = Math.abs(X).toString().padStart(2, '0');
        text = mantissaDigit + dot + frac + (upper ? 'E' : 'e') + expSign + expDigits;
        result += assemble(sign, '', text, width, flags, zeroEligible);
      } else if (conv === 'f' || conv === 'F') {
        const prec = precision === undefined ? 6 : precision;
        let intPart: string;
        let fracPart: string;
        if (abs === 0) {
          intPart = '0';
          fracPart = '0'.repeat(prec);
        } else {
          const { m, exp2 } = decompose(abs);
          const N = roundExact(m, exp2, prec);
          let digits = N.toString().padStart(prec + 1, '0');
          intPart = digits.slice(0, digits.length - prec) || '0';
          fracPart = prec > 0 ? digits.slice(digits.length - prec) : '';
        }
        const dot = prec === 0 ? (flags.hash ? '.' : '') : '.';
        text = intPart + dot + fracPart;
        result += assemble(sign, '', text, width, flags, zeroEligible);
      } else {
        // g, G
        let P = precision === undefined ? 6 : precision === 0 ? 1 : precision;
        let digits: string;
        let X: number;
        if (abs === 0) {
          digits = '0'.repeat(P);
          X = 0;
        } else {
          const { m, exp2 } = decompose(abs);
          const approxLog10 = Math.log10(abs);
          const res = toSignificant(m, exp2, P, approxLog10);
          digits = res.digits;
          X = res.exp;
        }
        if (P > X && X >= -4) {
          const fprec = P - 1 - X;
          let intPart: string;
          let fracPart: string;
          if (X >= 0) {
            intPart = digits.slice(0, X + 1);
            fracPart = digits.slice(X + 1);
          } else {
            intPart = '0';
            fracPart = '0'.repeat(-X - 1) + digits;
          }
          fracPart = stripTrailingZeros(fracPart, flags.hash);
          text = intPart + (fracPart ? '.' + fracPart : flags.hash ? '.' : '');
        } else {
          const eprec = P - 1;
          const mantissaDigit = digits[0];
          let frac = digits.slice(1);
          frac = stripTrailingZeros(frac, flags.hash);
          const expSign = X >= 0 ? '+' : '-';
          const expDigits = Math.abs(X).toString().padStart(2, '0');
          text =
            mantissaDigit +
            (frac ? '.' + frac : flags.hash ? '.' : '') +
            (upper ? 'E' : 'e') +
            expSign +
            expDigits;
        }
        result += assemble(sign, '', text, width, flags, zeroEligible);
      }
    }
  }

  result += fmt.slice(lastIndex);
  return result;
}
