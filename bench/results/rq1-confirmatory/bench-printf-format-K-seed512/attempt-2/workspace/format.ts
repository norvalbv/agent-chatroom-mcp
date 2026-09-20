// Exact decimal decomposition of a finite double: abs(x) = numerator / 10^k
function decompose(x: number): { numerator: bigint; k: number } {
  if (x === 0) return { numerator: 0n, k: 0 };
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setFloat64(0, x);
  const hi = BigInt(view.getUint32(0));
  const lo = BigInt(view.getUint32(4));
  const bits = (hi << 32n) | lo;
  const expBits = Number((bits >> 52n) & 0x7ffn);
  const mantissaBits = bits & 0xfffffffffffffn;
  let M: bigint;
  let E: number;
  if (expBits === 0) {
    M = mantissaBits;
    E = -1074;
  } else {
    M = mantissaBits | (1n << 52n);
    E = expBits - 1075;
  }
  if (E >= 0) {
    return { numerator: M << BigInt(E), k: 0 };
  }
  const k = -E;
  return { numerator: M * 5n ** BigInt(k), k };
}

// Returns round(numerator / 10^k * 10^d) using round-half-to-even, based on the exact value.
function roundAtScale(numerator: bigint, k: number, d: number): bigint {
  if (numerator === 0n) return 0n;
  const m = k - d;
  if (m <= 0) return numerator * 10n ** BigInt(-m);
  const div = 10n ** BigInt(m);
  const q = numerator / div;
  const r = numerator % div;
  const twice = r * 2n;
  if (twice < div) return q;
  if (twice > div) return q + 1n;
  return q % 2n === 0n ? q : q + 1n;
}

function toFixedParts(numerator: bigint, k: number, d: number): { intPart: string; fracPart: string } {
  const scaled = roundAtScale(numerator, k, d);
  let s = scaled.toString();
  if (d === 0) return { intPart: s, fracPart: '' };
  if (s.length <= d) s = s.padStart(d + 1, '0');
  return { intPart: s.slice(0, s.length - d), fracPart: s.slice(s.length - d) };
}

// Rounds to P+1 significant digits; returns those digits and the decimal exponent of the leading digit.
function toExpParts(numerator: bigint, k: number, P: number): { digits: string; exponent: number } {
  if (numerator === 0n) return { digits: '0'.repeat(P + 1), exponent: 0 };
  const L = numerator.toString().length;
  const E0 = L - 1 - k;
  const d = P - E0;
  const scaled = roundAtScale(numerator, k, d);
  let digits = scaled.toString();
  let exponent = E0;
  if (digits.length === P + 2) {
    digits = digits.slice(0, P + 1);
    exponent = E0 + 1;
  } else if (digits.length < P + 1) {
    digits = digits.padStart(P + 1, '0');
  }
  return { digits, exponent };
}

interface Flags {
  minus: boolean;
  plus: boolean;
  space: boolean;
  zero: boolean;
  hash: boolean;
}

function padNumeric(sign: string, prefix: string, digits: string, width: number | undefined, flags: Flags, zeroAllowed: boolean): string {
  const body = sign + prefix + digits;
  if (width === undefined || body.length >= width) return body;
  const padLen = width - body.length;
  if (flags.minus) return body + ' '.repeat(padLen);
  if (flags.zero && zeroAllowed) return sign + prefix + '0'.repeat(padLen) + digits;
  return ' '.repeat(padLen) + body;
}

function padSimple(body: string, width: number | undefined, minus: boolean): string {
  if (width === undefined || body.length >= width) return body;
  const padLen = width - body.length;
  return minus ? body + ' '.repeat(padLen) : ' '.repeat(padLen) + body;
}

function toBigIntArg(arg: number | bigint | string): bigint {
  return typeof arg === 'bigint' ? arg : BigInt(arg as number);
}

function stripTrailingZeros(frac: string): string {
  let end = frac.length;
  while (end > 0 && frac[end - 1] === '0') end--;
  return frac.slice(0, end);
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let argIndex = 0;
  const specRe = /%([-+0 #]*)(\d*)(\.(\d*))?([diouxXeEfFgGsc%])/g;
  let result = '';
  let lastEnd = 0;
  let m: RegExpExecArray | null;

  while ((m = specRe.exec(fmt)) !== null) {
    result += fmt.slice(lastEnd, m.index);
    lastEnd = specRe.lastIndex;

    const flagStr = m[1];
    const widthStr = m[2];
    const hasDot = m[3] !== undefined;
    const precStr = m[4];
    const conv = m[5];

    const flags: Flags = {
      minus: flagStr.includes('-'),
      plus: flagStr.includes('+'),
      space: flagStr.includes(' '),
      zero: flagStr.includes('0'),
      hash: flagStr.includes('#'),
    };
    const width = widthStr === '' ? undefined : parseInt(widthStr, 10);
    const precision = hasDot ? (precStr === '' ? 0 : parseInt(precStr, 10)) : undefined;

    if (conv === '%') {
      result += '%';
      continue;
    }

    const arg = args[argIndex++];

    if (conv === 'd' || conv === 'i') {
      const value = toBigIntArg(arg);
      const negative = value < 0n;
      const abs = negative ? -value : value;
      let digits: string;
      if (precision !== undefined) {
        digits = precision === 0 && abs === 0n ? '' : abs.toString().padStart(precision, '0');
      } else {
        digits = abs.toString();
      }
      const sign = negative ? '-' : flags.plus ? '+' : flags.space ? ' ' : '';
      const zeroAllowed = precision === undefined;
      result += padNumeric(sign, '', digits, width, flags, zeroAllowed);
    } else if (conv === 'x' || conv === 'X' || conv === 'o') {
      const value = toBigIntArg(arg);
      const abs = value < 0n ? -value : value;
      let base = conv === 'o' ? abs.toString(8) : abs.toString(16);
      if (conv === 'X') base = base.toUpperCase();
      let digits: string;
      if (precision !== undefined) {
        digits = precision === 0 && abs === 0n ? '' : base.padStart(precision, '0');
      } else {
        digits = base;
      }
      let prefix = '';
      if (flags.hash) {
        if (conv === 'o') {
          if (digits.length === 0 || digits[0] !== '0') digits = '0' + digits;
        } else if (abs !== 0n) {
          prefix = conv === 'X' ? '0X' : '0x';
        }
      }
      const zeroAllowed = precision === undefined;
      result += padNumeric('', prefix, digits, width, flags, zeroAllowed);
    } else if (conv === 's') {
      let str = arg as string;
      if (precision !== undefined) str = str.slice(0, precision);
      result += padSimple(str, width, flags.minus);
    } else if (conv === 'c') {
      const str = arg as string;
      result += padSimple(str, width, flags.minus);
    } else {
      // e E f F g G
      const value = arg as number;
      const upper = conv === conv.toUpperCase();
      const negative = Object.is(value, -0) || value < 0;
      const isNan = Number.isNaN(value);
      const sign = isNan ? '' : negative ? '-' : flags.plus ? '+' : flags.space ? ' ' : '';

      if (!Number.isFinite(value)) {
        const word = isNan ? (upper ? 'NAN' : 'nan') : upper ? 'INF' : 'inf';
        const body = sign + word;
        result += padNumeric(sign, '', word, width, flags, false);
        continue;
      }

      const abs = Math.abs(value);
      const { numerator, k } = decompose(abs);

      if (conv === 'f' || conv === 'F') {
        const d = precision ?? 6;
        const { intPart, fracPart } = toFixedParts(numerator, k, d);
        const dot = d > 0 || flags.hash ? '.' : '';
        result += padNumeric(sign, '', intPart + dot + fracPart, width, flags, true);
      } else if (conv === 'e' || conv === 'E') {
        const P = precision ?? 6;
        const { digits, exponent } = toExpParts(numerator, k, P);
        const first = digits[0];
        const rest = digits.slice(1);
        const dot = P > 0 || flags.hash ? '.' : '';
        const eLetter = conv === 'E' ? 'E' : 'e';
        const expSign = exponent < 0 ? '-' : '+';
        const expDigits = Math.abs(exponent).toString().padStart(2, '0');
        const numPart = first + dot + rest + eLetter + expSign + expDigits;
        result += padNumeric(sign, '', numPart, width, flags, true);
      } else {
        // g G
        const P0 = precision ?? 6;
        const P = P0 === 0 ? 1 : P0;
        const { digits, exponent: X } = toExpParts(numerator, k, P - 1);

        let body: string;
        if (P > X && X >= -4) {
          let intPart: string;
          let fracPart: string;
          if (X >= 0) {
            intPart = digits.slice(0, X + 1);
            fracPart = digits.slice(X + 1);
          } else {
            intPart = '0';
            fracPart = '0'.repeat(-X - 1) + digits;
          }
          if (!flags.hash) fracPart = stripTrailingZeros(fracPart);
          const dot = fracPart.length > 0 || flags.hash ? '.' : '';
          body = intPart + dot + fracPart;
        } else {
          const first = digits[0];
          let rest = digits.slice(1);
          if (!flags.hash) rest = stripTrailingZeros(rest);
          const dot = rest.length > 0 || flags.hash ? '.' : '';
          const eLetter = conv === 'G' ? 'E' : 'e';
          const expSign = X < 0 ? '-' : '+';
          const expDigits = Math.abs(X).toString().padStart(2, '0');
          body = first + dot + rest + eLetter + expSign + expDigits;
        }
        result += padNumeric(sign, '', body, width, flags, true);
      }
    }
  }

  result += fmt.slice(lastEnd);
  return result;
}
