type Flags = {
  minus: boolean;
  plus: boolean;
  space: boolean;
  zero: boolean;
  hash: boolean;
};

type Spec = {
  flags: Flags;
  width: number;
  precision: number | null; // null = not given
  conv: string;
};

function decompose(x: number): { sign: number; rawExp: number; mantissa: bigint } {
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const sign = (hi >>> 31) & 1;
  const rawExp = (hi >>> 20) & 0x7ff;
  const mantHi = hi & 0xfffff;
  const mantissa = (BigInt(mantHi) << 32n) | BigInt(lo >>> 0);
  return { sign, rawExp, mantissa };
}

function toME(x: number): { m: bigint; e: number } {
  const { rawExp, mantissa } = decompose(x);
  if (rawExp === 0) {
    return { m: mantissa, e: -1074 };
  }
  return { m: mantissa | (1n << 52n), e: rawExp - 1075 };
}

// Exact decimal expansion of m * 2^e (m >= 0 bigint, e integer).
function exactDecimal(m: bigint, e: number): { intPart: string; fracPart: string } {
  if (m === 0n) {
    return { intPart: '0', fracPart: e < 0 ? '0'.repeat(-e) : '' };
  }
  if (e >= 0) {
    return { intPart: (m << BigInt(e)).toString(), fracPart: '' };
  }
  const k = -e;
  const num = m * 5n ** BigInt(k);
  const numStr = num.toString().padStart(k + 1, '0');
  const intPart = numStr.slice(0, numStr.length - k).replace(/^0+(?=\d)/, '');
  const fracPart = numStr.slice(numStr.length - k);
  return { intPart, fracPart };
}

// Round the exact decimal (intPart.fracPart) to `p` digits after the point.
function roundFixed(intPart: string, fracPart: string, p: number): { intPart: string; fracPart: string } {
  if (p >= fracPart.length) {
    return { intPart, fracPart: fracPart + '0'.repeat(p - fracPart.length) };
  }
  const digits = intPart + fracPart;
  const cut = intPart.length + p;
  const kept = digits.slice(0, cut);
  const roundDigit = digits[cut];
  const rest = digits.slice(cut + 1);
  const restAllZero = !/[1-9]/.test(rest);
  const lastKept = kept[kept.length - 1];
  const roundUp =
    roundDigit > '5' || (roundDigit === '5' && (!restAllZero || parseInt(lastKept, 10) % 2 === 1));
  let newDigits = kept;
  if (roundUp) {
    const num = BigInt(kept) + 1n;
    let s = num.toString();
    if (s.length < kept.length) s = s.padStart(kept.length, '0');
    newDigits = s;
  }
  const grew = newDigits.length - kept.length;
  const newIntLen = intPart.length + grew;
  return { intPart: newDigits.slice(0, newIntLen), fracPart: newDigits.slice(newIntLen) };
}

// Round the exact decimal to P significant digits. Returns digit string of length P and decimal exponent.
function roundSignificant(intPart: string, fracPart: string, P: number): { digits: string; exp: number } {
  const digits = intPart + fracPart;
  const isZero = !/[1-9]/.test(digits);
  if (isZero) {
    return { digits: '0'.repeat(P), exp: 0 };
  }
  const firstNonZero = digits.search(/[1-9]/);
  let exp: number;
  if (firstNonZero < intPart.length) {
    exp = intPart.length - 1 - firstNonZero;
  } else {
    exp = -(firstNonZero - intPart.length + 1);
  }
  const needed = firstNonZero + P + 1;
  const padded = digits.length >= needed ? digits : digits + '0'.repeat(needed - digits.length);
  const kept = padded.slice(firstNonZero, firstNonZero + P);
  const roundDigit = padded[firstNonZero + P];
  const rest = padded.slice(firstNonZero + P + 1);
  const restAllZero = !/[1-9]/.test(rest);
  const lastKept = kept[kept.length - 1];
  const roundUp =
    roundDigit > '5' || (roundDigit === '5' && (!restAllZero || parseInt(lastKept, 10) % 2 === 1));
  if (!roundUp) {
    return { digits: kept, exp };
  }
  const num = BigInt(kept) + 1n;
  let s = num.toString();
  if (s.length > P) {
    exp += 1;
    s = s.slice(0, P);
  } else {
    s = s.padStart(P, '0');
  }
  return { digits: s, exp };
}

function signOf(negative: boolean, flags: Flags): string {
  if (negative) return '-';
  if (flags.plus) return '+';
  if (flags.space) return ' ';
  return '';
}

// Pad numeric content: sign + prefix + digits, honoring zero-fill between prefix and digits.
function padNumeric(sign: string, prefix: string, digits: string, spec: Spec): string {
  const content = sign + prefix + digits;
  if (content.length >= spec.width) return content;
  const padLen = spec.width - content.length;
  if (spec.flags.minus) {
    return content + ' '.repeat(padLen);
  }
  if (spec.flags.zero) {
    return sign + prefix + '0'.repeat(padLen) + digits;
  }
  return ' '.repeat(padLen) + content;
}

function padGeneric(content: string, spec: Spec): string {
  if (content.length >= spec.width) return content;
  const padLen = spec.width - content.length;
  if (spec.flags.minus) return content + ' '.repeat(padLen);
  return ' '.repeat(padLen) + content;
}

function formatInt(value: number | bigint, spec: Spec): string {
  const big = typeof value === 'bigint' ? value : BigInt(value);
  const negative = big < 0n;
  const mag = negative ? -big : big;
  let digits = mag.toString();
  if (spec.precision !== null) {
    if (spec.precision === 0 && mag === 0n) {
      digits = '';
    } else if (digits.length < spec.precision) {
      digits = digits.padStart(spec.precision, '0');
    }
  }
  const sign = signOf(negative, spec.flags);
  const zeroFlagActive = spec.flags.zero && spec.precision === null;
  const effectiveSpec: Spec = zeroFlagActive
    ? spec
    : { ...spec, flags: { ...spec.flags, zero: false } };
  return padNumeric(sign, '', digits, effectiveSpec);
}

function formatUnsignedBase(value: number | bigint, base: 16 | 8, upper: boolean, spec: Spec): string {
  const mag = typeof value === 'bigint' ? value : BigInt(value);
  let digits = mag.toString(base);
  if (upper) digits = digits.toUpperCase();
  if (spec.precision !== null) {
    if (spec.precision === 0 && mag === 0n) {
      digits = '';
    } else if (digits.length < spec.precision) {
      digits = digits.padStart(spec.precision, '0');
    }
  }
  let prefix = '';
  if (spec.flags.hash) {
    if (base === 16 && mag !== 0n) {
      prefix = upper ? '0X' : '0x';
    } else if (base === 8) {
      if (digits === '' || digits[0] !== '0') digits = '0' + digits;
    }
  }
  const zeroFlagActive = spec.flags.zero && spec.precision === null;
  const effectiveSpec: Spec = zeroFlagActive
    ? spec
    : { ...spec, flags: { ...spec.flags, zero: false } };
  return padNumeric('', prefix, digits, effectiveSpec);
}

function formatFloatConv(value: number, spec: Spec): string {
  const conv = spec.conv;
  const upper = conv === conv.toUpperCase();
  const { sign: signBit, rawExp, mantissa } = decompose(value);
  const negative = signBit === 1;
  const isNaN = rawExp === 0x7ff && mantissa !== 0n;
  const isInf = rawExp === 0x7ff && mantissa === 0n;

  if (isNaN) {
    const text = upper ? 'NAN' : 'nan';
    const spec2: Spec = { ...spec, flags: { ...spec.flags, zero: false } };
    return padNumeric('', '', text, spec2);
  }
  if (isInf) {
    const text = upper ? 'INF' : 'inf';
    const sign = signOf(negative, spec.flags);
    const spec2: Spec = { ...spec, flags: { ...spec.flags, zero: false } };
    return padNumeric(sign, '', text, spec2);
  }

  const { m, e } = toME(value);
  const sign = signOf(negative, spec.flags);

  if (conv === 'f' || conv === 'F') {
    const p = spec.precision === null ? 6 : spec.precision;
    const { intPart, fracPart } = exactDecimal(m, e);
    const rounded = roundFixed(intPart, fracPart, p);
    let digits = rounded.intPart;
    if (p > 0 || spec.flags.hash) {
      digits += '.' + rounded.fracPart;
    }
    return padNumeric(sign, '', digits, spec);
  }

  if (conv === 'e' || conv === 'E') {
    const p = spec.precision === null ? 6 : spec.precision;
    const { intPart, fracPart } = exactDecimal(m, e);
    const { digits: sig, exp } = roundSignificant(intPart, fracPart, p + 1);
    let mantissaStr = sig[0];
    if (p > 0 || spec.flags.hash) {
      mantissaStr += '.' + sig.slice(1);
    }
    const expSign = exp < 0 ? '-' : '+';
    const expDigits = Math.abs(exp).toString().padStart(2, '0');
    const eLetter = conv === 'E' ? 'E' : 'e';
    const digits = mantissaStr + eLetter + expSign + expDigits;
    return padNumeric(sign, '', digits, spec);
  }

  // g, G
  {
    let P = spec.precision === null ? 6 : spec.precision;
    if (P === 0) P = 1;
    const { intPart, fracPart } = exactDecimal(m, e);
    const { digits: sig, exp } = roundSignificant(intPart, fracPart, P);
    const eLetter = conv === 'G' ? 'E' : 'e';
    let digits: string;
    if (P > exp && exp >= -4) {
      // f style with precision P-1-exp
      let outIntPart: string;
      let outFracPart: string;
      if (exp >= 0) {
        const intLen = exp + 1;
        if (intLen >= sig.length) {
          outIntPart = sig + '0'.repeat(intLen - sig.length);
          outFracPart = '';
        } else {
          outIntPart = sig.slice(0, intLen);
          outFracPart = sig.slice(intLen);
        }
      } else {
        outIntPart = '0';
        outFracPart = '0'.repeat(-exp - 1) + sig;
      }
      if (!spec.flags.hash) {
        outFracPart = outFracPart.replace(/0+$/, '');
      }
      digits = outFracPart.length > 0 ? outIntPart + '.' + outFracPart : outIntPart + (spec.flags.hash ? '.' : '');
    } else {
      let mantissaStr = sig[0];
      let frac = sig.slice(1);
      if (!spec.flags.hash) {
        frac = frac.replace(/0+$/, '');
      }
      if (frac.length > 0 || spec.flags.hash) {
        mantissaStr += '.' + frac;
      }
      const expSign = exp < 0 ? '-' : '+';
      const expDigits = Math.abs(exp).toString().padStart(2, '0');
      digits = mantissaStr + eLetter + expSign + expDigits;
    }
    return padNumeric(sign, '', digits, spec);
  }
}

function parseSpec(fmt: string, i: number): { spec: Spec; next: number } {
  let j = i + 1; // skip '%'
  const flags: Flags = { minus: false, plus: false, space: false, zero: false, hash: false };
  while (j < fmt.length && '-+0 #'.includes(fmt[j])) {
    switch (fmt[j]) {
      case '-':
        flags.minus = true;
        break;
      case '+':
        flags.plus = true;
        break;
      case ' ':
        flags.space = true;
        break;
      case '0':
        flags.zero = true;
        break;
      case '#':
        flags.hash = true;
        break;
    }
    j++;
  }
  let widthStr = '';
  while (j < fmt.length && /\d/.test(fmt[j])) {
    widthStr += fmt[j];
    j++;
  }
  const width = widthStr === '' ? 0 : parseInt(widthStr, 10);
  let precision: number | null = null;
  if (fmt[j] === '.') {
    j++;
    let precStr = '';
    while (j < fmt.length && /\d/.test(fmt[j])) {
      precStr += fmt[j];
      j++;
    }
    precision = precStr === '' ? 0 : parseInt(precStr, 10);
  }
  const conv = fmt[j];
  j++;
  return { spec: { flags, width, precision, conv }, next: j };
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let result = '';
  let argIdx = 0;
  let i = 0;
  while (i < fmt.length) {
    const ch = fmt[i];
    if (ch !== '%') {
      result += ch;
      i++;
      continue;
    }
    if (fmt[i + 1] === '%') {
      result += '%';
      i += 2;
      continue;
    }
    const { spec, next } = parseSpec(fmt, i);
    i = next;
    const arg = args[argIdx++];
    switch (spec.conv) {
      case 'd':
      case 'i':
        result += formatInt(arg as number | bigint, spec);
        break;
      case 'x':
        result += formatUnsignedBase(arg as number | bigint, 16, false, spec);
        break;
      case 'X':
        result += formatUnsignedBase(arg as number | bigint, 16, true, spec);
        break;
      case 'o':
        result += formatUnsignedBase(arg as number | bigint, 8, false, spec);
        break;
      case 'e':
      case 'E':
      case 'f':
      case 'F':
      case 'g':
      case 'G':
        result += formatFloatConv(arg as number, spec);
        break;
      case 's': {
        let s = arg as string;
        if (spec.precision !== null) s = s.slice(0, spec.precision);
        result += padGeneric(s, spec);
        break;
      }
      case 'c': {
        const s = arg as string;
        result += padGeneric(s, spec);
        break;
      }
    }
  }
  return result;
}
