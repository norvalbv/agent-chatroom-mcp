type Arg = number | bigint | string;

interface Spec {
  flags: Set<string>;
  width: number | null;
  precision: number | null;
  conv: string;
}

function parseSpec(fmt: string, i: number): { spec: Spec; next: number } {
  const flags = new Set<string>();
  while (i < fmt.length && '-+ 0#'.includes(fmt[i])) {
    flags.add(fmt[i]);
    i++;
  }
  let width: number | null = null;
  let start = i;
  while (i < fmt.length && fmt[i] >= '0' && fmt[i] <= '9') i++;
  if (i > start) width = parseInt(fmt.slice(start, i), 10);

  let precision: number | null = null;
  if (fmt[i] === '.') {
    i++;
    start = i;
    while (i < fmt.length && fmt[i] >= '0' && fmt[i] <= '9') i++;
    precision = i > start ? parseInt(fmt.slice(start, i), 10) : 0;
  }

  const conv = fmt[i];
  i++;
  return { spec: { flags, width, precision, conv }, next: i };
}

function padNumeric(sign: string, prefix: string, digits: string, spec: Spec): string {
  const body = sign + prefix + digits;
  const width = spec.width ?? 0;
  if (body.length >= width) return body;
  const padLen = width - body.length;
  if (spec.flags.has('-')) {
    return body + ' '.repeat(padLen);
  }
  if (spec.flags.has('0')) {
    return sign + prefix + '0'.repeat(padLen) + digits;
  }
  return ' '.repeat(padLen) + body;
}

function padGeneral(text: string, spec: Spec): string {
  const width = spec.width ?? 0;
  if (text.length >= width) return text;
  const padLen = width - text.length;
  if (spec.flags.has('-')) return text + ' '.repeat(padLen);
  return ' '.repeat(padLen) + text;
}

function signFor(isNeg: boolean, spec: Spec): string {
  if (isNeg) return '-';
  if (spec.flags.has('+')) return '+';
  if (spec.flags.has(' ')) return ' ';
  return '';
}

function toBigIntMagnitude(v: number | bigint): { neg: boolean; mag: bigint } {
  if (typeof v === 'bigint') {
    return { neg: v < 0n, mag: v < 0n ? -v : v };
  }
  const neg = v < 0 || Object.is(v, -0);
  const mag = BigInt(Math.abs(v));
  return { neg, mag };
}

function formatDI(v: number | bigint, spec: Spec): string {
  const { neg, mag } = toBigIntMagnitude(v);
  let digits = mag.toString();
  if (spec.precision !== null) {
    if (spec.precision === 0 && mag === 0n) {
      digits = '';
    } else if (digits.length < spec.precision) {
      digits = '0'.repeat(spec.precision - digits.length) + digits;
    }
  }
  const sign = signFor(neg, spec);
  const useZero = spec.flags.has('0') && !spec.flags.has('-') && spec.precision === null;
  const localSpec: Spec = { ...spec, flags: useZero ? spec.flags : new Set([...spec.flags].filter(f => f !== '0')) };
  return padNumeric(sign, '', digits, localSpec);
}

function formatXO(v: number | bigint, spec: Spec): string {
  const mag = typeof v === 'bigint' ? v : BigInt(Math.abs(v));
  const base = spec.conv === 'o' ? 8 : 16;
  let digits = mag.toString(base);
  if (spec.conv === 'X') digits = digits.toUpperCase();

  let precision = spec.precision;
  if (precision !== null) {
    if (precision === 0 && mag === 0n) {
      digits = '';
    } else if (digits.length < precision) {
      digits = '0'.repeat(precision - digits.length) + digits;
    }
  }

  if (spec.conv === 'o' && spec.flags.has('#')) {
    if (digits.length === 0 || digits[0] !== '0') {
      digits = '0' + digits;
    }
  }

  let prefix = '';
  if (spec.flags.has('#') && (spec.conv === 'x' || spec.conv === 'X') && mag !== 0n) {
    prefix = spec.conv === 'x' ? '0x' : '0X';
  }

  const useZero = spec.flags.has('0') && !spec.flags.has('-') && spec.precision === null;
  const localSpec: Spec = { ...spec, flags: useZero ? spec.flags : new Set([...spec.flags].filter(f => f !== '0')) };
  return padNumeric('', prefix, digits, localSpec);
}

// Decompose a finite non-negative double into exact decimal digit string and exponent
// such that value == 0.digits * 10^exponent (digits has no leading zero, unless value is 0).
function exactDecimal(v: number): { digits: string; exp: number } {
  if (v === 0) return { digits: '0', exp: 1 };

  // Use BigInt exact representation via toString with enough precision.
  // Decompose the double into mantissa * 2^exp using DataView.
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setFloat64(0, v);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  let mantissaHi = hi & 0xfffff;
  let mantissa = (BigInt(mantissaHi) << 32n) | BigInt(lo);
  let e: number;
  if (expBits === 0) {
    // subnormal
    e = -1074;
  } else {
    mantissa = mantissa | (1n << 52n);
    e = expBits - 1075;
  }
  // value = mantissa * 2^e
  let numerator: bigint;
  let denomExp2 = 0;
  if (e >= 0) {
    numerator = mantissa << BigInt(e);
  } else {
    numerator = mantissa;
    denomExp2 = -e;
  }
  // value = numerator / 2^denomExp2
  // Multiply numerator by 5^denomExp2 to get value * 10^denomExp2 = numerator * 5^denomExp2
  const scaled = numerator * (5n ** BigInt(denomExp2));
  // value = scaled / 10^denomExp2
  let digits = scaled.toString();
  const exp = digits.length - denomExp2;
  return { digits, exp };
}

// Round a digit string (representing 0.digits * 10^exp, all digits significant, no leading zero)
// to n significant digits using round-half-to-even based on exact value.
function roundSignificant(digits: string, exp: number, n: number): { digits: string; exp: number } {
  if (n < 0) n = 0;
  if (digits.length <= n) {
    return { digits: digits + '0'.repeat(n - digits.length), exp };
  }
  const keep = digits.slice(0, n);
  const rest = digits.slice(n);
  const firstRestDigit = rest[0];
  let roundUp = false;
  if (firstRestDigit > '5') {
    roundUp = true;
  } else if (firstRestDigit < '5') {
    roundUp = false;
  } else {
    // exactly 5 followed by digits; check if rest beyond first is all zero
    const restAfter = rest.slice(1);
    const isExactHalf = /^0*$/.test(restAfter);
    if (!isExactHalf) {
      roundUp = true;
    } else {
      const lastKept = n === 0 ? '0' : keep[keep.length - 1];
      roundUp = (parseInt(lastKept, 10) % 2) === 1;
    }
  }
  let resultDigits = keep;
  let resultExp = exp;
  if (roundUp) {
    let arr = keep.split('');
    let idx = arr.length - 1;
    while (idx >= 0) {
      if (arr[idx] === '9') {
        arr[idx] = '0';
        idx--;
      } else {
        arr[idx] = String(Number(arr[idx]) + 1);
        break;
      }
    }
    if (idx < 0) {
      arr.unshift('1');
      if (n > 0) arr.pop();
      resultExp = exp + 1;
    }
    resultDigits = arr.join('');
  }
  return { digits: resultDigits, exp: resultExp };
}

function formatEfmt(absValue: number, precision: number, upper: boolean, hasHash: boolean): string {
  if (absValue === 0) {
    const digits = '0'.repeat(precision);
    const mantissa = precision > 0 || hasHash ? '0.' + digits : '0';
    return mantissa + (upper ? 'E' : 'e') + '+00';
  }
  const { digits: rawDigits, exp } = exactDecimal(absValue);
  const { digits, exp: newExp } = roundSignificant(rawDigits, exp, precision + 1);
  const decExp = newExp - 1;
  let mantissa = digits[0];
  const frac = digits.slice(1);
  if (precision > 0 || hasHash) {
    mantissa += '.' + frac;
  }
  const expSign = decExp < 0 ? '-' : '+';
  let expDigits = Math.abs(decExp).toString();
  if (expDigits.length < 2) expDigits = '0' + expDigits;
  return mantissa + (upper ? 'E' : 'e') + expSign + expDigits;
}

function formatFfmt(absValue: number, precision: number, hasHash: boolean): string {
  if (absValue === 0) {
    const intPart = '0';
    const fracDigits = '0'.repeat(precision);
    return precision > 0 || hasHash ? intPart + '.' + fracDigits : intPart;
  }
  const { digits: rawDigits, exp } = exactDecimal(absValue);
  // value = 0.digits * 10^exp; we want digits rounded to `precision` places after decimal point
  // total significant digits needed = exp + precision (digits before point = exp, after = precision)
  const totalSig = exp + precision;
  let intPart: string;
  let fracPart: string;
  const { digits, exp: newExp } = roundSignificant(rawDigits, exp, totalSig);
  // digits has `totalSig` characters (or padded), representing 0.digits * 10^newExp
  let combined = digits;
  const pointPos = newExp; // digits before decimal point count
  if (pointPos <= 0) {
    intPart = '0';
    fracPart = '0'.repeat(-pointPos) + combined;
  } else {
    if (combined.length < pointPos) {
      combined = combined + '0'.repeat(pointPos - combined.length);
    }
    intPart = combined.slice(0, pointPos);
    fracPart = combined.slice(pointPos);
  }
  if (fracPart.length < precision) {
    fracPart = fracPart + '0'.repeat(precision - fracPart.length);
  } else if (fracPart.length > precision) {
    fracPart = fracPart.slice(0, precision);
  }
  if (intPart === '') intPart = '0';
  return precision > 0 || hasHash ? intPart + '.' + fracPart : intPart;
}

function stripTrailingZerosG(s: string): string {
  if (!s.includes('.')) return s;
  s = s.replace(/0+$/, '');
  s = s.replace(/\.$/, '');
  return s;
}

function formatFloat(v: number, spec: Spec): string {
  const conv = spec.conv;
  const upper = conv === conv.toUpperCase() && conv !== conv.toLowerCase();
  const isNeg = v < 0 || Object.is(v, -0);
  const absValue = Math.abs(v);
  const hasHash = spec.flags.has('#');

  if (Number.isNaN(v)) {
    const text = upper ? 'NAN' : 'nan';
    return padGeneral(text, spec);
  }
  if (!Number.isFinite(v)) {
    const sign = signFor(isNeg, spec);
    const text = sign + (upper ? 'INF' : 'inf');
    // 0 flag ignored for inf -> spaces used (padGeneral does spaces)
    return padGeneral(text, spec);
  }

  const sign = signFor(isNeg, spec);
  let body: string;
  let lowerConv = conv.toLowerCase();

  if (lowerConv === 'e') {
    const precision = spec.precision ?? 6;
    body = formatEfmt(absValue, precision, conv === 'E', hasHash);
  } else if (lowerConv === 'f') {
    const precision = spec.precision ?? 6;
    body = formatFfmt(absValue, precision, hasHash);
  } else {
    // g, G
    let precision = spec.precision ?? 6;
    if (precision === 0) precision = 1;
    let X: number;
    if (absValue === 0) {
      X = 0;
    } else {
      const { digits: rawDigits, exp } = exactDecimal(absValue);
      const { exp: newExp } = roundSignificant(rawDigits, exp, precision);
      X = newExp - 1;
    }
    if (precision > X && X >= -4) {
      const fPrecision = precision - 1 - X;
      body = formatFfmt(absValue, fPrecision, hasHash);
    } else {
      body = formatEfmt(absValue, precision - 1, conv === 'G', hasHash);
    }
    if (!hasHash) {
      // strip trailing zeros in fractional part (not touching exponent part)
      const eIdx = body.search(/[eE]/);
      if (eIdx >= 0) {
        const mant = body.slice(0, eIdx);
        const rest = body.slice(eIdx);
        body = stripTrailingZerosG(mant) + rest;
      } else {
        body = stripTrailingZerosG(body);
      }
    }
  }

  const useZero = spec.flags.has('0') && !spec.flags.has('-');
  if (useZero) {
    const bodyFull = sign + body;
    const width = spec.width ?? 0;
    if (bodyFull.length >= width) return bodyFull;
    const padLen = width - bodyFull.length;
    return sign + '0'.repeat(padLen) + body;
  }
  return padGeneral(sign + body, spec);
}

function formatOne(spec: Spec, arg: Arg): string {
  switch (spec.conv) {
    case 'd':
    case 'i':
      return formatDI(arg as number | bigint, spec);
    case 'x':
    case 'X':
    case 'o':
      return formatXO(arg as number | bigint, spec);
    case 'e':
    case 'E':
    case 'f':
    case 'F':
    case 'g':
    case 'G':
      return formatFloat(arg as number, spec);
    case 's': {
      let s = arg as string;
      if (spec.precision !== null) s = s.slice(0, spec.precision);
      return padGeneral(s, spec);
    }
    case 'c': {
      const s = arg as string;
      return padGeneral(s, spec);
    }
    default:
      throw new Error(`unsupported conversion: ${spec.conv}`);
  }
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
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
    if (fmt[i + 1] === '%') {
      result += '%';
      i += 2;
      continue;
    }
    const { spec, next } = parseSpec(fmt, i + 1);
    i = next;
    const arg = args[argIndex++];
    result += formatOne(spec, arg);
  }
  return result;
}
