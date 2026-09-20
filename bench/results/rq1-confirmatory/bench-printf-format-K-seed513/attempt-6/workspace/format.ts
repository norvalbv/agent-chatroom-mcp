type Flags = { minus: boolean; plus: boolean; space: boolean; zero: boolean; hash: boolean };

function decomposeDouble(x: number): { mantissa: bigint; exp: number } {
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  const mantHigh = hi & 0xfffff;
  let mantissa = (BigInt(mantHigh) << 32n) | BigInt(lo);
  let exp: number;
  if (expBits === 0) {
    exp = -1074;
  } else {
    mantissa |= 1n << 52n;
    exp = expBits - 1075;
  }
  return { mantissa, exp };
}

// Returns round-half-to-even(mantissa * 2^exp * 10^k) as a BigInt.
function roundHalfEven(mantissa: bigint, exp: number, k: number): bigint {
  const numPow10 = k > 0 ? BigInt(k) : 0n;
  const denPow10 = k < 0 ? BigInt(-k) : 0n;
  const numPow2 = exp > 0 ? BigInt(exp) : 0n;
  const denPow2 = exp < 0 ? BigInt(-exp) : 0n;
  const A = mantissa * 10n ** numPow10 * 2n ** numPow2;
  const B = 10n ** denPow10 * 2n ** denPow2;
  let q = A / B;
  const r = A % B;
  const twice = r * 2n;
  if (twice > B) q += 1n;
  else if (twice === B && q % 2n === 1n) q += 1n;
  return q;
}

// Digits (integer + fraction) for %f style with `p` fractional digits.
function fixedDigits(mantissa: bigint, exp: number, p: number): { intPart: string; fracPart: string } {
  const N = roundHalfEven(mantissa, exp, p);
  const s = N.toString();
  if (p === 0) return { intPart: s, fracPart: '' };
  const padded = s.padStart(p + 1, '0');
  return { intPart: padded.slice(0, padded.length - p), fracPart: padded.slice(padded.length - p) };
}

// Determine decimal exponent X and (prec+1) significant digits for %e style.
function expDigits(mantissa: bigint, exp: number, prec: number): { X: number; digits: string } {
  if (mantissa === 0n) return { X: 0, digits: '0'.repeat(prec + 1) };
  const approx = (Math.log2(Number(mantissa)) + exp) * Math.log10(2);
  let X = Math.floor(approx);
  let N = roundHalfEven(mantissa, exp, prec - X);
  let s = N.toString();
  while (s.length > prec + 1) {
    X++;
    N = roundHalfEven(mantissa, exp, prec - X);
    s = N.toString();
  }
  while (s.length < prec + 1) {
    X--;
    N = roundHalfEven(mantissa, exp, prec - X);
    s = N.toString();
  }
  return { X, digits: s };
}

function signPrefix(negative: boolean, flags: Flags): string {
  if (negative) return '-';
  if (flags.plus) return '+';
  if (flags.space) return ' ';
  return '';
}

function padNumeric(lead: string, digits: string, width: number | null, flags: Flags, zeroAllowed: boolean): string {
  const total = lead.length + digits.length;
  if (width === null || total >= width) return lead + digits;
  const pad = width - total;
  if (flags.minus) return lead + digits + ' '.repeat(pad);
  if (flags.zero && zeroAllowed) return lead + '0'.repeat(pad) + digits;
  return ' '.repeat(pad) + lead + digits;
}

function padGeneral(s: string, width: number | null, minus: boolean): string {
  if (width === null || s.length >= width) return s;
  const pad = ' '.repeat(width - s.length);
  return minus ? s + pad : pad + s;
}

function formatFloatBody(
  x: number,
  conv: string,
  flags: Flags,
  width: number | null,
  precision: number | null
): string {
  const upper = conv === conv.toUpperCase();
  if (Number.isNaN(x)) {
    return padGeneral(upper ? 'NAN' : 'nan', width, flags.minus);
  }
  const negative = x < 0 || Object.is(x, -0);
  const absX = Math.abs(x);
  if (!Number.isFinite(absX)) {
    const lead = signPrefix(negative, flags);
    return padNumeric(lead, upper ? 'INF' : 'inf', width, flags, false);
  }

  const lower = conv.toLowerCase();
  const { mantissa, exp } = decomposeDouble(absX);
  const lead = signPrefix(negative, flags);

  if (lower === 'f') {
    const p = precision === null ? 6 : precision;
    const { intPart, fracPart } = fixedDigits(mantissa, exp, p);
    const showDot = p > 0 || flags.hash;
    const digits = intPart + (showDot ? '.' + fracPart : '');
    return padNumeric(lead, digits, width, flags, true);
  }

  if (lower === 'e') {
    const p = precision === null ? 6 : precision;
    const { X, digits: sigDigits } = expDigits(mantissa, exp, p);
    const first = sigDigits[0];
    const rest = sigDigits.slice(1);
    const showDot = p > 0 || flags.hash;
    const expSign = X < 0 ? '-' : '+';
    const expMag = Math.abs(X).toString().padStart(2, '0');
    const body = first + (showDot ? '.' + rest : '') + (upper ? 'E' : 'e') + expSign + expMag;
    return padNumeric(lead, body, width, flags, true);
  }

  // g / G
  const P = precision === null ? 6 : precision === 0 ? 1 : precision;
  const { X, digits: sigDigits } = expDigits(mantissa, exp, P - 1);
  let body: string;
  if (P > X && X >= -4) {
    const prec = P - 1 - X;
    let intPart: string;
    let fracPart: string;
    if (X >= 0) {
      intPart = sigDigits.slice(0, X + 1);
      fracPart = sigDigits.slice(X + 1);
    } else {
      intPart = '0';
      fracPart = '0'.repeat(-X - 1) + sigDigits;
    }
    if (!flags.hash) {
      fracPart = fracPart.replace(/0+$/, '');
    }
    body = intPart + (fracPart.length > 0 || flags.hash ? '.' + fracPart : '');
  } else {
    const first = sigDigits[0];
    let rest = sigDigits.slice(1);
    if (!flags.hash) {
      rest = rest.replace(/0+$/, '');
    }
    const expSign = X < 0 ? '-' : '+';
    const expMag = Math.abs(X).toString().padStart(2, '0');
    body =
      first +
      (rest.length > 0 || flags.hash ? '.' + rest : '') +
      (upper ? 'E' : 'e') +
      expSign +
      expMag;
  }
  return padNumeric(lead, body, width, flags, true);
}

function toBig(v: number | bigint): bigint {
  return typeof v === 'bigint' ? v : BigInt(v);
}

function formatIntBody(
  v: number | bigint,
  conv: string,
  flags: Flags,
  width: number | null,
  precision: number | null
): string {
  const big = toBig(v);

  if (conv === 'd' || conv === 'i') {
    const negative = big < 0n;
    const magnitude = negative ? -big : big;
    let digits: string;
    if (precision !== null) {
      if (precision === 0 && magnitude === 0n) digits = '';
      else digits = magnitude.toString().padStart(precision, '0');
    } else {
      digits = magnitude.toString();
    }
    const lead = signPrefix(negative, flags);
    const zeroAllowed = precision === null;
    return padNumeric(lead, digits, width, flags, zeroAllowed);
  }

  // x, X, o — non-negative
  const magnitude = big;
  let digits =
    conv === 'o' ? magnitude.toString(8) : conv === 'X' ? magnitude.toString(16).toUpperCase() : magnitude.toString(16);

  if (precision !== null) {
    if (precision === 0 && magnitude === 0n) digits = '';
    else digits = digits.padStart(precision, '0');
  }

  let lead = '';
  if (flags.hash) {
    if (conv === 'o') {
      if (digits.length === 0 || digits[0] !== '0') digits = '0' + digits;
    } else if (magnitude !== 0n) {
      lead = conv === 'X' ? '0X' : '0x';
    }
  }

  const zeroAllowed = precision === null;
  return padNumeric(lead, digits, width, flags, zeroAllowed);
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let argIndex = 0;
  const re = /%([-+0# ]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc%])/g;

  return fmt.replace(re, (_match, flagsStr: string, widthStr: string, precStr: string | undefined, conv: string) => {
    if (conv === '%') return '%';

    const flags: Flags = {
      minus: flagsStr.includes('-'),
      plus: flagsStr.includes('+'),
      space: flagsStr.includes(' '),
      zero: flagsStr.includes('0'),
      hash: flagsStr.includes('#'),
    };
    const width = widthStr.length > 0 ? parseInt(widthStr, 10) : null;
    const precision = precStr !== undefined ? (precStr.length > 0 ? parseInt(precStr, 10) : 0) : null;

    const arg = args[argIndex++];

    if (conv === 's') {
      let s = String(arg);
      if (precision !== null) s = s.slice(0, precision);
      return padGeneral(s, width, flags.minus);
    }
    if (conv === 'c') {
      return padGeneral(String(arg), width, flags.minus);
    }
    if (conv === 'd' || conv === 'i' || conv === 'x' || conv === 'X' || conv === 'o') {
      return formatIntBody(arg as number | bigint, conv, flags, width, precision);
    }
    // e E f F g G
    return formatFloatBody(arg as number, conv, flags, width, precision);
  });
}
