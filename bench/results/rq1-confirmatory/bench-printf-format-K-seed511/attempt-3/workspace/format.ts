// ---- exact decimal decomposition of a finite non-negative double ----

function exactDigits(absX: number): { intPart: string; fracPart: string } {
  if (absX === 0) return { intPart: '0', fracPart: '' };
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setFloat64(0, absX);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const biasedExp = (hi >>> 20) & 0x7ff;
  const mantHi = hi & 0xfffff;
  let mantissa = (BigInt(mantHi) << 32n) | BigInt(lo);
  let exp2: number;
  if (biasedExp === 0) {
    exp2 = -1074;
  } else {
    mantissa |= 1n << 52n;
    exp2 = biasedExp - 1075;
  }
  let numerator: bigint;
  let denominator: bigint;
  if (exp2 >= 0) {
    numerator = mantissa << BigInt(exp2);
    denominator = 1n;
  } else {
    numerator = mantissa;
    denominator = 1n << BigInt(-exp2);
  }
  const intPart = (numerator / denominator).toString();
  let remainder = numerator % denominator;
  let frac = '';
  while (remainder !== 0n) {
    remainder *= 10n;
    const digit = remainder / denominator;
    frac += digit.toString();
    remainder %= denominator;
  }
  return { intPart, fracPart: frac };
}

// round the exact value intPart.fracPart to k digits after the decimal point,
// round-half-to-even, using the exact (terminating) digit sequence.
function roundFixed(intPart: string, fracPart: string, k: number): { intPart: string; fracPart: string } {
  if (fracPart.length <= k) {
    return { intPart, fracPart: fracPart.padEnd(k, '0') };
  }
  const keep = intPart + fracPart.slice(0, k);
  const dropChar = fracPart[k];
  const restNonzero = /[1-9]/.test(fracPart.slice(k + 1));
  const lastKeptDigit = keep.charCodeAt(keep.length - 1) - 48;
  let roundUp: boolean;
  if (dropChar > '5') roundUp = true;
  else if (dropChar < '5') roundUp = false;
  else roundUp = restNonzero || lastKeptDigit % 2 === 1;
  const combined = roundUp ? (BigInt(keep) + 1n).toString().padStart(keep.length, '0') : keep;
  if (k === 0) return { intPart: combined, fracPart: '' };
  const newFrac = combined.slice(combined.length - k);
  let newInt = combined.slice(0, combined.length - k);
  if (newInt === '') newInt = '0';
  return { intPart: newInt, fracPart: newFrac };
}

// normalize exact digits to value = 0.<digits> * 10^decExp, digits[0] != '0' (unless value is 0)
function normalize(intPart: string, fracPart: string): { digits: string; decExp: number } {
  if (intPart !== '0') {
    return { digits: intPart + fracPart, decExp: intPart.length - 1 };
  }
  const idx = fracPart.search(/[1-9]/);
  if (idx === -1) return { digits: '0', decExp: 0 };
  return { digits: fracPart.slice(idx), decExp: -(idx + 1) };
}

// round normalized digits to P significant digits, round-half-to-even.
function roundSignificant(digits: string, decExp: number, P: number): { digits: string; decExp: number } {
  if (digits.length <= P) {
    return { digits: digits.padEnd(P, '0'), decExp };
  }
  const keep = digits.slice(0, P);
  const dropChar = digits[P];
  const restNonzero = /[1-9]/.test(digits.slice(P + 1));
  const lastKeptDigit = keep.charCodeAt(keep.length - 1) - 48;
  let roundUp: boolean;
  if (dropChar > '5') roundUp = true;
  else if (dropChar < '5') roundUp = false;
  else roundUp = restNonzero || lastKeptDigit % 2 === 1;
  if (!roundUp) return { digits: keep, decExp };
  const incremented = (BigInt(keep) + 1n).toString();
  if (incremented.length > keep.length) {
    return { digits: incremented.slice(0, P), decExp: decExp + 1 };
  }
  return { digits: incremented.padStart(P, '0'), decExp };
}

// ---- generic helpers ----

function signFor(isNeg: boolean, flags: Set<string>): string {
  if (isNeg) return '-';
  if (flags.has('+')) return '+';
  if (flags.has(' ')) return ' ';
  return '';
}

function pad(signPrefix: string, body: string, width: number, flags: Set<string>, zeroAllowed: boolean): string {
  const full = signPrefix + body;
  if (full.length >= width) return full;
  const padLen = width - full.length;
  if (flags.has('-')) return full + ' '.repeat(padLen);
  if (zeroAllowed && flags.has('0')) return signPrefix + '0'.repeat(padLen) + body;
  return ' '.repeat(padLen) + full;
}

function fmtNonFinite(x: number, flags: Set<string>, width: number, upper: boolean): string {
  if (Number.isNaN(x)) {
    const text = upper ? 'NAN' : 'nan';
    return pad('', text, width, flags, false);
  }
  const neg = x < 0;
  const sign = neg ? '-' : flags.has('+') ? '+' : flags.has(' ') ? ' ' : '';
  const text = upper ? 'INF' : 'inf';
  return pad(sign, text, width, flags, false);
}

// ---- integer conversions ----

function fmtDI(flags: Set<string>, width: number, precision: number | undefined, arg: number | bigint): string {
  let neg: boolean;
  let mag: bigint;
  if (typeof arg === 'bigint') {
    neg = arg < 0n;
    mag = neg ? -arg : arg;
  } else {
    neg = arg < 0;
    mag = BigInt(Math.trunc(Math.abs(arg)));
  }
  let digits = mag.toString();
  if (precision !== undefined) {
    digits = mag === 0n && precision === 0 ? '' : digits.padStart(precision, '0');
  }
  const sign = signFor(neg, flags);
  return pad(sign, digits, width, flags, precision === undefined);
}

function fmtHexOct(
  conv: 'x' | 'X' | 'o',
  flags: Set<string>,
  width: number,
  precision: number | undefined,
  arg: number | bigint,
): string {
  const mag: bigint = typeof arg === 'bigint' ? arg : BigInt(Math.trunc(arg));
  const base = conv === 'o' ? 8 : 16;
  let digits = mag.toString(base);
  if (conv === 'X') digits = digits.toUpperCase();
  if (precision !== undefined) {
    digits = mag === 0n && precision === 0 ? '' : digits.padStart(precision, '0');
  }
  let prefix = '';
  if (flags.has('#')) {
    if (conv === 'o') {
      if (digits === '' || digits[0] !== '0') digits = '0' + digits;
    } else if (mag !== 0n) {
      prefix = conv === 'X' ? '0X' : '0x';
    }
  }
  return pad(prefix, digits, width, flags, precision === undefined);
}

// ---- floating point conversions ----

function fmtE(
  conv: 'e' | 'E',
  flags: Set<string>,
  width: number,
  precision: number | undefined,
  argNum: number,
): string {
  const upper = conv === 'E';
  const prec = precision ?? 6;
  if (!isFinite(argNum)) return fmtNonFinite(argNum, flags, width, upper);
  const neg = argNum < 0 || Object.is(argNum, -0);
  const absX = Math.abs(argNum);
  let digits: string;
  let decExp: number;
  if (absX === 0) {
    digits = '0'.repeat(prec + 1);
    decExp = 0;
  } else {
    const { intPart, fracPart } = exactDigits(absX);
    const norm = normalize(intPart, fracPart);
    const r = roundSignificant(norm.digits, norm.decExp, prec + 1);
    digits = r.digits;
    decExp = r.decExp;
  }
  const first = digits[0];
  const rest = digits.slice(1);
  const fracStr = prec > 0 ? '.' + rest : flags.has('#') ? '.' : '';
  const expSign = decExp < 0 ? '-' : '+';
  const expDigits = Math.abs(decExp).toString().padStart(2, '0');
  const body = first + fracStr + (upper ? 'E' : 'e') + expSign + expDigits;
  const sign = signFor(neg, flags);
  return pad(sign, body, width, flags, true);
}

function fmtF(
  conv: 'f' | 'F',
  flags: Set<string>,
  width: number,
  precision: number | undefined,
  argNum: number,
): string {
  const upper = conv === 'F';
  const prec = precision ?? 6;
  if (!isFinite(argNum)) return fmtNonFinite(argNum, flags, width, upper);
  const neg = argNum < 0 || Object.is(argNum, -0);
  const absX = Math.abs(argNum);
  const { intPart, fracPart } = exactDigits(absX);
  const r = roundFixed(intPart, fracPart, prec);
  const fracStr = prec > 0 ? '.' + r.fracPart : flags.has('#') ? '.' : '';
  const body = r.intPart + fracStr;
  const sign = signFor(neg, flags);
  return pad(sign, body, width, flags, true);
}

function fmtG(
  conv: 'g' | 'G',
  flags: Set<string>,
  width: number,
  precision: number | undefined,
  argNum: number,
): string {
  const upper = conv === 'G';
  if (!isFinite(argNum)) return fmtNonFinite(argNum, flags, width, upper);
  const P = precision === undefined ? 6 : precision === 0 ? 1 : precision;
  const neg = argNum < 0 || Object.is(argNum, -0);
  const absX = Math.abs(argNum);
  let digits: string;
  let X: number;
  if (absX === 0) {
    digits = '0'.repeat(P);
    X = 0;
  } else {
    const { intPart, fracPart } = exactDigits(absX);
    const norm = normalize(intPart, fracPart);
    const r = roundSignificant(norm.digits, norm.decExp, P);
    digits = r.digits;
    X = r.decExp;
  }
  const hash = flags.has('#');
  let body: string;
  if (P > X && X >= -4) {
    let intStr: string;
    let fracStr: string;
    if (X >= 0) {
      intStr = digits.slice(0, X + 1);
      fracStr = digits.slice(X + 1);
    } else {
      intStr = '0';
      fracStr = '0'.repeat(-X - 1) + digits;
    }
    let fracOut: string;
    if (hash) {
      fracOut = fracStr.length > 0 ? '.' + fracStr : '.';
    } else {
      const stripped = fracStr.replace(/0+$/, '');
      fracOut = stripped ? '.' + stripped : '';
    }
    body = intStr + fracOut;
  } else {
    const first = digits[0];
    const rest = digits.slice(1);
    let fracOut: string;
    if (hash) {
      fracOut = rest.length > 0 ? '.' + rest : '.';
    } else {
      const stripped = rest.replace(/0+$/, '');
      fracOut = stripped ? '.' + stripped : '';
    }
    const expSign = X < 0 ? '-' : '+';
    const expDigits = Math.abs(X).toString().padStart(2, '0');
    body = first + fracOut + (upper ? 'E' : 'e') + expSign + expDigits;
  }
  const sign = signFor(neg, flags);
  return pad(sign, body, width, flags, true);
}

// ---- strings ----

function fmtS(flags: Set<string>, width: number, precision: number | undefined, arg: string): string {
  const s = precision !== undefined ? arg.slice(0, precision) : arg;
  return pad('', s, width, flags, false);
}

function fmtC(flags: Set<string>, width: number, arg: string): string {
  return pad('', arg, width, flags, false);
}

// ---- main entry point ----

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let result = '';
  let argi = 0;
  let i = 0;
  const specRe = /%([-+ 0#]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc%])/y;
  while (i < fmt.length) {
    if (fmt[i] === '%') {
      specRe.lastIndex = i;
      const m = specRe.exec(fmt);
      if (!m) {
        result += fmt[i];
        i++;
        continue;
      }
      const [full, flagsStr, widthStr, precStr, conv] = m;
      i += full.length;
      if (conv === '%') {
        result += '%';
        continue;
      }
      const flags = new Set(flagsStr.split(''));
      const width = widthStr ? parseInt(widthStr, 10) : 0;
      const precision = precStr !== undefined ? (precStr === '' ? 0 : parseInt(precStr, 10)) : undefined;
      const arg = args[argi++];
      switch (conv) {
        case 'd':
        case 'i':
          result += fmtDI(flags, width, precision, arg as number | bigint);
          break;
        case 'x':
        case 'X':
        case 'o':
          result += fmtHexOct(conv, flags, width, precision, arg as number | bigint);
          break;
        case 'e':
        case 'E':
          result += fmtE(conv, flags, width, precision, arg as number);
          break;
        case 'f':
        case 'F':
          result += fmtF(conv, flags, width, precision, arg as number);
          break;
        case 'g':
        case 'G':
          result += fmtG(conv, flags, width, precision, arg as number);
          break;
        case 's':
          result += fmtS(flags, width, precision, arg as string);
          break;
        case 'c':
          result += fmtC(flags, width, arg as string);
          break;
      }
    } else {
      result += fmt[i];
      i++;
    }
  }
  return result;
}
