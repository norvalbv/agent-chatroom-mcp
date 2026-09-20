type Flags = {
  leftAlign: boolean;
  plus: boolean;
  space: boolean;
  zero: boolean;
  hash: boolean;
};

function parseFlags(s: string): Flags {
  return {
    leftAlign: s.includes('-'),
    plus: s.includes('+'),
    space: s.includes(' '),
    zero: s.includes('0'),
    hash: s.includes('#'),
  };
}

function applyWidth(
  sign: string,
  prefix: string,
  digits: string,
  width: number,
  leftAlign: boolean,
  zeroPad: boolean
): string {
  const body = sign + prefix + digits;
  if (body.length >= width) return body;
  const padLen = width - body.length;
  if (leftAlign) return body + ' '.repeat(padLen);
  if (zeroPad) return sign + prefix + '0'.repeat(padLen) + digits;
  return ' '.repeat(padLen) + body;
}

function roundHalfEven(scaledNum: bigint, denom: bigint): bigint {
  let q = scaledNum / denom;
  const r = scaledNum % denom;
  const twice = r * 2n;
  if (twice > denom || (twice === denom && q % 2n === 1n)) {
    q += 1n;
  }
  return q;
}

function decompose(x: number): { numerator: bigint; denominator: bigint } {
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const rawExp = (hi >>> 20) & 0x7ff;
  const mantHi = hi & 0xfffff;
  let mantissa = (BigInt(mantHi) << 32n) | BigInt(lo);
  let exponent: number;
  if (rawExp === 0) {
    exponent = -1074;
  } else {
    mantissa |= 1n << 52n;
    exponent = rawExp - 1075;
  }
  let numerator: bigint;
  let denominator: bigint;
  if (exponent >= 0) {
    numerator = mantissa << BigInt(exponent);
    denominator = 1n;
  } else {
    numerator = mantissa;
    denominator = 1n << BigInt(-exponent);
  }
  return { numerator, denominator };
}

function geTenPow(numerator: bigint, denominator: bigint, X: number): boolean {
  if (X >= 0) return numerator >= denominator * 10n ** BigInt(X);
  return numerator * 10n ** BigInt(-X) >= denominator;
}

function findExponent(numerator: bigint, denominator: bigint, absValue: number): number {
  if (numerator === 0n) return 0;
  let X = Math.floor(Math.log10(absValue));
  if (!Number.isFinite(X)) X = 0;
  while (!geTenPow(numerator, denominator, X)) X--;
  while (geTenPow(numerator, denominator, X + 1)) X++;
  return X;
}

function eStyleDigits(
  numerator: bigint,
  denominator: bigint,
  precision: number,
  absValue: number
): { X: number; digits: string } {
  if (numerator === 0n) {
    return { X: 0, digits: '0'.repeat(precision + 1) };
  }
  let X = findExponent(numerator, denominator, absValue);
  const shift = precision - X;
  let scaledNum: bigint;
  let denom: bigint;
  if (shift >= 0) {
    scaledNum = numerator * 10n ** BigInt(shift);
    denom = denominator;
  } else {
    scaledNum = numerator;
    denom = denominator * 10n ** BigInt(-shift);
  }
  let q = roundHalfEven(scaledNum, denom);
  const maxQ = 10n ** BigInt(precision + 1);
  if (q >= maxQ) {
    q = q / 10n;
    X += 1;
  }
  const digits = q.toString().padStart(precision + 1, '0');
  return { X, digits };
}

function fStyleDigits(
  numerator: bigint,
  denominator: bigint,
  precision: number
): { intPart: string; fracPart: string } {
  const scaledNum = numerator * 10n ** BigInt(precision);
  const q = roundHalfEven(scaledNum, denominator);
  const s = q.toString().padStart(precision + 1, '0');
  const intPart = s.slice(0, s.length - precision) || '0';
  const fracPart = precision > 0 ? s.slice(s.length - precision) : '';
  return { intPart, fracPart };
}

function joinFrac(fracPart: string, hash: boolean, strip: boolean): string {
  let frac = fracPart;
  if (strip && !hash) frac = frac.replace(/0+$/, '');
  if (frac.length > 0) return '.' + frac;
  return hash ? '.' : '';
}

function toBigIntValue(v: number | bigint): bigint {
  return typeof v === 'bigint' ? v : BigInt(v);
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  const re = /%([-+0# ]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc%])/g;
  let result = '';
  let lastIndex = 0;
  let argIndex = 0;
  let m: RegExpExecArray | null;

  while ((m = re.exec(fmt)) !== null) {
    result += fmt.slice(lastIndex, m.index);
    lastIndex = re.lastIndex;

    const [, flagStr, widthStr, precStr, conv] = m;

    if (conv === '%') {
      result += '%';
      continue;
    }

    const flags = parseFlags(flagStr);
    const width = widthStr === '' ? 0 : parseInt(widthStr, 10);
    const precision = precStr === undefined ? undefined : precStr === '' ? 0 : parseInt(precStr, 10);

    const arg = args[argIndex++];

    if (conv === 'd' || conv === 'i') {
      const v = toBigIntValue(arg as number | bigint);
      const isNeg = v < 0n;
      const mag = isNeg ? -v : v;
      let digits = mag.toString();
      if (precision !== undefined) {
        if (precision === 0 && mag === 0n) {
          digits = '';
        } else {
          digits = digits.padStart(precision, '0');
        }
      }
      const sign = isNeg ? '-' : flags.plus ? '+' : flags.space ? ' ' : '';
      const zeroPad = !flags.leftAlign && flags.zero && precision === undefined;
      result += applyWidth(sign, '', digits, width, flags.leftAlign, zeroPad);
    } else if (conv === 'x' || conv === 'X' || conv === 'o') {
      const v = toBigIntValue(arg as number | bigint);
      const radix = conv === 'o' ? 8 : 16;
      let digits = v.toString(radix);
      if (conv === 'X') digits = digits.toUpperCase();
      if (precision !== undefined) {
        if (precision === 0 && v === 0n) {
          digits = '';
        } else {
          digits = digits.padStart(precision, '0');
        }
      }
      if (flags.hash) {
        if (conv === 'o') {
          if (digits === '' || digits[0] !== '0') {
            digits = '0' + digits;
          }
        }
      }
      let prefix = '';
      if (flags.hash && (conv === 'x' || conv === 'X') && v !== 0n) {
        prefix = conv === 'X' ? '0X' : '0x';
      }
      const zeroPad = !flags.leftAlign && flags.zero && precision === undefined;
      result += applyWidth('', prefix, digits, width, flags.leftAlign, zeroPad);
    } else if (conv === 'e' || conv === 'E' || conv === 'f' || conv === 'F' || conv === 'g' || conv === 'G') {
      const value = arg as number;
      const uppercase = conv === 'E' || conv === 'F' || conv === 'G';
      const isNaNVal = Number.isNaN(value);
      const isInf = !isNaNVal && !Number.isFinite(value);
      const isNegative = isNaNVal ? false : value < 0 || Object.is(value, -0);
      const sign = isNegative ? '-' : flags.plus ? '+' : flags.space ? ' ' : '';

      let digits: string;
      let zeroPad = !flags.leftAlign && flags.zero;

      if (isNaNVal) {
        digits = uppercase ? 'NAN' : 'nan';
        zeroPad = false;
      } else if (isInf) {
        digits = uppercase ? 'INF' : 'inf';
        zeroPad = false;
      } else {
        const absValue = Math.abs(value);
        const { numerator, denominator } = decompose(absValue);

        if (conv === 'e' || conv === 'E') {
          const precision = precStr === undefined ? 6 : precStr === '' ? 0 : parseInt(precStr, 10);
          const { X, digits: dstr } = eStyleDigits(numerator, denominator, precision, absValue);
          const expLetter = uppercase ? 'E' : 'e';
          const expSign = X >= 0 ? '+' : '-';
          const expAbs = Math.abs(X).toString().padStart(2, '0');
          const mantFirst = dstr[0];
          const mantRest = dstr.slice(1);
          digits = mantFirst + joinFrac(mantRest, flags.hash, false) + expLetter + expSign + expAbs;
        } else if (conv === 'f' || conv === 'F') {
          const precision = precStr === undefined ? 6 : precStr === '' ? 0 : parseInt(precStr, 10);
          const { intPart, fracPart } = fStyleDigits(numerator, denominator, precision);
          digits = intPart + joinFrac(fracPart, flags.hash, false);
        } else {
          const precRaw = precStr === undefined ? 6 : precStr === '' ? 0 : parseInt(precStr, 10);
          const P = precRaw === 0 ? 1 : precRaw;
          const { X, digits: dstr } = eStyleDigits(numerator, denominator, P - 1, absValue);
          const expLetter = conv === 'G' ? 'E' : 'e';
          if (P > X && X >= -4) {
            const fprecision = P - 1 - X;
            const { intPart, fracPart } = fStyleDigits(numerator, denominator, fprecision);
            digits = intPart + joinFrac(fracPart, flags.hash, true);
          } else {
            const mantFirst = dstr[0];
            const mantRest = dstr.slice(1);
            const expSign = X >= 0 ? '+' : '-';
            const expAbs = Math.abs(X).toString().padStart(2, '0');
            digits = mantFirst + joinFrac(mantRest, flags.hash, true) + expLetter + expSign + expAbs;
          }
        }
      }

      result += applyWidth(sign, '', digits, width, flags.leftAlign, zeroPad);
    } else if (conv === 's') {
      let str = arg as string;
      if (precision !== undefined) str = str.slice(0, precision);
      result += applyWidth('', '', str, width, flags.leftAlign, false);
    } else if (conv === 'c') {
      const str = arg as string;
      result += applyWidth('', '', str, width, flags.leftAlign, false);
    }
  }

  result += fmt.slice(lastIndex);
  return result;
}
