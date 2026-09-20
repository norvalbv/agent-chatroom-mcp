type Flags = {
  minus: boolean;
  plus: boolean;
  space: boolean;
  zero: boolean;
  hash: boolean;
  width: number;
  precision: number | undefined;
};

function padNumeric(prefix: string, digits: string, width: number, useZero: boolean, minus: boolean): string {
  const body = prefix + digits;
  if (body.length >= width) return body;
  if (minus) return body.padEnd(width, ' ');
  if (useZero) return prefix + digits.padStart(width - prefix.length, '0');
  return body.padStart(width, ' ');
}

function stripLeadingZeros(s: string): string {
  const t = s.replace(/^0+(?=\d)/, '');
  return t;
}

function joinFrac(frac: string, hash: boolean): string {
  return hash || frac.length > 0 ? '.' + frac : '';
}

function roundDrop(D: bigint, j: number): bigint {
  if (j <= 0) return D * 10n ** BigInt(-j);
  const pow = 10n ** BigInt(j);
  const q = D / pow;
  const r = D % pow;
  const twice = r * 2n;
  if (twice < pow) return q;
  if (twice > pow) return q + 1n;
  return q % 2n === 0n ? q : q + 1n;
}

function getExactDecimal(absValue: number): { D: bigint; k: number } {
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setFloat64(0, absValue, false);
  const bits = view.getBigUint64(0, false);
  const exponentBits = (bits >> 52n) & 0x7ffn;
  const mantissaBits = bits & 0xfffffffffffffn;
  let significand: bigint;
  let e: number;
  if (exponentBits === 0n) {
    significand = mantissaBits;
    e = -1074;
  } else {
    significand = mantissaBits | (1n << 52n);
    e = Number(exponentBits) - 1075;
  }
  if (significand === 0n) return { D: 0n, k: 0 };
  if (e >= 0) return { D: significand << BigInt(e), k: 0 };
  return { D: significand * 5n ** BigInt(-e), k: -e };
}

function roundToFractionalDigits(D: bigint, k: number, m: number): bigint {
  return roundDrop(D, k - m);
}

function roundSignificant(D: bigint, k: number, N: number): { digits: string; exp: number } {
  if (D === 0n) return { digits: '0'.repeat(N), exp: 0 };
  const s = D.toString();
  const len = s.length;
  let exp = len - 1 - k;
  const j = len - N;
  const R = roundDrop(D, j);
  let rs = R.toString();
  if (rs.length > N) {
    exp += rs.length - N;
    rs = rs.slice(0, N);
  } else if (rs.length < N) {
    rs = rs.padStart(N, '0');
  }
  return { digits: rs, exp };
}

function signChar(negative: boolean, plus: boolean, space: boolean): string {
  return negative ? '-' : plus ? '+' : space ? ' ' : '';
}

function toBigIntArg(v: number | bigint): bigint {
  return typeof v === 'bigint' ? v : BigInt(v);
}

function formatDI(v: number | bigint, f: Flags): string {
  const n = toBigIntArg(v);
  const negative = n < 0n;
  const magnitude = negative ? -n : n;
  const natural = magnitude.toString();
  let digits: string;
  if (f.precision === undefined) {
    digits = natural;
  } else if (f.precision === 0 && magnitude === 0n) {
    digits = '';
  } else {
    digits = natural.padStart(f.precision, '0');
  }
  const sign = signChar(negative, f.plus, f.space);
  const useZero = f.zero && f.precision === undefined;
  return padNumeric(sign, digits, f.width, useZero, f.minus);
}

function formatXO(v: number | bigint, conv: 'x' | 'X' | 'o', f: Flags): string {
  const magnitude = toBigIntArg(v);
  const base = conv === 'o' ? 8 : 16;
  let natural = magnitude.toString(base);
  if (conv === 'X') natural = natural.toUpperCase();
  let digits: string;
  if (f.precision === undefined) {
    digits = natural;
  } else if (f.precision === 0 && magnitude === 0n) {
    digits = '';
  } else {
    digits = natural.padStart(f.precision, '0');
  }
  let prefix = '';
  if (f.hash) {
    if (conv === 'o') {
      if (digits === '' || digits[0] !== '0') digits = '0' + digits;
    } else if (magnitude !== 0n) {
      prefix = conv === 'X' ? '0X' : '0x';
    }
  }
  const useZero = f.zero && f.precision === undefined;
  return padNumeric(prefix, digits, f.width, useZero, f.minus);
}

function formatFloat(v: number, conv: 'e' | 'E' | 'f' | 'F' | 'g' | 'G', f: Flags): string {
  const upper = conv === conv.toUpperCase();
  const negative = v < 0 || Object.is(v, -0);
  const nan = Number.isNaN(v);
  const infinite = !Number.isFinite(v) && !nan;

  if (nan) {
    const body = upper ? 'NAN' : 'nan';
    return padNumeric('', body, f.width, false, f.minus);
  }
  if (infinite) {
    const body = upper ? 'INF' : 'inf';
    const sign = signChar(negative, f.plus, f.space);
    return padNumeric(sign, body, f.width, false, f.minus);
  }

  const sign = signChar(negative, f.plus, f.space);
  const absValue = Math.abs(v);
  const { D, k } = getExactDecimal(absValue);

  let body: string;
  if (conv === 'f' || conv === 'F') {
    const m = f.precision ?? 6;
    const R = roundToFractionalDigits(D, k, m);
    const padded = R.toString().padStart(m + 1, '0');
    const intPart = m > 0 ? padded.slice(0, padded.length - m) : padded;
    const fracPart = m > 0 ? padded.slice(padded.length - m) : '';
    body = stripLeadingZeros(intPart) + joinFrac(fracPart, f.hash);
  } else if (conv === 'e' || conv === 'E') {
    const p = f.precision ?? 6;
    const N = p + 1;
    const { digits, exp } = roundSignificant(D, k, N);
    const fracPart = digits.slice(1);
    const expChar = conv === 'E' ? 'E' : 'e';
    const expSign = exp >= 0 ? '+' : '-';
    const expAbs = Math.abs(exp).toString().padStart(2, '0');
    body = digits[0] + joinFrac(fracPart, f.hash) + expChar + expSign + expAbs;
  } else {
    let P = f.precision ?? 6;
    if (P === 0) P = 1;
    const { digits, exp: X } = roundSignificant(D, k, P);
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
      if (!f.hash) fracPart = fracPart.replace(/0+$/, '');
      body = stripLeadingZeros(intPart) + joinFrac(fracPart, f.hash);
    } else {
      let fracPart = digits.slice(1);
      if (!f.hash) fracPart = fracPart.replace(/0+$/, '');
      const expChar = conv === 'G' ? 'E' : 'e';
      const expSign = X >= 0 ? '+' : '-';
      const expAbs = Math.abs(X).toString().padStart(2, '0');
      body = digits[0] + joinFrac(fracPart, f.hash) + expChar + expSign + expAbs;
    }
  }

  return padNumeric(sign, body, f.width, f.zero, f.minus);
}

function formatOne(conv: string, arg: number | bigint | string, f: Flags): string {
  switch (conv) {
    case 'd':
    case 'i':
      return formatDI(arg as number | bigint, f);
    case 'x':
    case 'X':
    case 'o':
      return formatXO(arg as number | bigint, conv, f);
    case 'e':
    case 'E':
    case 'f':
    case 'F':
    case 'g':
    case 'G':
      return formatFloat(arg as number, conv, f);
    case 's': {
      let str = arg as string;
      if (f.precision !== undefined) str = str.slice(0, f.precision);
      return padNumeric('', str, f.width, false, f.minus);
    }
    case 'c':
      return padNumeric('', arg as string, f.width, false, f.minus);
    default:
      throw new Error(`unsupported conversion: ${conv}`);
  }
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  const regex = /%([-+0# ]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc%])/g;
  let result = '';
  let lastIndex = 0;
  let argIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(fmt)) !== null) {
    result += fmt.slice(lastIndex, match.index);
    lastIndex = regex.lastIndex;
    const [, flagsStr, widthStr, precStr, conv] = match;
    if (conv === '%') {
      result += '%';
      continue;
    }
    const flags: Flags = {
      minus: flagsStr.includes('-'),
      plus: flagsStr.includes('+'),
      space: flagsStr.includes(' '),
      zero: flagsStr.includes('0'),
      hash: flagsStr.includes('#'),
      width: widthStr ? parseInt(widthStr, 10) : 0,
      precision: precStr !== undefined ? (precStr === '' ? 0 : parseInt(precStr, 10)) : undefined,
    };
    const arg = args[argIndex++];
    result += formatOne(conv, arg, flags);
  }
  result += fmt.slice(lastIndex);
  return result;
}
