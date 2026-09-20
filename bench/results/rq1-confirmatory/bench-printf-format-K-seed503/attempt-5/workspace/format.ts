type Flags = Set<string>;

function decomposeDouble(x: number): { mantissa: bigint; exp: number } {
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setFloat64(0, x);
  const hi = BigInt(view.getUint32(0));
  const lo = BigInt(view.getUint32(4));
  const bits = (hi << 32n) | lo;
  const exponent = Number((bits >> 52n) & 0x7ffn);
  const fraction = bits & 0xfffffffffffffn;
  if (exponent === 0) {
    return { mantissa: fraction, exp: -1074 };
  }
  return { mantissa: fraction | (1n << 52n), exp: exponent - 1075 };
}

// round(mantissa * 2^exp * 10^k) to nearest integer, ties to even. Exact.
function roundExact(mantissa: bigint, exp: number, k: number): bigint {
  let num = mantissa;
  let den = 1n;
  if (exp >= 0) num *= 2n ** BigInt(exp);
  else den *= 2n ** BigInt(-exp);
  if (k >= 0) num *= 10n ** BigInt(k);
  else den *= 10n ** BigInt(-k);
  const q = num / den;
  const r = num % den;
  const twice = r * 2n;
  if (twice < den) return q;
  if (twice > den) return q + 1n;
  return q % 2n === 0n ? q : q + 1n;
}

function formatFixed(mantissa: bigint, exp: number, k: number): { intPart: string; fracPart: string } {
  const rounded = roundExact(mantissa, exp, k);
  const digits = rounded.toString();
  if (k === 0) {
    return { intPart: digits, fracPart: '' };
  }
  const padded = digits.padStart(k + 1, '0');
  return { intPart: padded.slice(0, padded.length - k), fracPart: padded.slice(padded.length - k) };
}

function toSignificant(mantissa: bigint, exp: number, absValue: number, p: number): { digits: string; E: number } {
  if (absValue === 0) {
    return { digits: '0'.repeat(p), E: 0 };
  }
  let E = Math.floor(Math.log10(absValue));
  for (let i = 0; i < 6; i++) {
    const k = p - 1 - E;
    const rounded = roundExact(mantissa, exp, k);
    const digits = rounded.toString();
    if (digits.length === p) {
      return { digits, E };
    }
    E += digits.length - p;
  }
  const k = p - 1 - E;
  const rounded = roundExact(mantissa, exp, k);
  return { digits: rounded.toString().padStart(p, '0'), E };
}

function stripTrailingZeros(frac: string): string {
  let end = frac.length;
  while (end > 0 && frac[end - 1] === '0') end--;
  return frac.slice(0, end);
}

function padResult(sign: string, prefix: string, content: string, width: number, flags: Flags, zeroAllowed: boolean): string {
  const total = sign + prefix + content;
  if (total.length >= width) return total;
  const padLen = width - total.length;
  if (flags.has('-')) return total + ' '.repeat(padLen);
  if (flags.has('0') && zeroAllowed) return sign + prefix + '0'.repeat(padLen) + content;
  return ' '.repeat(padLen) + total;
}

function expString(E: number): string {
  const expSign = E < 0 ? '-' : '+';
  const expDigits = Math.abs(E).toString().padStart(2, '0');
  return expSign + expDigits;
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let out = '';
  let argIndex = 0;
  const re = /%([-+0# ]*)(\d*)(\.\d*)?([diouxXeEfFgGsc%])/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(fmt)) !== null) {
    out += fmt.slice(lastIndex, m.index);
    lastIndex = re.lastIndex;
    const [, flagsStr, widthStr, precStr, conv] = m;
    const flags: Flags = new Set(flagsStr.split('').filter((c) => c !== ''));
    const width = widthStr ? parseInt(widthStr, 10) : 0;
    const hasPrecision = precStr !== undefined;
    const precision = hasPrecision ? (precStr === '.' ? 0 : parseInt(precStr.slice(1), 10)) : undefined;

    if (conv === '%') {
      out += '%';
      continue;
    }

    const arg = args[argIndex++];

    if (conv === 'd' || conv === 'i') {
      const big = typeof arg === 'bigint' ? arg : BigInt(arg as number);
      const neg = big < 0n;
      const abs = neg ? -big : big;
      let digits: string;
      if (precision === 0 && abs === 0n) {
        digits = '';
      } else if (precision !== undefined) {
        digits = abs.toString(10).padStart(precision, '0');
      } else {
        digits = abs.toString(10);
      }
      const sign = neg ? '-' : flags.has('+') ? '+' : flags.has(' ') ? ' ' : '';
      out += padResult(sign, '', digits, width, flags, precision === undefined);
      continue;
    }

    if (conv === 'x' || conv === 'X' || conv === 'o') {
      const big = typeof arg === 'bigint' ? arg : BigInt(arg as number);
      const base = conv === 'o' ? 8 : 16;
      let digits: string;
      if (precision === 0 && big === 0n) {
        digits = '';
      } else if (precision !== undefined) {
        digits = big.toString(base).padStart(precision, '0');
      } else {
        digits = big.toString(base);
      }
      if (conv === 'X') digits = digits.toUpperCase();
      let prefix = '';
      if (flags.has('#')) {
        if (conv === 'o') {
          if (digits.length === 0 || digits[0] !== '0') digits = '0' + digits;
        } else if (big !== 0n) {
          prefix = conv === 'X' ? '0X' : '0x';
        }
      }
      out += padResult('', prefix, digits, width, flags, precision === undefined);
      continue;
    }

    if (conv === 's') {
      let s = arg as string;
      if (precision !== undefined) s = s.slice(0, precision);
      out += padResult('', '', s, width, flags, false);
      continue;
    }

    if (conv === 'c') {
      const s = arg as string;
      out += padResult('', '', s, width, flags, false);
      continue;
    }

    // e, E, f, F, g, G
    const value = arg as number;
    const upper = conv === 'F' || conv === 'E' || conv === 'G';
    const eChar = conv === 'e' || conv === 'E' ? (conv === 'E' ? 'E' : 'e') : upper ? 'E' : 'e';

    if (Number.isNaN(value)) {
      const body = upper ? 'NAN' : 'nan';
      out += padResult('', '', body, width, flags, false);
      continue;
    }

    const neg = value < 0 || Object.is(value, -0);
    const sign = neg ? '-' : flags.has('+') ? '+' : flags.has(' ') ? ' ' : '';

    if (!Number.isFinite(value)) {
      const body = upper ? 'INF' : 'inf';
      out += padResult(sign, '', body, width, flags, false);
      continue;
    }

    const absValue = Math.abs(value);
    const { mantissa, exp } = decomposeDouble(absValue);
    const hash = flags.has('#');

    if (conv === 'f' || conv === 'F') {
      const prec = precision !== undefined ? precision : 6;
      const { intPart, fracPart } = formatFixed(mantissa, exp, prec);
      const dot = prec > 0 ? '.' + fracPart : hash ? '.' : '';
      out += padResult(sign, '', intPart + dot, width, flags, true);
      continue;
    }

    if (conv === 'e' || conv === 'E') {
      const prec = precision !== undefined ? precision : 6;
      const p = prec + 1;
      const { digits, E } = toSignificant(mantissa, exp, absValue, p);
      const fracDigits = digits.slice(1);
      const dot = prec > 0 ? '.' + fracDigits : hash ? '.' : '';
      const body = digits[0] + dot + eChar + expString(E);
      out += padResult(sign, '', body, width, flags, true);
      continue;
    }

    // g, G
    let P = precision !== undefined ? precision : 6;
    if (P === 0) P = 1;
    const { digits, E } = toSignificant(mantissa, exp, absValue, P);

    let body: string;
    if (P > E && E >= -4) {
      const k = P - 1 - E;
      const { intPart, fracPart } = formatFixed(mantissa, exp, k);
      const frac = hash ? fracPart : stripTrailingZeros(fracPart);
      const dot = frac.length > 0 ? '.' + frac : hash ? '.' : '';
      body = intPart + dot;
    } else {
      const prec = P - 1;
      const fracDigitsFull = digits.slice(1);
      const fracDigits = hash ? fracDigitsFull : stripTrailingZeros(fracDigitsFull);
      const dot = fracDigits.length > 0 ? '.' + fracDigits : hash ? '.' : '';
      body = digits[0] + dot + eChar + expString(E);
    }
    out += padResult(sign, '', body, width, flags, true);
  }
  out += fmt.slice(lastIndex);
  return out;
}
