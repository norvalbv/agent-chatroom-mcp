type Decomposed = { mantissa: bigint; exponent: number };

// Decomposes a non-negative finite double x into mantissa * 2^exponent (exact).
function decomposeDouble(x: number): Decomposed {
  if (x === 0) return { mantissa: 0n, exponent: 0 };
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setFloat64(0, x);
  const bits = dv.getBigUint64(0);
  const expBits = Number((bits >> 52n) & 0x7ffn);
  const mantBits = bits & 0xfffffffffffffn;
  if (expBits === 0) {
    return { mantissa: mantBits, exponent: -1074 };
  }
  return { mantissa: mantBits | (1n << 52n), exponent: expBits - 1075 };
}

function pow2(n: number): bigint {
  return 2n ** BigInt(n);
}
function pow5(n: number): bigint {
  return 5n ** BigInt(n);
}

// Compares mantissa*2^e (value) to 10^X. Returns -1, 0, or 1.
function compareValueToPow10(mantissa: bigint, e: number, X: number): number {
  if (mantissa === 0n) return -1;
  const pa = e - X;
  const L = mantissa * pow2(Math.max(pa, 0)) * pow5(Math.max(-X, 0));
  const R = pow2(Math.max(-pa, 0)) * pow5(Math.max(X, 0));
  return L < R ? -1 : L > R ? 1 : 0;
}

// Finds X such that 10^X <= value < 10^(X+1), value = mantissa*2^e.
function findExponent(mantissa: bigint, e: number): number {
  if (mantissa === 0n) return 0;
  const approxLog2 = Math.log2(Number(mantissa)) + e;
  let X = Math.floor(approxLog2 / Math.log2(10));
  while (compareValueToPow10(mantissa, e, X) < 0) X--;
  while (compareValueToPow10(mantissa, e, X + 1) >= 0) X++;
  return X;
}

// Computes round(value * 10^k) with ties-to-even, value = mantissa*2^e (exact).
function computeRoundedDigits(mantissa: bigint, e: number, k: number): bigint {
  const pw2 = e + k;
  const pw5 = k;
  const numerator = mantissa * pow2(Math.max(pw2, 0)) * pow5(Math.max(pw5, 0));
  const denominator = pow2(Math.max(-pw2, 0)) * pow5(Math.max(-pw5, 0));
  if (denominator === 1n) return numerator;
  const q = numerator / denominator;
  const r = numerator - q * denominator;
  const twice = r * 2n;
  if (twice < denominator) return q;
  if (twice > denominator) return q + 1n;
  return q % 2n === 0n ? q : q + 1n;
}

function formatFloatF(mantissa: bigint, e: number, prec: number): { intPart: string; fracPart: string } {
  const Q = computeRoundedDigits(mantissa, e, prec);
  const digitsStr = Q.toString().padStart(prec + 1, '0');
  const len = digitsStr.length;
  const intPart = prec === 0 ? digitsStr : digitsStr.slice(0, len - prec);
  const fracPart = prec === 0 ? '' : digitsStr.slice(len - prec);
  return { intPart, fracPart };
}

function formatFloatE(mantissa: bigint, e: number, prec: number): { digits: string; exponent: number } {
  let X = findExponent(mantissa, e);
  const k = prec - X;
  const Q = computeRoundedDigits(mantissa, e, k);
  let digitsStr = Q.toString().padStart(prec + 1, '0');
  if (digitsStr.length > prec + 1) {
    X += 1;
    digitsStr = digitsStr.slice(0, prec + 1);
  }
  return { digits: digitsStr, exponent: X };
}

function getGExponent(mantissa: bigint, e: number, P: number): number {
  if (mantissa === 0n) return 0;
  let X = findExponent(mantissa, e);
  const k = P - 1 - X;
  const Q = computeRoundedDigits(mantissa, e, k);
  const digitsStr = Q.toString();
  if (digitsStr.length > P) X += 1;
  return X;
}

function stripTrailingZeros(s: string): string {
  if (!s.includes('.')) return s;
  s = s.replace(/0+$/, '');
  if (s.endsWith('.')) s = s.slice(0, -1);
  return s;
}

function padGeneric(str: string, width: number, leftAlign: boolean): string {
  if (str.length >= width) return str;
  const pad = ' '.repeat(width - str.length);
  return leftAlign ? str + pad : pad + str;
}

function padNumeric(
  sign: string,
  prefix: string,
  digits: string,
  width: number,
  leftAlign: boolean,
  zeroFlag: boolean
): string {
  const core = sign + prefix + digits;
  if (core.length >= width) return core;
  const padLen = width - core.length;
  if (leftAlign) return core + ' '.repeat(padLen);
  if (zeroFlag) return sign + prefix + '0'.repeat(padLen) + digits;
  return ' '.repeat(padLen) + core;
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let out = '';
  let argi = 0;
  let i = 0;
  const specRe = /^%([-+0 #]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc%])/;

  while (i < fmt.length) {
    if (fmt[i] !== '%') {
      out += fmt[i];
      i++;
      continue;
    }
    const rest = fmt.slice(i);
    const m = specRe.exec(rest)!;
    const flagsStr = m[1];
    const widthStr = m[2];
    const precStr = m[3];
    const conv = m[4];
    i += m[0].length;

    if (conv === '%') {
      out += '%';
      continue;
    }

    const hyphen = flagsStr.includes('-');
    const plus = flagsStr.includes('+');
    const space = flagsStr.includes(' ');
    const zeroFlag = flagsStr.includes('0');
    const hash = flagsStr.includes('#');
    const width = widthStr === '' ? 0 : parseInt(widthStr, 10);
    const hasPrecision = precStr !== undefined;
    const precision = hasPrecision ? (precStr === '' ? 0 : parseInt(precStr, 10)) : undefined;

    const arg = args[argi++];

    if (conv === 'd' || conv === 'i') {
      const v = typeof arg === 'bigint' ? arg : BigInt(arg as number);
      const isNeg = v < 0n;
      const mag = isNeg ? -v : v;
      let digits: string;
      if (precision === 0 && mag === 0n) {
        digits = '';
      } else {
        const base = mag.toString();
        digits = precision !== undefined ? base.padStart(precision, '0') : base;
      }
      const sign = isNeg ? '-' : plus ? '+' : space ? ' ' : '';
      const useZero = zeroFlag && !hyphen && precision === undefined;
      out += padNumeric(sign, '', digits, width, hyphen, useZero);
      continue;
    }

    if (conv === 'x' || conv === 'X' || conv === 'o') {
      const v = typeof arg === 'bigint' ? arg : BigInt(arg as number);
      const base = conv === 'o' ? 8 : 16;
      let digits: string;
      if (precision === 0 && v === 0n) {
        digits = '';
      } else {
        let b = v.toString(base);
        if (conv === 'X') b = b.toUpperCase();
        digits = precision !== undefined ? b.padStart(precision, '0') : b;
      }
      let prefix = '';
      if (hash) {
        if (conv === 'o') {
          if (digits === '' || digits[0] !== '0') digits = '0' + digits;
        } else {
          if (v !== 0n) prefix = conv === 'x' ? '0x' : '0X';
        }
      }
      const useZero = zeroFlag && !hyphen && precision === undefined;
      out += padNumeric('', prefix, digits, width, hyphen, useZero);
      continue;
    }

    if (conv === 'e' || conv === 'E' || conv === 'f' || conv === 'F' || conv === 'g' || conv === 'G') {
      const x = arg as number;
      const isUpper = conv === 'E' || conv === 'F' || conv === 'G';

      if (Number.isNaN(x)) {
        const body = isUpper ? 'NAN' : 'nan';
        out += padGeneric(body, width, hyphen);
        continue;
      }
      if (!Number.isFinite(x)) {
        const isNeg = x < 0;
        const sign = isNeg ? '-' : plus ? '+' : space ? ' ' : '';
        const body = sign + (isUpper ? 'INF' : 'inf');
        out += padGeneric(body, width, hyphen);
        continue;
      }

      const isNeg = x < 0 || Object.is(x, -0);
      const sign = isNeg ? '-' : plus ? '+' : space ? ' ' : '';
      const { mantissa, exponent } = decomposeDouble(Math.abs(x));
      const useZero = zeroFlag && !hyphen;

      if (conv === 'e' || conv === 'E') {
        const prec = precision !== undefined ? precision : 6;
        const { digits, exponent: X } = formatFloatE(mantissa, exponent, prec);
        const intDigit = digits[0];
        const fracDigits = digits.slice(1);
        const dot = prec === 0 && !hash ? '' : '.';
        const eLetter = conv === 'E' ? 'E' : 'e';
        const expSign = X < 0 ? '-' : '+';
        const expAbs = Math.abs(X).toString().padStart(2, '0');
        const bodyDigits = intDigit + dot + fracDigits + eLetter + expSign + expAbs;
        out += padNumeric(sign, '', bodyDigits, width, hyphen, useZero);
        continue;
      }

      if (conv === 'f' || conv === 'F') {
        const prec = precision !== undefined ? precision : 6;
        const { intPart, fracPart } = formatFloatF(mantissa, exponent, prec);
        const dot = prec === 0 && !hash ? '' : '.';
        const bodyDigits = intPart + dot + fracPart;
        out += padNumeric(sign, '', bodyDigits, width, hyphen, useZero);
        continue;
      }

      // g, G
      const Pin = precision !== undefined ? precision : 6;
      const P = Pin === 0 ? 1 : Pin;
      const X = getGExponent(mantissa, exponent, P);
      let bodyDigits: string;
      if (P > X && X >= -4) {
        const prec2 = P - 1 - X;
        const { intPart, fracPart } = formatFloatF(mantissa, exponent, prec2);
        const dot = prec2 === 0 && !hash ? '' : '.';
        bodyDigits = intPart + dot + fracPart;
        if (!hash) bodyDigits = stripTrailingZeros(bodyDigits);
      } else {
        const prec2 = P - 1;
        const { digits, exponent: X2 } = formatFloatE(mantissa, exponent, prec2);
        const intDigit = digits[0];
        const fracDigits = digits.slice(1);
        const dot = prec2 === 0 && !hash ? '' : '.';
        let mantissaPart = intDigit + dot + fracDigits;
        if (!hash) mantissaPart = stripTrailingZeros(mantissaPart);
        const eLetter = isUpper ? 'E' : 'e';
        const expSign = X2 < 0 ? '-' : '+';
        const expAbs = Math.abs(X2).toString().padStart(2, '0');
        bodyDigits = mantissaPart + eLetter + expSign + expAbs;
      }
      out += padNumeric(sign, '', bodyDigits, width, hyphen, useZero);
      continue;
    }

    if (conv === 's') {
      const s = arg as string;
      const body = precision !== undefined ? s.slice(0, precision) : s;
      out += padGeneric(body, width, hyphen);
      continue;
    }

    if (conv === 'c') {
      const s = arg as string;
      out += padGeneric(s, width, hyphen);
      continue;
    }
  }

  return out;
}
