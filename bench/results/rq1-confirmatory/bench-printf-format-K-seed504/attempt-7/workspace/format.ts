// ---- exact binary decomposition helpers ----

function decompose(x: number): { M: bigint; E: number } {
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const exponentBits = (hi >>> 20) & 0x7ff;
  const mantissaHi = hi & 0xfffff;
  const mantissaBits = (BigInt(mantissaHi) << 32n) | BigInt(lo);
  if (exponentBits === 0) {
    return { M: mantissaBits, E: -1074 };
  }
  const M = mantissaBits | (1n << 52n);
  const E = exponentBits - 1075;
  return { M, E };
}

// compare M * 2^E  to  10^X
function cmpValueToPow10(M: bigint, E: number, X: number): number {
  let lhsNum = M;
  let lhsDen = 1n;
  if (E >= 0) lhsNum <<= BigInt(E);
  else lhsDen <<= BigInt(-E);
  let rhsNum: bigint;
  let rhsDen: bigint;
  if (X >= 0) {
    rhsNum = 10n ** BigInt(X);
    rhsDen = 1n;
  } else {
    rhsNum = 1n;
    rhsDen = 10n ** BigInt(-X);
  }
  const l = lhsNum * rhsDen;
  const r = rhsNum * lhsDen;
  return l < r ? -1 : l > r ? 1 : 0;
}

// round(M * 2^E * 10^s) to nearest integer, ties to even
function scaledRound(M: bigint, E: number, s: number): bigint {
  const a = E + s;
  const b = s;
  let num = M;
  let den = 1n;
  if (a >= 0) num <<= BigInt(a);
  else den <<= BigInt(-a);
  if (b >= 0) num *= 5n ** BigInt(b);
  else den *= 5n ** BigInt(-b);
  const q = num / den;
  const r = num % den;
  const twiceR = r * 2n;
  if (twiceR < den) return q;
  if (twiceR > den) return q + 1n;
  return q % 2n === 0n ? q : q + 1n;
}

function computeSigDigits(absVal: number, sigDigits: number): { digits: string; X: number } {
  if (absVal === 0) {
    return { digits: '0'.repeat(sigDigits), X: 0 };
  }
  const { M, E } = decompose(absVal);
  let X = Math.floor(Math.log10(absVal));
  if (!isFinite(X)) X = 0;
  while (cmpValueToPow10(M, E, X + 1) >= 0) X++;
  while (cmpValueToPow10(M, E, X) < 0) X--;
  let digitsBig = scaledRound(M, E, sigDigits - 1 - X);
  let digitStr = digitsBig.toString();
  if (digitStr.length > sigDigits) {
    X += digitStr.length - sigDigits;
    digitStr = digitStr.slice(0, sigDigits);
  } else if (digitStr.length < sigDigits) {
    digitStr = digitStr.padStart(sigDigits, '0');
  }
  return { digits: digitStr, X };
}

function fParts(absVal: number, precision: number): { intPart: string; fracPart: string } {
  const { M, E } = decompose(absVal);
  const rounded = scaledRound(M, E, precision);
  let s = rounded.toString();
  if (s.length <= precision) s = s.padStart(precision + 1, '0');
  const intPart = s.slice(0, s.length - precision);
  const fracPart = precision > 0 ? s.slice(s.length - precision) : '';
  return { intPart, fracPart };
}

// ---- flags ----

interface Flags {
  minus: boolean;
  plus: boolean;
  space: boolean;
  zero: boolean;
  hash: boolean;
}

function parseFlags(s: string): Flags {
  return {
    minus: s.includes('-'),
    plus: s.includes('+'),
    space: s.includes(' '),
    zero: s.includes('0'),
    hash: s.includes('#'),
  };
}

function padNumeric(sign: string, prefix: string, body: string, width: number, flags: Flags, zeroApplies: boolean): string {
  const core = sign + prefix + body;
  if (width <= core.length) return core;
  const padLen = width - core.length;
  if (flags.minus) return core + ' '.repeat(padLen);
  if (flags.zero && zeroApplies) return sign + prefix + '0'.repeat(padLen) + body;
  return ' '.repeat(padLen) + core;
}

function padText(text: string, width: number, minus: boolean): string {
  if (width <= text.length) return text;
  const pad = ' '.repeat(width - text.length);
  return minus ? text + pad : pad + text;
}

function toBigIntMagnitude(arg: number | bigint | string): bigint {
  if (typeof arg === 'bigint') return arg < 0n ? -arg : arg;
  const n = arg as number;
  const b = BigInt(n);
  return b < 0n ? -b : b;
}

function isNegative(arg: number | bigint | string): boolean {
  if (typeof arg === 'bigint') return arg < 0n;
  return (arg as number) < 0;
}

function intDigitsWithPrecision(magnitude: bigint, precision: number | undefined): string {
  let digits = magnitude.toString(10);
  if (precision !== undefined) {
    if (magnitude === 0n && precision === 0) {
      digits = '';
    } else {
      digits = digits.padStart(precision, '0');
    }
  }
  return digits;
}

function signStringForInt(neg: boolean, flags: Flags): string {
  if (neg) return '-';
  if (flags.plus) return '+';
  if (flags.space) return ' ';
  return '';
}

function signStringForFloat(value: number, flags: Flags): string {
  if (Number.isNaN(value)) return '';
  const negBit = value < 0 || Object.is(value, -0);
  if (negBit) return '-';
  if (flags.plus) return '+';
  if (flags.space) return ' ';
  return '';
}

function formatFracStrip(intPart: string, fracPart: string, hash: boolean): string {
  if (hash) {
    return intPart + '.' + fracPart;
  }
  let f = fracPart.replace(/0+$/, '');
  if (f === '') return intPart;
  return intPart + '.' + f;
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let out = '';
  let argIdx = 0;
  const re = /%([-+0# ]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc%])/g;
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
    const width = widthStr === '' ? 0 : parseInt(widthStr, 10);
    const precision = precStr === undefined ? undefined : precStr === '' ? 0 : parseInt(precStr, 10);
    const arg = args[argIdx++];

    if (conv === 'd' || conv === 'i') {
      const neg = isNegative(arg);
      const mag = toBigIntMagnitude(arg);
      const digits = intDigitsWithPrecision(mag, precision);
      const sign = signStringForInt(neg, flags);
      const zeroApplies = precision === undefined;
      out += padNumeric(sign, '', digits, width, flags, zeroApplies);
    } else if (conv === 'x' || conv === 'X' || conv === 'o') {
      const mag = toBigIntMagnitude(arg);
      const base = conv === 'o' ? 8 : 16;
      let digits = mag.toString(base);
      if (precision !== undefined) {
        if (mag === 0n && precision === 0) digits = '';
        else digits = digits.padStart(precision, '0');
      }
      if (conv === 'X') digits = digits.toUpperCase();
      let prefix = '';
      if (flags.hash) {
        if (conv === 'o') {
          if (digits === '' || digits[0] !== '0') digits = '0' + digits;
        } else if (mag !== 0n) {
          prefix = conv === 'X' ? '0X' : '0x';
        }
      }
      const zeroApplies = precision === undefined;
      out += padNumeric('', prefix, digits, width, flags, zeroApplies);
    } else if (conv === 's') {
      let s = arg as string;
      if (precision !== undefined) s = s.slice(0, precision);
      out += padText(s, width, flags.minus);
    } else if (conv === 'c') {
      const s = arg as string;
      out += padText(s, width, flags.minus);
    } else if (conv === 'e' || conv === 'E' || conv === 'f' || conv === 'F' || conv === 'g' || conv === 'G') {
      const value = arg as number;
      const upper = conv === 'F' || conv === 'E' || conv === 'G';
      const sign = signStringForFloat(value, flags);

      if (Number.isNaN(value)) {
        const body = upper ? 'NAN' : 'nan';
        out += padNumeric('', '', body, width, flags, false);
        continue;
      }
      if (!isFinite(value)) {
        const body = upper ? 'INF' : 'inf';
        out += padNumeric(sign, '', body, width, flags, false);
        continue;
      }

      const absVal = Math.abs(value);
      const zeroApplies = true;

      if (conv === 'f' || conv === 'F') {
        const p = precision === undefined ? 6 : precision;
        const { intPart, fracPart } = fParts(absVal, p);
        const body = p > 0 || flags.hash ? intPart + '.' + fracPart : intPart;
        out += padNumeric(sign, '', body, width, flags, zeroApplies);
      } else if (conv === 'e' || conv === 'E') {
        const p = precision === undefined ? 6 : precision;
        const { digits, X } = computeSigDigits(absVal, p + 1);
        const mantissa = p > 0 || flags.hash ? digits[0] + '.' + digits.slice(1) : digits[0];
        const expChar = conv === 'E' ? 'E' : 'e';
        const expSign = X >= 0 ? '+' : '-';
        const expDigits = Math.abs(X).toString().padStart(2, '0');
        const body = mantissa + expChar + expSign + expDigits;
        out += padNumeric(sign, '', body, width, flags, zeroApplies);
      } else {
        // g, G
        const P = precision === undefined ? 6 : precision === 0 ? 1 : precision;
        const { digits, X } = computeSigDigits(absVal, P);
        let body: string;
        if (P > X && X >= -4) {
          const p = P - 1 - X;
          const { intPart, fracPart } = fParts(absVal, p);
          body = formatFracStrip(intPart, fracPart, flags.hash);
        } else {
          const p = P - 1;
          const intPart = digits[0];
          const fracPart = digits.slice(1);
          const mantissa = formatFracStrip(intPart, fracPart, flags.hash);
          const expChar = conv === 'G' ? 'E' : 'e';
          const expSign = X >= 0 ? '+' : '-';
          const expDigits = Math.abs(X).toString().padStart(2, '0');
          body = mantissa + expChar + expSign + expDigits;
        }
        out += padNumeric(sign, '', body, width, flags, zeroApplies);
      }
    }
  }
  out += fmt.slice(lastIndex);
  return out;
}
