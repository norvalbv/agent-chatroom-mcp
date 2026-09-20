export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let out = '';
  let ai = 0;
  let i = 0;
  while (i < fmt.length) {
    const c = fmt[i];
    if (c !== '%') {
      out += c;
      i++;
      continue;
    }
    let j = i + 1;
    let flags = '';
    while (j < fmt.length && '-+ 0#'.includes(fmt[j])) {
      flags += fmt[j];
      j++;
    }
    let widthStr = '';
    while (j < fmt.length && /[0-9]/.test(fmt[j])) {
      widthStr += fmt[j];
      j++;
    }
    let precStr: string | null = null;
    if (fmt[j] === '.') {
      j++;
      precStr = '';
      while (j < fmt.length && /[0-9]/.test(fmt[j])) {
        precStr += fmt[j];
        j++;
      }
    }
    const conv = fmt[j];
    j++;
    if (conv === '%') {
      out += '%';
      i = j;
      continue;
    }
    const width = widthStr ? parseInt(widthStr, 10) : 0;
    const precision = precStr !== null ? (precStr === '' ? 0 : parseInt(precStr, 10)) : null;
    const arg = args[ai++];
    out += convertSpec(conv, flags, width, precision, arg);
    i = j;
  }
  return out;
}

function convertSpec(
  conv: string,
  flags: string,
  width: number,
  precision: number | null,
  arg: number | bigint | string
): string {
  switch (conv) {
    case 'd':
    case 'i':
      return convDI(flags, width, precision, arg as number | bigint);
    case 'x':
    case 'X':
    case 'o':
      return convXXO(conv, flags, width, precision, arg as number | bigint);
    case 'e':
    case 'E':
    case 'f':
    case 'F':
    case 'g':
    case 'G':
      return convFloat(conv, flags, width, precision, arg as number);
    case 's':
      return convS(flags, width, precision, arg as string);
    case 'c':
      return convC(flags, width, arg as string);
    default:
      throw new Error('unsupported conversion ' + conv);
  }
}

function assembleNumeric(
  sign: string,
  prefix: string,
  digits: string,
  width: number,
  flags: string,
  zeroAllowed: boolean
): string {
  const leftAlign = flags.includes('-');
  const zeroFlag = flags.includes('0') && zeroAllowed && !leftAlign;
  const core = sign + prefix + digits;
  if (core.length >= width) return core;
  const padLen = width - core.length;
  if (leftAlign) return core + ' '.repeat(padLen);
  if (zeroFlag) return sign + prefix + '0'.repeat(padLen) + digits;
  return ' '.repeat(padLen) + core;
}

function padGeneric(s: string, width: number, leftAlign: boolean): string {
  if (s.length >= width) return s;
  const pad = ' '.repeat(width - s.length);
  return leftAlign ? s + pad : pad + s;
}

// ---- d, i ----
function convDI(flags: string, width: number, precision: number | null, arg: number | bigint): string {
  const v = typeof arg === 'bigint' ? arg : BigInt(arg);
  const neg = v < 0n;
  const abs = neg ? -v : v;
  let digits = abs.toString();
  if (precision !== null) {
    if (precision === 0 && abs === 0n) digits = '';
    else digits = digits.padStart(precision, '0');
  }
  const sign = neg ? '-' : flags.includes('+') ? '+' : flags.includes(' ') ? ' ' : '';
  const zeroAllowed = precision === null;
  return assembleNumeric(sign, '', digits, width, flags, zeroAllowed);
}

// ---- x, X, o ----
function convXXO(conv: string, flags: string, width: number, precision: number | null, arg: number | bigint): string {
  const v = typeof arg === 'bigint' ? arg : BigInt(arg);
  const base = conv === 'o' ? 8 : 16;
  let digits = v.toString(base);
  if (conv === 'X') digits = digits.toUpperCase();
  if (precision !== null) {
    if (precision === 0 && v === 0n) digits = '';
    else digits = digits.padStart(precision, '0');
  }
  let prefix = '';
  if (flags.includes('#')) {
    if (conv === 'o') {
      if (digits.length === 0 || digits[0] !== '0') digits = '0' + digits;
    } else if (v !== 0n) {
      prefix = conv === 'X' ? '0X' : '0x';
    }
  }
  const zeroAllowed = precision === null;
  return assembleNumeric('', prefix, digits, width, flags, zeroAllowed);
}

// ---- s ----
function convS(flags: string, width: number, precision: number | null, arg: string): string {
  let s = String(arg);
  if (precision !== null) s = s.slice(0, precision);
  return padGeneric(s, width, flags.includes('-'));
}

// ---- c ----
function convC(flags: string, width: number, arg: string): string {
  return padGeneric(String(arg), width, flags.includes('-'));
}

// ---- float helpers ----

function decompose(x: number): { sign: number; m: bigint; e: number } {
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const sign = hi >>> 31;
  const expBits = (hi >>> 20) & 0x7ff;
  const mantHi = hi & 0xfffff;
  let mant = (BigInt(mantHi) << 32n) | BigInt(lo);
  let e: number;
  if (expBits === 0) {
    e = -1074;
  } else {
    mant = mant | (1n << 52n);
    e = expBits - 1075;
  }
  return { sign, m: mant, e };
}

function getIntFrac(m: bigint, e: number): { intPart: bigint; fracDigits: string } {
  if (m === 0n) return { intPart: 0n, fracDigits: '' };
  if (e >= 0) {
    return { intPart: m << BigInt(e), fracDigits: '' };
  }
  const k = -e;
  const kBig = BigInt(k);
  const intPart = m >> kBig;
  const rem = m - (intPart << kBig);
  const fracVal = rem * 5n ** kBig;
  const fracDigits = fracVal.toString().padStart(k, '0');
  return { intPart, fracDigits };
}

function roundFrac(intPart: bigint, fracDigits: string, p: number): { intPart: bigint; frac: string } {
  if (p >= fracDigits.length) {
    return { intPart, frac: fracDigits.padEnd(p, '0') };
  }
  const kept = fracDigits.slice(0, p);
  const rest = fracDigits.slice(p);
  const firstDropped = rest[0];
  const restIsExactHalf = firstDropped === '5' && /^0*$/.test(rest.slice(1));
  let roundUp: boolean;
  if (firstDropped < '5') roundUp = false;
  else if (firstDropped > '5') roundUp = true;
  else if (!restIsExactHalf) roundUp = true;
  else {
    const lastKeptDigit = p > 0 ? kept[p - 1] : (intPart % 10n < 0n ? -(intPart % 10n) : intPart % 10n).toString();
    const lastDigitNum = parseInt(lastKeptDigit, 10);
    roundUp = lastDigitNum % 2 === 1;
  }
  if (!roundUp) {
    return { intPart, frac: kept };
  }
  if (p === 0) {
    return { intPart: intPart + 1n, frac: '' };
  }
  const arr = kept.split('');
  let idx = arr.length - 1;
  let carry = 1;
  while (idx >= 0 && carry) {
    let d = arr[idx].charCodeAt(0) - 48 + carry;
    if (d === 10) {
      d = 0;
      carry = 1;
    } else {
      carry = 0;
    }
    arr[idx] = String(d);
    idx--;
  }
  const newIntPart = carry ? intPart + 1n : intPart;
  return { intPart: newIntPart, frac: arr.join('') };
}

function toSignificant(intPart: bigint, fracDigits: string): { digits: string; exp: number; isZero: boolean } {
  const intStr = intPart.toString();
  if (intStr !== '0') {
    return { digits: intStr + fracDigits, exp: intStr.length - 1, isZero: false };
  }
  let idx = 0;
  while (idx < fracDigits.length && fracDigits[idx] === '0') idx++;
  if (idx === fracDigits.length) return { digits: '0', exp: 0, isZero: true };
  return { digits: fracDigits.slice(idx), exp: -(idx + 1), isZero: false };
}

function roundSignificant(digits: string, n: number): { digits: string; carry: boolean } {
  if (n >= digits.length) {
    return { digits: digits.padEnd(n, '0'), carry: false };
  }
  const kept = digits.slice(0, n);
  const rest = digits.slice(n);
  const firstDropped = rest[0];
  const restIsExactHalf = firstDropped === '5' && /^0*$/.test(rest.slice(1));
  let roundUp: boolean;
  if (firstDropped < '5') roundUp = false;
  else if (firstDropped > '5') roundUp = true;
  else if (!restIsExactHalf) roundUp = true;
  else {
    const lastDigitNum = parseInt(kept[n - 1], 10);
    roundUp = lastDigitNum % 2 === 1;
  }
  if (!roundUp) return { digits: kept, carry: false };
  const arr = kept.split('');
  let idx = arr.length - 1;
  let carry = 1;
  while (idx >= 0 && carry) {
    let d = arr[idx].charCodeAt(0) - 48 + carry;
    if (d === 10) {
      d = 0;
      carry = 1;
    } else {
      carry = 0;
    }
    arr[idx] = String(d);
    idx--;
  }
  if (carry) {
    return { digits: '1' + '0'.repeat(n - 1), carry: true };
  }
  return { digits: arr.join(''), carry: false };
}

function stripTrailingZeros(s: string): string {
  if (!s.includes('.')) return s;
  s = s.replace(/0+$/, '');
  if (s.endsWith('.')) s = s.slice(0, -1);
  return s;
}

function buildF(intPart: bigint, fracDigits: string, p: number, altFlag: boolean): string {
  const r = roundFrac(intPart, fracDigits, p);
  let s = r.intPart.toString();
  if (p > 0 || altFlag) s += '.' + r.frac;
  return s;
}

function eStyleDigits(intPart: bigint, fracDigits: string, p: number): { mantissaDigits: string; exp: number } {
  const sig = toSignificant(intPart, fracDigits);
  if (sig.isZero) {
    return { mantissaDigits: '0'.repeat(p + 1), exp: 0 };
  }
  const n = p + 1;
  const r = roundSignificant(sig.digits, n);
  const exp = sig.exp + (r.carry ? 1 : 0);
  return { mantissaDigits: r.digits, exp };
}

function buildMantissa(mantissaDigits: string, p: number, altFlag: boolean): string {
  if (p === 0) return altFlag ? mantissaDigits[0] + '.' : mantissaDigits[0];
  return mantissaDigits[0] + '.' + mantissaDigits.slice(1);
}

function expString(exp: number, upper: boolean): string {
  const esign = exp < 0 ? '-' : '+';
  const eabs = Math.abs(exp).toString().padStart(2, '0');
  return (upper ? 'E' : 'e') + esign + eabs;
}

function buildG(intPart: bigint, fracDigits: string, P: number, altFlag: boolean, upper: boolean): string {
  const Peff = P === 0 ? 1 : P;
  const sig = toSignificant(intPart, fracDigits);
  let X: number;
  if (sig.isZero) {
    X = 0;
  } else {
    const r = roundSignificant(sig.digits, Peff);
    X = sig.exp + (r.carry ? 1 : 0);
  }
  if (Peff > X && X >= -4) {
    const p = Peff - 1 - X;
    let body = buildF(intPart, fracDigits, p, altFlag);
    if (!altFlag) body = stripTrailingZeros(body);
    return body;
  } else {
    const p = Peff - 1;
    const { mantissaDigits, exp } = eStyleDigits(intPart, fracDigits, p);
    let mant = buildMantissa(mantissaDigits, p, altFlag);
    if (!altFlag) mant = stripTrailingZeros(mant);
    return mant + expString(exp, upper);
  }
}

function convFloat(conv: string, flags: string, width: number, precision: number | null, arg: number): string {
  const isUpper = conv === conv.toUpperCase();
  const kind = conv.toLowerCase();
  const altFlag = flags.includes('#');

  if (Number.isNaN(arg)) {
    const text = isUpper ? 'NAN' : 'nan';
    return assembleNumeric('', '', text, width, flags, false);
  }
  if (!Number.isFinite(arg)) {
    const neg = arg < 0;
    const sign = neg ? '-' : flags.includes('+') ? '+' : flags.includes(' ') ? ' ' : '';
    const text = isUpper ? 'INF' : 'inf';
    return assembleNumeric(sign, '', text, width, flags, false);
  }

  const { sign: signBit, m, e } = decompose(arg);
  const neg = signBit === 1;
  const sign = neg ? '-' : flags.includes('+') ? '+' : flags.includes(' ') ? ' ' : '';
  const { intPart, fracDigits } = getIntFrac(m, e);

  let body: string;
  if (kind === 'f') {
    const p = precision === null ? 6 : precision;
    body = buildF(intPart, fracDigits, p, altFlag);
  } else if (kind === 'e') {
    const p = precision === null ? 6 : precision;
    const { mantissaDigits, exp } = eStyleDigits(intPart, fracDigits, p);
    body = buildMantissa(mantissaDigits, p, altFlag) + expString(exp, isUpper);
  } else {
    const P = precision === null ? 6 : precision;
    body = buildG(intPart, fracDigits, P, altFlag, isUpper);
  }

  return assembleNumeric(sign, '', body, width, flags, true);
}
