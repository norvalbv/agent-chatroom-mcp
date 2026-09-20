type Flags = {
  minus: boolean;
  plus: boolean;
  space: boolean;
  zero: boolean;
  hash: boolean;
};

interface Decomposed {
  sign: 0 | 1;
  D: bigint;
  s: number;
  digits0: string;
  pointExp: number;
}

function decompose(value: number): Decomposed {
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setFloat64(0, value);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const sign: 0 | 1 = (hi >>> 31) as 0 | 1;
  const expBits = (hi >>> 20) & 0x7ff;
  const mantHi = hi & 0xfffff;
  const mantissa = (BigInt(mantHi) << 32n) | BigInt(lo >>> 0);

  let m: bigint;
  let exp: number;
  if (expBits === 0) {
    m = mantissa;
    exp = -1074;
  } else {
    m = mantissa | (1n << 52n);
    exp = expBits - 1075;
  }

  let D: bigint;
  let s: number;
  if (exp >= 0) {
    D = m << BigInt(exp);
    s = 0;
  } else {
    const k = -exp;
    D = m * 5n ** BigInt(k);
    s = k;
  }

  const digits0 = D.toString();
  const pointExp = D === 0n ? 0 : digits0.length - 1 - s;

  return { sign, D, s, digits0, pointExp };
}

function roundDigits(digits: string, keep: number): { digits: string; overflow: boolean } {
  if (keep >= digits.length) {
    return { digits: digits.padEnd(keep, '0'), overflow: false };
  }
  const kept = digits.slice(0, keep);
  const firstDropped = digits[keep];
  const rest = digits.slice(keep + 1);

  let roundUp: boolean;
  if (firstDropped > '5') {
    roundUp = true;
  } else if (firstDropped < '5') {
    roundUp = false;
  } else if (/[1-9]/.test(rest)) {
    roundUp = true;
  } else {
    const lastKept = keep > 0 ? kept[keep - 1] : '0';
    roundUp = Number(lastKept) % 2 === 1;
  }

  if (!roundUp) {
    return { digits: kept, overflow: false };
  }

  const incremented = (BigInt(kept === '' ? '0' : kept) + 1n).toString();
  if (incremented.length > keep) {
    return { digits: incremented, overflow: true };
  }
  return { digits: incremented.padStart(keep, '0'), overflow: false };
}

function eFormatDigits(dec: Decomposed, prec: number): { first: string; frac: string; exp: number } {
  const keep = prec + 1;
  const r = roundDigits(dec.digits0, keep);
  let mant = r.digits;
  let exp = dec.pointExp;
  if (r.overflow) {
    mant = r.digits.slice(0, keep);
    exp += 1;
  }
  return { first: mant[0], frac: mant.slice(1), exp };
}

function fFormatDigits(dec: Decomposed, prec: number): { intPart: string; frac: string } {
  const { digits0, s } = dec;
  const paddedLen = Math.max(digits0.length, s + 1);
  const paddedInt = digits0.padStart(paddedLen, '0');

  let fullDigits: string;
  if (prec >= s) {
    fullDigits = paddedInt + '0'.repeat(prec - s);
  } else {
    const keep = paddedInt.length - (s - prec);
    const r = roundDigits(paddedInt, keep);
    fullDigits = r.digits;
  }

  const intLen = fullDigits.length - prec;
  let intPart = fullDigits.slice(0, intLen);
  if (intPart === '') intPart = '0';
  const frac = prec > 0 ? fullDigits.slice(intLen) : '';
  return { intPart, frac };
}

function padNumeric(
  prefix: string,
  digits: string,
  width: number,
  leftAlign: boolean,
  zeroFlag: boolean
): string {
  const body = prefix + digits;
  if (body.length >= width) return body;
  if (leftAlign) return body.padEnd(width, ' ');
  if (zeroFlag) {
    return prefix + '0'.repeat(width - body.length) + digits;
  }
  return body.padStart(width, ' ');
}

function signPrefix(neg: boolean, flags: Flags): string {
  if (neg) return '-';
  if (flags.plus) return '+';
  if (flags.space) return ' ';
  return '';
}

function formatSpec(
  conv: string,
  flags: Flags,
  width: number | undefined,
  precision: number | undefined,
  arg: number | bigint | string
): string {
  const w = width ?? 0;

  if (conv === 'd' || conv === 'i') {
    const value = arg as number | bigint;
    const neg = value < 0;
    const absBig = typeof value === 'bigint' ? (neg ? -value : value) : BigInt(Math.abs(value));
    let digitStr = absBig.toString();
    const precisionGiven = precision !== undefined;
    if (precisionGiven) {
      if (precision === 0 && absBig === 0n) {
        digitStr = '';
      } else {
        digitStr = digitStr.padStart(precision, '0');
      }
    }
    const prefix = signPrefix(neg, flags);
    const zeroFlag = flags.zero && !flags.minus && !precisionGiven;
    return padNumeric(prefix, digitStr, w, flags.minus, zeroFlag);
  }

  if (conv === 'x' || conv === 'X' || conv === 'o') {
    const value = arg as number | bigint;
    const absBig = typeof value === 'bigint' ? value : BigInt(value);
    const base = conv === 'o' ? 8 : 16;
    let digitStr = absBig.toString(base);
    if (conv === 'X') digitStr = digitStr.toUpperCase();
    const precisionGiven = precision !== undefined;
    if (precisionGiven) {
      if (precision === 0 && absBig === 0n) {
        digitStr = '';
      } else {
        digitStr = digitStr.padStart(precision, '0');
      }
    }
    let prefix = '';
    if (flags.hash) {
      if (conv === 'o') {
        if (digitStr === '' || digitStr[0] !== '0') {
          digitStr = '0' + digitStr;
        }
      } else if (absBig !== 0n) {
        prefix = conv === 'X' ? '0X' : '0x';
      }
    }
    const zeroFlag = flags.zero && !flags.minus && !precisionGiven;
    return padNumeric(prefix, digitStr, w, flags.minus, zeroFlag);
  }

  if (conv === 'e' || conv === 'E' || conv === 'f' || conv === 'F' || conv === 'g' || conv === 'G') {
    const value = arg as number;
    const dec = decompose(value);
    const neg = dec.sign === 1;
    const isNaN_ = Number.isNaN(value);
    const isInf = !Number.isFinite(value) && !isNaN_;
    const upper = conv === 'E' || conv === 'F' || conv === 'G';

    let core: string;
    if (isNaN_) {
      core = upper ? 'NAN' : 'nan';
      const zeroFlag = false;
      const prefix = '';
      return padNumeric(prefix, core, w, flags.minus, zeroFlag);
    }
    if (isInf) {
      core = upper ? 'INF' : 'inf';
      const prefix = signPrefix(neg, flags);
      return padNumeric(prefix, core, w, flags.minus, false);
    }

    const prefix = signPrefix(neg, flags);

    if (conv === 'f' || conv === 'F') {
      const prec = precision ?? 6;
      const { intPart, frac } = fFormatDigits(dec, prec);
      const dot = prec > 0 || flags.hash ? '.' : '';
      core = intPart + dot + frac;
      return padNumeric(prefix, core, w, flags.minus, flags.zero && !flags.minus);
    }

    if (conv === 'e' || conv === 'E') {
      const prec = precision ?? 6;
      const { first, frac, exp } = eFormatDigits(dec, prec);
      const dot = prec > 0 || flags.hash ? '.' : '';
      const expSign = exp < 0 ? '-' : '+';
      const expDigits = Math.abs(exp).toString().padStart(2, '0');
      const eChar = upper ? 'E' : 'e';
      core = first + dot + frac + eChar + expSign + expDigits;
      return padNumeric(prefix, core, w, flags.minus, flags.zero && !flags.minus);
    }

    // g, G
    const P = precision === undefined ? 6 : precision === 0 ? 1 : precision;
    const { first, frac, exp: X } = eFormatDigits(dec, P - 1);
    let body: string;
    if (P > X && X >= -4) {
      const fPrec = P - 1 - X;
      const { intPart, frac: fFrac } = fFormatDigits(dec, fPrec);
      if (flags.hash) {
        body = intPart + (fPrec > 0 ? '.' + fFrac : '');
      } else {
        let fracTrimmed = fFrac.replace(/0+$/, '');
        body = intPart + (fracTrimmed.length > 0 ? '.' + fracTrimmed : '');
      }
    } else {
      const expSign = X < 0 ? '-' : '+';
      const expDigits = Math.abs(X).toString().padStart(2, '0');
      const eChar = upper ? 'E' : 'e';
      if (flags.hash) {
        body = first + (frac.length > 0 ? '.' + frac : '.') + eChar + expSign + expDigits;
      } else {
        const fracTrimmed = frac.replace(/0+$/, '');
        body = first + (fracTrimmed.length > 0 ? '.' + fracTrimmed : '') + eChar + expSign + expDigits;
      }
    }
    return padNumeric(prefix, body, w, flags.minus, flags.zero && !flags.minus);
  }

  if (conv === 's') {
    let str = arg as string;
    if (precision !== undefined) str = str.slice(0, precision);
    if (str.length >= w) return str;
    return flags.minus ? str.padEnd(w, ' ') : str.padStart(w, ' ');
  }

  if (conv === 'c') {
    const str = arg as string;
    if (str.length >= w) return str;
    return flags.minus ? str.padEnd(w, ' ') : str.padStart(w, ' ');
  }

  throw new Error(`unsupported conversion: ${conv}`);
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let out = '';
  let argIdx = 0;
  let i = 0;
  const n = fmt.length;

  while (i < n) {
    const ch = fmt[i];
    if (ch !== '%') {
      out += ch;
      i++;
      continue;
    }

    i++; // consume '%'
    if (fmt[i] === '%') {
      out += '%';
      i++;
      continue;
    }

    const flags: Flags = { minus: false, plus: false, space: false, zero: false, hash: false };
    while (i < n) {
      const c = fmt[i];
      if (c === '-') flags.minus = true;
      else if (c === '+') flags.plus = true;
      else if (c === ' ') flags.space = true;
      else if (c === '0') flags.zero = true;
      else if (c === '#') flags.hash = true;
      else break;
      i++;
    }

    let widthStr = '';
    while (i < n && fmt[i] >= '0' && fmt[i] <= '9') {
      widthStr += fmt[i];
      i++;
    }
    const width = widthStr === '' ? undefined : parseInt(widthStr, 10);

    let precision: number | undefined;
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

    const arg = args[argIdx++];
    out += formatSpec(conv, flags, width, precision, arg);
  }

  return out;
}
