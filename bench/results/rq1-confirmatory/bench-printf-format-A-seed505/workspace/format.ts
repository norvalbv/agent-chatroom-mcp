export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let out = '';
  let argIndex = 0;
  const re = /%([-+ #0]*)(\d*)(\.(\d*))?([diouxXeEfFgGsc%])/g;
  let lastEnd = 0;
  let m: RegExpExecArray | null;

  while ((m = re.exec(fmt)) !== null) {
    out += fmt.slice(lastEnd, m.index);
    lastEnd = re.lastIndex;

    const [, flagStr, widthStr, precStr, precDigits, conv] = m;

    if (conv === '%') {
      out += '%';
      continue;
    }

    const flags = new Set(flagStr.split('').filter((c) => c.length > 0));
    const width = widthStr ? parseInt(widthStr, 10) : 0;
    const precision = precStr !== undefined ? (precDigits === '' ? 0 : parseInt(precDigits, 10)) : undefined;
    const arg = args[argIndex++];

    switch (conv) {
      case 'd':
      case 'i':
        out += formatIntSigned(toBigIntExact(arg), flags, width, precision);
        break;
      case 'x':
        out += formatUnsigned(toBigIntExact(arg), 16, false, flags, width, precision);
        break;
      case 'X':
        out += formatUnsigned(toBigIntExact(arg), 16, true, flags, width, precision);
        break;
      case 'o':
        out += formatUnsigned(toBigIntExact(arg), 8, false, flags, width, precision);
        break;
      case 'e':
      case 'E':
      case 'f':
      case 'F':
      case 'g':
      case 'G':
        out += formatFloat(arg as number, conv, flags, width, precision);
        break;
      case 's':
        out += formatS(arg as string, flags, width, precision);
        break;
      case 'c':
        out += formatC(arg as string, flags, width);
        break;
    }
  }

  out += fmt.slice(lastEnd);
  return out;
}

function toBigIntExact(v: number | bigint | string): bigint {
  return typeof v === 'bigint' ? v : BigInt(v as number);
}

function padWithWidth(core: string, insertPoint: number, width: number, leftAlign: boolean, zeroFlag: boolean): string {
  if (core.length >= width) return core;
  const padLen = width - core.length;
  if (leftAlign) return core + ' '.repeat(padLen);
  if (zeroFlag) return core.slice(0, insertPoint) + '0'.repeat(padLen) + core.slice(insertPoint);
  return ' '.repeat(padLen) + core;
}

function formatIntSigned(value: bigint, flags: Set<string>, width: number, precision: number | undefined): string {
  const neg = value < 0n;
  const abs = neg ? -value : value;
  let digits = abs.toString();
  if (precision !== undefined) {
    if (precision === 0 && abs === 0n) digits = '';
    else digits = digits.padStart(precision, '0');
  }
  const sign = neg ? '-' : flags.has('+') ? '+' : flags.has(' ') ? ' ' : '';
  const core = sign + digits;
  const leftAlign = flags.has('-');
  const zeroFlag = flags.has('0') && !leftAlign && precision === undefined;
  return padWithWidth(core, sign.length, width, leftAlign, zeroFlag);
}

function formatUnsigned(
  value: bigint,
  base: 16 | 8,
  upper: boolean,
  flags: Set<string>,
  width: number,
  precision: number | undefined,
): string {
  let digits = value.toString(base);
  if (upper) digits = digits.toUpperCase();
  if (precision !== undefined) {
    if (precision === 0 && value === 0n) digits = '';
    else digits = digits.padStart(precision, '0');
  }
  let prefix = '';
  if (flags.has('#')) {
    if (base === 16 && value !== 0n) {
      prefix = upper ? '0X' : '0x';
    } else if (base === 8) {
      if (digits.length === 0 || digits[0] !== '0') digits = '0' + digits;
    }
  }
  const core = prefix + digits;
  const leftAlign = flags.has('-');
  const zeroFlag = flags.has('0') && !leftAlign && precision === undefined;
  return padWithWidth(core, prefix.length, width, leftAlign, zeroFlag);
}

function decomposeAbs(x: number): { numerator: bigint; k: number } {
  if (x === 0) return { numerator: 0n, k: 0 };
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setFloat64(0, x);
  const hi = view.getUint32(0);
  const lo = view.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  const mantHi = hi & 0xfffff;
  let mantissa = (BigInt(mantHi) << 32n) | BigInt(lo);
  let exponent: number;
  if (expBits === 0) {
    exponent = -1074;
  } else {
    mantissa = mantissa | (1n << 52n);
    exponent = expBits - 1075;
  }
  if (exponent >= 0) {
    return { numerator: mantissa << BigInt(exponent), k: 0 };
  }
  const k = -exponent;
  return { numerator: mantissa * 5n ** BigInt(k), k };
}

function roundBigInt(n: bigint, d: number): bigint {
  if (d <= 0) return n * 10n ** BigInt(-d);
  const divisor = 10n ** BigInt(d);
  const q = n / divisor;
  const r = n % divisor;
  const half = divisor / 2n;
  if (r > half || (r === half && q % 2n === 1n)) return q + 1n;
  return q;
}

function sigDigits(numerator: bigint, k: number, s: number): { digits: string; exp: number } {
  if (numerator === 0n) return { digits: '0'.repeat(s), exp: 0 };
  const l = numerator.toString().length;
  let exp = l - k - 1;
  const d = l - s;
  const q = roundBigInt(numerator, d);
  let qStr = q.toString();
  if (qStr.length > s) {
    exp += qStr.length - s;
    qStr = qStr.slice(0, s);
  } else if (qStr.length < s) {
    qStr = qStr.padStart(s, '0');
  }
  return { digits: qStr, exp };
}

function formatFStyle(numerator: bigint, k: number, p: number, hash: boolean): string {
  if (numerator === 0n) {
    const frac = p > 0 ? '0'.repeat(p) : '';
    return '0' + (p > 0 || hash ? '.' + frac : '');
  }
  const d = k - p;
  const q = roundBigInt(numerator, d);
  let qStr = q.toString();
  qStr = qStr.padStart(p + 1, '0');
  const intPart = qStr.slice(0, qStr.length - p) || '0';
  const frac = p > 0 ? qStr.slice(qStr.length - p) : '';
  return intPart + (p > 0 || hash ? '.' + frac : '');
}

function formatEStyle(numerator: bigint, k: number, p: number, hash: boolean, upper: boolean): string {
  const s = p + 1;
  const { digits, exp } = sigDigits(numerator, k, s);
  const first = digits[0];
  const rest = digits.slice(1);
  const mantissa = first + (p > 0 || hash ? '.' + rest : '');
  const eChar = upper ? 'E' : 'e';
  const expSign = exp >= 0 ? '+' : '-';
  const expDigits = Math.abs(exp).toString().padStart(2, '0');
  return mantissa + eChar + expSign + expDigits;
}

function stripTrailing(s: string): string {
  const eIdx = s.search(/[eE]/);
  let mantissa = eIdx === -1 ? s : s.slice(0, eIdx);
  const rest = eIdx === -1 ? '' : s.slice(eIdx);
  if (mantissa.includes('.')) {
    mantissa = mantissa.replace(/0+$/, '');
    mantissa = mantissa.replace(/\.$/, '');
  }
  return mantissa + rest;
}

function formatFloat(x: number, conv: string, flags: Set<string>, width: number, precision: number | undefined): string {
  const upper = conv === conv.toUpperCase();
  const isNegZero = Object.is(x, -0);
  const negative = x < 0 || isNegZero;
  const signChar = negative ? '-' : flags.has('+') ? '+' : flags.has(' ') ? ' ' : '';
  const leftAlign = flags.has('-');

  if (Number.isNaN(x)) {
    const s = upper ? 'NAN' : 'nan';
    return padWithWidth(s, 0, width, leftAlign, false);
  }
  if (!Number.isFinite(x)) {
    const s = upper ? 'INF' : 'inf';
    const core = signChar + s;
    return padWithWidth(core, signChar.length, width, leftAlign, false);
  }

  const abs = Math.abs(x);
  const { numerator, k } = decomposeAbs(abs);
  const hash = flags.has('#');
  let body: string;

  if (conv === 'f' || conv === 'F') {
    const p = precision ?? 6;
    body = formatFStyle(numerator, k, p, hash);
  } else if (conv === 'e' || conv === 'E') {
    const p = precision ?? 6;
    body = formatEStyle(numerator, k, p, hash, upper);
  } else {
    const P = precision === undefined ? 6 : precision === 0 ? 1 : precision;
    const { exp: X } = sigDigits(numerator, k, P);
    let core: string;
    if (P > X && X >= -4) {
      core = formatFStyle(numerator, k, P - 1 - X, hash);
    } else {
      core = formatEStyle(numerator, k, P - 1, hash, upper);
    }
    if (!hash) core = stripTrailing(core);
    body = core;
  }

  const core = signChar + body;
  const zeroFlag = flags.has('0') && !leftAlign;
  return padWithWidth(core, signChar.length, width, leftAlign, zeroFlag);
}

function formatS(str: string, flags: Set<string>, width: number, precision: number | undefined): string {
  let s = str;
  if (precision !== undefined) s = s.slice(0, precision);
  return padWithWidth(s, 0, width, flags.has('-'), false);
}

function formatC(str: string, flags: Set<string>, width: number): string {
  return padWithWidth(str, 0, width, flags.has('-'), false);
}
