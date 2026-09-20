type NumArg = number | bigint | string;

function toBigInt(v: number | bigint): bigint {
  return typeof v === 'bigint' ? v : BigInt(v);
}

// Exact decimal expansion of a non-negative finite double.
// value = intPart + 0.fracDigits (fracDigits is exact and terminating).
function doubleToExact(value: number): { intPart: bigint; fracDigits: string } {
  if (value === 0) return { intPart: 0n, fracDigits: '' };
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setFloat64(0, value);
  const hi = view.getUint32(0);
  const lo = view.getUint32(4);
  const biasedExp = (hi >>> 20) & 0x7ff;
  const mantHigh = BigInt(hi & 0xfffff);
  const mantLow = BigInt(lo >>> 0);
  const mantissaBits = (mantHigh << 32n) | mantLow;
  let M: bigint;
  let E: number;
  if (biasedExp === 0) {
    M = mantissaBits;
    E = -1074;
  } else {
    M = mantissaBits | (1n << 52n);
    E = biasedExp - 1075;
  }
  if (M === 0n) return { intPart: 0n, fracDigits: '' };
  if (E >= 0) {
    return { intPart: M << BigInt(E), fracDigits: '' };
  }
  const n = -E;
  const D = 1n << BigInt(n);
  const intPart = M / D;
  const r0 = M % D;
  const frac = r0 * 5n ** BigInt(n);
  const fracDigits = frac.toString().padStart(n, '0');
  return { intPart, fracDigits };
}

function decideRoundUp(rest: string, tieBreakOdd: () => boolean): boolean {
  const first = rest[0];
  if (first > '5') return true;
  if (first < '5') return false;
  if (/[1-9]/.test(rest.slice(1))) return true;
  return tieBreakOdd();
}

function roundFrac(intPart: bigint, fracDigits: string, k: number): { intPart: bigint; frac: string } {
  if (k >= fracDigits.length) {
    return { intPart, frac: fracDigits.padEnd(k, '0') };
  }
  const kept = fracDigits.slice(0, k);
  const rest = fracDigits.slice(k);
  const roundUp = decideRoundUp(rest, () => {
    const lastDigit = k > 0 ? Number(kept[k - 1]) : Number(intPart % 10n);
    return lastDigit % 2 === 1;
  });
  const scale = 10n ** BigInt(k);
  const keptBig = k > 0 ? BigInt(kept) : 0n;
  let combined = intPart * scale + keptBig;
  if (roundUp) combined += 1n;
  const newIntPart = combined / scale;
  const newFrac = (combined % scale).toString().padStart(k, '0');
  return { intPart: newIntPart, frac: newFrac };
}

function roundSignificant(digitsStr: string, P: number): { digits: string; carry: boolean } {
  if (P >= digitsStr.length) {
    return { digits: digitsStr.padEnd(P, '0'), carry: false };
  }
  const kept = digitsStr.slice(0, P);
  const rest = digitsStr.slice(P);
  const roundUp = decideRoundUp(rest, () => Number(kept[P - 1]) % 2 === 1);
  if (!roundUp) return { digits: kept, carry: false };
  const keptBig = BigInt(kept) + 1n;
  const keptStr = keptBig.toString();
  if (keptStr.length > P) {
    return { digits: keptStr.slice(0, P), carry: true };
  }
  return { digits: keptStr.padStart(P, '0'), carry: false };
}

function roundToFraction(mag: number, k: number): { intPart: string; frac: string } {
  const { intPart, fracDigits } = doubleToExact(mag);
  const r = roundFrac(intPart, fracDigits, k);
  return { intPart: r.intPart.toString(), frac: r.frac };
}

function roundToSignificant(mag: number, P: number): { sig: string; exp: number } {
  const { intPart, fracDigits } = doubleToExact(mag);
  const intStr = intPart.toString();
  const full = intStr + fracDigits;
  let idx = 0;
  while (idx < full.length && full[idx] === '0') idx++;
  const X = intStr.length - 1 - idx;
  const sigFull = full.slice(idx);
  const r = roundSignificant(sigFull, P);
  return { sig: r.digits, exp: X + (r.carry ? 1 : 0) };
}

function formatFromSig(sig: string, X: number): { intPart: string; frac: string } {
  if (X >= 0) {
    if (X + 1 <= sig.length) {
      return { intPart: sig.slice(0, X + 1), frac: sig.slice(X + 1) };
    }
    return { intPart: sig + '0'.repeat(X + 1 - sig.length), frac: '' };
  }
  return { intPart: '0', frac: '0'.repeat(-X - 1) + sig };
}

function pad(sign: string, prefix: string, digits: string, width: number, flags: string, zeroOk: boolean): string {
  const bodyStr = sign + prefix + digits;
  if (bodyStr.length >= width) return bodyStr;
  const padLen = width - bodyStr.length;
  if (flags.includes('-')) return bodyStr + ' '.repeat(padLen);
  if (flags.includes('0') && zeroOk) return sign + prefix + '0'.repeat(padLen) + digits;
  return ' '.repeat(padLen) + bodyStr;
}

function formatInt(arg: number | bigint, flags: string, width: number, precision: number | null): string {
  const big = toBigInt(arg);
  const neg = big < 0n;
  const mag = neg ? -big : big;
  let digits = mag.toString();
  if (precision !== null) {
    digits = precision === 0 && mag === 0n ? '' : digits.padStart(precision, '0');
  }
  const sign = neg ? '-' : flags.includes('+') ? '+' : flags.includes(' ') ? ' ' : '';
  const zeroOk = !flags.includes('-') && precision === null;
  return pad(sign, '', digits, width, flags, zeroOk);
}

function formatUnsigned(conv: string, arg: number | bigint, flags: string, width: number, precision: number | null): string {
  const big = toBigInt(arg);
  const radix = conv === 'o' ? 8 : 16;
  let digits = big.toString(radix);
  if (conv === 'X') digits = digits.toUpperCase();
  if (precision !== null) {
    digits = precision === 0 && big === 0n ? '' : digits.padStart(precision, '0');
  }
  if (conv === 'o' && flags.includes('#') && !digits.startsWith('0')) {
    digits = '0' + digits;
  }
  let prefix = '';
  if ((conv === 'x' || conv === 'X') && flags.includes('#') && big !== 0n) {
    prefix = conv === 'x' ? '0x' : '0X';
  }
  const zeroOk = !flags.includes('-') && precision === null;
  return pad('', prefix, digits, width, flags, zeroOk);
}

function formatFloat(conv: string, value: number, flags: string, width: number, precision: number | null): string {
  const isUpper = conv === conv.toUpperCase();
  const baseConv = conv.toLowerCase();
  const neg = value < 0 || Object.is(value, -0);
  const signChar = neg ? '-' : flags.includes('+') ? '+' : flags.includes(' ') ? ' ' : '';

  if (Number.isNaN(value)) {
    const text = isUpper ? 'NAN' : 'nan';
    return pad('', '', text, width, flags, false);
  }
  if (!Number.isFinite(value)) {
    const text = isUpper ? 'INF' : 'inf';
    return pad(signChar, '', text, width, flags, false);
  }

  const mag = Math.abs(value);
  let bodyDigits: string;

  if (baseConv === 'e') {
    const p = precision === null ? 6 : precision;
    let sig: string;
    let X: number;
    if (mag === 0) {
      sig = '0'.repeat(p + 1);
      X = 0;
    } else {
      const r = roundToSignificant(mag, p + 1);
      sig = r.sig;
      X = r.exp;
    }
    const frac = sig.slice(1);
    const showDot = p > 0 || flags.includes('#');
    const expSign = X < 0 ? '-' : '+';
    const expAbs = Math.abs(X).toString().padStart(2, '0');
    const eLetter = isUpper ? 'E' : 'e';
    bodyDigits = sig[0] + (showDot ? '.' + frac : '') + eLetter + expSign + expAbs;
  } else if (baseConv === 'f') {
    const k = precision === null ? 6 : precision;
    let intPart: string;
    let frac: string;
    if (mag === 0) {
      intPart = '0';
      frac = '0'.repeat(k);
    } else {
      const r = roundToFraction(mag, k);
      intPart = r.intPart;
      frac = r.frac;
    }
    const showDot = k > 0 || flags.includes('#');
    bodyDigits = intPart + (showDot ? '.' + frac : '');
  } else {
    let P = precision === null ? 6 : precision;
    if (P === 0) P = 1;
    let sig: string;
    let X: number;
    if (mag === 0) {
      sig = '0'.repeat(P);
      X = 0;
    } else {
      const r = roundToSignificant(mag, P);
      sig = r.sig;
      X = r.exp;
    }
    if (P > X && X >= -4) {
      const fp = formatFromSig(sig, X);
      let frac = fp.frac;
      if (!flags.includes('#')) frac = frac.replace(/0+$/, '');
      bodyDigits = fp.intPart + (frac.length > 0 || flags.includes('#') ? '.' + frac : '');
    } else {
      let fracE = sig.slice(1);
      if (!flags.includes('#')) fracE = fracE.replace(/0+$/, '');
      const expSign = X < 0 ? '-' : '+';
      const expAbs = Math.abs(X).toString().padStart(2, '0');
      const eLetter = isUpper ? 'E' : 'e';
      bodyDigits = sig[0] + (fracE.length > 0 || flags.includes('#') ? '.' + fracE : '') + eLetter + expSign + expAbs;
    }
  }

  const zeroOk = !flags.includes('-');
  return pad(signChar, '', bodyDigits, width, flags, zeroOk);
}

function formatString(s: string, flags: string, width: number, precision: number | null): string {
  const sliced = precision !== null ? s.slice(0, precision) : s;
  const padLen = width - sliced.length;
  if (padLen <= 0) return sliced;
  return flags.includes('-') ? sliced + ' '.repeat(padLen) : ' '.repeat(padLen) + sliced;
}

export function format(fmt: string, ...args: NumArg[]): string {
  let result = '';
  let argIndex = 0;
  let i = 0;
  while (i < fmt.length) {
    const ch = fmt[i];
    if (ch !== '%') {
      result += ch;
      i++;
      continue;
    }
    i++;
    if (fmt[i] === '%') {
      result += '%';
      i++;
      continue;
    }
    let flags = '';
    while (i < fmt.length && '-+0 #'.includes(fmt[i])) {
      flags += fmt[i];
      i++;
    }
    let widthStr = '';
    while (i < fmt.length && /[0-9]/.test(fmt[i])) {
      widthStr += fmt[i];
      i++;
    }
    let precision: number | null = null;
    if (fmt[i] === '.') {
      i++;
      let precStr = '';
      while (i < fmt.length && /[0-9]/.test(fmt[i])) {
        precStr += fmt[i];
        i++;
      }
      precision = precStr === '' ? 0 : parseInt(precStr, 10);
    }
    const conv = fmt[i];
    i++;
    const width = widthStr === '' ? 0 : parseInt(widthStr, 10);
    const arg = args[argIndex++];

    switch (conv) {
      case 'd':
      case 'i':
        result += formatInt(arg as number | bigint, flags, width, precision);
        break;
      case 'x':
      case 'X':
      case 'o':
        result += formatUnsigned(conv, arg as number | bigint, flags, width, precision);
        break;
      case 'e':
      case 'E':
      case 'f':
      case 'F':
      case 'g':
      case 'G':
        result += formatFloat(conv, arg as number, flags, width, precision);
        break;
      case 's':
        result += formatString(arg as string, flags, width, precision);
        break;
      case 'c':
        result += formatString(arg as string, flags, width, null);
        break;
      default:
        throw new Error(`Unsupported conversion: %${conv}`);
    }
  }
  return result;
}
