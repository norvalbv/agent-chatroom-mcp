function doubleToFraction(x: number): { num: bigint; denom: bigint } {
  if (x === 0) return { num: 0n, denom: 1n };
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setFloat64(0, x);
  const bits = view.getBigUint64(0);
  const exponentBits = Number((bits >> 52n) & 0x7ffn);
  const mantissaBits = bits & 0xfffffffffffffn;
  let mantissa: bigint;
  let e: number;
  if (exponentBits === 0) {
    mantissa = mantissaBits;
    e = -1074;
  } else {
    mantissa = mantissaBits | (1n << 52n);
    e = exponentBits - 1075;
  }
  if (e >= 0) return { num: mantissa << BigInt(e), denom: 1n };
  return { num: mantissa, denom: 1n << BigInt(-e) };
}

function divRoundHalfEven(numerator: bigint, denominator: bigint): bigint {
  let q = numerator / denominator;
  const r = numerator % denominator;
  const twice = r * 2n;
  if (twice > denominator) q += 1n;
  else if (twice === denominator && q % 2n !== 0n) q += 1n;
  return q;
}

function fixedDigits(magnitude: number, p: number): { intPart: string; fracPart: string } {
  if (magnitude === 0) return { intPart: '0', fracPart: '0'.repeat(p) };
  const { num, denom } = doubleToFraction(magnitude);
  const scaled = num * 10n ** BigInt(p);
  const val = divRoundHalfEven(scaled, denom);
  let s = val.toString();
  if (s.length <= p) s = '0'.repeat(p - s.length + 1) + s;
  const intPart = p > 0 ? s.slice(0, s.length - p) : s;
  const fracPart = p > 0 ? s.slice(s.length - p) : '';
  return { intPart, fracPart };
}

function eStyleCompute(magnitude: number, p: number): { digits: string; exp: number } {
  if (magnitude === 0) return { digits: '0'.repeat(p + 1), exp: 0 };
  const { num, denom } = doubleToFraction(magnitude);
  const cmpToPow10 = (e: number): number => {
    let lhs: bigint;
    let rhs: bigint;
    if (e >= 0) {
      lhs = num;
      rhs = denom * 10n ** BigInt(e);
    } else {
      lhs = num * 10n ** BigInt(-e);
      rhs = denom;
    }
    if (lhs < rhs) return -1;
    if (lhs > rhs) return 1;
    return 0;
  };
  let X = Math.floor(Math.log10(magnitude));
  while (cmpToPow10(X) < 0) X -= 1;
  while (cmpToPow10(X + 1) >= 0) X += 1;

  const computeDigits = (Xval: number): string => {
    const shift = p - Xval;
    let numerator2: bigint;
    let denom2: bigint;
    if (shift >= 0) {
      numerator2 = num * 10n ** BigInt(shift);
      denom2 = denom;
    } else {
      numerator2 = num;
      denom2 = denom * 10n ** BigInt(-shift);
    }
    return divRoundHalfEven(numerator2, denom2).toString();
  };

  let digits = computeDigits(X);
  if (digits.length > p + 1) {
    X += 1;
    digits = digits.slice(0, p + 1);
  } else if (digits.length < p + 1) {
    digits = digits.padStart(p + 1, '0');
  }
  return { digits, exp: X };
}

function stripTrailingZeros(fracPart: string): string {
  let end = fracPart.length;
  while (end > 0 && fracPart[end - 1] === '0') end -= 1;
  return fracPart.slice(0, end);
}

function padNumeric(
  sign: string,
  prefix: string,
  digits: string,
  width: number,
  minus: boolean,
  zero: boolean,
): string {
  const body = sign + prefix + digits;
  if (body.length >= width) return body;
  const padLen = width - body.length;
  if (minus) return body + ' '.repeat(padLen);
  if (zero) return sign + prefix + '0'.repeat(padLen) + digits;
  return ' '.repeat(padLen) + body;
}

function formatExpExponent(exp: number): string {
  const sign = exp < 0 ? '-' : '+';
  let abs = Math.abs(exp).toString();
  if (abs.length < 2) abs = '0'.repeat(2 - abs.length) + abs;
  return sign + abs;
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let argIndex = 0;
  const re = /%([-+0 #]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc%])/g;

  return fmt.replace(re, (_match, flagsStr: string, widthStr: string, precStr: string | undefined, conv: string) => {
    if (conv === '%') return '%';

    const minus = flagsStr.includes('-');
    const plus = flagsStr.includes('+');
    const space = flagsStr.includes(' ');
    const zero = flagsStr.includes('0');
    const hash = flagsStr.includes('#');
    const width = widthStr ? parseInt(widthStr, 10) : 0;
    const precisionGiven = precStr !== undefined;
    const precision = precStr === undefined ? undefined : precStr === '' ? 0 : parseInt(precStr, 10);

    const arg = args[argIndex++];

    if (conv === 'd' || conv === 'i') {
      let neg: boolean;
      let mag: bigint;
      if (typeof arg === 'bigint') {
        neg = arg < 0n;
        mag = neg ? -arg : arg;
      } else {
        const n = arg as number;
        neg = n < 0 || Object.is(n, -0);
        mag = BigInt(Math.trunc(Math.abs(n)));
      }
      const p = precisionGiven ? (precision as number) : 1;
      let digits = mag.toString();
      if (p === 0 && mag === 0n) digits = '';
      else if (digits.length < p) digits = '0'.repeat(p - digits.length) + digits;
      const sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
      const zeroActive = zero && !precisionGiven;
      return padNumeric(sign, '', digits, width, minus, zeroActive);
    }

    if (conv === 'x' || conv === 'X' || conv === 'o') {
      const mag = typeof arg === 'bigint' ? arg : BigInt(arg as number);
      const p = precisionGiven ? (precision as number) : 1;
      const radix = conv === 'o' ? 8 : 16;
      let digits = mag.toString(radix);
      if (conv === 'X') digits = digits.toUpperCase();
      if (p === 0 && mag === 0n) digits = '';
      else if (digits.length < p) digits = '0'.repeat(p - digits.length) + digits;

      let prefix = '';
      if (hash) {
        if ((conv === 'x' || conv === 'X') && mag !== 0n) {
          prefix = conv === 'x' ? '0x' : '0X';
        } else if (conv === 'o') {
          if (digits.length === 0 || digits[0] !== '0') digits = '0' + digits;
        }
      }
      const zeroActive = zero && !precisionGiven;
      return padNumeric('', prefix, digits, width, minus, zeroActive);
    }

    if (conv === 'e' || conv === 'E' || conv === 'f' || conv === 'F' || conv === 'g' || conv === 'G') {
      const n = arg as number;
      const isNeg = n < 0 || Object.is(n, -0);
      const upper = conv === 'E' || conv === 'F' || conv === 'G';

      if (Number.isNaN(n)) {
        const body = upper ? 'NAN' : 'nan';
        return padNumeric('', '', body, width, minus, false);
      }
      const sign = isNeg ? '-' : plus ? '+' : space ? ' ' : '';
      if (!Number.isFinite(n)) {
        const body = upper ? 'INF' : 'inf';
        return padNumeric(sign, '', body, width, minus, false);
      }

      const magnitude = Math.abs(n);

      if (conv === 'e' || conv === 'E') {
        const p = precisionGiven ? (precision as number) : 6;
        const { digits, exp } = eStyleCompute(magnitude, p);
        const first = digits[0];
        const rest = digits.slice(1);
        const decimalPart = p === 0 ? (hash ? '.' : '') : '.' + rest;
        const eLetter = conv === 'E' ? 'E' : 'e';
        const out = first + decimalPart + eLetter + formatExpExponent(exp);
        return padNumeric(sign, '', out, width, minus, zero);
      }

      if (conv === 'f' || conv === 'F') {
        const p = precisionGiven ? (precision as number) : 6;
        const { intPart, fracPart } = fixedDigits(magnitude, p);
        const decimalPart = p === 0 ? (hash ? '.' : '') : '.' + fracPart;
        const out = intPart + decimalPart;
        return padNumeric(sign, '', out, width, minus, zero);
      }

      // g, G
      const P = precisionGiven ? (precision as number) : 6;
      const Pe = P === 0 ? 1 : P;
      const { digits, exp: X } = eStyleCompute(magnitude, Pe - 1);
      let out: string;
      if (Pe > X && X >= -4) {
        const fp = Pe - 1 - X;
        const { intPart, fracPart } = fixedDigits(magnitude, fp);
        let frac = fracPart;
        if (!hash) frac = stripTrailingZeros(frac);
        out = frac.length > 0 ? intPart + '.' + frac : hash ? intPart + '.' : intPart;
      } else {
        const first = digits[0];
        let rest = digits.slice(1);
        if (!hash) rest = stripTrailingZeros(rest);
        const eLetter = upper ? 'E' : 'e';
        const mantissa = rest.length > 0 ? first + '.' + rest : hash ? first + '.' : first;
        out = mantissa + eLetter + formatExpExponent(X);
      }
      return padNumeric(sign, '', out, width, minus, zero);
    }

    if (conv === 's') {
      let str = arg as string;
      if (precisionGiven) str = str.slice(0, precision as number);
      if (str.length >= width) return str;
      const padLen = width - str.length;
      return minus ? str + ' '.repeat(padLen) : ' '.repeat(padLen) + str;
    }

    // c
    const ch = arg as string;
    if (ch.length >= width) return ch;
    const padLen = width - ch.length;
    return minus ? ch + ' '.repeat(padLen) : ' '.repeat(padLen) + ch;
  });
}
