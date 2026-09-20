type Decomposed = { mantissa: bigint; exp: number };

function decomposeDouble(x: number): Decomposed {
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setFloat64(0, x);
  const hi = view.getUint32(0);
  const lo = view.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  const fracHi = hi & 0xfffff;
  const fracBig = (BigInt(fracHi) << 32n) | BigInt(lo);
  let mantissa: bigint;
  let exp: number;
  if (expBits === 0) {
    mantissa = fracBig;
    exp = 1 - 1023 - 52;
  } else {
    mantissa = fracBig | (1n << 52n);
    exp = expBits - 1023 - 52;
  }
  return { mantissa, exp };
}

// Returns N, D (bigints, D > 0) such that |x| === N / D exactly.
function exactFraction(x: number): { N: bigint; D: bigint } {
  const { mantissa, exp } = decomposeDouble(Math.abs(x));
  if (exp >= 0) return { N: mantissa << BigInt(exp), D: 1n };
  return { N: mantissa, D: 1n << BigInt(-exp) };
}

// Rounds N/D * 10^k to the nearest integer, ties to even. k may be negative.
function scaledRound(N: bigint, D: bigint, k: number): bigint {
  let num: bigint;
  let den: bigint;
  if (k >= 0) {
    num = N * 10n ** BigInt(k);
    den = D;
  } else {
    num = N;
    den = D * 10n ** BigInt(-k);
  }
  if (num === 0n) return 0n;
  let q = num / den;
  const r = num % den;
  const twiceR = r * 2n;
  if (twiceR > den) q += 1n;
  else if (twiceR === den && q % 2n !== 0n) q += 1n;
  return q;
}

function formatFixedDigits(N: bigint, D: bigint, p: number): { intPart: string; fracPart: string } {
  const scaled = scaledRound(N, D, p);
  let s = scaled.toString();
  if (s.length <= p) s = s.padStart(p + 1, '0');
  if (p === 0) return { intPart: s, fracPart: '' };
  return { intPart: s.slice(0, s.length - p), fracPart: s.slice(s.length - p) };
}

function eStyleDigits(N: bigint, D: bigint, p: number, magnitude: number): { digits: string; exp: number } {
  const n = p + 1;
  if (N === 0n) return { digits: '0'.repeat(n), exp: 0 };

  const ge = (e: number): boolean => {
    if (e >= 0) return N >= D * 10n ** BigInt(e);
    return N * 10n ** BigInt(-e) >= D;
  };

  let E = Math.floor(Math.log10(magnitude));
  let guard = 0;
  while (!ge(E) && guard++ < 2000) E--;
  guard = 0;
  while (ge(E + 1) && guard++ < 2000) E++;

  const k = n - 1 - E;
  let digitsBig = scaledRound(N, D, k);
  let digitsStr = digitsBig.toString();
  if (digitsStr.length > n) {
    E += digitsStr.length - n;
    digitsStr = digitsStr.slice(0, n);
  } else if (digitsStr.length < n) {
    digitsStr = digitsStr.padStart(n, '0');
  }
  return { digits: digitsStr, exp: E };
}

function trimTrailingZeros(s: string): string {
  return s.replace(/0+$/, '');
}

function padNum(body: string, width: number | undefined, leftAlign: boolean, zeroFlag: boolean, prefixLen: number): string {
  if (width === undefined || body.length >= width) return body;
  if (leftAlign) return body + ' '.repeat(width - body.length);
  if (zeroFlag) return body.slice(0, prefixLen) + '0'.repeat(width - body.length) + body.slice(prefixLen);
  return ' '.repeat(width - body.length) + body;
}

function toBigIntArg(arg: number | bigint | string): bigint {
  return typeof arg === 'bigint' ? arg : BigInt(arg as number);
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  const specRe = /%([-+ 0#]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc%])/g;
  let result = '';
  let lastIndex = 0;
  let argIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = specRe.exec(fmt)) !== null) {
    result += fmt.slice(lastIndex, match.index);
    lastIndex = specRe.lastIndex;

    const [, flagsStr, widthStr, precStr, conversion] = match;

    if (conversion === '%') {
      result += '%';
      continue;
    }

    const leftAlign = flagsStr.includes('-');
    const plusFlag = flagsStr.includes('+');
    const spaceFlag = flagsStr.includes(' ');
    const zeroFlag = flagsStr.includes('0');
    const hashFlag = flagsStr.includes('#');
    const width = widthStr === '' ? undefined : parseInt(widthStr, 10);
    const precision = precStr === undefined ? undefined : precStr === '' ? 0 : parseInt(precStr, 10);

    if (conversion === 'd' || conversion === 'i') {
      const big = toBigIntArg(args[argIndex++]);
      const negative = big < 0n;
      const mag = negative ? -big : big;
      let digits = mag.toString();
      if (precision !== undefined) {
        digits = precision === 0 && mag === 0n ? '' : digits.padStart(precision, '0');
      }
      const sign = negative ? '-' : plusFlag ? '+' : spaceFlag ? ' ' : '';
      const body = sign + digits;
      const zeroEffective = zeroFlag && !leftAlign && precision === undefined;
      result += padNum(body, width, leftAlign, zeroEffective, sign.length);
      continue;
    }

    if (conversion === 'x' || conversion === 'X' || conversion === 'o') {
      const mag = toBigIntArg(args[argIndex++]);
      const base = conversion === 'o' ? 8 : 16;
      let digits = mag.toString(base);
      if (conversion === 'X') digits = digits.toUpperCase();
      if (precision !== undefined) {
        digits = precision === 0 && mag === 0n ? '' : digits.padStart(precision, '0');
      }

      let prefix = '';
      if (conversion === 'o') {
        if (hashFlag && (digits.length === 0 || digits[0] !== '0')) digits = '0' + digits;
      } else {
        if (hashFlag && mag !== 0n) prefix = conversion === 'x' ? '0x' : '0X';
      }

      const body = prefix + digits;
      const zeroEffective = zeroFlag && !leftAlign && precision === undefined;
      result += padNum(body, width, leftAlign, zeroEffective, prefix.length);
      continue;
    }

    if (conversion === 'e' || conversion === 'E' || conversion === 'f' || conversion === 'F' || conversion === 'g' || conversion === 'G') {
      const arg = args[argIndex++] as number;
      const isUpper = conversion === conversion.toUpperCase();
      const isNaNVal = Number.isNaN(arg);
      const isInf = !isNaNVal && !Number.isFinite(arg);
      const negative = !isNaNVal && (arg < 0 || Object.is(arg, -0));
      const signStr = isNaNVal ? '' : negative ? '-' : plusFlag ? '+' : spaceFlag ? ' ' : '';

      let bodyText: string;
      let zeroEffective: boolean;

      if (isNaNVal) {
        bodyText = isUpper ? 'NAN' : 'nan';
        zeroEffective = false;
      } else if (isInf) {
        bodyText = isUpper ? 'INF' : 'inf';
        zeroEffective = false;
      } else {
        const magnitude = Math.abs(arg);
        const { N, D } = exactFraction(arg);
        zeroEffective = zeroFlag && !leftAlign;

        if (conversion === 'f' || conversion === 'F') {
          const p = precision ?? 6;
          const { intPart, fracPart } = formatFixedDigits(N, D, p);
          bodyText = p > 0 || hashFlag ? intPart + '.' + fracPart : intPart;
        } else if (conversion === 'e' || conversion === 'E') {
          const p = precision ?? 6;
          const { digits, exp } = eStyleDigits(N, D, p, magnitude);
          const frac = digits.slice(1);
          const mantissaStr = p > 0 || hashFlag ? digits[0] + '.' + frac : digits[0];
          const expSign = exp < 0 ? '-' : '+';
          const expAbs = Math.abs(exp).toString().padStart(2, '0');
          bodyText = mantissaStr + (isUpper ? 'E' : 'e') + expSign + expAbs;
        } else {
          let P = precision ?? 6;
          if (P === 0) P = 1;
          const { digits: eDigits, exp: X } = eStyleDigits(N, D, P - 1, magnitude);

          if (P > X && X >= -4) {
            const fPrec = P - 1 - X;
            const { intPart, fracPart } = formatFixedDigits(N, D, fPrec);
            if (hashFlag) {
              bodyText = fPrec > 0 ? intPart + '.' + fracPart : intPart + '.';
            } else {
              const trimmed = trimTrailingZeros(fracPart);
              bodyText = trimmed.length > 0 ? intPart + '.' + trimmed : intPart;
            }
          } else {
            const mantissaDigit = eDigits[0];
            const frac = eDigits.slice(1);
            let mantissaStr: string;
            if (hashFlag) {
              mantissaStr = frac.length > 0 ? mantissaDigit + '.' + frac : mantissaDigit + '.';
            } else {
              const trimmed = trimTrailingZeros(frac);
              mantissaStr = trimmed.length > 0 ? mantissaDigit + '.' + trimmed : mantissaDigit;
            }
            const expSign = X < 0 ? '-' : '+';
            const expAbs = Math.abs(X).toString().padStart(2, '0');
            bodyText = mantissaStr + (isUpper ? 'E' : 'e') + expSign + expAbs;
          }
        }
      }

      const fullBody = signStr + bodyText;
      result += padNum(fullBody, width, leftAlign, zeroEffective, signStr.length);
      continue;
    }

    if (conversion === 's') {
      let str = args[argIndex++] as string;
      if (precision !== undefined) str = str.slice(0, precision);
      result += padNum(str, width, leftAlign, false, 0);
      continue;
    }

    if (conversion === 'c') {
      const str = args[argIndex++] as string;
      result += padNum(str, width, leftAlign, false, 0);
      continue;
    }
  }

  result += fmt.slice(lastIndex);
  return result;
}
