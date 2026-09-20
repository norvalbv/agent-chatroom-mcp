type Decomposed = { sign: boolean; m: bigint; e: number };

function decompose(x: number): Decomposed {
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const sign = (hi >>> 31) !== 0;
  const expBits = (hi >>> 20) & 0x7ff;
  const mantHi = hi & 0xfffff;
  const mantissa = (BigInt(mantHi) << 32n) | BigInt(lo >>> 0);
  if (expBits === 0) {
    return { sign, m: mantissa, e: -1074 };
  }
  return { sign, m: mantissa | (1n << 52n), e: expBits - 1075 };
}

// Returns round(m * 2^e * 10^k) to nearest, ties to even. m >= 0.
function roundExact(m: bigint, e: number, k: number): bigint {
  if (m === 0n) return 0n;
  const a = e + k;
  const b = k;
  let numerator = m;
  let denominator = 1n;
  if (a >= 0) numerator *= 1n << BigInt(a);
  else denominator *= 1n << BigInt(-a);
  if (b >= 0) numerator *= 5n ** BigInt(b);
  else denominator *= 5n ** BigInt(-b);
  if (denominator === 1n) return numerator;
  const q = numerator / denominator;
  const r = numerator % denominator;
  const twiceR = r * 2n;
  if (twiceR < denominator) return q;
  if (twiceR > denominator) return q + 1n;
  return q % 2n === 0n ? q : q + 1n;
}

// Digits of |value| with `precision` digits after the decimal point (no sign, no leading trim).
function toFixedDigits(m: bigint, e: number, precision: number): string {
  const N = roundExact(m, e, precision);
  let s = N.toString();
  if (precision > 0) {
    if (s.length <= precision) s = '0'.repeat(precision - s.length + 1) + s;
    const intPart = s.slice(0, s.length - precision);
    const fracPart = s.slice(s.length - precision);
    return intPart + '.' + fracPart;
  }
  return s;
}

// (precision+1) significant digits and decimal exponent for e-style notation of |value|.
function toExpDigits(m: bigint, e: number, precision: number): { digits: string; exponent: number } {
  if (m === 0n) {
    return { digits: '0'.repeat(precision + 1), exponent: 0 };
  }
  const approx = Number(m) * Math.pow(2, e);
  let X = Math.floor(Math.log10(Math.abs(approx)));
  let digits = '';
  for (let iter = 0; iter < 20; iter++) {
    const k = precision - X;
    const N = roundExact(m, e, k);
    const s = N.toString();
    const diff = s.length - (precision + 1);
    if (diff === 0) {
      digits = s;
      break;
    }
    X += diff;
    if (iter === 19) digits = s;
  }
  return { digits, exponent: X };
}

function trimFixedTrailingZeros(s: string): string {
  if (!s.includes('.')) return s;
  s = s.replace(/0+$/, '');
  if (s.endsWith('.')) s = s.slice(0, -1);
  return s;
}

function padNumeric(prefix: string, digits: string, width: number, leftAlign: boolean, zeroFlag: boolean): string {
  const total = prefix + digits;
  if (total.length >= width) return total;
  const padLen = width - total.length;
  if (leftAlign) return total + ' '.repeat(padLen);
  if (zeroFlag) return prefix + '0'.repeat(padLen) + digits;
  return ' '.repeat(padLen) + total;
}

function padSimple(str: string, width: number, leftAlign: boolean): string {
  if (str.length >= width) return str;
  const padding = ' '.repeat(width - str.length);
  return leftAlign ? str + padding : padding + str;
}

function toBigInt(v: number | bigint): bigint {
  return typeof v === 'bigint' ? v : BigInt(v);
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let argIndex = 0;
  const nextArg = () => args[argIndex++];

  const re = /%([-+ 0#]*)(\d*)(\.\d*)?([a-zA-Z%])/g;

  return fmt.replace(re, (_match, flagsStr: string, widthStr: string, precStr: string | undefined, conv: string) => {
    if (conv === '%') return '%';

    const leftAlign = flagsStr.includes('-');
    const plusFlag = flagsStr.includes('+');
    const spaceFlag = flagsStr.includes(' ');
    const hashFlag = flagsStr.includes('#');
    const zeroFlagRaw = flagsStr.includes('0');
    const width = widthStr ? parseInt(widthStr, 10) : 0;
    const precision = precStr === undefined ? undefined : precStr.length > 1 ? parseInt(precStr.slice(1), 10) : 0;

    if (conv === 'd' || conv === 'i') {
      const bi = toBigInt(nextArg() as number | bigint);
      const negative = bi < 0n;
      const abs = negative ? -bi : bi;
      let digits = abs.toString();
      if (precision !== undefined) {
        digits = abs === 0n && precision === 0 ? '' : digits.padStart(precision, '0');
      }
      const sign = negative ? '-' : plusFlag ? '+' : spaceFlag ? ' ' : '';
      const zeroFlag = zeroFlagRaw && !leftAlign && precision === undefined;
      return padNumeric(sign, digits, width, leftAlign, zeroFlag);
    }

    if (conv === 'x' || conv === 'X' || conv === 'o') {
      const bi = toBigInt(nextArg() as number | bigint);
      let digits = bi.toString(conv === 'o' ? 8 : 16);
      if (conv === 'X') digits = digits.toUpperCase();
      if (precision !== undefined) {
        digits = bi === 0n && precision === 0 ? '' : digits.padStart(precision, '0');
      }
      let prefix = '';
      if (hashFlag) {
        if (conv === 'o') {
          if (digits.length === 0 || digits[0] !== '0') digits = '0' + digits;
        } else if (bi !== 0n) {
          prefix = conv === 'X' ? '0X' : '0x';
        }
      }
      const zeroFlag = zeroFlagRaw && !leftAlign && precision === undefined;
      return padNumeric(prefix, digits, width, leftAlign, zeroFlag);
    }

    if (conv === 'e' || conv === 'E' || conv === 'f' || conv === 'F' || conv === 'g' || conv === 'G') {
      const x = nextArg() as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';

      if (Number.isNaN(x)) {
        const text = upper ? 'NAN' : 'nan';
        return padNumeric('', text, width, leftAlign, false);
      }

      if (!Number.isFinite(x)) {
        const negative = x < 0;
        const sign = negative ? '-' : plusFlag ? '+' : spaceFlag ? ' ' : '';
        const text = upper ? 'INF' : 'inf';
        return padNumeric(sign, text, width, leftAlign, false);
      }

      const { sign: negBit, m, e } = decompose(x);
      const sign = negBit ? '-' : plusFlag ? '+' : spaceFlag ? ' ' : '';
      const zeroFlag = zeroFlagRaw && !leftAlign;
      let text: string;

      if (conv === 'f' || conv === 'F') {
        const p = precision === undefined ? 6 : precision;
        let digits = toFixedDigits(m, e, p);
        if (p === 0 && hashFlag) digits += '.';
        text = digits;
      } else if (conv === 'e' || conv === 'E') {
        const p = precision === undefined ? 6 : precision;
        const { digits, exponent } = toExpDigits(m, e, p);
        let mantissa = digits[0];
        if (p > 0) mantissa += '.' + digits.slice(1);
        else if (hashFlag) mantissa += '.';
        const expSign = exponent < 0 ? '-' : '+';
        const expAbs = Math.abs(exponent).toString().padStart(2, '0');
        text = mantissa + (upper ? 'E' : 'e') + expSign + expAbs;
      } else {
        const P = precision === undefined ? 6 : precision === 0 ? 1 : precision;
        const { exponent: X } = toExpDigits(m, e, P - 1);
        if (P > X && X >= -4) {
          const fPrecision = P - 1 - X;
          let digits = toFixedDigits(m, e, fPrecision);
          if (!hashFlag) digits = trimFixedTrailingZeros(digits);
          text = digits;
        } else {
          const { digits: edigits } = toExpDigits(m, e, P - 1);
          const first = edigits[0];
          let frac = edigits.slice(1);
          if (!hashFlag) frac = frac.replace(/0+$/, '');
          const mantissa = frac.length > 0 ? first + '.' + frac : hashFlag ? first + '.' : first;
          const expSign = X < 0 ? '-' : '+';
          const expAbs = Math.abs(X).toString().padStart(2, '0');
          text = mantissa + (upper ? 'E' : 'e') + expSign + expAbs;
        }
      }

      return padNumeric(sign, text, width, leftAlign, zeroFlag);
    }

    if (conv === 's') {
      let str = nextArg() as string;
      if (precision !== undefined) str = str.slice(0, precision);
      return padSimple(str, width, leftAlign);
    }

    if (conv === 'c') {
      const ch = nextArg() as string;
      return padSimple(ch, width, leftAlign);
    }

    return _match;
  });
}
