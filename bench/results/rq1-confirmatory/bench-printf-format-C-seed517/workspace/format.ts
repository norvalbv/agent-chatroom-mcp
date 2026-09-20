type Flags = Set<string>;

function decompose(absX: number): { M: bigint; E: number } {
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setFloat64(0, absX);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  const mantHi = hi & 0xfffff;
  const mantissa = (BigInt(mantHi) << 32n) | BigInt(lo);
  if (expBits === 0) {
    return { M: mantissa, E: -1074 };
  }
  return { M: mantissa | (1n << 52n), E: expBits - 1075 };
}

// round(|absX| * 10^k) to nearest integer, ties to even.
function scaledRound(M: bigint, E: number, k: number): bigint {
  if (M === 0n) return 0n;
  let num = M;
  let den = 1n;
  if (k >= 0) num *= 10n ** BigInt(k);
  else den *= 10n ** BigInt(-k);
  if (E >= 0) num *= 2n ** BigInt(E);
  else den *= 2n ** BigInt(-E);
  let q = num / den;
  const r = num % den;
  const twice = r * 2n;
  if (twice > den) q += 1n;
  else if (twice === den && q % 2n !== 0n) q += 1n;
  return q;
}

function fmtF(absX: number, precision: number): string {
  let s: string;
  if (absX === 0) {
    s = '0'.repeat(precision + 1);
  } else {
    const { M, E } = decompose(absX);
    const N = scaledRound(M, E, precision);
    s = N.toString();
    if (s.length <= precision) s = '0'.repeat(precision + 1 - s.length) + s;
  }
  const intPart = s.slice(0, s.length - precision) || '0';
  const frac = precision > 0 ? s.slice(s.length - precision) : '';
  return intPart + '.' + frac;
}

function eCore(absX: number, precision: number): { digits: string; exp: number } {
  if (absX === 0) return { digits: '0'.repeat(precision + 1), exp: 0 };
  const { M, E } = decompose(absX);
  let exp = Math.floor(Math.log10(absX));
  let digits = '';
  for (let iter = 0; iter < 40; iter++) {
    const N = scaledRound(M, E, precision - exp);
    digits = N.toString();
    const diff = digits.length - (precision + 1);
    if (diff === 0) break;
    exp += diff;
  }
  return { digits, exp };
}

function fmtE(absX: number, precision: number, hash: boolean, upper: boolean): string {
  const { digits, exp } = eCore(absX, precision);
  const first = digits[0];
  const rest = digits.slice(1);
  const mantissa = precision > 0 || hash ? first + '.' + rest : first;
  const expSign = exp >= 0 ? '+' : '-';
  const expAbs = Math.abs(exp).toString().padStart(2, '0');
  return mantissa + (upper ? 'E' : 'e') + expSign + expAbs;
}

function stripTrailing(s: string, hash: boolean): string {
  if (hash) return s;
  if (!s.includes('.')) return s;
  s = s.replace(/0+$/, '');
  if (s.endsWith('.')) s = s.slice(0, -1);
  return s;
}

function dropDot(s: string, hash: boolean): string {
  if (hash) return s;
  return s.endsWith('.') ? s.slice(0, -1) : s;
}

function fmtG(absX: number, precisionRaw: number, hash: boolean, upper: boolean): string {
  const P = precisionRaw === 0 ? 1 : precisionRaw;
  const { digits, exp: X } = eCore(absX, P - 1);
  if (P > X && X >= -4) {
    const fPrecision = P - 1 - X;
    let body = fmtF(absX, fPrecision);
    if (fPrecision === 0) body = dropDot(body, hash);
    else body = stripTrailing(body, hash);
    return body;
  }
  const first = digits[0];
  const rest = digits.slice(1);
  let mantissa = first + '.' + rest;
  mantissa = stripTrailing(mantissa, hash);
  const expSign = X >= 0 ? '+' : '-';
  const expAbs = Math.abs(X).toString().padStart(2, '0');
  return mantissa + (upper ? 'E' : 'e') + expSign + expAbs;
}

function padGeneric(s: string, width: number, leftAlign: boolean): string {
  if (s.length >= width) return s;
  const pad = ' '.repeat(width - s.length);
  return leftAlign ? s + pad : pad + s;
}

function padNumeric(
  sign: string,
  prefix: string,
  digits: string,
  width: number,
  zeroFlag: boolean,
  leftAlign: boolean,
): string {
  const body = sign + prefix + digits;
  if (body.length >= width) return body;
  const padLen = width - body.length;
  if (leftAlign) return body + ' '.repeat(padLen);
  if (zeroFlag) return sign + prefix + '0'.repeat(padLen) + digits;
  return ' '.repeat(padLen) + body;
}

function intMagnitudeDigits(
  abs: bigint,
  letter: string,
  precision: number | undefined,
  octHash: boolean,
): string {
  let s: string;
  switch (letter) {
    case 'x':
      s = abs.toString(16);
      break;
    case 'X':
      s = abs.toString(16).toUpperCase();
      break;
    case 'o':
      s = abs.toString(8);
      break;
    default:
      s = abs.toString(10);
  }
  if (abs === 0n && precision === 0) {
    s = '';
  } else if (precision !== undefined && s.length < precision) {
    s = '0'.repeat(precision - s.length) + s;
  }
  if (octHash && (s.length === 0 || s[0] !== '0')) {
    s = '0' + s;
  }
  return s;
}

function toBigInt(v: number | bigint): bigint {
  return typeof v === 'bigint' ? v : BigInt(Math.trunc(v));
}

function formatInt(
  letter: string,
  raw: number | bigint,
  flags: Flags,
  width: number,
  precision: number | undefined,
): string {
  const big = toBigInt(raw);
  const isSigned = letter === 'd' || letter === 'i';
  const negative = isSigned && big < 0n;
  const abs = negative ? -big : big;
  const octHash = letter === 'o' && flags.has('#');
  const digits = intMagnitudeDigits(abs, letter, precision, octHash);
  let signStr = '';
  let prefix = '';
  if (isSigned) {
    signStr = negative ? '-' : flags.has('+') ? '+' : flags.has(' ') ? ' ' : '';
  } else if ((letter === 'x' || letter === 'X') && flags.has('#') && abs !== 0n) {
    prefix = letter === 'x' ? '0x' : '0X';
  }
  const zeroFlag = flags.has('0') && !flags.has('-') && precision === undefined;
  return padNumeric(signStr, prefix, digits, width, zeroFlag, flags.has('-'));
}

function formatFloat(
  letter: string,
  value: number,
  flags: Flags,
  width: number,
  precision: number | undefined,
): string {
  const upper = letter === letter.toUpperCase();
  const lower = letter.toLowerCase();
  const isNegative = value < 0 || Object.is(value, -0);
  if (Number.isNaN(value)) {
    const body = upper ? 'NAN' : 'nan';
    return padNumeric('', '', body, width, false, flags.has('-'));
  }
  const signStr = isNegative ? '-' : flags.has('+') ? '+' : flags.has(' ') ? ' ' : '';
  if (!Number.isFinite(value)) {
    const body = upper ? 'INF' : 'inf';
    return padNumeric(signStr, '', body, width, false, flags.has('-'));
  }
  const absX = Math.abs(value);
  const hash = flags.has('#');
  const prec = precision ?? 6;
  let body: string;
  if (lower === 'f') {
    body = fmtF(absX, prec);
    if (prec === 0) body = dropDot(body, hash);
  } else if (lower === 'e') {
    body = fmtE(absX, prec, hash, upper);
  } else {
    body = fmtG(absX, prec, hash, upper);
  }
  const zeroFlag = flags.has('0') && !flags.has('-');
  return padNumeric(signStr, '', body, width, zeroFlag, flags.has('-'));
}

const SPEC_RE = /^%([-+ #0]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc%])/;

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let out = '';
  let argIndex = 0;
  let i = 0;
  while (i < fmt.length) {
    const ch = fmt[i];
    if (ch !== '%') {
      out += ch;
      i++;
      continue;
    }
    const m = SPEC_RE.exec(fmt.slice(i));
    if (!m) {
      out += ch;
      i++;
      continue;
    }
    const [full, flagStr, widthStr, precStr, conv] = m;
    i += full.length;
    if (conv === '%') {
      out += '%';
      continue;
    }
    const flags: Flags = new Set(flagStr.split(''));
    const width = widthStr ? parseInt(widthStr, 10) : 0;
    const precision = precStr !== undefined ? (precStr === '' ? 0 : parseInt(precStr, 10)) : undefined;
    const arg = args[argIndex++];

    if (conv === 'd' || conv === 'i' || conv === 'x' || conv === 'X' || conv === 'o') {
      out += formatInt(conv, arg as number | bigint, flags, width, precision);
    } else if (conv === 'e' || conv === 'E' || conv === 'f' || conv === 'F' || conv === 'g' || conv === 'G') {
      out += formatFloat(conv, arg as number, flags, width, precision);
    } else if (conv === 's') {
      let s = String(arg);
      if (precision !== undefined) s = s.slice(0, precision);
      out += padGeneric(s, width, flags.has('-'));
    } else if (conv === 'c') {
      const s = String(arg);
      out += padGeneric(s, width, flags.has('-'));
    }
  }
  return out;
}
