export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let out = '';
  let argIndex = 0;
  const re = /%([-+ 0#]*)(\d*)(\.(\d*))?([diouxXeEfFgGsc%])/g;
  let lastEnd = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(fmt)) !== null) {
    out += fmt.slice(lastEnd, m.index);
    lastEnd = m.index + m[0].length;

    const flagsStr = m[1];
    const widthStr = m[2];
    const hasDot = m[3] !== undefined;
    const precStr = m[4];
    const conv = m[5];

    if (conv === '%') {
      out += '%';
      continue;
    }

    const flags = new Set(flagsStr.split(''));
    const width = widthStr === '' ? 0 : parseInt(widthStr, 10);
    const precision = hasDot ? (precStr === '' ? 0 : parseInt(precStr, 10)) : undefined;

    const arg = args[argIndex++];

    switch (conv) {
      case 'd':
      case 'i':
        out += formatIntSigned(arg as number | bigint, flags, width, precision);
        break;
      case 'x':
      case 'X':
      case 'o':
        out += formatIntUnsigned(arg as number | bigint, conv, flags, width, precision);
        break;
      case 'e':
      case 'E':
        out += formatExp(arg as number, conv, flags, width, precision);
        break;
      case 'f':
      case 'F':
        out += formatFixed(arg as number, conv, flags, width, precision);
        break;
      case 'g':
      case 'G':
        out += formatGeneral(arg as number, conv, flags, width, precision);
        break;
      case 's':
        out += formatString(arg as string, flags, width, precision);
        break;
      case 'c':
        out += formatChar(arg as string, flags, width);
        break;
    }
  }
  out += fmt.slice(lastEnd);
  return out;
}

// ---------- shared helpers ----------

function toBig(v: number | bigint): bigint {
  return typeof v === 'bigint' ? v : BigInt(v);
}

function divRoundEven(num: bigint, den: bigint): bigint {
  const q = num / den;
  const r = num % den;
  const twice = r * 2n;
  if (twice < den) return q;
  if (twice > den) return q + 1n;
  return q % 2n === 0n ? q : q + 1n;
}

// Decomposes a positive finite double into numerator, scale such that
// value === numerator * 10^scale (numerator: nonnegative BigInt, scale: integer <= 0).
function decomposeDouble(x: number): { numerator: bigint; scale: number } {
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setFloat64(0, x);
  const hi = view.getUint32(0);
  const lo = view.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  const mantHigh = BigInt(hi & 0xfffff);
  const mant = (mantHigh << 32n) | BigInt(lo >>> 0);

  let M: bigint;
  let E: number;
  if (expBits === 0) {
    M = mant;
    E = -1074;
  } else {
    M = mant | (1n << 52n);
    E = expBits - 1075;
  }

  if (E >= 0) {
    return { numerator: M << BigInt(E), scale: 0 };
  }
  return { numerator: M * 5n ** BigInt(-E), scale: E };
}

function roundToFixedInt(numerator: bigint, scale: number, k: number): bigint {
  if (numerator === 0n) return 0n;
  const e = scale + k;
  if (e >= 0) return numerator * 10n ** BigInt(e);
  return divRoundEven(numerator, 10n ** BigInt(-e));
}

function roundSignificant(numerator: bigint, scale: number, sig: number): { digits: string; exp: number } {
  if (numerator === 0n) return { digits: '0'.repeat(sig), exp: 0 };
  const len = numerator.toString().length;
  let X = len - 1 + scale;
  const diff = sig - len;
  let N: bigint;
  if (diff >= 0) {
    N = numerator * 10n ** BigInt(diff);
  } else {
    N = divRoundEven(numerator, 10n ** BigInt(-diff));
  }
  let digits = N.toString();
  if (digits.length > sig) {
    N = N / 10n;
    digits = N.toString();
    X += 1;
  }
  if (digits.length < sig) digits = digits.padStart(sig, '0');
  return { digits, exp: X };
}

function stripTrailingZerosAfterDot(s: string): string {
  if (!s.includes('.')) return s;
  s = s.replace(/0+$/, '');
  if (s.endsWith('.')) s = s.slice(0, -1);
  return s;
}

function assemble(sign: string, prefix: string, digits: string, width: number, flags: Set<string>, zeroAllowed: boolean): string {
  const body = sign + prefix + digits;
  if (body.length >= width) return body;
  const padLen = width - body.length;
  if (flags.has('-')) return body + ' '.repeat(padLen);
  if (flags.has('0') && zeroAllowed) return sign + prefix + '0'.repeat(padLen) + digits;
  return ' '.repeat(padLen) + body;
}

function padText(text: string, width: number, flags: Set<string>): string {
  if (text.length >= width) return text;
  const padLen = width - text.length;
  return flags.has('-') ? text + ' '.repeat(padLen) : ' '.repeat(padLen) + text;
}

// ---------- integer conversions ----------

function formatIntSigned(arg: number | bigint, flags: Set<string>, width: number, precision: number | undefined): string {
  const n = toBig(arg);
  const negative = n < 0n;
  const magnitude = negative ? -n : n;
  let digits = magnitude.toString();

  if (precision !== undefined) {
    if (precision === 0 && magnitude === 0n) {
      digits = '';
    } else if (digits.length < precision) {
      digits = digits.padStart(precision, '0');
    }
  }

  const sign = negative ? '-' : flags.has('+') ? '+' : flags.has(' ') ? ' ' : '';
  const zeroAllowed = precision === undefined;
  return assemble(sign, '', digits, width, flags, zeroAllowed);
}

function formatIntUnsigned(arg: number | bigint, conv: 'x' | 'X' | 'o', flags: Set<string>, width: number, precision: number | undefined): string {
  const n = toBig(arg);
  let digits = conv === 'o' ? n.toString(8) : n.toString(16);
  if (conv === 'X') digits = digits.toUpperCase();

  if (precision !== undefined) {
    if (precision === 0 && n === 0n) {
      digits = '';
    } else if (digits.length < precision) {
      digits = digits.padStart(precision, '0');
    }
  }

  if (conv === 'o' && flags.has('#')) {
    if (digits.length === 0 || digits[0] !== '0') digits = '0' + digits;
  }

  let prefix = '';
  if ((conv === 'x' || conv === 'X') && flags.has('#') && n !== 0n) {
    prefix = conv === 'x' ? '0x' : '0X';
  }

  const zeroAllowed = precision === undefined;
  return assemble('', prefix, digits, width, flags, zeroAllowed);
}

// ---------- float helpers ----------

function signBitOf(value: number): boolean {
  return Object.is(value, -0) || value < 0;
}

function signString(signBit: boolean, flags: Set<string>): string {
  return signBit ? '-' : flags.has('+') ? '+' : flags.has(' ') ? ' ' : '';
}

// ---------- e, E ----------

function formatExp(value: number, conv: 'e' | 'E', flags: Set<string>, width: number, precision: number | undefined): string {
  const p = precision === undefined ? 6 : precision;

  if (Number.isNaN(value)) {
    const text = conv === 'E' ? 'NAN' : 'nan';
    return assemble('', '', text, width, flags, false);
  }
  const signBit = signBitOf(value);
  if (!Number.isFinite(value)) {
    const text = conv === 'E' ? 'INF' : 'inf';
    return assemble(signString(signBit, flags), '', text, width, flags, false);
  }

  const abs = Math.abs(value);
  const { numerator, scale } = abs === 0 ? { numerator: 0n, scale: 0 } : decomposeDouble(abs);
  const { digits, exp } = roundSignificant(numerator, scale, p + 1);

  const first = digits[0];
  const rest = digits.slice(1);
  const frac = p > 0 ? '.' + rest : flags.has('#') ? '.' : '';
  const expLetter = conv === 'E' ? 'E' : 'e';
  const expSign = exp >= 0 ? '+' : '-';
  const expDigits = Math.abs(exp).toString().padStart(2, '0');
  const text = first + frac + expLetter + expSign + expDigits;

  return assemble(signString(signBit, flags), '', text, width, flags, true);
}

// ---------- f, F ----------

function formatFixed(value: number, conv: 'f' | 'F', flags: Set<string>, width: number, precision: number | undefined): string {
  const p = precision === undefined ? 6 : precision;

  if (Number.isNaN(value)) {
    const text = conv === 'F' ? 'NAN' : 'nan';
    return assemble('', '', text, width, flags, false);
  }
  const signBit = signBitOf(value);
  if (!Number.isFinite(value)) {
    const text = conv === 'F' ? 'INF' : 'inf';
    return assemble(signString(signBit, flags), '', text, width, flags, false);
  }

  const abs = Math.abs(value);
  const { numerator, scale } = abs === 0 ? { numerator: 0n, scale: 0 } : decomposeDouble(abs);
  const N = roundToFixedInt(numerator, scale, p);
  const Ns = N.toString().padStart(p + 1, '0');
  const intPart = p === 0 ? Ns : Ns.slice(0, Ns.length - p);
  const fracPart = p === 0 ? '' : Ns.slice(Ns.length - p);
  const frac = p > 0 ? '.' + fracPart : flags.has('#') ? '.' : '';
  const text = intPart + frac;

  return assemble(signString(signBit, flags), '', text, width, flags, true);
}

// ---------- g, G ----------

function formatGeneral(value: number, conv: 'g' | 'G', flags: Set<string>, width: number, precision: number | undefined): string {
  let P = precision === undefined ? 6 : precision === 0 ? 1 : precision;

  if (Number.isNaN(value)) {
    const text = conv === 'G' ? 'NAN' : 'nan';
    return assemble('', '', text, width, flags, false);
  }
  const signBit = signBitOf(value);
  if (!Number.isFinite(value)) {
    const text = conv === 'G' ? 'INF' : 'inf';
    return assemble(signString(signBit, flags), '', text, width, flags, false);
  }

  const abs = Math.abs(value);
  const { numerator, scale } = abs === 0 ? { numerator: 0n, scale: 0 } : decomposeDouble(abs);
  const { digits: sig, exp: X } = roundSignificant(numerator, scale, P);

  const useF = P > X && X >= -4;
  let bodyDigits: string;

  if (useF) {
    const p = P - 1 - X;
    let intPart: string;
    let fracPart: string;
    if (X >= 0) {
      if (X + 1 <= P) {
        intPart = sig.slice(0, X + 1);
        fracPart = sig.slice(X + 1);
      } else {
        intPart = sig + '0'.repeat(X + 1 - P);
        fracPart = '';
      }
    } else {
      intPart = '0';
      fracPart = '0'.repeat(-X - 1) + sig;
    }
    let frac = p > 0 ? '.' + fracPart : flags.has('#') ? '.' : '';
    bodyDigits = intPart + frac;
    if (!flags.has('#') && p > 0) bodyDigits = stripTrailingZerosAfterDot(bodyDigits);
  } else {
    const p = P - 1;
    const first = sig[0];
    const rest = sig.slice(1);
    let frac = p > 0 ? '.' + rest : flags.has('#') ? '.' : '';
    let mantissa = first + frac;
    if (!flags.has('#') && p > 0) mantissa = stripTrailingZerosAfterDot(mantissa);
    const expLetter = conv === 'G' ? 'E' : 'e';
    const expSign = X >= 0 ? '+' : '-';
    const expDigits = Math.abs(X).toString().padStart(2, '0');
    bodyDigits = mantissa + expLetter + expSign + expDigits;
  }

  return assemble(signString(signBit, flags), '', bodyDigits, width, flags, true);
}

// ---------- s, c ----------

function formatString(arg: string, flags: Set<string>, width: number, precision: number | undefined): string {
  const text = precision !== undefined ? arg.slice(0, precision) : arg;
  return padText(text, width, flags);
}

function formatChar(arg: string, flags: Set<string>, width: number): string {
  return padText(arg, width, flags);
}
