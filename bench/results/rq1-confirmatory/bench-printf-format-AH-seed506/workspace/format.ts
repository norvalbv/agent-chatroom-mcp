// Exact decimal decomposition of a non-negative finite double `mag`
// into D (a BigInt) and e10 (an integer) such that mag === D * 10^e10 exactly.
function decompose(mag: number): { D: bigint; e10: number } {
  if (mag === 0) return { D: 0n, e10: 0 };
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setFloat64(0, mag);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  const mantissa = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo >>> 0);
  let M: bigint;
  let E: number;
  if (expBits === 0) {
    M = mantissa;
    E = -1074;
  } else {
    M = mantissa | (1n << 52n);
    E = expBits - 1075;
  }
  if (E >= 0) {
    return { D: M * 2n ** BigInt(E), e10: 0 };
  }
  return { D: M * 5n ** BigInt(-E), e10: E };
}

// round(num/den) using round-half-to-even; num >= 0, den > 0.
function divRoundEven(num: bigint, den: bigint): bigint {
  const q = num / den;
  const r = num % den;
  const twice = r * 2n;
  if (twice > den) return q + 1n;
  if (twice === den) return q % 2n === 0n ? q : q + 1n;
  return q;
}

// round(D * 10^e10 * 10^fracDigits) as an integer BigInt.
function scaledRound(D: bigint, e10: number, fracDigits: number): bigint {
  const shift = e10 + fracDigits;
  if (shift >= 0) return D * 10n ** BigInt(shift);
  return divRoundEven(D, 10n ** BigInt(-shift));
}

// Round D * 10^e10 to `sig` significant digits.
function sciRound(D: bigint, e10: number, sig: number): { exp: number; digits: string } {
  if (D === 0n) return { exp: 0, digits: '0'.repeat(sig) };
  const len = D.toString().length;
  let exp = len - 1 + e10;
  const shift = sig - len;
  const N = shift >= 0 ? D * 10n ** BigInt(shift) : divRoundEven(D, 10n ** BigInt(-shift));
  let s = N.toString();
  if (s.length > sig) {
    exp += s.length - sig;
    s = s.slice(0, sig);
  } else if (s.length < sig) {
    s = s.padStart(sig, '0');
  }
  return { exp, digits: s };
}

function buildFixed(D: bigint, e10: number, p: number, hashFlag: boolean): string {
  const N = scaledRound(D, e10, p);
  let s = N.toString();
  if (s.length < p + 1) s = s.padStart(p + 1, '0');
  const cut = s.length - p;
  const intPart = s.slice(0, cut);
  const fracPart = s.slice(cut);
  return intPart + (p > 0 || hashFlag ? '.' + fracPart : '');
}

function buildSci(D: bigint, e10: number, p: number, hashFlag: boolean, upper: boolean): string {
  const { exp, digits } = sciRound(D, e10, p + 1);
  const first = digits[0];
  const frac = digits.slice(1);
  const body = first + (p > 0 || hashFlag ? '.' + frac : '');
  const expSign = exp >= 0 ? '+' : '-';
  const expStr = String(Math.abs(exp)).padStart(2, '0');
  return body + (upper ? 'E' : 'e') + expSign + expStr;
}

function stripTrailingZerosDecimal(s: string): string {
  if (!s.includes('.')) return s;
  s = s.replace(/0+$/, '');
  if (s.endsWith('.')) s = s.slice(0, -1);
  return s;
}

function buildG(D: bigint, e10: number, pIn: number, hashFlag: boolean, upper: boolean): string {
  const Pg = pIn === 0 ? 1 : pIn;
  const { exp: X, digits: sigDigits } = sciRound(D, e10, Pg);
  if (Pg > X && X >= -4) {
    const fp = Pg - 1 - X;
    const fixed = buildFixed(D, e10, fp, true);
    return hashFlag ? fixed : stripTrailingZerosDecimal(fixed);
  }
  const p = Pg - 1;
  const first = sigDigits[0];
  const frac = sigDigits.slice(1);
  const body = first + '.' + frac;
  const bodyFinal = hashFlag ? body : stripTrailingZerosDecimal(body);
  const expSign = X >= 0 ? '+' : '-';
  const expStr = String(Math.abs(X)).padStart(2, '0');
  return bodyFinal + (upper ? 'E' : 'e') + expSign + expStr;
}

function padNumeric(sign: string, prefix: string, digits: string, width: number, minusFlag: boolean, zeroFlag: boolean): string {
  const core = sign + prefix + digits;
  if (core.length >= width) return core;
  const padLen = width - core.length;
  if (minusFlag) return core + ' '.repeat(padLen);
  if (zeroFlag) return sign + prefix + '0'.repeat(padLen) + digits;
  return ' '.repeat(padLen) + core;
}

function padGeneric(str: string, width: number, minusFlag: boolean): string {
  if (str.length >= width) return str;
  const pad = ' '.repeat(width - str.length);
  return minusFlag ? str + pad : pad + str;
}

interface Spec {
  flags: string;
  width: number;
  precision: number | undefined;
  conv: string;
}

function parseSpec(fmt: string, i: number): { spec: Spec | null; next: number } {
  let j = i;
  let flags = '';
  while (j < fmt.length && '-+0# '.includes(fmt[j])) {
    flags += fmt[j];
    j++;
  }
  let widthStr = '';
  while (j < fmt.length && fmt[j] >= '0' && fmt[j] <= '9') {
    widthStr += fmt[j];
    j++;
  }
  const width = widthStr === '' ? 0 : Number(widthStr);
  let precision: number | undefined = undefined;
  if (fmt[j] === '.') {
    j++;
    let precStr = '';
    while (j < fmt.length && fmt[j] >= '0' && fmt[j] <= '9') {
      precStr += fmt[j];
      j++;
    }
    precision = precStr === '' ? 0 : Number(precStr);
  }
  const conv = fmt[j];
  j++;
  return { spec: { flags, width, precision, conv }, next: j };
}

function toBigIntValue(arg: number | bigint): bigint {
  return typeof arg === 'bigint' ? arg : BigInt(arg as number);
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let out = '';
  let argIndex = 0;
  let i = 0;
  while (i < fmt.length) {
    const ch = fmt[i];
    if (ch !== '%') {
      out += ch;
      i++;
      continue;
    }
    if (fmt[i + 1] === '%') {
      out += '%';
      i += 2;
      continue;
    }
    const { spec, next } = parseSpec(fmt, i + 1);
    i = next;
    const { flags, width, precision, conv } = spec as Spec;
    const minusFlag = flags.includes('-');
    const zeroFlag = flags.includes('0');
    const plusFlag = flags.includes('+');
    const spaceFlag = flags.includes(' ');
    const hashFlag = flags.includes('#');

    if (conv === 'd' || conv === 'i') {
      const value = toBigIntValue(args[argIndex++] as number | bigint);
      const negative = value < 0n;
      const mag = negative ? -value : value;
      let digits: string;
      if (precision !== undefined && precision === 0 && mag === 0n) {
        digits = '';
      } else {
        digits = mag.toString();
        if (precision !== undefined) digits = digits.padStart(precision, '0');
      }
      const sign = negative ? '-' : plusFlag ? '+' : spaceFlag ? ' ' : '';
      const useZero = zeroFlag && !minusFlag && precision === undefined;
      out += padNumeric(sign, '', digits, width, minusFlag, useZero);
    } else if (conv === 'x' || conv === 'X' || conv === 'o') {
      const value = toBigIntValue(args[argIndex++] as number | bigint);
      let digits: string;
      if (precision !== undefined && precision === 0 && value === 0n) {
        digits = '';
      } else {
        digits = value.toString(conv === 'o' ? 8 : 16);
        if (conv === 'X') digits = digits.toUpperCase();
        if (precision !== undefined) digits = digits.padStart(precision, '0');
      }
      let prefix = '';
      if (hashFlag) {
        if (conv === 'o') {
          if (digits === '' || digits[0] !== '0') digits = '0' + digits;
        } else if (value !== 0n) {
          prefix = conv === 'X' ? '0X' : '0x';
        }
      }
      const useZero = zeroFlag && !minusFlag && precision === undefined;
      out += padNumeric('', prefix, digits, width, minusFlag, useZero);
    } else if (conv === 'e' || conv === 'E' || conv === 'f' || conv === 'F' || conv === 'g' || conv === 'G') {
      const x = args[argIndex++] as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      if (Number.isNaN(x)) {
        const digits = upper ? 'NAN' : 'nan';
        out += padNumeric('', '', digits, width, minusFlag, false);
        continue;
      }
      const negative = x < 0 || Object.is(x, -0);
      const sign = negative ? '-' : plusFlag ? '+' : spaceFlag ? ' ' : '';
      if (!isFinite(x)) {
        const digits = upper ? 'INF' : 'inf';
        out += padNumeric(sign, '', digits, width, minusFlag, false);
        continue;
      }
      const { D, e10 } = decompose(Math.abs(x));
      const useZero = zeroFlag && !minusFlag;
      let digits: string;
      if (conv === 'f' || conv === 'F') {
        digits = buildFixed(D, e10, precision === undefined ? 6 : precision, hashFlag);
      } else if (conv === 'e' || conv === 'E') {
        digits = buildSci(D, e10, precision === undefined ? 6 : precision, hashFlag, upper);
      } else {
        digits = buildG(D, e10, precision === undefined ? 6 : precision, hashFlag, upper);
      }
      out += padNumeric(sign, '', digits, width, minusFlag, useZero);
    } else if (conv === 's') {
      let str = args[argIndex++] as string;
      if (precision !== undefined) str = str.slice(0, precision);
      out += padGeneric(str, width, minusFlag);
    } else if (conv === 'c') {
      const str = args[argIndex++] as string;
      out += padGeneric(str, width, minusFlag);
    }
  }
  return out;
}
