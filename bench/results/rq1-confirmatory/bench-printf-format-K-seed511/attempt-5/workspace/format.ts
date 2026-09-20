type Flags = {
  minus: boolean;
  plus: boolean;
  space: boolean;
  zero: boolean;
  hash: boolean;
};

function pow2(k: number): bigint {
  return k <= 0 ? 1n : 1n << BigInt(k);
}

function pow10(k: number): bigint {
  return k <= 0 ? 1n : 10n ** BigInt(k);
}

// Decompose a finite, non-zero, non-negative double into m * 2^e (exact).
function decompose(x: number): { m: bigint; e: number } {
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setFloat64(0, x);
  const bits = dv.getBigUint64(0);
  const expBits = Number((bits >> 52n) & 0x7ffn);
  const mantissaBits = bits & 0xfffffffffffffn;
  if (expBits === 0) {
    return { m: mantissaBits, e: -1074 };
  }
  return { m: mantissaBits | (1n << 52n), e: expBits - 1075 };
}

// Round m*2^e * 10^n to the nearest integer, ties to even.
function roundScaled(m: bigint, e: number, n: number): bigint {
  const numerator = m * pow2(e > 0 ? e : 0) * pow10(n > 0 ? n : 0);
  const denominator = pow2(e < 0 ? -e : 0) * pow10(n < 0 ? -n : 0);
  if (denominator === 1n) return numerator;
  const q = numerator / denominator;
  const r = numerator % denominator;
  const twice = r * 2n;
  if (twice > denominator) return q + 1n;
  if (twice === denominator) return q % 2n === 0n ? q : q + 1n;
  return q;
}

// round(absX * 10^n) as a BigInt, exact.
function scaledRound(absX: number, n: number): bigint {
  if (absX === 0) return 0n;
  const { m, e } = decompose(absX);
  return roundScaled(m, e, n);
}

// Round absX to P+1 significant decimal digits; return the digit string
// (length P+1) and the decimal exponent X such that
// absX ~= 0.digits[0]digits[1...] * 10^(X+1)  (i.e. d0.d1d2...dP * 10^X).
function eStyleDigits(absX: number, P: number): { digits: string; X: number } {
  if (absX === 0) return { digits: '0'.repeat(P + 1), X: 0 };
  let X = Math.floor(Math.log10(absX));
  for (let iter = 0; iter < 10; iter++) {
    const N = scaledRound(absX, P - X);
    const s = N.toString();
    if (s.length === P + 1) {
      return { digits: s, X };
    } else if (s.length > P + 1) {
      X += s.length - (P + 1);
    } else {
      X -= (P + 1) - s.length;
    }
  }
  const N = scaledRound(absX, P - X);
  const s = N.toString().padStart(P + 1, '0');
  return { digits: s.slice(s.length - (P + 1)), X };
}

function fStyleDigits(absX: number, P: number): { intPart: string; fracPart: string } {
  const N = scaledRound(absX, P);
  let s = N.toString();
  if (s.length <= P) s = s.padStart(P + 1, '0');
  const intPart = P > 0 ? s.slice(0, s.length - P) : s;
  const fracPart = P > 0 ? s.slice(s.length - P) : '';
  return { intPart, fracPart };
}

function padWidthSpaces(text: string, width: number, minus: boolean): string {
  if (text.length >= width) return text;
  return minus ? text.padEnd(width) : text.padStart(width);
}

function padNumeric(
  sign: string,
  prefix: string,
  digits: string,
  width: number,
  flags: Flags,
  zeroAllowed: boolean
): string {
  const total = sign + prefix + digits;
  if (total.length >= width) return total;
  if (flags.minus) return total.padEnd(width);
  if (zeroAllowed && flags.zero) {
    return sign + prefix + digits.padStart(width - sign.length - prefix.length, '0');
  }
  return total.padStart(width);
}

function signFor(isNegative: boolean, flags: Flags): string {
  if (isNegative) return '-';
  if (flags.plus) return '+';
  if (flags.space) return ' ';
  return '';
}

function signAndAbs(x: number, flags: Flags): { sign: string; special: 'nan' | 'inf' | null; absX: number } {
  if (Number.isNaN(x)) return { sign: '', special: 'nan', absX: NaN };
  const isNeg = x < 0 || Object.is(x, -0);
  const sign = signFor(isNeg, flags);
  if (!Number.isFinite(x)) {
    return { sign, special: 'inf', absX: Infinity };
  }
  return { sign, special: null, absX: Math.abs(x) };
}

function stripFrac(frac: string, hash: boolean): { dot: string; frac: string } {
  if (frac.length === 0) {
    return { dot: hash ? '.' : '', frac: '' };
  }
  if (hash) {
    return { dot: '.', frac };
  }
  const stripped = frac.replace(/0+$/, '');
  return { dot: stripped.length > 0 ? '.' : '', frac: stripped };
}

function toBigIntArg(v: number | bigint | string): bigint {
  if (typeof v === 'bigint') return v;
  return BigInt(v as number);
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let argIndex = 0;
  let result = '';
  let lastIndex = 0;
  const specRe = /%([-+#0 ]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc%])/g;
  let match: RegExpExecArray | null;

  while ((match = specRe.exec(fmt)) !== null) {
    result += fmt.slice(lastIndex, match.index);
    lastIndex = specRe.lastIndex;
    const [, flagsStr, widthStr, precDigits, conv] = match;

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
    };
    const width = widthStr ? parseInt(widthStr, 10) : 0;
    const hasPrec = precDigits !== undefined;
    const precision = hasPrec ? (precDigits === '' ? 0 : parseInt(precDigits, 10)) : undefined;
    const arg = args[argIndex++];

    result += formatOne(conv, flags, width, precision, hasPrec, arg);
  }
  result += fmt.slice(lastIndex);
  return result;
}

function formatOne(
  conv: string,
  flags: Flags,
  width: number,
  precision: number | undefined,
  hasPrec: boolean,
  arg: number | bigint | string
): string {
  switch (conv) {
    case 'd':
    case 'i': {
      const big = toBigIntArg(arg);
      const neg = big < 0n;
      const absBig = neg ? -big : big;
      let digits = absBig.toString();
      if (hasPrec) {
        if (precision === 0 && absBig === 0n) digits = '';
        else digits = digits.padStart(precision as number, '0');
      }
      const sign = signFor(neg, flags);
      const zeroAllowed = !hasPrec;
      return padNumeric(sign, '', digits, width, flags, zeroAllowed);
    }
    case 'x':
    case 'X':
    case 'o': {
      const absBig = toBigIntArg(arg);
      let digits = absBig.toString(conv === 'o' ? 8 : 16);
      if (conv === 'X') digits = digits.toUpperCase();
      if (hasPrec) {
        if (precision === 0 && absBig === 0n) digits = '';
        else digits = digits.padStart(precision as number, '0');
      }
      let prefix = '';
      if (flags.hash) {
        if (conv === 'o') {
          if (digits.length === 0 || digits[0] !== '0') digits = '0' + digits;
        } else if (absBig !== 0n) {
          prefix = conv === 'X' ? '0X' : '0x';
        }
      }
      const zeroAllowed = !hasPrec;
      return padNumeric('', prefix, digits, width, flags, zeroAllowed);
    }
    case 'e':
    case 'E': {
      const upper = conv === 'E';
      const P = precision !== undefined ? precision : 6;
      const x = arg as number;
      const { sign, special, absX } = signAndAbs(x, flags);
      if (special === 'nan') return padWidthSpaces(upper ? 'NAN' : 'nan', width, flags.minus);
      if (special === 'inf') return padWidthSpaces(sign + (upper ? 'INF' : 'inf'), width, flags.minus);
      const { digits, X } = eStyleDigits(absX, P);
      const d0 = digits[0];
      const rest = digits.slice(1);
      const { dot, frac } = P === 0 ? { dot: flags.hash ? '.' : '', frac: '' } : { dot: '.', frac: rest };
      const expSign = X < 0 ? '-' : '+';
      const expAbs = Math.abs(X).toString().padStart(2, '0');
      const content = d0 + dot + frac + (upper ? 'E' : 'e') + expSign + expAbs;
      return padNumeric(sign, '', content, width, flags, true);
    }
    case 'f':
    case 'F': {
      const upper = conv === 'F';
      const P = precision !== undefined ? precision : 6;
      const x = arg as number;
      const { sign, special, absX } = signAndAbs(x, flags);
      if (special === 'nan') return padWidthSpaces(upper ? 'NAN' : 'nan', width, flags.minus);
      if (special === 'inf') return padWidthSpaces(sign + (upper ? 'INF' : 'inf'), width, flags.minus);
      const { intPart, fracPart } = fStyleDigits(absX, P);
      const dot = P === 0 ? (flags.hash ? '.' : '') : '.';
      const content = intPart + dot + fracPart;
      return padNumeric(sign, '', content, width, flags, true);
    }
    case 'g':
    case 'G': {
      const upper = conv === 'G';
      const P0 = precision !== undefined ? precision : 6;
      const P = P0 === 0 ? 1 : P0;
      const x = arg as number;
      const { sign, special, absX } = signAndAbs(x, flags);
      if (special === 'nan') return padWidthSpaces(upper ? 'NAN' : 'nan', width, flags.minus);
      if (special === 'inf') return padWidthSpaces(sign + (upper ? 'INF' : 'inf'), width, flags.minus);

      const { digits, X } = eStyleDigits(absX, P - 1);
      let content: string;
      if (P > X && X >= -4) {
        let intPart: string;
        let fracPartFull: string;
        if (X >= 0) {
          intPart = digits.slice(0, X + 1);
          fracPartFull = digits.slice(X + 1);
        } else {
          intPart = '0';
          fracPartFull = '0'.repeat(-X - 1) + digits;
        }
        const { dot, frac } = stripFrac(fracPartFull, flags.hash);
        content = intPart + dot + frac;
      } else {
        const d0 = digits[0];
        const restFull = digits.slice(1);
        const { dot, frac } = stripFrac(restFull, flags.hash);
        const expSign = X < 0 ? '-' : '+';
        const expAbs = Math.abs(X).toString().padStart(2, '0');
        content = d0 + dot + frac + (upper ? 'E' : 'e') + expSign + expAbs;
      }
      return padNumeric(sign, '', content, width, flags, true);
    }
    case 's': {
      let str = arg as string;
      if (precision !== undefined) str = str.slice(0, precision);
      return padWidthSpaces(str, width, flags.minus);
    }
    case 'c': {
      const str = arg as string;
      return padWidthSpaces(str, width, flags.minus);
    }
    default:
      throw new Error(`unsupported conversion: ${conv}`);
  }
}
