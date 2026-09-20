// Exact-rounding printf-style formatter. No dependencies.

function pow2(n: number): bigint {
  return 2n ** BigInt(n);
}
function pow5(n: number): bigint {
  return 5n ** BigInt(n);
}

// Returns round(f * 2^e * 10^k) with ties-to-even, computed exactly.
function roundedScaled(f: bigint, e: number, k: number): bigint {
  const a = e + k; // exponent of 2
  const b = k; // exponent of 5
  let numerator = f;
  let denominator = 1n;
  if (a >= 0) numerator *= pow2(a);
  else denominator *= pow2(-a);
  if (b >= 0) numerator *= pow5(b);
  else denominator *= pow5(-b);

  const q = numerator / denominator;
  const r = numerator % denominator;
  const twice = r * 2n;
  if (twice < denominator) return q;
  if (twice > denominator) return q + 1n;
  return q % 2n === 0n ? q : q + 1n;
}

// Decompose a finite double's magnitude into f * 2^e, f a non-negative BigInt.
function decompose(x: number): { f: bigint; e: number } {
  const abs = Math.abs(x);
  if (abs === 0) return { f: 0n, e: 0 };
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setFloat64(0, abs);
  const hi = view.getUint32(0);
  const lo = view.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  const mantHigh = BigInt(hi & 0xfffff);
  const mantLow = BigInt(lo >>> 0);
  const mantissa = (mantHigh << 32n) | mantLow;
  if (expBits === 0) {
    return { f: mantissa, e: -1074 };
  }
  return { f: mantissa | (1n << 52n), e: expBits - 1023 - 52 };
}

function isNegativeSign(x: number): boolean {
  return x < 0 || Object.is(x, -0);
}

function eStyleDigits(f: bigint, e: number, P: number): { digits: string; E: number } {
  if (f === 0n) return { digits: '0'.repeat(P), E: 0 };
  let E = Math.floor(Math.log10(Number(f)) + e * Math.log10(2));
  for (let iter = 0; iter < 5; iter++) {
    const k = P - 1 - E;
    const N = roundedScaled(f, e, k);
    const digits = N.toString();
    if (digits.length === P) return { digits, E };
    E += digits.length - P;
  }
  const k = P - 1 - E;
  const N = roundedScaled(f, e, k);
  return { digits: N.toString().padStart(P, '0').slice(0, P), E };
}

function fStyleParts(f: bigint, e: number, precision: number): { intPart: string; fracPart: string } {
  const N = roundedScaled(f, e, precision);
  const digits = N.toString().padStart(precision + 1, '0');
  if (precision === 0) return { intPart: digits, fracPart: '' };
  return { intPart: digits.slice(0, digits.length - precision), fracPart: digits.slice(digits.length - precision) };
}

function padNumeric(signStr: string, prefix: string, digits: string, width: number, zeroFlag: boolean, leftFlag: boolean): string {
  const body = signStr + prefix + digits;
  if (body.length >= width) return body;
  const padLen = width - body.length;
  if (leftFlag) return body + ' '.repeat(padLen);
  if (zeroFlag) return signStr + prefix + '0'.repeat(padLen) + digits;
  return ' '.repeat(padLen) + body;
}

function padGeneric(text: string, width: number, leftFlag: boolean): string {
  if (text.length >= width) return text;
  const pad = ' '.repeat(width - text.length);
  return leftFlag ? text + pad : pad + text;
}

interface Spec {
  flags: Set<string>;
  width: number;
  precision: number | undefined;
  conv: string;
}

function toBigIntArg(v: number | bigint): bigint {
  return typeof v === 'bigint' ? v : BigInt(v);
}

function numSign(neg: boolean, plusFlag: boolean, spaceFlag: boolean): string {
  if (neg) return '-';
  if (plusFlag) return '+';
  if (spaceFlag) return ' ';
  return '';
}

function stripTrailingZeros(intPart: string, fracPart: string, hash: boolean): string {
  if (hash) return fracPart.length > 0 ? intPart + '.' + fracPart : intPart + '.';
  if (fracPart.length === 0) return intPart;
  let end = fracPart.length;
  while (end > 0 && fracPart[end - 1] === '0') end--;
  if (end === 0) return intPart;
  return intPart + '.' + fracPart.slice(0, end);
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let result = '';
  let argIdx = 0;
  const re = /%([-+0 #]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc%])/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(fmt)) !== null) {
    result += fmt.slice(lastIndex, m.index);
    lastIndex = re.lastIndex;

    const flagsStr = m[1];
    const widthStr = m[2];
    const precStr = m[3];
    const conv = m[4];

    if (conv === '%') {
      result += '%';
      continue;
    }

    const flags = new Set(flagsStr.split(''));
    const leftFlag = flags.has('-');
    const plusFlag = flags.has('+');
    const spaceFlag = flags.has(' ');
    const zeroFlagRaw = flags.has('0');
    const hashFlag = flags.has('#');
    const width = widthStr ? parseInt(widthStr, 10) : 0;
    const precision = precStr !== undefined ? (precStr === '' ? 0 : parseInt(precStr, 10)) : undefined;

    const arg = args[argIdx++];

    let out: string;

    switch (conv) {
      case 'd':
      case 'i': {
        const big = toBigIntArg(arg as number | bigint);
        const neg = big < 0n;
        const mag = neg ? -big : big;
        let digits: string;
        if (precision !== undefined) {
          if (precision === 0 && mag === 0n) digits = '';
          else digits = mag.toString(10).padStart(precision, '0');
        } else {
          digits = mag.toString(10);
        }
        const signStr = numSign(neg, plusFlag, spaceFlag);
        const zeroFlag = zeroFlagRaw && !leftFlag && precision === undefined;
        out = padNumeric(signStr, '', digits, width, zeroFlag, leftFlag);
        break;
      }
      case 'x':
      case 'X':
      case 'o': {
        const mag = toBigIntArg(arg as number | bigint);
        const base = conv === 'o' ? 8 : 16;
        let digits: string;
        if (precision !== undefined) {
          if (precision === 0 && mag === 0n) digits = '';
          else digits = mag.toString(base).padStart(precision, '0');
        } else {
          digits = mag.toString(base);
        }
        if (conv === 'X') digits = digits.toUpperCase();
        let prefix = '';
        if (hashFlag) {
          if ((conv === 'x' || conv === 'X') && mag !== 0n) {
            prefix = conv === 'x' ? '0x' : '0X';
          } else if (conv === 'o') {
            if (digits.length === 0 || digits[0] !== '0') {
              digits = '0' + digits;
            }
          }
        }
        const zeroFlag = zeroFlagRaw && !leftFlag && precision === undefined;
        out = padNumeric('', prefix, digits, width, zeroFlag, leftFlag);
        break;
      }
      case 'e':
      case 'E':
      case 'f':
      case 'F':
      case 'g':
      case 'G': {
        const num = Number(arg);
        const upper = conv === 'E' || conv === 'F' || conv === 'G';
        if (Number.isNaN(num)) {
          const body = upper ? 'NAN' : 'nan';
          out = padNumeric('', '', body, width, false, leftFlag);
          break;
        }
        const neg = isNegativeSign(num);
        const signStr = numSign(neg, plusFlag, spaceFlag);
        if (!Number.isFinite(num)) {
          const body = upper ? 'INF' : 'inf';
          out = padNumeric(signStr, '', body, width, false, leftFlag);
          break;
        }
        const { f, e } = decompose(num);
        const lower = conv.toLowerCase();

        if (lower === 'f') {
          const prec = precision !== undefined ? precision : 6;
          const { intPart, fracPart } = fStyleParts(f, e, prec);
          const mantissa = prec > 0 || hashFlag ? intPart + '.' + fracPart : intPart;
          const zeroFlag = zeroFlagRaw && !leftFlag;
          out = padNumeric(signStr, '', mantissa, width, zeroFlag, leftFlag);
        } else if (lower === 'e') {
          const prec = precision !== undefined ? precision : 6;
          const { digits, E } = eStyleDigits(f, e, prec + 1);
          const first = digits[0];
          const rest = digits.slice(1);
          const mantissa = prec > 0 || hashFlag ? first + '.' + rest : first;
          const expChar = conv === 'E' ? 'E' : 'e';
          const expSign = E < 0 ? '-' : '+';
          const expAbs = Math.abs(E).toString().padStart(2, '0');
          const full = mantissa + expChar + expSign + expAbs;
          const zeroFlag = zeroFlagRaw && !leftFlag;
          out = padNumeric(signStr, '', full, width, zeroFlag, leftFlag);
        } else {
          // g / G
          const specified = precision !== undefined ? precision : 6;
          const P = specified === 0 ? 1 : specified;
          const { digits: pdigits, E: X } = eStyleDigits(f, e, P);
          let mantissa: string;
          let expPart = '';
          if (P > X && X >= -4) {
            const fprec = P - 1 - X;
            const { intPart, fracPart } = fStyleParts(f, e, fprec < 0 ? 0 : fprec);
            mantissa = stripTrailingZeros(intPart, fprec < 0 ? '' : fracPart, hashFlag);
          } else {
            const eprec = P - 1;
            const first = pdigits[0];
            const rest = pdigits.slice(1);
            mantissa = stripTrailingZeros(first, rest, hashFlag);
            const expChar = conv === 'G' ? 'E' : 'e';
            const expSign = X < 0 ? '-' : '+';
            const expAbs = Math.abs(X).toString().padStart(2, '0');
            expPart = expChar + expSign + expAbs;
          }
          const full = mantissa + expPart;
          const zeroFlag = zeroFlagRaw && !leftFlag;
          out = padNumeric(signStr, '', full, width, zeroFlag, leftFlag);
        }
        break;
      }
      case 's': {
        let str = arg as string;
        if (precision !== undefined) str = str.slice(0, precision);
        out = padGeneric(str, width, leftFlag);
        break;
      }
      case 'c': {
        const str = arg as string;
        out = padGeneric(str, width, leftFlag);
        break;
      }
      default:
        out = '';
    }

    result += out;
  }
  result += fmt.slice(lastIndex);
  return result;
}
