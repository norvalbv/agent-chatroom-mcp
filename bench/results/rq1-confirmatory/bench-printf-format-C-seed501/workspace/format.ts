export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let argIndex = 0;
  const nextArg = () => args[argIndex++];

  let out = '';
  const re = /%([-+ 0#]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc%])/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(fmt)) !== null) {
    out += fmt.slice(last, m.index);
    last = re.lastIndex;
    const [, flagsStr, widthStr, precStr, conv] = m;

    if (conv === '%') {
      out += '%';
      continue;
    }

    const flags = flagsStr;
    const width = widthStr === '' ? undefined : parseInt(widthStr, 10);
    const precision = precStr === undefined ? undefined : (precStr === '' ? 0 : parseInt(precStr, 10));
    const leftAlign = flags.includes('-');

    out += renderConversion(conv, flags, width, precision, leftAlign, nextArg());
  }
  out += fmt.slice(last);
  return out;
}

function renderConversion(
  conv: string,
  flags: string,
  width: number | undefined,
  precision: number | undefined,
  leftAlign: boolean,
  arg: number | bigint | string,
): string {
  switch (conv) {
    case 'd':
    case 'i':
      return renderInt(flags, width, precision, leftAlign, arg);
    case 'x':
    case 'X':
    case 'o':
      return renderUint(conv, flags, width, precision, leftAlign, arg);
    case 'e':
    case 'E':
    case 'f':
    case 'F':
    case 'g':
    case 'G':
      return renderFloat(conv, flags, width, precision, leftAlign, arg as number);
    case 's':
      return renderString(width, precision, leftAlign, arg as string);
    case 'c':
      return renderChar(width, leftAlign, arg as string);
    default:
      throw new Error(`unsupported conversion: %${conv}`);
  }
}

function padNumeric(
  sign: string,
  prefix: string,
  digits: string,
  width: number | undefined,
  leftAlign: boolean,
  zeroPad: boolean,
): string {
  const body = sign + prefix + digits;
  if (width === undefined || body.length >= width) return body;
  const padLen = width - body.length;
  if (leftAlign) return body + ' '.repeat(padLen);
  if (zeroPad) return sign + prefix + '0'.repeat(padLen) + digits;
  return ' '.repeat(padLen) + body;
}

function renderInt(
  flags: string,
  width: number | undefined,
  precision: number | undefined,
  leftAlign: boolean,
  arg: number | bigint | string,
): string {
  const v: bigint = typeof arg === 'bigint' ? arg : BigInt(arg as number);
  const neg = v < 0n;
  const mag = neg ? -v : v;
  let digits: string;
  if (precision === 0 && mag === 0n) {
    digits = '';
  } else if (precision !== undefined) {
    digits = mag.toString().padStart(precision, '0');
  } else {
    digits = mag.toString();
  }
  const sign = neg ? '-' : flags.includes('+') ? '+' : flags.includes(' ') ? ' ' : '';
  const zeroPad = flags.includes('0') && !leftAlign && precision === undefined;
  return padNumeric(sign, '', digits, width, leftAlign, zeroPad);
}

function renderUint(
  conv: string,
  flags: string,
  width: number | undefined,
  precision: number | undefined,
  leftAlign: boolean,
  arg: number | bigint | string,
): string {
  const v: bigint = typeof arg === 'bigint' ? arg : BigInt(arg as number);
  const base = conv === 'o' ? 8 : 16;
  let digits: string;
  if (precision === 0 && v === 0n) {
    digits = '';
  } else if (precision !== undefined) {
    digits = v.toString(base).padStart(precision, '0');
  } else {
    digits = v.toString(base);
  }
  if (conv === 'X') digits = digits.toUpperCase();

  let prefix = '';
  if (flags.includes('#')) {
    if ((conv === 'x' || conv === 'X') && v !== 0n) {
      prefix = conv === 'x' ? '0x' : '0X';
    } else if (conv === 'o') {
      if (digits === '' || digits[0] !== '0') digits = '0' + digits;
    }
  }

  const zeroPad = flags.includes('0') && !leftAlign && precision === undefined;
  return padNumeric('', prefix, digits, width, leftAlign, zeroPad);
}

function renderString(width: number | undefined, precision: number | undefined, leftAlign: boolean, arg: string): string {
  let str = arg;
  if (precision !== undefined) str = str.slice(0, precision);
  if (width === undefined || str.length >= width) return str;
  const pad = ' '.repeat(width - str.length);
  return leftAlign ? str + pad : pad + str;
}

function renderChar(width: number | undefined, leftAlign: boolean, arg: string): string {
  const str = arg;
  if (width === undefined || str.length >= width) return str;
  const pad = ' '.repeat(width - str.length);
  return leftAlign ? str + pad : pad + str;
}

// --- Exact binary-to-decimal conversion for floats ---

function decompose(x: number): { M: bigint; E: number } {
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  const mantHi = hi & 0xfffff;
  const mant = (BigInt(mantHi) << 32n) | BigInt(lo);
  if (expBits === 0) {
    return { M: mant, E: -1074 };
  }
  return { M: mant | (1n << 52n), E: expBits - 1075 };
}

// round(value * 10^shift) using exact arithmetic, round-half-to-even.
function scaledRound(M: bigint, E: number, shift: number): bigint {
  let num: bigint = M;
  let den: bigint = 1n;
  if (E >= 0) num = num << BigInt(E);
  else den = 1n << BigInt(-E);
  if (shift >= 0) num = num * 10n ** BigInt(shift);
  else den = den * 10n ** BigInt(-shift);

  let q = num / den;
  const r = num % den;
  if (r === 0n) return q;
  const twiceR = r * 2n;
  if (twiceR < den) return q;
  if (twiceR > den) return q + 1n;
  return q % 2n === 0n ? q : q + 1n;
}

function toFixedExact(absValue: number, precision: number): { integerPart: string; fracPart: string } {
  const { M, E } = decompose(absValue);
  const scaled = scaledRound(M, E, precision);
  let s = scaled.toString();
  if (precision === 0) {
    return { integerPart: s, fracPart: '' };
  }
  if (s.length <= precision) s = s.padStart(precision + 1, '0');
  return { integerPart: s.slice(0, s.length - precision), fracPart: s.slice(s.length - precision) };
}

function toExponentialExact(absValue: number, precision: number): { digits: string; exp: number } {
  if (absValue === 0) {
    return { digits: '0'.repeat(precision + 1), exp: 0 };
  }
  const { M, E } = decompose(absValue);
  let X = Math.floor(Math.log10(absValue));
  let shift = precision - X;
  let scaled = scaledRound(M, E, shift);
  const lowBound = 10n ** BigInt(precision);
  const highBound = 10n ** BigInt(precision + 1);
  while (scaled >= highBound) {
    X++;
    shift--;
    scaled = scaledRound(M, E, shift);
  }
  while (scaled < lowBound) {
    X--;
    shift++;
    scaled = scaledRound(M, E, shift);
  }
  const digits = scaled.toString().padStart(precision + 1, '0');
  return { digits, exp: X };
}

function renderFloat(
  conv: string,
  flags: string,
  width: number | undefined,
  precision: number | undefined,
  leftAlign: boolean,
  x: number,
): string {
  const upper = conv === 'F' || conv === 'E' || conv === 'G';
  const negSign = Object.is(x, -0) || x < 0;
  const isNaNVal = Number.isNaN(x);

  let sign: string;
  let bodyDigits: string;
  let zeroPad = false;

  if (isNaNVal) {
    sign = '';
    bodyDigits = upper ? 'NAN' : 'nan';
  } else if (!isFinite(x)) {
    sign = negSign ? '-' : flags.includes('+') ? '+' : flags.includes(' ') ? ' ' : '';
    bodyDigits = upper ? 'INF' : 'inf';
  } else {
    sign = negSign ? '-' : flags.includes('+') ? '+' : flags.includes(' ') ? ' ' : '';
    const absValue = Math.abs(x);
    zeroPad = flags.includes('0') && !leftAlign;

    if (conv === 'f' || conv === 'F') {
      const prec = precision === undefined ? 6 : precision;
      const { integerPart, fracPart } = toFixedExact(absValue, prec);
      bodyDigits = integerPart + (prec > 0 || flags.includes('#') ? '.' + fracPart : '');
    } else if (conv === 'e' || conv === 'E') {
      const prec = precision === undefined ? 6 : precision;
      const { digits, exp } = toExponentialExact(absValue, prec);
      const first = digits[0];
      const rest = digits.slice(1);
      const mantissa = first + (prec > 0 || flags.includes('#') ? '.' + rest : '');
      const expSign = exp < 0 ? '-' : '+';
      const expAbs = Math.abs(exp).toString().padStart(2, '0');
      bodyDigits = mantissa + (conv === 'e' ? 'e' : 'E') + expSign + expAbs;
    } else {
      // g, G
      const P = precision === undefined ? 6 : precision === 0 ? 1 : precision;
      const { digits: gdigits, exp: X } = toExponentialExact(absValue, P - 1);
      const useF = P > X && X >= -4;
      if (useF) {
        const fprec = P - 1 - X;
        const { integerPart, fracPart } = toFixedExact(absValue, fprec);
        let frac = fracPart;
        let dot = fprec > 0 || flags.includes('#');
        if (!flags.includes('#')) {
          frac = frac.replace(/0+$/, '');
          dot = frac.length > 0;
        }
        bodyDigits = integerPart + (dot ? '.' + frac : '');
      } else {
        const eprec = P - 1;
        const first = gdigits[0];
        let rest = gdigits.slice(1);
        let dot = eprec > 0 || flags.includes('#');
        if (!flags.includes('#')) {
          rest = rest.replace(/0+$/, '');
          dot = rest.length > 0;
        }
        const mantissa = first + (dot ? '.' + rest : '');
        const expSign = X < 0 ? '-' : '+';
        const expAbs = Math.abs(X).toString().padStart(2, '0');
        bodyDigits = mantissa + (conv === 'G' ? 'E' : 'e') + expSign + expAbs;
      }
    }
  }

  return padNumeric(sign, '', bodyDigits, width, leftAlign, zeroPad);
}
