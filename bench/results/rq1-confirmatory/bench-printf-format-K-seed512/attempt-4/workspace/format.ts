// Exact-rounding printf-style formatter. All decimal rounding is performed
// on the exact binary value of the double (via BigInt rational arithmetic),
// using round-to-nearest, ties-to-even.

function decompose(x: number): { M: bigint; binExp: bigint } {
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setFloat64(0, x);
  const hi = BigInt(dv.getUint32(0));
  const lo = BigInt(dv.getUint32(4));
  const bits = (hi << 32n) | lo;
  const exp = (bits >> 52n) & 0x7ffn;
  const frac = bits & 0xfffffffffffffn;
  if (exp === 0n) {
    return { M: frac, binExp: -1074n };
  }
  return { M: frac | (1n << 52n), binExp: exp - 1075n };
}

// round(M * 2^binExp * 10^n), ties-to-even, M >= 0.
function scaledRound(M: bigint, binExp: bigint, n: bigint): bigint {
  const p2 = binExp + n;
  const p5 = n;
  const numPow2 = p2 > 0n ? p2 : 0n;
  const denPow2 = p2 < 0n ? -p2 : 0n;
  const numPow5 = p5 > 0n ? p5 : 0n;
  const denPow5 = p5 < 0n ? -p5 : 0n;
  const numerator = M * 2n ** numPow2 * 5n ** numPow5;
  const denominator = 2n ** denPow2 * 5n ** denPow5;
  let q = numerator / denominator;
  const r = numerator % denominator;
  const twice = r * 2n;
  if (twice > denominator) q += 1n;
  else if (twice === denominator && q % 2n === 1n) q += 1n;
  return q;
}

function fStyleCompute(absVal: number, precision: number): { intPart: string; fracPart: string } {
  const { M, binExp } = decompose(absVal);
  const D = scaledRound(M, binExp, BigInt(precision));
  let s = D.toString();
  if (s.length <= precision) s = s.padStart(precision + 1, '0');
  const intPart = precision > 0 ? s.slice(0, s.length - precision) : s;
  const fracPart = precision > 0 ? s.slice(s.length - precision) : '';
  return { intPart, fracPart };
}

function eStyleCompute(absVal: number, precision: number): { digits: string; exponent: number } {
  if (absVal === 0) {
    return { digits: '0'.repeat(precision + 1), exponent: 0 };
  }
  const { M, binExp } = decompose(absVal);
  let e0 = Math.floor(Math.log10(absVal));
  const p = BigInt(precision);
  let D = scaledRound(M, binExp, p - BigInt(e0));
  const powP = 10n ** p;
  const powP1 = powP * 10n;
  while (D >= powP1) {
    e0 += 1;
    D = scaledRound(M, binExp, p - BigInt(e0));
  }
  while (D < powP) {
    e0 -= 1;
    D = scaledRound(M, binExp, p - BigInt(e0));
  }
  return { digits: D.toString(), exponent: e0 };
}

function fracSection(fracPart: string, hashFlag: boolean): string {
  if (hashFlag) return '.' + fracPart;
  const stripped = fracPart.replace(/0+$/, '');
  return stripped.length > 0 ? '.' + stripped : '';
}

function gStyleText(absVal: number, P: number, hashFlag: boolean, upper: boolean): string {
  if (absVal === 0) {
    const fprecision = P - 1;
    const { intPart, fracPart } = fStyleCompute(0, fprecision);
    return intPart + fracSection(fracPart, hashFlag);
  }
  const { digits, exponent: X } = eStyleCompute(absVal, P - 1);
  if (P > X && X >= -4) {
    const fprecision = P - 1 - X;
    const { intPart, fracPart } = fStyleCompute(absVal, fprecision);
    return intPart + fracSection(fracPart, hashFlag);
  }
  const first = digits[0];
  const rest = digits.slice(1);
  const expSign = X < 0 ? '-' : '+';
  const expDigits = String(Math.abs(X)).padStart(2, '0');
  return first + fracSection(rest, hashFlag) + (upper ? 'E' : 'e') + expSign + expDigits;
}

function specialText(value: number, upper: boolean): string | null {
  if (Number.isNaN(value)) return upper ? 'NAN' : 'nan';
  if (!Number.isFinite(value)) return upper ? 'INF' : 'inf';
  return null;
}

function floatSign(value: number, plusFlag: boolean, spaceFlag: boolean, isNaN: boolean): string {
  if (isNaN) return '';
  const negative = value < 0 || Object.is(value, -0);
  if (negative) return '-';
  if (plusFlag) return '+';
  if (spaceFlag) return ' ';
  return '';
}

function intDigits(absBig: bigint, precision: number | undefined, base: number): string {
  const s = absBig.toString(base);
  if (precision !== undefined) {
    if (absBig === 0n && precision === 0) return '';
    return s.padStart(precision, '0');
  }
  return s;
}

function pad(
  sign: string,
  prefix: string,
  digits: string,
  width: number | undefined,
  minusFlag: boolean,
  zeroApplies: boolean,
): string {
  const body = sign + prefix + digits;
  if (width === undefined || body.length >= width) return body;
  const padLen = width - body.length;
  if (minusFlag) return body + ' '.repeat(padLen);
  if (zeroApplies) return sign + prefix + '0'.repeat(padLen) + digits;
  return ' '.repeat(padLen) + body;
}

function padText(text: string, width: number | undefined, minusFlag: boolean): string {
  if (width === undefined || text.length >= width) return text;
  const padLen = width - text.length;
  return minusFlag ? text + ' '.repeat(padLen) : ' '.repeat(padLen) + text;
}

const SPEC_RE = /%([-+# 0]*)(\d*)(?:\.(\d*))?([a-zA-Z%])/g;

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let out = '';
  let argIdx = 0;
  let lastIndex = 0;
  SPEC_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = SPEC_RE.exec(fmt)) !== null) {
    out += fmt.slice(lastIndex, match.index);
    lastIndex = SPEC_RE.lastIndex;

    const [, flagsStr, widthStr, precisionStr, conv] = match;

    if (conv === '%') {
      out += '%';
      continue;
    }

    const minusFlag = flagsStr.includes('-');
    const plusFlag = flagsStr.includes('+');
    const spaceFlag = flagsStr.includes(' ');
    const zeroFlag = flagsStr.includes('0');
    const hashFlag = flagsStr.includes('#');
    const width = widthStr === '' ? undefined : parseInt(widthStr, 10);
    const precision = precisionStr === undefined ? undefined : precisionStr === '' ? 0 : parseInt(precisionStr, 10);

    switch (conv) {
      case 'd':
      case 'i': {
        const raw = args[argIdx++];
        const big = typeof raw === 'bigint' ? raw : BigInt(raw as number);
        const neg = big < 0n;
        const absBig = neg ? -big : big;
        const digits = intDigits(absBig, precision, 10);
        const sign = neg ? '-' : plusFlag ? '+' : spaceFlag ? ' ' : '';
        const zeroApplies = zeroFlag && !minusFlag && precision === undefined;
        out += pad(sign, '', digits, width, minusFlag, zeroApplies);
        break;
      }
      case 'x':
      case 'X':
      case 'o': {
        const raw = args[argIdx++];
        const big = typeof raw === 'bigint' ? raw : BigInt(raw as number);
        const base = conv === 'o' ? 8 : 16;
        let digits = intDigits(big, precision, base);
        if (conv === 'X') digits = digits.toUpperCase();
        if (conv === 'o' && hashFlag) {
          if (digits.length === 0 || digits[0] !== '0') digits = '0' + digits;
        }
        let prefix = '';
        if ((conv === 'x' || conv === 'X') && hashFlag && big !== 0n) {
          prefix = conv === 'x' ? '0x' : '0X';
        }
        const zeroApplies = zeroFlag && !minusFlag && precision === undefined;
        out += pad('', prefix, digits, width, minusFlag, zeroApplies);
        break;
      }
      case 'e':
      case 'E':
      case 'f':
      case 'F':
      case 'g':
      case 'G': {
        const raw = args[argIdx++] as number;
        const upper = conv === 'E' || conv === 'F' || conv === 'G';
        const isNaNVal = Number.isNaN(raw);
        const special = specialText(raw, upper);
        const sign = floatSign(raw, plusFlag, spaceFlag, isNaNVal);
        let bodyText: string;
        let zeroApplies: boolean;
        if (special !== null) {
          bodyText = special;
          zeroApplies = false;
        } else {
          const absVal = Math.abs(raw);
          if (conv === 'f' || conv === 'F') {
            const p = precision === undefined ? 6 : precision;
            const { intPart, fracPart } = fStyleCompute(absVal, p);
            bodyText = intPart + (p === 0 ? (hashFlag ? '.' : '') : '.' + fracPart);
          } else if (conv === 'e' || conv === 'E') {
            const p = precision === undefined ? 6 : precision;
            const { digits, exponent } = eStyleCompute(absVal, p);
            const first = digits[0];
            const rest = digits.slice(1);
            const fracPartText = p === 0 ? (hashFlag ? '.' : '') : '.' + rest;
            const expSign = exponent < 0 ? '-' : '+';
            const expDigits = String(Math.abs(exponent)).padStart(2, '0');
            bodyText = first + fracPartText + (upper ? 'E' : 'e') + expSign + expDigits;
          } else {
            const P = precision === undefined ? 6 : precision === 0 ? 1 : precision;
            bodyText = gStyleText(absVal, P, hashFlag, upper);
          }
          zeroApplies = zeroFlag && !minusFlag;
        }
        out += pad(sign, '', bodyText, width, minusFlag, zeroApplies);
        break;
      }
      case 's': {
        const raw = args[argIdx++] as string;
        const text = precision !== undefined ? raw.slice(0, precision) : raw;
        out += padText(text, width, minusFlag);
        break;
      }
      case 'c': {
        const raw = args[argIdx++] as string;
        out += padText(raw, width, minusFlag);
        break;
      }
    }
  }
  out += fmt.slice(lastIndex);
  return out;
}
