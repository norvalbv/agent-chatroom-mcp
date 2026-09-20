type Flags = Set<string>;

function decompose(x: number): { N: bigint; decExp: number; isNaN: boolean; isInf: boolean } {
  if (Number.isNaN(x)) return { N: 0n, decExp: 0, isNaN: true, isInf: false };
  if (!Number.isFinite(x)) return { N: 0n, decExp: 0, isNaN: false, isInf: true };

  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  const mantHi = hi & 0xfffff;
  const mantissa = (BigInt(mantHi) << 32n) | BigInt(lo >>> 0);

  if (expBits === 0 && mantissa === 0n) {
    return { N: 0n, decExp: 0, isNaN: false, isInf: false };
  }

  let m: bigint;
  let be: number;
  if (expBits === 0) {
    m = mantissa;
    be = -1074;
  } else {
    m = mantissa | (1n << 52n);
    be = expBits - 1075;
  }

  let N: bigint;
  let decExp: number;
  if (be >= 0) {
    N = m << BigInt(be);
    decExp = 0;
  } else {
    N = m * 5n ** BigInt(-be);
    decExp = be;
  }
  return { N, decExp, isNaN: false, isInf: false };
}

// Returns round(N * 10^decExp * 10^fracDigits), ties to even, exact.
function roundToFracDigits(N: bigint, decExp: number, fracDigits: number): bigint {
  const shift = decExp + fracDigits;
  if (shift >= 0) return N * 10n ** BigInt(shift);
  const k = BigInt(-shift);
  const div = 10n ** k;
  const q = N / div;
  const r = N % div;
  const twice = r * 2n;
  if (twice < div) return q;
  if (twice > div) return q + 1n;
  return q % 2n === 0n ? q : q + 1n;
}

// Rounds |value| to `sig` significant decimal digits.
function computeSig(N: bigint, decExp: number, sig: number): { X: number; Mstr: string } {
  if (N === 0n) return { X: 0, Mstr: '0'.repeat(sig) };
  const digits0 = N.toString();
  const pointPos = digits0.length + decExp;
  let X = pointPos - 1;
  const fracDigits = sig - 1 - X;
  let M = roundToFracDigits(N, decExp, fracDigits);
  let Mstr = M.toString();
  if (Mstr.length > sig) {
    const diff = Mstr.length - sig;
    X += diff;
    M = M / 10n ** BigInt(diff);
    Mstr = M.toString();
  } else if (Mstr.length < sig) {
    Mstr = Mstr.padStart(sig, '0');
  }
  return { X, Mstr };
}

function fixedBody(M: bigint, fracDigits: number, hash: boolean): string {
  const s = M.toString().padStart(fracDigits + 1, '0');
  const intPart = fracDigits > 0 ? s.slice(0, s.length - fracDigits) : s;
  const fracPart = fracDigits > 0 ? s.slice(s.length - fracDigits) : '';
  if (fracDigits > 0) return intPart + '.' + fracPart;
  return hash ? intPart + '.' : intPart;
}

function expBody(
  N: bigint,
  decExp: number,
  precision: number,
  hash: boolean,
): { mantissa: string; expStr: string } {
  const sig = precision + 1;
  const { X, Mstr } = computeSig(N, decExp, sig);
  const first = Mstr[0];
  const rest = Mstr.slice(1);
  const mantissa = precision > 0 ? first + '.' + rest : hash ? first + '.' : first;
  const expSign = X >= 0 ? '+' : '-';
  const expStr = expSign + String(Math.abs(X)).padStart(2, '0');
  return { mantissa, expStr };
}

function trimG(s: string): string {
  if (!s.includes('.')) return s;
  s = s.replace(/0+$/, '');
  if (s.endsWith('.')) s = s.slice(0, -1);
  return s;
}

function padNumeric(
  sign: string,
  prefix: string,
  digits: string,
  width: number | undefined,
  leftAlign: boolean,
  zeroFlag: boolean,
): string {
  const core = sign + prefix + digits;
  const w = width ?? 0;
  if (core.length >= w) return core;
  const padLen = w - core.length;
  if (leftAlign) return core + ' '.repeat(padLen);
  if (zeroFlag) return sign + prefix + '0'.repeat(padLen) + digits;
  return ' '.repeat(padLen) + core;
}

function padText(s: string, width: number | undefined, leftAlign: boolean): string {
  const w = width ?? 0;
  if (s.length >= w) return s;
  const padLen = w - s.length;
  return leftAlign ? s + ' '.repeat(padLen) : ' '.repeat(padLen) + s;
}

function toBigIntArg(arg: number | bigint): bigint {
  return typeof arg === 'bigint' ? arg : BigInt(arg);
}

function formatOne(
  conv: string,
  flags: Flags,
  width: number | undefined,
  precision: number | undefined,
  arg: number | bigint | string,
): string {
  const leftAlign = flags.has('-');
  const hash = flags.has('#');

  switch (conv) {
    case 'd':
    case 'i': {
      const value = toBigIntArg(arg as number | bigint);
      const neg = value < 0n;
      const mag = neg ? -value : value;
      let digits = mag.toString();
      if (precision !== undefined) {
        digits = mag === 0n && precision === 0 ? '' : digits.padStart(precision, '0');
      }
      const signChar = neg ? '-' : flags.has('+') ? '+' : flags.has(' ') ? ' ' : '';
      const zeroFlag = flags.has('0') && !leftAlign && precision === undefined;
      return padNumeric(signChar, '', digits, width, leftAlign, zeroFlag);
    }
    case 'x':
    case 'X':
    case 'o': {
      const mag = toBigIntArg(arg as number | bigint);
      let digits = mag.toString(conv === 'o' ? 8 : 16);
      if (conv === 'X') digits = digits.toUpperCase();
      if (precision !== undefined) {
        digits = mag === 0n && precision === 0 ? '' : digits.padStart(precision, '0');
      }
      let prefix = '';
      if (conv !== 'o' && hash && mag !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      if (conv === 'o' && hash) {
        if (digits.length === 0 || digits[0] !== '0') digits = '0' + digits;
      }
      const zeroFlag = flags.has('0') && !leftAlign && precision === undefined;
      return padNumeric('', prefix, digits, width, leftAlign, zeroFlag);
    }
    case 'e':
    case 'E':
    case 'f':
    case 'F':
    case 'g':
    case 'G': {
      const x = arg as number;
      const info = decompose(x);
      const signBit = x < 0 || Object.is(x, -0);
      const upper = conv === 'F' || conv === 'E' || conv === 'G';
      const signChar = info.isNaN ? '' : signBit ? '-' : flags.has('+') ? '+' : flags.has(' ') ? ' ' : '';

      if (info.isNaN) {
        return padNumeric(signChar, '', upper ? 'NAN' : 'nan', width, leftAlign, false);
      }
      if (info.isInf) {
        return padNumeric(signChar, '', upper ? 'INF' : 'inf', width, leftAlign, false);
      }

      const zeroFlag = flags.has('0') && !leftAlign;

      if (conv === 'f' || conv === 'F') {
        const p = precision === undefined ? 6 : precision;
        const M = roundToFracDigits(info.N, info.decExp, p);
        const body = fixedBody(M, p, hash);
        return padNumeric(signChar, '', body, width, leftAlign, zeroFlag);
      }

      if (conv === 'e' || conv === 'E') {
        const p = precision === undefined ? 6 : precision;
        const { mantissa, expStr } = expBody(info.N, info.decExp, p, hash);
        const body = mantissa + (conv === 'E' ? 'E' : 'e') + expStr;
        return padNumeric(signChar, '', body, width, leftAlign, zeroFlag);
      }

      // g / G
      const P = precision === undefined ? 6 : precision === 0 ? 1 : precision;
      const { X, Mstr } = computeSig(info.N, info.decExp, P);
      let body: string;
      if (P > X && X >= -4) {
        const fracDigits = P - 1 - X;
        const M = BigInt(Mstr);
        body = fixedBody(M, fracDigits, hash);
        if (!hash) body = trimG(body);
      } else {
        const { mantissa, expStr } = expBody(info.N, info.decExp, P - 1, hash);
        let m = mantissa;
        if (!hash) m = trimG(m);
        body = m + (conv === 'G' ? 'E' : 'e') + expStr;
      }
      return padNumeric(signChar, '', body, width, leftAlign, zeroFlag);
    }
    case 's': {
      let str = arg as string;
      if (precision !== undefined) str = str.slice(0, precision);
      return padText(str, width, leftAlign);
    }
    case 'c': {
      const str = arg as string;
      return padText(str, width, leftAlign);
    }
    default:
      return '';
  }
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  const re = /%([-+ 0#]*)(\d*)(\.(\d*))?([diouxXeEfFgGsc%])/g;
  let result = '';
  let lastIndex = 0;
  let argi = 0;
  let m: RegExpExecArray | null;

  while ((m = re.exec(fmt)) !== null) {
    result += fmt.slice(lastIndex, m.index);
    lastIndex = re.lastIndex;
    const [, flagsStr, widthStr, precGroup, precDigits, conv] = m;

    if (conv === '%') {
      result += '%';
      continue;
    }

    const flags: Flags = new Set(flagsStr.split(''));
    const width = widthStr === '' ? undefined : parseInt(widthStr, 10);
    const precision = precGroup === undefined ? undefined : precDigits === '' ? 0 : parseInt(precDigits, 10);
    const arg = args[argi++];
    result += formatOne(conv, flags, width, precision, arg);
  }
  result += fmt.slice(lastIndex);
  return result;
}
