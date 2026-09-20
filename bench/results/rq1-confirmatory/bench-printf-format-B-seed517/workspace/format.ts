type Flags = {
  minus: boolean;
  plus: boolean;
  space: boolean;
  zero: boolean;
  hash: boolean;
};

function pow10(n: number): bigint {
  return 10n ** BigInt(n);
}

function roundHalfEven(num: bigint, den: bigint): bigint {
  const q = num / den;
  const r = num % den;
  const twice = r * 2n;
  if (twice < den) return q;
  if (twice > den) return q + 1n;
  return q % 2n === 0n ? q : q + 1n;
}

function decomposeDouble(x: number): { sign: boolean; M: bigint; E2: number } {
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setFloat64(0, x);
  const bits = view.getBigUint64(0);
  const sign = (bits >> 63n) & 1n;
  const expBits = Number((bits >> 52n) & 0x7ffn);
  const mantissaBits = bits & 0xfffffffffffffn;
  let M: bigint;
  let E2: number;
  if (expBits === 0) {
    M = mantissaBits;
    E2 = -1074;
  } else {
    M = mantissaBits | (1n << 52n);
    E2 = expBits - 1075;
  }
  return { sign: sign === 1n, M, E2 };
}

function toFraction(M: bigint, E2: number): { num: bigint; den: bigint } {
  if (E2 >= 0) {
    return { num: M << BigInt(E2), den: 1n };
  }
  return { num: M, den: 1n << BigInt(-E2) };
}

function compareValueToPow10(num: bigint, den: bigint, X: number): number {
  let lhs: bigint;
  let rhs: bigint;
  if (X >= 0) {
    lhs = num;
    rhs = den * pow10(X);
  } else {
    lhs = num * pow10(-X);
    rhs = den;
  }
  if (lhs < rhs) return -1;
  if (lhs > rhs) return 1;
  return 0;
}

function findExponent(num: bigint, den: bigint, estimate: number): number {
  let X = estimate;
  while (compareValueToPow10(num, den, X) < 0) X--;
  while (compareValueToPow10(num, den, X + 1) >= 0) X++;
  return X;
}

function sigDigits(num: bigint, den: bigint, N: number, estimate: number): { digits: string; X: number } {
  let X = findExponent(num, den, estimate);
  const shift = N - 1 - X;
  let scaledNum: bigint;
  let scaledDen: bigint;
  if (shift >= 0) {
    scaledNum = num * pow10(shift);
    scaledDen = den;
  } else {
    scaledNum = num;
    scaledDen = den * pow10(-shift);
  }
  let digitsInt = roundHalfEven(scaledNum, scaledDen);
  let digitsStr = digitsInt.toString();
  if (digitsStr.length > N) {
    X += 1;
    digitsStr = digitsStr.slice(0, N);
  } else if (digitsStr.length < N) {
    digitsStr = digitsStr.padStart(N, '0');
  }
  return { digits: digitsStr, X };
}

function fStyleDigits(num: bigint, den: bigint, P: number): { intPart: string; fracPart: string } {
  const scaled = roundHalfEven(num * pow10(P), den);
  let s = scaled.toString();
  if (s.length <= P) s = s.padStart(P + 1, '0');
  if (P === 0) return { intPart: s, fracPart: '' };
  return { intPart: s.slice(0, s.length - P), fracPart: s.slice(s.length - P) };
}

function padWidth(body: string, width: number, leftAlign: boolean): string {
  if (body.length >= width) return body;
  const pad = ' '.repeat(width - body.length);
  return leftAlign ? body + pad : pad + body;
}

function applyNumericWidth(
  sign: string,
  prefix: string,
  digits: string,
  width: number,
  flags: Flags,
): string {
  const body = sign + prefix + digits;
  if (body.length >= width) return body;
  if (flags.minus) return body + ' '.repeat(width - body.length);
  if (flags.zero) return sign + prefix + '0'.repeat(width - body.length) + digits;
  return ' '.repeat(width - body.length) + body;
}

function toBigIntSafe(v: number | bigint): bigint {
  return typeof v === 'bigint' ? v : BigInt(v);
}

function signPrefix(isNeg: boolean, flags: Flags): string {
  if (isNeg) return '-';
  if (flags.plus) return '+';
  if (flags.space) return ' ';
  return '';
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  const re = /%([-+ 0#]*)(\d*)(\.\d*)?([diouxXeEfFgGsc%])/g;
  let result = '';
  let lastIndex = 0;
  let argIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = re.exec(fmt)) !== null) {
    result += fmt.slice(lastIndex, match.index);
    lastIndex = re.lastIndex;

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
    };
    const width = widthStr === '' ? 0 : parseInt(widthStr, 10);
    const precision = precStr === undefined ? null : precStr === '.' ? 0 : parseInt(precStr.slice(1), 10);

    const arg = args[argIndex++];

    if (conv === 'd' || conv === 'i') {
      const value = toBigIntSafe(arg as number | bigint);
      const isNeg = value < 0n;
      const abs = isNeg ? -value : value;
      let digits: string;
      if (precision !== null) {
        if (abs === 0n && precision === 0) {
          digits = '';
        } else {
          digits = abs.toString().padStart(precision, '0');
        }
      } else {
        digits = abs.toString();
      }
      const sign = signPrefix(isNeg, flags);
      const effFlags: Flags = { ...flags, zero: flags.zero && precision === null };
      result += applyNumericWidth(sign, '', digits, width, effFlags);
      continue;
    }

    if (conv === 'x' || conv === 'X' || conv === 'o') {
      const value = toBigIntSafe(arg as number | bigint);
      const base = conv === 'o' ? 8 : 16;
      let digits: string;
      if (precision !== null) {
        if (value === 0n && precision === 0) {
          digits = '';
        } else {
          digits = value.toString(base).padStart(precision, '0');
        }
      } else {
        digits = value.toString(base);
      }
      if (conv === 'X') digits = digits.toUpperCase();
      let prefix = '';
      if (flags.hash) {
        if (conv === 'o') {
          if (digits === '' || digits[0] !== '0') digits = '0' + digits;
        } else if (value !== 0n) {
          prefix = conv === 'X' ? '0X' : '0x';
        }
      }
      const effFlags: Flags = { ...flags, zero: flags.zero && precision === null };
      result += applyNumericWidth('', prefix, digits, width, effFlags);
      continue;
    }

    if (conv === 's') {
      let str = arg as string;
      if (precision !== null) str = str.slice(0, precision);
      result += padWidth(str, width, flags.minus);
      continue;
    }

    if (conv === 'c') {
      const str = arg as string;
      result += padWidth(str, width, flags.minus);
      continue;
    }

    // e E f F g G
    const value = arg as number;
    const upper = conv === 'E' || conv === 'F' || conv === 'G';

    if (Number.isNaN(value)) {
      const text = upper ? 'NAN' : 'nan';
      result += padWidth(text, width, flags.minus);
      continue;
    }

    const { sign: signBit, M, E2 } = decomposeDouble(value);

    if (!Number.isFinite(value)) {
      const sign = signPrefix(signBit, flags);
      const body = sign + (upper ? 'INF' : 'inf');
      result += padWidth(body, width, flags.minus);
      continue;
    }

    const sign = signPrefix(signBit, flags);
    const { num, den } = toFraction(M, E2);
    const isZero = M === 0n;

    if (conv === 'f' || conv === 'F') {
      const P = precision === null ? 6 : precision;
      const { intPart, fracPart } = fStyleDigits(num, den, P);
      let digits: string;
      if (P === 0) {
        digits = flags.hash ? intPart + '.' : intPart;
      } else {
        digits = intPart + '.' + fracPart;
      }
      result += applyNumericWidth(sign, '', digits, width, flags);
      continue;
    }

    if (conv === 'e' || conv === 'E') {
      const P = precision === null ? 6 : precision;
      const N = P + 1;
      let digits: string;
      let X: number;
      if (isZero) {
        digits = '0'.repeat(N);
        X = 0;
      } else {
        const estimate = Math.floor(Math.log10(Math.abs(value)));
        const r = sigDigits(num, den, N, estimate);
        digits = r.digits;
        X = r.X;
      }
      const first = digits[0];
      const rest = digits.slice(1);
      const mantissa = P === 0 ? (flags.hash ? first + '.' : first) : first + '.' + rest;
      const expSign = X < 0 ? '-' : '+';
      let expAbs = Math.abs(X).toString();
      if (expAbs.length < 2) expAbs = expAbs.padStart(2, '0');
      const body = mantissa + (upper ? 'E' : 'e') + expSign + expAbs;
      result += applyNumericWidth(sign, '', body, width, flags);
      continue;
    }

    // g G
    {
      const P0 = precision === null ? 6 : precision;
      const P = P0 === 0 ? 1 : P0;
      let digits: string;
      let X: number;
      if (isZero) {
        digits = '0'.repeat(P);
        X = 0;
      } else {
        const estimate = Math.floor(Math.log10(Math.abs(value)));
        const r = sigDigits(num, den, P, estimate);
        digits = r.digits;
        X = r.X;
      }

      let numberBody: string;
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
        if (!flags.hash) {
          fracPart = fracPart.replace(/0+$/, '');
        }
        numberBody = fracPart === '' ? (flags.hash ? intPart + '.' : intPart) : intPart + '.' + fracPart;
      } else {
        const first = digits[0];
        let rest = digits.slice(1);
        if (!flags.hash) {
          rest = rest.replace(/0+$/, '');
        }
        const mantissa = rest === '' ? (flags.hash ? first + '.' : first) : first + '.' + rest;
        const expSign = X < 0 ? '-' : '+';
        let expAbs = Math.abs(X).toString();
        if (expAbs.length < 2) expAbs = expAbs.padStart(2, '0');
        numberBody = mantissa + (upper ? 'E' : 'e') + expSign + expAbs;
      }
      result += applyNumericWidth(sign, '', numberBody, width, flags);
      continue;
    }
  }

  result += fmt.slice(lastIndex);
  return result;
}
