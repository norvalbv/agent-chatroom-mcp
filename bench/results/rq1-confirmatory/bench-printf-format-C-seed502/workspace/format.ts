export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let argi = 0;
  const re = /%([-+ 0#]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc%])/g;
  return fmt.replace(
    re,
    (_match: string, flagsStr: string, widthStr: string, precStr: string | undefined, conv: string) => {
      if (conv === '%') return '%';
      const flags = new Set(flagsStr.split(''));
      const width = widthStr ? parseInt(widthStr, 10) : 0;
      const hasPrecision = precStr !== undefined;
      const precision = hasPrecision ? (precStr === '' ? 0 : parseInt(precStr, 10)) : undefined;
      const arg = args[argi++];
      return convertOne(conv, flags, width, precision, hasPrecision, arg);
    },
  );
}

function decompose(absX: number): { m: bigint; e: number } {
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, absX);
  const high = buf.getUint32(0);
  const low = buf.getUint32(4);
  const expBits = (high >>> 20) & 0x7ff;
  const mantHigh = high & 0xfffff;
  const mantissa = (BigInt(mantHigh) << 32n) | BigInt(low >>> 0);
  if (expBits === 0) {
    return { m: mantissa, e: -1074 };
  }
  return { m: mantissa | (1n << 52n), e: expBits - 1075 };
}

// round(value * 10^k) with ties-to-even, using exact fraction arithmetic
function scaledRound(m: bigint, e: number, k: number): bigint {
  const A = e + k;
  let numerator = m;
  if (A > 0) numerator *= 1n << BigInt(A);
  if (k > 0) numerator *= 5n ** BigInt(k);
  let denom = 1n;
  if (A < 0) denom *= 1n << BigInt(-A);
  if (k < 0) denom *= 5n ** BigInt(-k);
  const q = numerator / denom;
  const r = numerator % denom;
  const twice = r * 2n;
  if (twice > denom) return q + 1n;
  if (twice < denom) return q;
  return q % 2n === 0n ? q : q + 1n;
}

// Returns p+1 significant digits (as a string of exactly p+1 chars) and decimal exponent X
// such that absX ~= digits[0].digits[1:] * 10^X, correctly rounded to p+1 significant digits.
function eStyleDigits(absX: number, p: number): { digits: string; X: number } {
  if (absX === 0) {
    return { digits: '0'.repeat(p + 1), X: 0 };
  }
  const { m, e } = decompose(absX);
  let X = Math.floor(Math.log10(absX));
  const lower = 10n ** BigInt(p);
  const upper = 10n ** BigInt(p + 1);
  for (let guard = 0; guard < 1000; guard++) {
    const k = p - X;
    const N = scaledRound(m, e, k);
    if (N >= upper) {
      X += 1;
      continue;
    }
    if (N < lower) {
      X -= 1;
      continue;
    }
    return { digits: N.toString(), X };
  }
  throw new Error('eStyleDigits failed to converge');
}

function fStyleDigits(absX: number, p: number): { intPart: string; fracPart: string } {
  if (absX === 0) {
    return { intPart: '0', fracPart: '0'.repeat(p) };
  }
  const { m, e } = decompose(absX);
  const N = scaledRound(m, e, p);
  const full = N.toString().padStart(p + 1, '0');
  const intPart = full.slice(0, full.length - p) || '0';
  const fracPart = p > 0 ? full.slice(full.length - p) : '';
  return { intPart, fracPart };
}

function trimTrailingZeros(mantissa: string): string {
  if (!mantissa.includes('.')) return mantissa;
  mantissa = mantissa.replace(/0+$/, '');
  if (mantissa.endsWith('.')) mantissa = mantissa.slice(0, -1);
  return mantissa;
}

function padNumeric(
  sign: string,
  prefix: string,
  digits: string,
  width: number,
  leftAlign: boolean,
  zeroPad: boolean,
): string {
  const body = sign + prefix + digits;
  if (body.length >= width) return body;
  const padLen = width - body.length;
  if (leftAlign) return body + ' '.repeat(padLen);
  if (zeroPad) return sign + prefix + '0'.repeat(padLen) + digits;
  return ' '.repeat(padLen) + body;
}

function padPlain(text: string, width: number, leftAlign: boolean): string {
  if (text.length >= width) return text;
  const padLen = width - text.length;
  return leftAlign ? text + ' '.repeat(padLen) : ' '.repeat(padLen) + text;
}

function signFor(negative: boolean, flags: Set<string>): string {
  if (negative) return '-';
  if (flags.has('+')) return '+';
  if (flags.has(' ')) return ' ';
  return '';
}

function padDigitsToPrecision(digits: string, precision: number | undefined, isZero: boolean): string {
  if (precision === undefined) return digits;
  if (precision === 0 && isZero) return '';
  if (digits.length < precision) return '0'.repeat(precision - digits.length) + digits;
  return digits;
}

function convertOne(
  conv: string,
  flags: Set<string>,
  width: number,
  precision: number | undefined,
  hasPrecision: boolean,
  arg: number | bigint | string,
): string {
  const leftAlign = flags.has('-');

  if (conv === 'd' || conv === 'i') {
    const bi = typeof arg === 'bigint' ? arg : BigInt(arg as number);
    const neg = bi < 0n;
    const abs = neg ? -bi : bi;
    let digits = abs.toString();
    digits = padDigitsToPrecision(digits, precision, abs === 0n);
    const sign = signFor(neg, flags);
    const zeroPad = flags.has('0') && !leftAlign && !hasPrecision;
    return padNumeric(sign, '', digits, width, leftAlign, zeroPad);
  }

  if (conv === 'x' || conv === 'X' || conv === 'o') {
    const bi = typeof arg === 'bigint' ? arg : BigInt(arg as number);
    let digits = bi.toString(conv === 'o' ? 8 : 16);
    if (conv === 'X') digits = digits.toUpperCase();
    digits = padDigitsToPrecision(digits, precision, bi === 0n);
    if (flags.has('#')) {
      if (conv === 'o') {
        if (digits === '') digits = '0';
        else if (!digits.startsWith('0')) digits = '0' + digits;
      }
    }
    let prefix = '';
    if (flags.has('#') && (conv === 'x' || conv === 'X') && bi !== 0n) {
      prefix = conv === 'x' ? '0x' : '0X';
    }
    const zeroPad = flags.has('0') && !leftAlign && !hasPrecision;
    return padNumeric('', prefix, digits, width, leftAlign, zeroPad);
  }

  if (conv === 'e' || conv === 'E' || conv === 'f' || conv === 'F' || conv === 'g' || conv === 'G') {
    const x = arg as number;
    const upper = conv === 'E' || conv === 'F' || conv === 'G';

    if (Number.isNaN(x)) {
      const text = upper ? 'NAN' : 'nan';
      return padNumeric('', '', text, width, leftAlign, false);
    }
    if (!Number.isFinite(x)) {
      const text = upper ? 'INF' : 'inf';
      const sign = signFor(x < 0, flags);
      return padNumeric(sign, '', text, width, leftAlign, false);
    }

    const negative = x < 0 || Object.is(x, -0);
    const sign = signFor(negative, flags);
    const absX = Math.abs(x);
    const zeroPad = flags.has('0') && !leftAlign;

    if (conv === 'e' || conv === 'E') {
      const p = hasPrecision ? (precision as number) : 6;
      const { digits, X } = eStyleDigits(absX, p);
      const d0 = digits[0];
      const rest = digits.slice(1);
      let mantissa = d0 + (p > 0 || flags.has('#') ? '.' + rest : '');
      const expSign = X >= 0 ? '+' : '-';
      const expDigits = Math.abs(X).toString().padStart(2, '0');
      const letter = conv === 'E' ? 'E' : 'e';
      const digitsOut = mantissa + letter + expSign + expDigits;
      return padNumeric(sign, '', digitsOut, width, leftAlign, zeroPad);
    }

    if (conv === 'f' || conv === 'F') {
      const p = hasPrecision ? (precision as number) : 6;
      const { intPart, fracPart } = fStyleDigits(absX, p);
      const digitsOut = intPart + (p > 0 || flags.has('#') ? '.' + fracPart : '');
      return padNumeric(sign, '', digitsOut, width, leftAlign, zeroPad);
    }

    // g, G
    {
      const P = hasPrecision ? (precision === 0 ? 1 : (precision as number)) : 6;
      const { digits, X } = eStyleDigits(absX, P - 1);
      let mantissa: string;
      let digitsOut: string;
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
        mantissa = intPart + (fracPart.length > 0 || flags.has('#') ? '.' + fracPart : '');
        if (!flags.has('#')) mantissa = trimTrailingZeros(mantissa);
        digitsOut = mantissa;
      } else {
        const d0 = digits[0];
        const rest = digits.slice(1);
        mantissa = d0 + (rest.length > 0 || flags.has('#') ? '.' + rest : '');
        if (!flags.has('#')) mantissa = trimTrailingZeros(mantissa);
        const expSign = X >= 0 ? '+' : '-';
        const expDigits = Math.abs(X).toString().padStart(2, '0');
        const letter = conv === 'G' ? 'E' : 'e';
        digitsOut = mantissa + letter + expSign + expDigits;
      }
      return padNumeric(sign, '', digitsOut, width, leftAlign, zeroPad);
    }
  }

  if (conv === 's') {
    const s = arg as string;
    const text = precision !== undefined ? s.slice(0, precision) : s;
    return padPlain(text, width, leftAlign);
  }

  if (conv === 'c') {
    const text = arg as string;
    return padPlain(text, width, leftAlign);
  }

  throw new Error(`unsupported conversion: ${conv}`);
}
