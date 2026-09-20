export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let argIndex = 0;
  const nextArg = (): number | bigint | string => args[argIndex++];

  let out = '';
  const specRe = /%([-+0 #]*)(\d*)(\.\d*)?([diouxXeEfFgGsc%])/g;
  let lastEnd = 0;
  let m: RegExpExecArray | null;
  while ((m = specRe.exec(fmt))) {
    out += fmt.slice(lastEnd, m.index);
    lastEnd = specRe.lastIndex;
    const [, flagsStr, widthStr, precStr, conv] = m;
    if (conv === '%') {
      out += '%';
      continue;
    }
    const flags = flagsStr;
    const width = widthStr === '' ? undefined : parseInt(widthStr, 10);
    const precision = precStr === undefined ? undefined : precStr === '.' ? 0 : parseInt(precStr.slice(1), 10);
    const arg = nextArg();
    out += formatOne(conv, flags, width, precision, arg);
  }
  out += fmt.slice(lastEnd);
  return out;
}

function formatOne(
  conv: string,
  flags: string,
  width: number | undefined,
  precision: number | undefined,
  arg: number | bigint | string
): string {
  switch (conv) {
    case 'd':
    case 'i':
      return formatInt(flags, width, precision, arg, 10, false);
    case 'x':
      return formatUint(flags, width, precision, arg, 16, false);
    case 'X':
      return formatUint(flags, width, precision, arg, 16, true);
    case 'o':
      return formatUint(flags, width, precision, arg, 8, false);
    case 'e':
    case 'E':
      return formatExpConv(flags, width, precision, arg as number, conv === 'E');
    case 'f':
    case 'F':
      return formatFixedConv(flags, width, precision, arg as number, conv === 'F');
    case 'g':
    case 'G':
      return formatGeneral(flags, width, precision, arg as number, conv === 'G');
    case 's':
      return formatString(flags, width, precision, arg as string);
    case 'c':
      return formatChar(flags, width, arg as string);
    default:
      throw new Error(`unsupported conversion: ${conv}`);
  }
}

// ---------- generic padding ----------

function applyWidth(body: string, width: number | undefined, leftAlign: boolean, zeroPad: boolean, prefixLen: number): string {
  if (width === undefined || body.length >= width) return body;
  const padLen = width - body.length;
  if (leftAlign) return body + ' '.repeat(padLen);
  if (zeroPad) return body.slice(0, prefixLen) + '0'.repeat(padLen) + body.slice(prefixLen);
  return ' '.repeat(padLen) + body;
}

// ---------- integer conversions ----------

function formatInt(
  flags: string,
  width: number | undefined,
  precision: number | undefined,
  arg: number | bigint | string,
  base: number,
  upper: boolean
): string {
  const isNeg = typeof arg === 'bigint' ? arg < 0n : (arg as number) < 0;
  const mag: bigint = typeof arg === 'bigint' ? (isNeg ? -arg : arg) : BigInt(Math.abs(arg as number));
  let digits = mag.toString(base);
  if (upper) digits = digits.toUpperCase();
  digits = applyIntPrecision(digits, mag, precision);
  const sign = isNeg ? '-' : flags.includes('+') ? '+' : flags.includes(' ') ? ' ' : '';
  const body = sign + digits;
  const zeroPad = flags.includes('0') && !flags.includes('-') && precision === undefined;
  return applyWidth(body, width, flags.includes('-'), zeroPad, sign.length);
}

function applyIntPrecision(digits: string, mag: bigint, precision: number | undefined): string {
  if (precision === undefined) return digits;
  if (mag === 0n) return precision === 0 ? '' : '0'.repeat(precision);
  return digits.padStart(precision, '0');
}

function formatUint(
  flags: string,
  width: number | undefined,
  precision: number | undefined,
  arg: number | bigint | string,
  base: number,
  upper: boolean
): string {
  const value: bigint = typeof arg === 'bigint' ? arg : BigInt(arg as number);
  let digits = value.toString(base);
  if (upper) digits = digits.toUpperCase();
  digits = applyIntPrecision(digits, value, precision);

  let prefix = '';
  if (flags.includes('#')) {
    if (base === 16) {
      if (value !== 0n) prefix = upper ? '0X' : '0x';
    } else if (base === 8) {
      if (digits.length === 0 || digits[0] !== '0') digits = '0' + digits;
    }
  }
  const body = prefix + digits;
  const zeroPad = flags.includes('0') && !flags.includes('-') && precision === undefined;
  return applyWidth(body, width, flags.includes('-'), zeroPad, prefix.length);
}

// ---------- exact decimal representation of doubles ----------

interface ExactDecimal {
  intStr: string;
  fracStr: string;
}

function exactDecimalOfDouble(x: number): ExactDecimal {
  // x must be finite and non-negative (sign handled separately), x !== 0 handled by caller too but works for 0.
  if (x === 0) return { intStr: '0', fracStr: '' };
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const exp = (hi >>> 20) & 0x7ff;
  const fracHi = hi & 0xfffff;
  const frac = (BigInt(fracHi) << 32n) | BigInt(lo >>> 0);

  let significand: bigint;
  let exp2: number;
  if (exp === 0) {
    significand = frac;
    exp2 = -1074;
  } else {
    significand = frac | (1n << 52n);
    exp2 = exp - 1075;
  }

  if (exp2 >= 0) {
    const intVal = significand << BigInt(exp2);
    return { intStr: intVal.toString(), fracStr: '' };
  } else {
    const k = -exp2;
    const numerator = significand * 5n ** BigInt(k);
    let numStr = numerator.toString();
    if (numStr.length <= k) numStr = numStr.padStart(k + 1, '0');
    const intStr = numStr.slice(0, numStr.length - k).replace(/^0+(?=\d)/, '') || '0';
    const fracStr = numStr.slice(numStr.length - k);
    return { intStr, fracStr };
  }
}

function incrementDecimalString(s: string): string {
  const arr = s.split('');
  let i = arr.length - 1;
  while (i >= 0) {
    if (arr[i] === '9') {
      arr[i] = '0';
      i--;
    } else {
      arr[i] = String(Number(arr[i]) + 1);
      break;
    }
  }
  if (i < 0) arr.unshift('1');
  return arr.join('');
}

function roundFrac(intStr: string, fracStr: string, precision: number): { intStr: string; fracStr: string } {
  if (fracStr.length <= precision) {
    return { intStr, fracStr: fracStr.padEnd(precision, '0') };
  }
  const keptFrac = fracStr.slice(0, precision);
  const firstDropped = fracStr[precision];
  const restAllZero = /^0*$/.test(fracStr.slice(precision + 1));
  let roundUp: boolean;
  if (firstDropped > '5') roundUp = true;
  else if (firstDropped < '5') roundUp = false;
  else if (!restAllZero) roundUp = true;
  else {
    const lastKept = precision > 0 ? keptFrac[precision - 1] : intStr[intStr.length - 1];
    roundUp = Number(lastKept) % 2 === 1;
  }
  let kept = intStr + keptFrac;
  if (roundUp) kept = incrementDecimalString(kept);
  const origLen = intStr.length + keptFrac.length;
  const grew = kept.length - origLen;
  const newIntLen = intStr.length + grew;
  let newIntStr = kept.slice(0, newIntLen);
  const newFracStr = kept.slice(newIntLen);
  newIntStr = newIntStr.replace(/^0+(?=\d)/, '');
  return { intStr: newIntStr, fracStr: newFracStr };
}

// ---------- sign / special value handling shared by e f g ----------

function signOf(x: number, flags: string): string {
  const negative = x < 0 || Object.is(x, -0);
  if (negative) return '-';
  if (flags.includes('+')) return '+';
  if (flags.includes(' ')) return ' ';
  return '';
}

function specialBody(x: number, upper: boolean): string | null {
  if (Number.isNaN(x)) return upper ? 'NAN' : 'nan';
  if (!Number.isFinite(x)) return upper ? 'INF' : 'inf';
  return null;
}

// ---------- f, F ----------

function bodyFixed(intStr: string, fracStr: string, precision: number, hash: boolean): string {
  const r = roundFrac(intStr, fracStr, precision);
  if (precision > 0 || hash) return r.intStr + '.' + r.fracStr;
  return r.intStr;
}

function formatFixedConv(
  flags: string,
  width: number | undefined,
  precision: number | undefined,
  x: number,
  upper: boolean
): string {
  const P = precision === undefined ? 6 : precision;
  const special = specialBody(x, upper);
  const sign = Number.isNaN(x) ? '' : signOf(x, flags);
  if (special !== null) {
    const body = sign + special;
    return applyWidth(body, width, flags.includes('-'), false, 0);
  }
  const abs = Math.abs(x);
  const { intStr, fracStr } = exactDecimalOfDouble(abs);
  const digits = bodyFixed(intStr, fracStr, P, flags.includes('#'));
  const body = sign + digits;
  const zeroPad = flags.includes('0') && !flags.includes('-');
  return applyWidth(body, width, flags.includes('-'), zeroPad, sign.length);
}

// ---------- e, E ----------

function findLeadAndRest(intStr: string, fracStr: string): { lead: string; rest: string; exp: number } {
  const all = intStr + fracStr;
  const idx = all.search(/[1-9]/);
  if (idx === -1) {
    return { lead: '0', rest: '', exp: 0 };
  }
  const exp = intStr.length - 1 - idx;
  return { lead: all[idx], rest: all.slice(idx + 1), exp };
}

function roundSignificant(lead: string, rest: string, precision: number): { lead: string; frac: string; expDelta: number } {
  const r = roundFrac(lead, rest, precision);
  if (r.intStr.length === 1) return { lead: r.intStr, frac: r.fracStr, expDelta: 0 };
  const extra = r.intStr.slice(1);
  const frac = (extra + r.fracStr).slice(0, precision);
  return { lead: r.intStr[0], frac, expDelta: r.intStr.length - 1 };
}

function formatExponent(exp: number, upper: boolean): string {
  const sign = exp < 0 ? '-' : '+';
  const mag = Math.abs(exp).toString();
  const digits = mag.length < 2 ? mag.padStart(2, '0') : mag;
  return (upper ? 'E' : 'e') + sign + digits;
}

function bodyExp(intStr: string, fracStr: string, precision: number, hash: boolean, upper: boolean): { text: string; exp: number } {
  const { lead, rest, exp } = findLeadAndRest(intStr, fracStr);
  const r = roundSignificant(lead, rest, precision);
  const finalExp = exp + r.expDelta;
  const mantissa = precision > 0 || hash ? r.lead + '.' + r.frac : r.lead;
  return { text: mantissa + formatExponent(finalExp, upper), exp: finalExp };
}

function formatExpConv(
  flags: string,
  width: number | undefined,
  precision: number | undefined,
  x: number,
  upper: boolean
): string {
  const P = precision === undefined ? 6 : precision;
  const special = specialBody(x, upper);
  const sign = Number.isNaN(x) ? '' : signOf(x, flags);
  if (special !== null) {
    const body = sign + special;
    return applyWidth(body, width, flags.includes('-'), false, 0);
  }
  const abs = Math.abs(x);
  const { intStr, fracStr } = exactDecimalOfDouble(abs);
  const { text } = bodyExp(intStr, fracStr, P, flags.includes('#'), upper);
  const body = sign + text;
  const zeroPad = flags.includes('0') && !flags.includes('-');
  return applyWidth(body, width, flags.includes('-'), zeroPad, sign.length);
}

// ---------- g, G ----------

function formatGeneral(
  flags: string,
  width: number | undefined,
  precision: number | undefined,
  x: number,
  upper: boolean
): string {
  const Praw = precision === undefined ? 6 : precision;
  const P = Praw === 0 ? 1 : Praw;
  const special = specialBody(x, upper);
  const sign = Number.isNaN(x) ? '' : signOf(x, flags);
  const hash = flags.includes('#');
  if (special !== null) {
    const body = sign + special;
    return applyWidth(body, width, flags.includes('-'), false, 0);
  }
  const abs = Math.abs(x);
  const { intStr, fracStr } = exactDecimalOfDouble(abs);
  const { lead, rest, exp } = findLeadAndRest(intStr, fracStr);
  const r = roundSignificant(lead, rest, P - 1);
  const X = exp + r.expDelta;

  let digits: string;
  if (P > X && X >= -4) {
    const fprec = P - 1 - X;
    digits = bodyFixed(intStr, fracStr, fprec, true);
  } else {
    const eprec = P - 1;
    digits = bodyExp(intStr, fracStr, eprec, true, upper).text;
  }

  if (!hash) {
    digits = trimTrailingZeros(digits, upper);
  }

  const body = sign + digits;
  const zeroPad = flags.includes('0') && !flags.includes('-');
  return applyWidth(body, width, flags.includes('-'), zeroPad, sign.length);
}

function trimTrailingZeros(digits: string, upper: boolean): string {
  const eLetter = upper ? 'E' : 'e';
  const eIdx = digits.indexOf(eLetter);
  let mantissa = eIdx === -1 ? digits : digits.slice(0, eIdx);
  const exponent = eIdx === -1 ? '' : digits.slice(eIdx);
  if (mantissa.includes('.')) {
    mantissa = mantissa.replace(/0+$/, '');
    mantissa = mantissa.replace(/\.$/, '');
  }
  return mantissa + exponent;
}

// ---------- s, c ----------

function formatString(flags: string, width: number | undefined, precision: number | undefined, arg: string): string {
  let body = arg;
  if (precision !== undefined) body = body.slice(0, precision);
  return applyWidth(body, width, flags.includes('-'), false, 0);
}

function formatChar(flags: string, width: number | undefined, arg: string): string {
  return applyWidth(arg, width, flags.includes('-'), false, 0);
}
