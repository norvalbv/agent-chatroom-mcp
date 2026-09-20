type Flags = {
  minus: boolean;
  plus: boolean;
  space: boolean;
  zero: boolean;
  hash: boolean;
};

function decomposeDouble(magnitude: number): { mantissa: bigint; exp2: number } {
  if (magnitude === 0) return { mantissa: 0n, exp2: 0 };
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setFloat64(0, magnitude);
  const hi = view.getUint32(0);
  const lo = view.getUint32(4);
  const biasedExp = (hi >>> 20) & 0x7ff;
  const fracHi = BigInt(hi & 0xfffff);
  const fracLo = BigInt(lo >>> 0);
  const frac = (fracHi << 32n) | fracLo;
  if (biasedExp === 0) {
    return { mantissa: frac, exp2: -1074 };
  }
  return { mantissa: frac | (1n << 52n), exp2: biasedExp - 1075 };
}

function roundHalfEven(num: bigint, den: bigint): bigint {
  const q = num / den;
  const r = num % den;
  const twice = r * 2n;
  if (twice > den) return q + 1n;
  if (twice < den) return q;
  return q % 2n === 0n ? q : q + 1n;
}

// round(mantissa * 2^exp2 * 10^f), mantissa >= 0
function scaledRound(mantissa: bigint, exp2: number, f: number): bigint {
  if (mantissa === 0n) return 0n;
  const a = exp2 + f;
  const b = f;
  const numPow2 = a > 0 ? a : 0;
  const denPow2 = a < 0 ? -a : 0;
  const numPow5 = b > 0 ? b : 0;
  const denPow5 = b < 0 ? -b : 0;
  const num = mantissa * 2n ** BigInt(numPow2) * 5n ** BigInt(numPow5);
  const den = 2n ** BigInt(denPow2) * 5n ** BigInt(denPow5);
  return roundHalfEven(num, den);
}

// Returns n significant decimal digits of |value| = mantissa * 2^exp2, rounded
// half-to-even, along with the decimal exponent X such that
// value ~= 0.digits * 10^(X+1) (i.e. digits[0] is the 10^X place).
function significantDigits(mantissa: bigint, exp2: number, n: number): { digits: string; exp: number } {
  if (mantissa === 0n) return { digits: '0'.repeat(n), exp: 0 };
  let x = Math.floor(Math.log10(Number(mantissa)) + exp2 * Math.log10(2));
  for (;;) {
    const f = n - 1 - x;
    const rounded = scaledRound(mantissa, exp2, f);
    const s = rounded.toString();
    if (s.length === n) return { digits: s, exp: x };
    x += s.length - n;
  }
}

function signChar(isNeg: boolean, flags: Flags): string {
  if (isNeg) return '-';
  if (flags.plus) return '+';
  if (flags.space) return ' ';
  return '';
}

function padNumeric(prefix: string, digitsPart: string, width: number, flags: Flags, allowZero: boolean): string {
  const body = prefix + digitsPart;
  if (body.length >= width) return body;
  const padLen = width - body.length;
  if (flags.minus) return body + ' '.repeat(padLen);
  if (flags.zero && allowZero) return prefix + '0'.repeat(padLen) + digitsPart;
  return ' '.repeat(padLen) + body;
}

function padSpacesOnly(text: string, width: number, minus: boolean): string {
  if (text.length >= width) return text;
  const pad = ' '.repeat(width - text.length);
  return minus ? text + pad : pad + text;
}

function trimFrac(fracPart: string, hash: boolean): string {
  if (hash) return '.' + fracPart;
  const t = fracPart.replace(/0+$/, '');
  return t.length ? '.' + t : '';
}

function formatExponent(x: number): string {
  const sign = x >= 0 ? '+' : '-';
  const abs = Math.abs(x).toString().padStart(2, '0');
  return sign + abs;
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let out = '';
  let argIndex = 0;
  let i = 0;
  const n = fmt.length;

  while (i < n) {
    const ch = fmt[i];
    if (ch !== '%') {
      out += ch;
      i++;
      continue;
    }

    let j = i + 1;
    const flags: Flags = { minus: false, plus: false, space: false, zero: false, hash: false };
    while (j < n) {
      const c = fmt[j];
      if (c === '-') flags.minus = true;
      else if (c === '+') flags.plus = true;
      else if (c === ' ') flags.space = true;
      else if (c === '0') flags.zero = true;
      else if (c === '#') flags.hash = true;
      else break;
      j++;
    }

    let widthStr = '';
    while (j < n && fmt[j] >= '0' && fmt[j] <= '9') {
      widthStr += fmt[j];
      j++;
    }
    const width = widthStr === '' ? 0 : parseInt(widthStr, 10);

    let precision: number | undefined;
    if (j < n && fmt[j] === '.') {
      j++;
      let precStr = '';
      while (j < n && fmt[j] >= '0' && fmt[j] <= '9') {
        precStr += fmt[j];
        j++;
      }
      precision = precStr === '' ? 0 : parseInt(precStr, 10);
    }

    const conv = fmt[j];
    j++;

    if (conv === '%') {
      out += '%';
      i = j;
      continue;
    }

    const arg = args[argIndex++];

    if (conv === 'd' || conv === 'i') {
      const value = typeof arg === 'bigint' ? arg : BigInt(arg as number);
      const neg = value < 0n;
      const mag = neg ? -value : value;
      let digits: string;
      if (precision !== undefined) {
        if (precision === 0 && mag === 0n) digits = '';
        else digits = mag.toString().padStart(precision, '0');
      } else {
        digits = mag.toString();
      }
      const sc = signChar(neg, flags);
      const allowZero = precision === undefined;
      out += padNumeric(sc, digits, width, flags, allowZero);
    } else if (conv === 'x' || conv === 'X' || conv === 'o') {
      const value = typeof arg === 'bigint' ? arg : BigInt(arg as number);
      const base = conv === 'o' ? 8 : 16;
      let digits: string;
      if (precision !== undefined) {
        if (precision === 0 && value === 0n) digits = '';
        else digits = value.toString(base).padStart(precision, '0');
      } else {
        digits = value.toString(base);
      }
      if (conv === 'X') digits = digits.toUpperCase();
      let prefix = '';
      if (flags.hash) {
        if (conv === 'o') {
          if (digits === '' || digits[0] !== '0') digits = '0' + digits;
        } else if (value !== 0n) {
          prefix = conv === 'X' ? '0X' : '0x';
        }
      }
      const allowZero = precision === undefined;
      out += padNumeric(prefix, digits, width, flags, allowZero);
    } else if (conv === 'e' || conv === 'E' || conv === 'f' || conv === 'F' || conv === 'g' || conv === 'G') {
      const value = arg as number;
      const isUpper = conv === 'E' || conv === 'F' || conv === 'G';
      if (Number.isNaN(value)) {
        const text = isUpper ? 'NAN' : 'nan';
        out += padSpacesOnly(text, width, flags.minus);
        i = j;
        continue;
      }
      const neg = value < 0 || Object.is(value, -0);
      const sc = signChar(neg, flags);
      if (!Number.isFinite(value)) {
        const text = isUpper ? 'INF' : 'inf';
        out += padSpacesOnly(sc + text, width, flags.minus);
        i = j;
        continue;
      }
      const magnitude = Math.abs(value);
      const { mantissa, exp2 } = decomposeDouble(magnitude);

      if (conv === 'e' || conv === 'E') {
        const p = precision === undefined ? 6 : precision;
        const { digits, exp: x } = significantDigits(mantissa, exp2, p + 1);
        const intDigit = digits[0];
        const fracPart = digits.slice(1);
        const dot = p > 0 ? '.' + fracPart : flags.hash ? '.' : '';
        const rest = intDigit + dot + (isUpper ? 'E' : 'e') + formatExponent(x);
        out += padNumeric(sc, rest, width, flags, true);
      } else if (conv === 'f' || conv === 'F') {
        const p = precision === undefined ? 6 : precision;
        const rounded = scaledRound(mantissa, exp2, p);
        const s = rounded.toString().padStart(p + 1, '0');
        const intStr = p > 0 ? s.slice(0, s.length - p) : s;
        const fracStr = p > 0 ? s.slice(s.length - p) : '';
        const dot = p > 0 ? '.' + fracStr : flags.hash ? '.' : '';
        const rest = intStr + dot;
        out += padNumeric(sc, rest, width, flags, true);
      } else {
        // g, G
        const pRaw = precision === undefined ? 6 : precision;
        const p = pRaw === 0 ? 1 : pRaw;
        const { digits, exp: x } = significantDigits(mantissa, exp2, p);
        let body: string;
        if (p > x && x >= -4) {
          let intPart: string;
          let fracPart: string;
          if (x >= 0) {
            intPart = digits.slice(0, x + 1);
            fracPart = digits.slice(x + 1);
          } else {
            intPart = '0';
            fracPart = '0'.repeat(-x - 1) + digits;
          }
          body = intPart + trimFrac(fracPart, flags.hash);
        } else {
          const intDigit = digits[0];
          const fracPart = digits.slice(1);
          body = intDigit + trimFrac(fracPart, flags.hash) + (isUpper ? 'E' : 'e') + formatExponent(x);
        }
        out += padNumeric(sc, body, width, flags, true);
      }
    } else if (conv === 's') {
      let str = arg as string;
      if (precision !== undefined) str = str.slice(0, precision);
      out += padSpacesOnly(str, width, flags.minus);
    } else if (conv === 'c') {
      const str = arg as string;
      out += padSpacesOnly(str, width, flags.minus);
    }

    i = j;
  }

  return out;
}
