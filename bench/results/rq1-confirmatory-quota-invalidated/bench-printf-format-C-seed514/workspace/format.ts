type Arg = number | bigint | string;

interface Spec {
  flags: string;
  width: number | null;
  precision: number | null;
  conv: string;
}

function parseSpecs(fmt: string): { literal: string; spec: Spec | null }[] {
  const re = /%([-+ 0#]*)(\d*)(\.(\d*))?([diouxXeEfFgGsc%])/g;
  const parts: { literal: string; spec: Spec | null }[] = [];
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(fmt)) !== null) {
    const literal = fmt.slice(lastIndex, m.index);
    lastIndex = re.lastIndex;
    const [, flags, widthStr, precGroup, precDigits, conv] = m;
    if (conv === '%') {
      parts.push({ literal: literal + '%', spec: null });
      continue;
    }
    const width = widthStr === '' ? null : parseInt(widthStr, 10);
    const precision = precGroup === undefined ? null : (precDigits === '' ? 0 : parseInt(precDigits, 10));
    parts.push({ literal, spec: { flags, width, precision, conv } });
  }
  parts.push({ literal: fmt.slice(lastIndex), spec: null });
  return parts;
}

function decompose(ax: number): { mantissa: bigint; exp: number } {
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setFloat64(0, ax);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const exponent = (hi >>> 20) & 0x7ff;
  const mantissaBits = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo >>> 0);
  if (exponent === 0) {
    return { mantissa: mantissaBits, exp: -1074 };
  }
  return { mantissa: mantissaBits | (1n << 52n), exp: exponent - 1075 };
}

function isNegativeBit(x: number): boolean {
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setFloat64(0, x);
  return (dv.getUint8(0) & 0x80) !== 0;
}

// round(mantissa * 2^exp * 10^k) to nearest integer, ties to even.
function roundExact(mantissa: bigint, exp: number, k: number): bigint {
  if (mantissa === 0n) return 0n;
  const a = exp + k;
  const b = k;
  let numerator = mantissa;
  const denomParts: bigint[] = [];
  if (a >= 0) numerator *= 2n ** BigInt(a);
  else denomParts.push(2n ** BigInt(-a));
  if (b >= 0) numerator *= 5n ** BigInt(b);
  else denomParts.push(5n ** BigInt(-b));
  if (denomParts.length === 0) return numerator;
  const denom = denomParts.reduce((x, y) => x * y, 1n);
  let q = numerator / denom;
  const r = numerator % denom;
  const twiceR = r * 2n;
  if (twiceR > denom) q += 1n;
  else if (twiceR === denom && q % 2n !== 0n) q += 1n;
  return q;
}

function signPrefix(isNeg: boolean, flags: string): string {
  if (isNeg) return '-';
  if (flags.includes('+')) return '+';
  if (flags.includes(' ')) return ' ';
  return '';
}

function assemble(sign: string, prefix: string, body: string, width: number | null, flags: string, zeroPad: boolean): string {
  const full = sign + prefix + body;
  const w = width ?? 0;
  if (full.length >= w) return full;
  const padLen = w - full.length;
  if (flags.includes('-')) return full + ' '.repeat(padLen);
  if (zeroPad) return sign + prefix + '0'.repeat(padLen) + body;
  return ' '.repeat(padLen) + full;
}

function toBigIntValue(v: Arg): bigint {
  if (typeof v === 'bigint') return v;
  return BigInt(v as number);
}

function digitsWithPrecision(mag: bigint, precision: number | null): string {
  const natural = mag.toString();
  if (precision === null) return natural === '0' ? '0' : natural;
  if (precision === 0 && mag === 0n) return '';
  return natural.padStart(precision, '0');
}

function formatDI(value: Arg, flags: string, width: number | null, precision: number | null): string {
  const big = toBigIntValue(value);
  const isNeg = big < 0n;
  const mag = isNeg ? -big : big;
  const digits = digitsWithPrecision(mag, precision);
  const sign = signPrefix(isNeg, flags);
  const zeroPad = flags.includes('0') && precision === null;
  return assemble(sign, '', digits, width, flags, zeroPad);
}

function formatXO(value: Arg, flags: string, width: number | null, precision: number | null, conv: string): string {
  const big = toBigIntValue(value);
  const base = conv === 'o' ? 8 : 16;
  let natural = big.toString(base);
  if (conv === 'X') natural = natural.toUpperCase();
  let digits: string;
  if (precision === null) {
    digits = natural === '0' ? '0' : natural;
  } else if (precision === 0 && big === 0n) {
    digits = '';
  } else {
    digits = natural.padStart(precision, '0');
  }
  if (conv === 'o' && flags.includes('#')) {
    if (digits.length === 0 || digits[0] !== '0') digits = '0' + digits;
  }
  let prefix = '';
  if ((conv === 'x' || conv === 'X') && flags.includes('#') && big !== 0n) {
    prefix = conv === 'x' ? '0x' : '0X';
  }
  const zeroPad = flags.includes('0') && precision === null;
  return assemble('', prefix, digits, width, flags, zeroPad);
}

function formatSpecialFloat(x: number, flags: string, width: number | null, isNanLetterUpper: boolean, isInfLetterUpper: boolean): string {
  if (Number.isNaN(x)) {
    const body = isNanLetterUpper ? 'NAN' : 'nan';
    return assemble('', '', body, width, flags, false);
  }
  const isNeg = isNegativeBit(x);
  const sign = signPrefix(isNeg, flags);
  const body = isInfLetterUpper ? 'INF' : 'inf';
  return assemble(sign, '', body, width, flags, false);
}

function formatF(value: number, flags: string, width: number | null, precision: number | null, upper: boolean): string {
  const prec = precision === null ? 6 : precision;
  if (Number.isNaN(value) || !Number.isFinite(value)) {
    return formatSpecialFloat(value, flags, width, upper, upper);
  }
  const isNeg = isNegativeBit(value);
  const ax = Math.abs(value);
  const { mantissa, exp } = decompose(ax);
  const scaled = roundExact(mantissa, exp, prec);
  const digitsStr = scaled.toString().padStart(prec + 1, '0');
  const intPart = prec > 0 ? digitsStr.slice(0, digitsStr.length - prec) : digitsStr;
  const fracPart = prec > 0 ? digitsStr.slice(digitsStr.length - prec) : '';
  const dot = prec > 0 || flags.includes('#') ? '.' : '';
  const body = intPart + dot + fracPart;
  const sign = signPrefix(isNeg, flags);
  const zeroPad = flags.includes('0');
  return assemble(sign, '', body, width, flags, zeroPad);
}

function computeExpDigits(mantissa: bigint, exp: number, ax: number, sigCount: number): { E: number; digits: string } {
  if (mantissa === 0n) {
    return { E: 0, digits: '0'.repeat(sigCount) };
  }
  let E = Math.floor(Math.log10(ax));
  let digits = '';
  for (let iter = 0; iter < 20; iter++) {
    const k = sigCount - 1 - E;
    const scaled = roundExact(mantissa, exp, k);
    digits = scaled.toString();
    if (digits.length === sigCount) break;
    if (digits.length > sigCount) {
      E += digits.length - sigCount;
    } else {
      E -= sigCount - digits.length;
    }
  }
  return { E, digits };
}

function formatE(value: number, flags: string, width: number | null, precision: number | null, upper: boolean): string {
  const prec = precision === null ? 6 : precision;
  if (Number.isNaN(value) || !Number.isFinite(value)) {
    return formatSpecialFloat(value, flags, width, upper, upper);
  }
  const isNeg = isNegativeBit(value);
  const ax = Math.abs(value);
  const { mantissa, exp } = decompose(ax);
  const { E, digits } = computeExpDigits(mantissa, exp, ax, prec + 1);
  const intDigit = digits[0];
  const fracDigits = digits.slice(1);
  const dot = prec > 0 || flags.includes('#') ? '.' : '';
  const expLetter = upper ? 'E' : 'e';
  const expSign = E < 0 ? '-' : '+';
  const expAbs = Math.abs(E).toString().padStart(2, '0');
  const body = intDigit + dot + fracDigits + expLetter + expSign + expAbs;
  const sign = signPrefix(isNeg, flags);
  const zeroPad = flags.includes('0');
  return assemble(sign, '', body, width, flags, zeroPad);
}

function formatG(value: number, flags: string, width: number | null, precision: number | null, upper: boolean): string {
  const P = precision === null ? 6 : (precision === 0 ? 1 : precision);
  if (Number.isNaN(value) || !Number.isFinite(value)) {
    return formatSpecialFloat(value, flags, width, upper, upper);
  }
  const isNeg = isNegativeBit(value);
  const ax = Math.abs(value);
  const { mantissa, exp } = decompose(ax);
  const { E: X, digits } = computeExpDigits(mantissa, exp, ax, P);
  const sign = signPrefix(isNeg, flags);
  const hash = flags.includes('#');
  let body: string;
  if (P > X && X >= -4) {
    let intPart: string;
    let fracPart: string;
    if (X >= 0) {
      intPart = digits.slice(0, X + 1);
      fracPart = digits.slice(X + 1);
    } else {
      intPart = '0';
      fracPart = '0'.repeat(-X - 1) + digits;
    }
    if (!hash) {
      fracPart = fracPart.replace(/0+$/, '');
    }
    body = fracPart.length > 0 || hash ? intPart + '.' + fracPart : intPart;
  } else {
    const intDigit = digits[0];
    let fracPart = digits.slice(1);
    if (!hash) {
      fracPart = fracPart.replace(/0+$/, '');
    }
    const expLetter = upper ? 'E' : 'e';
    const expSign = X < 0 ? '-' : '+';
    const expAbs = Math.abs(X).toString().padStart(2, '0');
    const mantissaStr = fracPart.length > 0 || hash ? intDigit + '.' + fracPart : intDigit;
    body = mantissaStr + expLetter + expSign + expAbs;
  }
  const zeroPad = flags.includes('0');
  return assemble(sign, '', body, width, flags, zeroPad);
}

function formatS(value: Arg, flags: string, width: number | null, precision: number | null): string {
  let s = String(value);
  if (precision !== null) s = s.slice(0, precision);
  return assemble('', '', s, width, flags, false);
}

function formatC(value: Arg, flags: string, width: number | null): string {
  const s = String(value);
  return assemble('', '', s, width, flags, false);
}

export function format(fmt: string, ...args: Arg[]): string {
  const parts = parseSpecs(fmt);
  let result = '';
  let argIndex = 0;
  for (const part of parts) {
    result += part.literal;
    if (!part.spec) continue;
    const { flags, width, precision, conv } = part.spec;
    const arg = args[argIndex++];
    switch (conv) {
      case 'd':
      case 'i':
        result += formatDI(arg, flags, width, precision);
        break;
      case 'x':
      case 'X':
      case 'o':
        result += formatXO(arg, flags, width, precision, conv);
        break;
      case 'e':
        result += formatE(Number(arg), flags, width, precision, false);
        break;
      case 'E':
        result += formatE(Number(arg), flags, width, precision, true);
        break;
      case 'f':
        result += formatF(Number(arg), flags, width, precision, false);
        break;
      case 'F':
        result += formatF(Number(arg), flags, width, precision, true);
        break;
      case 'g':
        result += formatG(Number(arg), flags, width, precision, false);
        break;
      case 'G':
        result += formatG(Number(arg), flags, width, precision, true);
        break;
      case 's':
        result += formatS(arg, flags, width, precision);
        break;
      case 'c':
        result += formatC(arg, flags, width);
        break;
    }
  }
  return result;
}
