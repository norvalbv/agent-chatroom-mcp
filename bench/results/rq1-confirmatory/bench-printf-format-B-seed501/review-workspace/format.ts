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
  const expBits = (hi >>> 20) & 0x7ff;
  const mantHi = BigInt(hi & 0xfffff);
  const mantLo = BigInt(lo >>> 0);
  let mantissa = (mantHi << 32n) | mantLo;
  let E: number;
  if (expBits === 0) {
    E = -1074;
  } else {
    mantissa = mantissa | (1n << 52n);
    E = expBits - 1075;
  }
  return { M: mantissa, E };
}

function roundFraction(N: bigint, D: bigint): bigint {
  let q = N / D;
  const r = N % D;
  const twiceR = r * 2n;
  if (twiceR > D) q += 1n;
  else if (twiceR === D) {
    if (q % 2n === 1n) q += 1n;
  }
  return q;
}

// round(M * 2^E * 10^d) to nearest integer, ties to even
function roundValueTimesPow10(M: bigint, E: number, d: number): bigint {
  const e2 = E + d;
  const e5 = d;
  let N = M;
  let D = 1n;
  if (e2 >= 0) N *= 1n << BigInt(e2);
  else D *= 1n << BigInt(-e2);
  if (e5 >= 0) N *= 5n ** BigInt(e5);
  else D *= 5n ** BigInt(-e5);
  return roundFraction(N, D);
}

// compare M*2^E to 10^X
function comparePow10(M: bigint, E: number, X: number): number {
  let N1 = M;
  let D1 = 1n;
  if (E >= 0) N1 *= 1n << BigInt(E);
  else D1 *= 1n << BigInt(-E);
  let N2 = 1n;
  let D2 = 1n;
  if (X >= 0) N2 *= 10n ** BigInt(X);
  else D2 *= 10n ** BigInt(-X);
  const left = N1 * D2;
  const right = N2 * D1;
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function findExponent(M: bigint, E: number, x: number): number {
  let X = Math.floor(Math.log10(x));
  while (comparePow10(M, E, X) < 0) X--;
  while (comparePow10(M, E, X + 1) >= 0) X++;
  return X;
}

// returns P+1 significant digits (as string) and the decimal exponent
function expDigitsAndExponent(absX: number, P: number): { digits: string; X: number } {
  if (absX === 0) return { digits: '0'.repeat(P + 1), X: 0 };
  const { M, E } = decomposeDouble(absX);
  let X = findExponent(M, E, absX);
  let digitsBig = roundValueTimesPow10(M, E, P - X);
  let digits = digitsBig.toString();
  if (digits.length > P + 1) {
    X += 1;
    digits = digits.slice(0, P + 1);
  } else if (digits.length < P + 1) {
    digits = digits.padStart(P + 1, '0');
  }
  return { digits, X };
}

function fIntegerAndFraction(absX: number, P: number): { intPart: string; fracPart: string } {
  let intVal: bigint;
  if (absX === 0) {
    intVal = 0n;
  } else {
    const { M, E } = decomposeDouble(absX);
    intVal = roundValueTimesPow10(M, E, P);
  }
  let s = intVal.toString();
  if (s.length < P + 1) s = s.padStart(P + 1, '0');
  const intPart = P > 0 ? s.slice(0, s.length - P) : s;
  const fracPart = P > 0 ? s.slice(s.length - P) : '';
  return { intPart, fracPart };
}

function padNum(
  sign: string,
  prefix: string,
  digits: string,
  width: number,
  flagMinus: boolean,
  useZero: boolean
): string {
  const bodyLen = sign.length + prefix.length + digits.length;
  if (bodyLen >= width) return sign + prefix + digits;
  const padLen = width - bodyLen;
  if (flagMinus) return sign + prefix + digits + ' '.repeat(padLen);
  if (useZero) return sign + prefix + '0'.repeat(padLen) + digits;
  return ' '.repeat(padLen) + sign + prefix + digits;
}

function padText(text: string, width: number, flagMinus: boolean): string {
  if (text.length >= width) return text;
  const pad = ' '.repeat(width - text.length);
  return flagMinus ? text + pad : pad + text;
}

function intDigits(mag: bigint, precision: number | null, base: number, upper: boolean): string {
  let s = mag.toString(base);
  if (upper) s = s.toUpperCase();
  if (precision === 0 && mag === 0n) return '';
  if (precision !== null) s = s.padStart(precision, '0');
  return s;
}

function signFor(neg: boolean, flags: Flags): string {
  if (neg) return '-';
  if (flags.plus) return '+';
  if (flags.space) return ' ';
  return '';
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  const re = /%([-+ 0#]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc%])/g;
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

    const flags: Flags = {
      minus: flagsStr.includes('-'),
      plus: flagsStr.includes('+'),
      space: flagsStr.includes(' '),
      zero: flagsStr.includes('0'),
      hash: flagsStr.includes('#'),
    };
    const width = widthStr ? parseInt(widthStr, 10) : 0;
    const precision = precStr === undefined ? null : precStr === '' ? 0 : parseInt(precStr, 10);

    const arg = args[argIndex++];

    if (conv === 'd' || conv === 'i') {
      const value = typeof arg === 'bigint' ? arg : BigInt(arg as number);
      const neg = value < 0n;
      const mag = neg ? -value : value;
      const digits = intDigits(mag, precision, 10, false);
      const sign = signFor(neg, flags);
      const useZero = flags.zero && precision === null;
      result += padNum(sign, '', digits, width, flags.minus, useZero);
    } else if (conv === 'x' || conv === 'X' || conv === 'o') {
      const value = typeof arg === 'bigint' ? arg : BigInt(arg as number);
      const upper = conv === 'X';
      const base = conv === 'o' ? 8 : 16;
      let digits = intDigits(value, precision, base, upper);
      if (conv === 'o' && flags.hash) {
        if (digits.length === 0 || digits[0] !== '0') digits = '0' + digits;
      }
      let prefix = '';
      if ((conv === 'x' || conv === 'X') && flags.hash && value !== 0n) {
        prefix = conv === 'X' ? '0X' : '0x';
      }
      const useZero = flags.zero && precision === null;
      result += padNum('', prefix, digits, width, flags.minus, useZero);
    } else if (conv === 'e' || conv === 'E' || conv === 'f' || conv === 'F' || conv === 'g' || conv === 'G') {
      const x = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      const isNaNVal = Number.isNaN(x);
      const isInf = !isNaNVal && !Number.isFinite(x);
      const neg = !isNaNVal && (x < 0 || Object.is(x, -0));

      if (isNaNVal) {
        const text = upper ? 'NAN' : 'nan';
        result += padText(text, width, flags.minus);
        continue;
      }
      if (isInf) {
        const sign = signFor(neg, flags);
        const text = sign + (upper ? 'INF' : 'inf');
        result += padText(text, width, flags.minus);
        continue;
      }

      const absX = Math.abs(x);
      const sign = signFor(neg, flags);
      let digitsBody: string;

      if (conv === 'e' || conv === 'E') {
        const P = precision === null ? 6 : precision;
        const { digits, X } = expDigitsAndExponent(absX, P);
        const mantissa = digits[0] + (P > 0 || flags.hash ? '.' + digits.slice(1) : '');
        const expSign = X < 0 ? '-' : '+';
        let expAbs = Math.abs(X).toString();
        if (expAbs.length < 2) expAbs = expAbs.padStart(2, '0');
        digitsBody = mantissa + (upper ? 'E' : 'e') + expSign + expAbs;
      } else if (conv === 'f' || conv === 'F') {
        const P = precision === null ? 6 : precision;
        const { intPart, fracPart } = fIntegerAndFraction(absX, P);
        digitsBody = intPart + (P > 0 || flags.hash ? '.' + fracPart : '');
      } else {
        const Pin = precision === null ? 6 : precision;
        const Pg = Pin === 0 ? 1 : Pin;
        let intPart: string;
        let fracPart: string;
        let useExp = false;
        let expX = 0;
        let mantissaDigits = '';

        if (absX === 0) {
          intPart = '0';
          fracPart = '0'.repeat(Pg - 1);
        } else {
          const { digits, X } = expDigitsAndExponent(absX, Pg - 1);
          if (Pg > X && X >= -4) {
            if (X >= 0) {
              intPart = digits.slice(0, X + 1);
              fracPart = digits.slice(X + 1);
            } else {
              intPart = '0';
              fracPart = '0'.repeat(-X - 1) + digits;
            }
          } else {
            useExp = true;
            expX = X;
            mantissaDigits = digits;
            intPart = digits[0];
            fracPart = digits.slice(1);
          }
        }

        if (!flags.hash) {
          fracPart = fracPart.replace(/0+$/, '');
        }
        const dot = fracPart.length > 0 || flags.hash ? '.' : '';

        if (useExp) {
          const expSign = expX < 0 ? '-' : '+';
          let expAbs = Math.abs(expX).toString();
          if (expAbs.length < 2) expAbs = expAbs.padStart(2, '0');
          digitsBody = intPart + dot + fracPart + (upper ? 'E' : 'e') + expSign + expAbs;
        } else {
          digitsBody = intPart + dot + fracPart;
        }
      }

      const useZero = flags.zero;
      result += padNum(sign, '', digitsBody, width, flags.minus, useZero);
    } else if (conv === 's') {
      let text = arg as string;
      if (precision !== null) text = text.slice(0, precision);
      result += padText(text, width, flags.minus);
    } else if (conv === 'c') {
      const text = arg as string;
      result += padText(text, width, flags.minus);
    }
  }

  result += fmt.slice(lastIndex);
  return result;
}
