// ---- exact binary -> decimal conversion (no rounding error) ----

function decompose(absX: number): { m: bigint; e2: number } {
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setFloat64(0, absX);
  const hi = view.getUint32(0);
  const lo = view.getUint32(4);
  const rawExp = (hi >>> 20) & 0x7ff;
  const mantHi = hi & 0xfffff;
  let m = (BigInt(mantHi) << 32n) | BigInt(lo >>> 0);
  let e2: number;
  if (rawExp === 0) {
    e2 = -1074;
  } else {
    m = m | (1n << 52n);
    e2 = rawExp - 1075;
  }
  return { m, e2 };
}

// Exact decimal value of a non-negative finite double: intPart + 0.frac (frac exact digits)
function exactDecimal(absX: number): { intPart: bigint; frac: string } {
  const { m, e2 } = decompose(absX);
  if (m === 0n) return { intPart: 0n, frac: '' };
  if (e2 >= 0) {
    return { intPart: m << BigInt(e2), frac: '' };
  }
  const k = -e2;
  const numerator = m * 5n ** BigInt(k); // = value * 10^k, exact
  let s = numerator.toString();
  if (s.length <= k) s = '0'.repeat(k - s.length + 1) + s;
  const intPart = BigInt(s.slice(0, s.length - k));
  const frac = s.slice(s.length - k);
  return { intPart, frac };
}

// Round intPart + 0.frac to p fractional digits, half-to-even, using exact digits.
function roundDigits(intPart: bigint, frac: string, p: number): { intPart: bigint; frac: string } {
  const keep = frac.slice(0, p).padEnd(p, '0');
  const rest = frac.slice(p);
  let combined = intPart * 10n ** BigInt(p) + (p > 0 ? BigInt(keep) : 0n);
  if (rest.length > 0) {
    const d = rest[0];
    const tailNonZero = /[1-9]/.test(rest.slice(1));
    if (d > '5' || (d === '5' && tailNonZero)) {
      combined += 1n;
    } else if (d === '5' && !tailNonZero) {
      if (combined % 2n === 1n) combined += 1n;
    }
  }
  if (p === 0) {
    return { intPart: combined, frac: '' };
  }
  const s = combined.toString().padStart(p + 1, '0');
  return { intPart: BigInt(s.slice(0, s.length - p)), frac: s.slice(s.length - p) };
}

// Round a digit string (arbitrary length, leading digit significant) to `keep` significant
// digits, half-to-even. Returns the rounded digits (length keep) and an exponent shift
// (1 if rounding overflowed, e.g. "999" -> "100" with shift 1).
function roundSig(D: string, keep: number): { digits: string; expShift: number } {
  if (D.length <= keep) {
    return { digits: D.padEnd(keep, '0'), expShift: 0 };
  }
  const keepStr = D.slice(0, keep);
  const rest = D.slice(keep);
  let n = BigInt(keepStr);
  const d = rest[0];
  const tailNonZero = /[1-9]/.test(rest.slice(1));
  if (d > '5' || (d === '5' && tailNonZero)) {
    n += 1n;
  } else if (d === '5' && !tailNonZero) {
    if (n % 2n === 1n) n += 1n;
  }
  let s = n.toString();
  if (s.length > keep) {
    return { digits: s.slice(0, keep), expShift: s.length - keep };
  }
  s = s.padStart(keep, '0');
  return { digits: s, expShift: 0 };
}

// Leading significant digit string D and its decimal exponent E, such that
// value = D[0].D[1:] * 10^E. Requires the value to be nonzero.
function toSciDigits(intPart: bigint, frac: string): { D: string; E: number } {
  const intStr = intPart.toString();
  if (intStr !== '0') {
    return { D: intStr + frac, E: intStr.length - 1 };
  }
  let i = 0;
  while (i < frac.length && frac[i] === '0') i++;
  return { D: frac.slice(i), E: -(i + 1) };
}

function applyPrecisionPad(s: string, isZeroValue: boolean, precision: number | null): string {
  if (precision === null) return s;
  if (precision === 0 && isZeroValue) return '';
  if (s.length < precision) return '0'.repeat(precision - s.length) + s;
  return s;
}

function numSign(neg: boolean, plus: boolean, space: boolean): string {
  if (neg) return '-';
  if (plus) return '+';
  if (space) return ' ';
  return '';
}

interface FormattedNum {
  signAndPrefix: string;
  digits: string;
  isSpecial?: boolean;
}

function fmtInt(arg: number | bigint, precision: number | null, plus: boolean, space: boolean): FormattedNum {
  const big = typeof arg === 'bigint' ? arg : BigInt(arg);
  const neg = big < 0n;
  const mag = neg ? -big : big;
  const sign = numSign(neg, plus, space);
  const digits = applyPrecisionPad(mag.toString(), mag === 0n, precision);
  return { signAndPrefix: sign, digits };
}

function fmtHexOct(arg: number | bigint, precision: number | null, hash: boolean, conv: 'x' | 'X' | 'o'): FormattedNum {
  const big = typeof arg === 'bigint' ? arg : BigInt(arg);
  let s = conv === 'o' ? big.toString(8) : big.toString(16);
  if (conv === 'X') s = s.toUpperCase();
  s = applyPrecisionPad(s, big === 0n, precision);
  let prefix = '';
  if (hash) {
    if (conv === 'o') {
      if (s.length === 0 || s[0] !== '0') s = '0' + s;
    } else if (big !== 0n) {
      prefix = conv === 'X' ? '0X' : '0x';
    }
  }
  return { signAndPrefix: prefix, digits: s };
}

function fmtF(x: number, precision: number | null, plus: boolean, space: boolean, hash: boolean, upper: boolean): FormattedNum {
  const p = precision === null ? 6 : precision;
  if (Number.isNaN(x)) return { signAndPrefix: '', digits: upper ? 'NAN' : 'nan', isSpecial: true };
  const neg = x < 0 || Object.is(x, -0);
  const sign = numSign(neg, plus, space);
  if (!Number.isFinite(x)) return { signAndPrefix: sign, digits: upper ? 'INF' : 'inf', isSpecial: true };
  const { intPart, frac } = exactDecimal(Math.abs(x));
  const rounded = roundDigits(intPart, frac, p);
  const digits = rounded.intPart.toString() + (p > 0 ? '.' + rounded.frac : hash ? '.' : '');
  return { signAndPrefix: sign, digits };
}

function fmtE(x: number, precision: number | null, plus: boolean, space: boolean, hash: boolean, upper: boolean): FormattedNum {
  const p = precision === null ? 6 : precision;
  const eChar = upper ? 'E' : 'e';
  if (Number.isNaN(x)) return { signAndPrefix: '', digits: upper ? 'NAN' : 'nan', isSpecial: true };
  const neg = x < 0 || Object.is(x, -0);
  const sign = numSign(neg, plus, space);
  if (!Number.isFinite(x)) return { signAndPrefix: sign, digits: upper ? 'INF' : 'inf', isSpecial: true };
  if (x === 0) {
    const mantissa = '0' + (p > 0 ? '.' + '0'.repeat(p) : hash ? '.' : '');
    return { signAndPrefix: sign, digits: mantissa + eChar + '+00' };
  }
  const { intPart, frac } = exactDecimal(Math.abs(x));
  const { D, E } = toSciDigits(intPart, frac);
  const rs = roundSig(D, p + 1);
  const finalE = E + rs.expShift;
  const mantissa = rs.digits[0] + (p > 0 ? '.' + rs.digits.slice(1) : hash ? '.' : '');
  const expSign = finalE < 0 ? '-' : '+';
  let expDigits = Math.abs(finalE).toString();
  if (expDigits.length < 2) expDigits = '0'.repeat(2 - expDigits.length) + expDigits;
  return { signAndPrefix: sign, digits: mantissa + eChar + expSign + expDigits };
}

function fmtG(x: number, precision: number | null, plus: boolean, space: boolean, hash: boolean, upper: boolean): FormattedNum {
  const P = precision === null ? 6 : precision === 0 ? 1 : precision;
  const eChar = upper ? 'E' : 'e';
  if (Number.isNaN(x)) return { signAndPrefix: '', digits: upper ? 'NAN' : 'nan', isSpecial: true };
  const neg = x < 0 || Object.is(x, -0);
  const sign = numSign(neg, plus, space);
  if (!Number.isFinite(x)) return { signAndPrefix: sign, digits: upper ? 'INF' : 'inf', isSpecial: true };
  if (x === 0) {
    let digits = '0';
    if (hash && P > 1) digits += '.' + '0'.repeat(P - 1);
    else if (hash) digits += '.';
    return { signAndPrefix: sign, digits };
  }
  const { intPart, frac } = exactDecimal(Math.abs(x));
  const { D, E } = toSciDigits(intPart, frac);
  const rs = roundSig(D, P);
  const finalE = E + rs.expShift;
  const digitsArr = rs.digits;
  let out: string;
  if (P > finalE && finalE >= -4) {
    let intStr: string;
    let fracStr: string;
    if (finalE >= 0) {
      const full = digitsArr.length >= finalE + 1 ? digitsArr : digitsArr.padEnd(finalE + 1, '0');
      intStr = full.slice(0, finalE + 1);
      fracStr = full.slice(finalE + 1);
    } else {
      intStr = '0';
      fracStr = '0'.repeat(-finalE - 1) + digitsArr;
    }
    if (!hash) fracStr = fracStr.replace(/0+$/, '');
    out = intStr + (fracStr.length > 0 ? '.' + fracStr : hash ? '.' : '');
  } else {
    let fracStr = digitsArr.slice(1);
    if (!hash) fracStr = fracStr.replace(/0+$/, '');
    const mantissa = digitsArr[0] + (fracStr.length > 0 ? '.' + fracStr : hash ? '.' : '');
    const expSign = finalE < 0 ? '-' : '+';
    let expDigits = Math.abs(finalE).toString();
    if (expDigits.length < 2) expDigits = '0'.repeat(2 - expDigits.length) + expDigits;
    out = mantissa + eChar + expSign + expDigits;
  }
  return { signAndPrefix: sign, digits: out };
}

function padNumeric(signAndPrefix: string, digits: string, width: number, minus: boolean, useZero: boolean): string {
  const total = signAndPrefix.length + digits.length;
  if (total >= width) return signAndPrefix + digits;
  const padLen = width - total;
  if (minus) return signAndPrefix + digits + ' '.repeat(padLen);
  if (useZero) return signAndPrefix + '0'.repeat(padLen) + digits;
  return ' '.repeat(padLen) + signAndPrefix + digits;
}

function padSimple(s: string, width: number, minus: boolean): string {
  if (s.length >= width) return s;
  const padLen = width - s.length;
  return minus ? s + ' '.repeat(padLen) : ' '.repeat(padLen) + s;
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let result = '';
  let argIndex = 0;
  let i = 0;
  const n = fmt.length;
  while (i < n) {
    const c = fmt[i];
    if (c !== '%') {
      result += c;
      i++;
      continue;
    }
    i++; // consume '%'
    if (fmt[i] === '%') {
      result += '%';
      i++;
      continue;
    }
    let flags = '';
    while (i < n && '-+ 0#'.includes(fmt[i])) {
      flags += fmt[i];
      i++;
    }
    let widthStr = '';
    while (i < n && fmt[i] >= '0' && fmt[i] <= '9') {
      widthStr += fmt[i];
      i++;
    }
    let precision: number | null = null;
    if (fmt[i] === '.') {
      i++;
      let precStr = '';
      while (i < n && fmt[i] >= '0' && fmt[i] <= '9') {
        precStr += fmt[i];
        i++;
      }
      precision = precStr === '' ? 0 : parseInt(precStr, 10);
    }
    const conv = fmt[i];
    i++;

    const width = widthStr === '' ? 0 : parseInt(widthStr, 10);
    const minus = flags.includes('-');
    const plus = flags.includes('+');
    const space = flags.includes(' ');
    const zero = flags.includes('0');
    const hash = flags.includes('#');

    const arg = args[argIndex++];

    switch (conv) {
      case 'd':
      case 'i': {
        const r = fmtInt(arg as number | bigint, precision, plus, space);
        const useZero = zero && precision === null;
        result += padNumeric(r.signAndPrefix, r.digits, width, minus, useZero);
        break;
      }
      case 'x':
      case 'X':
      case 'o': {
        const r = fmtHexOct(arg as number | bigint, precision, hash, conv);
        const useZero = zero && precision === null;
        result += padNumeric(r.signAndPrefix, r.digits, width, minus, useZero);
        break;
      }
      case 'e':
      case 'E': {
        const r = fmtE(Number(arg), precision, plus, space, hash, conv === 'E');
        const useZero = zero && !r.isSpecial;
        result += padNumeric(r.signAndPrefix, r.digits, width, minus, useZero);
        break;
      }
      case 'f':
      case 'F': {
        const r = fmtF(Number(arg), precision, plus, space, hash, conv === 'F');
        const useZero = zero && !r.isSpecial;
        result += padNumeric(r.signAndPrefix, r.digits, width, minus, useZero);
        break;
      }
      case 'g':
      case 'G': {
        const r = fmtG(Number(arg), precision, plus, space, hash, conv === 'G');
        const useZero = zero && !r.isSpecial;
        result += padNumeric(r.signAndPrefix, r.digits, width, minus, useZero);
        break;
      }
      case 's': {
        let s = arg as string;
        if (precision !== null) s = s.slice(0, precision);
        result += padSimple(s, width, minus);
        break;
      }
      case 'c': {
        result += padSimple(arg as string, width, minus);
        break;
      }
    }
  }
  return result;
}
