type Flags = {
  minus: boolean;
  plus: boolean;
  space: boolean;
  zero: boolean;
  hash: boolean;
};

function getBits(x: number): { mantissa: bigint; exp: number } {
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  const hiFrac = hi & 0xfffff;
  const fraction = (BigInt(hiFrac) << 32n) | BigInt(lo);
  if (expBits === 0) {
    return { mantissa: fraction, exp: -1074 };
  }
  return { mantissa: fraction | (1n << 52n), exp: expBits - 1075 };
}

function isNegative(x: number): boolean {
  return x < 0 || Object.is(x, -0);
}

// Round the exact value mantissa * 2^exp to P digits after the decimal point,
// using round-half-to-even on the exact binary value.
function toFixedDigits(mantissa: bigint, exp: number, P: number): { intPart: string; fracPart: string } {
  if (mantissa === 0n) {
    return { intPart: '0', fracPart: '0'.repeat(P) };
  }
  let numerator: bigint;
  let denominator: bigint;
  if (exp >= 0) {
    numerator = mantissa * (2n ** BigInt(exp)) * (10n ** BigInt(P));
    denominator = 1n;
  } else {
    numerator = mantissa * (10n ** BigInt(P));
    denominator = 2n ** BigInt(-exp);
  }
  let q = numerator / denominator;
  const r = numerator % denominator;
  if (denominator > 1n) {
    const twice = r * 2n;
    if (twice > denominator || (twice === denominator && q % 2n === 1n)) {
      q += 1n;
    }
  }
  const s = q.toString();
  if (P === 0) {
    return { intPart: s, fracPart: '' };
  }
  const padded = s.padStart(P + 1, '0');
  return { intPart: padded.slice(0, padded.length - P), fracPart: padded.slice(padded.length - P) };
}

// Round the exact value mantissa * 2^exp (mantissa > 0) to S significant
// decimal digits, using round-half-to-even on the exact binary value.
// Returns the S digit string and the decimal exponent X of the first digit.
function toSignificantDigits(mantissa: bigint, exp: number, S: number): { digits: string; X: number } {
  let X = Math.floor(exp * Math.log10(2) + Math.log10(Number(mantissa)));
  for (let iter = 0; iter < 8; iter++) {
    const d = X - S + 1;
    let numerator = mantissa;
    let denominator = 1n;
    if (exp >= 0) numerator *= 2n ** BigInt(exp);
    else denominator *= 2n ** BigInt(-exp);
    if (d <= 0) numerator *= 10n ** BigInt(-d);
    else denominator *= 10n ** BigInt(d);
    let q = numerator / denominator;
    const r = numerator % denominator;
    if (denominator > 1n) {
      const twice = r * 2n;
      if (twice > denominator || (twice === denominator && q % 2n === 1n)) {
        q += 1n;
      }
    }
    const s = q.toString();
    if (s.length === S) {
      return { digits: s, X };
    } else if (s.length > S) {
      X += 1;
    } else {
      X -= 1;
    }
  }
  throw new Error('unreachable');
}

function intArgToBigInt(arg: number | bigint | string): bigint {
  return typeof arg === 'bigint' ? arg : BigInt(arg as number);
}

function padNumeric(sign: string, prefix: string, digits: string, width: number, flags: Flags, zeroAllowed: boolean): string {
  const core = sign + prefix + digits;
  if (core.length >= width) return core;
  if (flags.minus) return core + ' '.repeat(width - core.length);
  if (flags.zero && zeroAllowed) {
    return sign + prefix + '0'.repeat(width - core.length) + digits;
  }
  return ' '.repeat(width - core.length) + core;
}

function padString(s: string, width: number, flags: Flags): string {
  if (s.length >= width) return s;
  const pad = ' '.repeat(width - s.length);
  return flags.minus ? s + pad : pad + s;
}

function signFor(neg: boolean, flags: Flags): string {
  return neg ? '-' : flags.plus ? '+' : flags.space ? ' ' : '';
}

function formatDI(arg: number | bigint, flags: Flags, precision: number | undefined): { sign: string; digits: string } {
  const n = intArgToBigInt(arg);
  const neg = n < 0n;
  const abs = neg ? -n : n;
  let digits: string;
  if (precision !== undefined) {
    digits = precision === 0 && abs === 0n ? '' : abs.toString().padStart(precision, '0');
  } else {
    digits = abs.toString();
  }
  return { sign: signFor(neg, flags), digits };
}

function formatXXO(conv: 'x' | 'X' | 'o', arg: number | bigint, flags: Flags, precision: number | undefined): { digits: string; prefix: string } {
  const n = intArgToBigInt(arg);
  const base = conv === 'o' ? 8 : 16;
  let digits = n.toString(base);
  if (conv === 'X') digits = digits.toUpperCase();
  if (precision !== undefined) {
    digits = precision === 0 && n === 0n ? '' : digits.padStart(precision, '0');
  }
  let prefix = '';
  if (flags.hash) {
    if ((conv === 'x' || conv === 'X') && n !== 0n) {
      prefix = conv === 'x' ? '0x' : '0X';
    } else if (conv === 'o') {
      if (digits.length === 0 || digits[0] !== '0') digits = '0' + digits;
    }
  }
  return { digits, prefix };
}

function formatExpBody(x: number, conv: 'e' | 'E', flags: Flags, precision: number | undefined): { sign: string; body: string; special: boolean } {
  const P = precision === undefined ? 6 : precision;
  if (Number.isNaN(x)) {
    return { sign: '', body: conv === 'E' ? 'NAN' : 'nan', special: true };
  }
  const neg = isNegative(x);
  if (!Number.isFinite(x)) {
    return { sign: signFor(neg, flags), body: conv === 'E' ? 'INF' : 'inf', special: true };
  }
  const { mantissa, exp } = getBits(Math.abs(x));
  let X: number, digits: string;
  if (mantissa === 0n) {
    X = 0;
    digits = '0'.repeat(P + 1);
  } else {
    const r = toSignificantDigits(mantissa, exp, P + 1);
    X = r.X;
    digits = r.digits;
  }
  const frac = digits.slice(1, 1 + P);
  const mantStr = digits[0] + (P > 0 ? '.' + frac : flags.hash ? '.' : '');
  const expSign = X < 0 ? '-' : '+';
  const expAbs = Math.abs(X).toString().padStart(2, '0');
  const eLetter = conv === 'E' ? 'E' : 'e';
  return { sign: signFor(neg, flags), body: mantStr + eLetter + expSign + expAbs, special: false };
}

function formatFixedBody(x: number, conv: 'f' | 'F', flags: Flags, precision: number | undefined): { sign: string; body: string; special: boolean } {
  const P = precision === undefined ? 6 : precision;
  if (Number.isNaN(x)) {
    return { sign: '', body: conv === 'F' ? 'NAN' : 'nan', special: true };
  }
  const neg = isNegative(x);
  if (!Number.isFinite(x)) {
    return { sign: signFor(neg, flags), body: conv === 'F' ? 'INF' : 'inf', special: true };
  }
  const { mantissa, exp } = getBits(Math.abs(x));
  const { intPart, fracPart } = toFixedDigits(mantissa, exp, P);
  const body = intPart + (P > 0 ? '.' + fracPart : flags.hash ? '.' : '');
  return { sign: signFor(neg, flags), body, special: false };
}

function formatGBody(x: number, conv: 'g' | 'G', flags: Flags, precision: number | undefined): { sign: string; body: string; special: boolean } {
  let P = precision === undefined ? 6 : precision;
  if (P === 0) P = 1;
  if (Number.isNaN(x)) {
    return { sign: '', body: conv === 'G' ? 'NAN' : 'nan', special: true };
  }
  const neg = isNegative(x);
  if (!Number.isFinite(x)) {
    return { sign: signFor(neg, flags), body: conv === 'G' ? 'INF' : 'inf', special: true };
  }
  const { mantissa, exp } = getBits(Math.abs(x));
  let X: number, digits: string;
  if (mantissa === 0n) {
    X = 0;
    digits = '0'.repeat(P);
  } else {
    const r = toSignificantDigits(mantissa, exp, P);
    X = r.X;
    digits = r.digits;
  }
  const eLetter = conv === 'G' ? 'E' : 'e';
  let body: string;
  if (P > X && X >= -4) {
    const fp = P - 1 - X;
    let intPart: string, fracPart: string;
    if (mantissa === 0n) {
      intPart = '0';
      fracPart = '0'.repeat(Math.max(fp, 0));
    } else {
      const r2 = toFixedDigits(mantissa, exp, fp);
      intPart = r2.intPart;
      fracPart = r2.fracPart;
    }
    let frac = fracPart;
    if (!flags.hash) frac = frac.replace(/0+$/, '');
    body = intPart + (frac.length > 0 ? '.' + frac : flags.hash ? '.' : '');
  } else {
    const fp = P - 1;
    let frac = digits.slice(1, 1 + fp);
    if (!flags.hash) frac = frac.replace(/0+$/, '');
    const mantStr = digits[0] + (frac.length > 0 ? '.' + frac : flags.hash ? '.' : '');
    const expSign = X < 0 ? '-' : '+';
    const expAbs = Math.abs(X).toString().padStart(2, '0');
    body = mantStr + eLetter + expSign + expAbs;
  }
  return { sign: signFor(neg, flags), body, special: false };
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let argIndex = 0;
  const re = /%([-+ 0#]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc%])/g;
  return fmt.replace(re, (_match: string, flagsStr: string, widthStr: string, precStr: string | undefined, conv: string) => {
    if (conv === '%') return '%';
    const flags: Flags = {
      minus: flagsStr.includes('-'),
      plus: flagsStr.includes('+'),
      space: flagsStr.includes(' '),
      zero: flagsStr.includes('0'),
      hash: flagsStr.includes('#'),
    };
    const width = widthStr ? parseInt(widthStr, 10) : 0;
    const precision = precStr === undefined ? undefined : precStr === '' ? 0 : parseInt(precStr, 10);
    const arg = args[argIndex++];

    switch (conv) {
      case 'd':
      case 'i': {
        const { sign, digits } = formatDI(arg as number | bigint, flags, precision);
        return padNumeric(sign, '', digits, width, flags, precision === undefined);
      }
      case 'x':
      case 'X':
      case 'o': {
        const { digits, prefix } = formatXXO(conv, arg as number | bigint, flags, precision);
        return padNumeric('', prefix, digits, width, flags, precision === undefined);
      }
      case 'e':
      case 'E': {
        const { sign, body, special } = formatExpBody(arg as number, conv, flags, precision);
        return padNumeric(sign, '', body, width, flags, !special);
      }
      case 'f':
      case 'F': {
        const { sign, body, special } = formatFixedBody(arg as number, conv, flags, precision);
        return padNumeric(sign, '', body, width, flags, !special);
      }
      case 'g':
      case 'G': {
        const { sign, body, special } = formatGBody(arg as number, conv, flags, precision);
        return padNumeric(sign, '', body, width, flags, !special);
      }
      case 's': {
        let s = arg as string;
        if (precision !== undefined) s = s.slice(0, precision);
        return padString(s, width, flags);
      }
      case 'c': {
        return padString(arg as string, width, flags);
      }
      default:
        throw new Error(`unsupported conversion: ${conv}`);
    }
  });
}
