type Arg = number | bigint | string;

function decodeDouble(x: number): { m: bigint; e: number } {
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  const mantHi = hi & 0xfffff;
  const mantissa = (BigInt(mantHi) << 32n) | BigInt(lo >>> 0);
  if (expBits === 0) {
    return { m: mantissa, e: -1074 };
  }
  return { m: mantissa | (1n << 52n), e: expBits - 1075 };
}

// round(|value| * 10^s) using round-half-to-even, where value = m * 2^e
function roundScale(m: bigint, e: number, s: number): bigint {
  if (m === 0n) return 0n;
  const exponent2 = e + s;
  const exponent5 = s;
  let numerator = m;
  let denominator = 1n;
  if (exponent2 >= 0) numerator *= 2n ** BigInt(exponent2);
  else denominator *= 2n ** BigInt(-exponent2);
  if (exponent5 >= 0) numerator *= 5n ** BigInt(exponent5);
  else denominator *= 5n ** BigInt(-exponent5);
  const q = numerator / denominator;
  const r = numerator % denominator;
  const twice = r * 2n;
  if (twice < denominator) return q;
  if (twice > denominator) return q + 1n;
  return q % 2n === 0n ? q : q + 1n;
}

function toBigInt(a: Arg): bigint {
  return typeof a === 'bigint' ? a : BigInt(a as number);
}

function applyIntPrecision(digits: string, precision: number | undefined, isZero: boolean): string {
  if (precision === undefined) return digits;
  if (precision === 0 && isZero) return '';
  if (digits.length < precision) return '0'.repeat(precision - digits.length) + digits;
  return digits;
}

function pad(sign: string, prefix: string, digits: string, width: number, zeroFlag: boolean, dashFlag: boolean): string {
  const core = sign + prefix + digits;
  if (core.length >= width) return core;
  const padLen = width - core.length;
  if (dashFlag) return core + ' '.repeat(padLen);
  if (zeroFlag) return sign + prefix + '0'.repeat(padLen) + digits;
  return ' '.repeat(padLen) + core;
}

function signChar(negative: boolean, plusFlag: boolean, spaceFlag: boolean): string {
  if (negative) return '-';
  if (plusFlag) return '+';
  if (spaceFlag) return ' ';
  return '';
}

function stripTrailingZeros(mantissa: string): string {
  if (!mantissa.includes('.')) return mantissa;
  let s = mantissa.replace(/0+$/, '');
  if (s.endsWith('.')) s = s.slice(0, -1);
  return s;
}

// Find X (decimal exponent in e-style with p digits after point) and the
// (p+1)-digit rounded significant-digit string for a nonzero finite x.
function eStyleDigits(m: bigint, e: number, x: number, p: number): { X: number; digitStr: string } {
  let X = Math.floor(Math.log10(Math.abs(x)));
  const low = 10n ** BigInt(p);
  const high = 10n ** BigInt(p + 1);
  let digitsBig = roundScale(m, e, p - X);
  while (digitsBig >= high) {
    X += 1;
    digitsBig = roundScale(m, e, p - X);
  }
  while (digitsBig < low) {
    X -= 1;
    digitsBig = roundScale(m, e, p - X);
  }
  return { X, digitStr: digitsBig.toString() };
}

function fStyleBody(m: bigint, e: number, p: number, isZero: boolean, altFlag: boolean): string {
  let intPart: string;
  let fracPart: string;
  if (isZero) {
    intPart = '0';
    fracPart = '0'.repeat(p);
  } else {
    const N = roundScale(m, e, p);
    const scale = 10n ** BigInt(p);
    intPart = (N / scale).toString();
    fracPart = (N % scale).toString().padStart(p, '0');
  }
  if (p === 0) return intPart + (altFlag ? '.' : '');
  return intPart + '.' + fracPart;
}

export function format(fmt: string, ...args: Arg[]): string {
  const re = /%([-+0 #]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc%])/g;
  let result = '';
  let lastIndex = 0;
  let argIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = re.exec(fmt)) !== null) {
    result += fmt.slice(lastIndex, match.index);
    lastIndex = re.lastIndex;

    const [, flagsStr, widthStr, precisionStr, conv] = match;

    if (conv === '%') {
      result += '%';
      continue;
    }

    const dashFlag = flagsStr.includes('-');
    const plusFlag = flagsStr.includes('+');
    const spaceFlag = flagsStr.includes(' ');
    const zeroFlagRaw = flagsStr.includes('0');
    const altFlag = flagsStr.includes('#');
    const width = widthStr === '' ? undefined : parseInt(widthStr, 10);
    const precision = precisionStr === undefined ? undefined : precisionStr === '' ? 0 : parseInt(precisionStr, 10);

    const arg = args[argIndex++];

    let out: string;

    if (conv === 'd' || conv === 'i') {
      const bi = toBigInt(arg);
      const negative = bi < 0n;
      const abs = negative ? -bi : bi;
      const isZero = abs === 0n;
      let digits = applyIntPrecision(abs.toString(), precision, isZero);
      const sign = signChar(negative, plusFlag, spaceFlag);
      const zeroFlag = zeroFlagRaw && !dashFlag && precision === undefined;
      out = width !== undefined ? pad(sign, '', digits, width, zeroFlag, dashFlag) : sign + digits;
    } else if (conv === 'x' || conv === 'X' || conv === 'o') {
      const bi = toBigInt(arg);
      const isZero = bi === 0n;
      let digits = bi.toString(conv === 'o' ? 8 : 16);
      if (conv === 'X') digits = digits.toUpperCase();
      digits = applyIntPrecision(digits, precision, isZero);
      let prefix = '';
      if (altFlag) {
        if (conv === 'o') {
          if (digits.length === 0 || digits[0] !== '0') digits = '0' + digits;
        } else if (!isZero) {
          prefix = conv === 'X' ? '0X' : '0x';
        }
      }
      const zeroFlag = zeroFlagRaw && !dashFlag && precision === undefined;
      out = width !== undefined ? pad('', prefix, digits, width, zeroFlag, dashFlag) : prefix + digits;
    } else if (conv === 's') {
      let text = String(arg);
      if (precision !== undefined) text = text.slice(0, precision);
      out = width !== undefined ? pad('', '', text, width, false, dashFlag) : text;
    } else if (conv === 'c') {
      const text = String(arg);
      out = width !== undefined ? pad('', '', text, width, false, dashFlag) : text;
    } else {
      // e E f F g G
      const x = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      if (Number.isNaN(x)) {
        const text = upper ? 'NAN' : 'nan';
        out = width !== undefined ? pad('', '', text, width, false, dashFlag) : text;
      } else {
        const negative = x < 0 || Object.is(x, -0);
        const sign = signChar(negative, plusFlag, spaceFlag);
        if (!Number.isFinite(x)) {
          const text = upper ? 'INF' : 'inf';
          out = width !== undefined ? pad(sign, '', text, width, false, dashFlag) : sign + text;
        } else {
          const isZero = x === 0;
          const { m, e } = isZero ? { m: 0n, e: 0 } : decodeDouble(x);
          let body: string;

          if (conv === 'e' || conv === 'E') {
            const p = precision === undefined ? 6 : precision;
            let X: number;
            let digitStr: string;
            if (isZero) {
              X = 0;
              digitStr = '0'.repeat(p + 1);
            } else {
              const r = eStyleDigits(m, e, x, p);
              X = r.X;
              digitStr = r.digitStr;
            }
            const intDigit = digitStr[0];
            const fracDigits = digitStr.slice(1);
            const mantissa = p === 0 ? intDigit + (altFlag ? '.' : '') : intDigit + '.' + fracDigits;
            const expSign = X < 0 ? '-' : '+';
            const expStr = Math.abs(X).toString().padStart(2, '0');
            body = mantissa + (conv === 'E' ? 'E' : 'e') + expSign + expStr;
          } else if (conv === 'f' || conv === 'F') {
            const p = precision === undefined ? 6 : precision;
            body = fStyleBody(m, e, p, isZero, altFlag);
          } else {
            // g G
            let P = precision === undefined ? 6 : precision;
            if (P === 0) P = 1;
            let X: number;
            let digitStr: string;
            if (isZero) {
              X = 0;
              digitStr = '0'.repeat(P);
            } else {
              const r = eStyleDigits(m, e, x, P - 1);
              X = r.X;
              digitStr = r.digitStr;
            }
            if (P > X && X >= -4) {
              const fp = P - 1 - X;
              let fbody = fStyleBody(m, e, fp, isZero, altFlag);
              if (!altFlag) fbody = stripTrailingZeros(fbody);
              body = fbody;
            } else {
              const ep = P - 1;
              const intDigit = digitStr[0];
              const fracDigits = digitStr.slice(1);
              let mantissa = ep === 0 ? intDigit + (altFlag ? '.' : '') : intDigit + '.' + fracDigits;
              if (!altFlag) mantissa = stripTrailingZeros(mantissa);
              const expSign = X < 0 ? '-' : '+';
              const expStr = Math.abs(X).toString().padStart(2, '0');
              body = mantissa + (conv === 'G' ? 'E' : 'e') + expSign + expStr;
            }
          }

          const zeroFlag = zeroFlagRaw && !dashFlag;
          out = width !== undefined ? pad(sign, '', body, width, zeroFlag, dashFlag) : sign + body;
        }
      }
    }

    result += out;
  }

  result += fmt.slice(lastIndex);
  return result;
}
