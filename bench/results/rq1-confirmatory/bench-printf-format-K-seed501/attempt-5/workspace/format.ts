// ---- exact-decimal helpers (IEEE754 double -> exact rational -> rounded digits) ----

function decompose(x: number): { mantissa: bigint; exp2: number } {
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setFloat64(0, x);
  const hi = view.getUint32(0);
  const lo = view.getUint32(4);
  const exponentBits = (hi >>> 20) & 0x7ff;
  const mantissaHigh = hi & 0xfffff;
  let mantissa = (BigInt(mantissaHigh) << 32n) | BigInt(lo);
  let exp2: number;
  if (exponentBits === 0) {
    exp2 = -1074;
  } else {
    mantissa |= 1n << 52n;
    exp2 = exponentBits - 1075;
  }
  return { mantissa, exp2 };
}

function bigRoundDiv(num: bigint, den: bigint): bigint {
  const q = num / den;
  const r = num % den;
  const twice = r * 2n;
  if (twice > den) return q + 1n;
  if (twice === den) return q % 2n === 0n ? q : q + 1n;
  return q;
}

// Rounds |x| * 10^d to the nearest integer (ties to even), exactly.
function roundToDecimalShift(mantissa: bigint, exp2: number, d: number): bigint {
  if (mantissa === 0n) return 0n;
  const fiveExp = d;
  const powE = exp2 + d;
  let numerator = mantissa;
  let denominator = 1n;
  if (fiveExp >= 0) numerator *= 5n ** BigInt(fiveExp);
  else denominator *= 5n ** BigInt(-fiveExp);
  if (powE >= 0) numerator *= 2n ** BigInt(powE);
  else denominator *= 2n ** BigInt(-powE);
  return bigRoundDiv(numerator, denominator);
}

// Returns n correctly-rounded (round-half-to-even) significant digits of x>0 (finite),
// and the base-10 exponent of the first digit.
function getSignificantDigits(x: number, n: number): { digits: string; exp: number } {
  const { mantissa, exp2 } = decompose(x);
  let e0 = Math.floor(Math.log10(x));
  if (!isFinite(e0)) e0 = 0;
  for (let iter = 0; iter < 30; iter++) {
    const d = n - 1 - e0;
    const q = roundToDecimalShift(mantissa, exp2, d);
    const qStr = q.toString();
    if (qStr.length === n) return { digits: qStr, exp: e0 };
    if (qStr.length > n) {
      e0 += qStr.length - n;
    } else {
      e0 -= n - qStr.length;
    }
  }
  throw new Error('unreachable');
}

function isNeg(x: number): boolean {
  return x < 0 || Object.is(x, -0);
}

function signStr(neg: boolean, flags: string): string {
  if (neg) return '-';
  if (flags.includes('+')) return '+';
  if (flags.includes(' ')) return ' ';
  return '';
}

function toBigInt(v: number | bigint): bigint {
  return typeof v === 'bigint' ? v : BigInt(v);
}

function digitsWithPrecision(magStr: string, precision: number | undefined): string {
  if (precision === undefined) return magStr;
  if (precision === 0 && magStr === '0') return '';
  return magStr.padStart(precision, '0');
}

function pad(
  sign: string,
  prefix: string,
  digits: string,
  width: number,
  leftAlign: boolean,
  zeroPad: boolean,
): string {
  const bodyLen = sign.length + prefix.length + digits.length;
  if (width <= bodyLen) return sign + prefix + digits;
  const padLen = width - bodyLen;
  if (leftAlign) return sign + prefix + digits + ' '.repeat(padLen);
  if (zeroPad) return sign + prefix + '0'.repeat(padLen) + digits;
  return ' '.repeat(padLen) + sign + prefix + digits;
}

// ---- main formatter ----

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let out = '';
  let argIndex = 0;
  const re = /%([-+0 #]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc%])|[^%]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(fmt)) !== null) {
    if (m[4] === undefined) {
      out += m[0];
      continue;
    }
    const flags = m[1];
    const width = m[2] ? parseInt(m[2], 10) : 0;
    const precision = m[3] === undefined ? undefined : m[3] === '' ? 0 : parseInt(m[3], 10);
    const conv = m[4];
    const leftAlign = flags.includes('-');
    const hasZero = flags.includes('0');
    const hasHash = flags.includes('#');

    if (conv === '%') {
      out += '%';
      continue;
    }

    const arg = args[argIndex++];

    if (conv === 'd' || conv === 'i') {
      const value = toBigInt(arg as number | bigint);
      const neg = value < 0n;
      const mag = neg ? -value : value;
      const digits = digitsWithPrecision(mag.toString(10), precision);
      const sign = signStr(neg, flags);
      const zeroPad = hasZero && precision === undefined && !leftAlign;
      out += pad(sign, '', digits, width, leftAlign, zeroPad);
    } else if (conv === 'x' || conv === 'X' || conv === 'o') {
      const mag = toBigInt(arg as number | bigint);
      const base = conv === 'o' ? 8 : 16;
      let magStr = mag.toString(base);
      if (conv === 'X') magStr = magStr.toUpperCase();
      let digits = digitsWithPrecision(magStr, precision);
      let prefix = '';
      if (conv === 'o') {
        if (hasHash && (digits === '' || digits[0] !== '0')) digits = '0' + digits;
      } else {
        if (hasHash && mag !== 0n) prefix = conv === 'X' ? '0X' : '0x';
      }
      const zeroPad = hasZero && precision === undefined && !leftAlign;
      out += pad('', prefix, digits, width, leftAlign, zeroPad);
    } else if (conv === 'e' || conv === 'E' || conv === 'f' || conv === 'F' || conv === 'g' || conv === 'G') {
      const x = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      if (Number.isNaN(x)) {
        const body = upper ? 'NAN' : 'nan';
        out += pad('', '', body, width, leftAlign, false);
        continue;
      }
      const neg = isNeg(x);
      const sign = signStr(neg, flags);
      if (!isFinite(x)) {
        const body = upper ? 'INF' : 'inf';
        out += pad(sign, '', body, width, leftAlign, false);
        continue;
      }
      const ax = Math.abs(x);
      const zeroPad = hasZero && !leftAlign;
      let body: string;

      if (conv === 'e' || conv === 'E') {
        const p = precision === undefined ? 6 : precision;
        const { digits, exp } =
          ax === 0 ? { digits: '0'.repeat(p + 1), exp: 0 } : getSignificantDigits(ax, p + 1);
        const first = digits[0];
        const rest = digits.slice(1);
        const dot = p > 0 || hasHash ? '.' : '';
        const expSign = exp >= 0 ? '+' : '-';
        const expDigits = Math.abs(exp).toString().padStart(2, '0');
        body = first + dot + rest + (conv === 'E' ? 'E' : 'e') + expSign + expDigits;
      } else if (conv === 'f' || conv === 'F') {
        const p = precision === undefined ? 6 : precision;
        const { mantissa, exp2 } = decompose(ax);
        const q = roundToDecimalShift(mantissa, exp2, p);
        const qStr = q.toString().padStart(p + 1, '0');
        const intPart = p > 0 ? qStr.slice(0, qStr.length - p) : qStr;
        const fracPart = p > 0 ? qStr.slice(qStr.length - p) : '';
        const dot = p > 0 || hasHash ? '.' : '';
        body = intPart + dot + fracPart;
      } else {
        // g, G
        const rawP = precision === undefined ? 6 : precision;
        const P = rawP === 0 ? 1 : rawP;
        const { digits, exp: X } = ax === 0 ? { digits: '0'.repeat(P), exp: 0 } : getSignificantDigits(ax, P);
        const useF = P > X && X >= -4;
        if (useF) {
          let intPart: string;
          let fracPart: string;
          if (X >= 0) {
            intPart = digits.slice(0, X + 1);
            fracPart = digits.slice(X + 1);
          } else {
            intPart = '0';
            fracPart = '0'.repeat(-X - 1) + digits;
          }
          if (!hasHash) fracPart = fracPart.replace(/0+$/, '');
          const dot = fracPart.length > 0 || hasHash ? '.' : '';
          body = intPart + dot + fracPart;
        } else {
          const first = digits[0];
          let rest = digits.slice(1);
          if (!hasHash) rest = rest.replace(/0+$/, '');
          const dot = rest.length > 0 || hasHash ? '.' : '';
          const expSign = X >= 0 ? '+' : '-';
          const expDigits = Math.abs(X).toString().padStart(2, '0');
          body = first + dot + rest + (conv === 'G' ? 'E' : 'e') + expSign + expDigits;
        }
      }
      out += pad(sign, '', body, width, leftAlign, zeroPad);
    } else if (conv === 's') {
      let s = arg as string;
      if (precision !== undefined) s = s.slice(0, precision);
      out += pad('', '', s, width, leftAlign, false);
    } else if (conv === 'c') {
      const s = arg as string;
      out += pad('', '', s, width, leftAlign, false);
    }
  }
  return out;
}
