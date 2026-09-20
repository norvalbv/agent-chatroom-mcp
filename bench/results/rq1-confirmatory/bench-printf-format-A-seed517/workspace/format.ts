function roundRatioToEven(num: bigint, den: bigint): bigint {
  const q = num / den;
  const r = num - q * den;
  const twiceR = r * 2n;
  if (twiceR < den) return q;
  if (twiceR > den) return q + 1n;
  return q % 2n === 0n ? q : q + 1n;
}

// Returns round(mantissa * 2^exponent * 10^n), ties to even, exact.
function scaledRound(mantissa: bigint, exponent: number, n: number): bigint {
  let num = mantissa;
  let den = 1n;
  if (n >= 0) {
    num *= 5n ** BigInt(n);
  } else {
    den *= 5n ** BigInt(-n);
  }
  const p = exponent + n;
  if (p >= 0) {
    num *= 2n ** BigInt(p);
  } else {
    den *= 2n ** BigInt(-p);
  }
  return roundRatioToEven(num, den);
}

function decomposeDouble(x: number): { mantissa: bigint; exponent: number } {
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  const mantHigh = hi & 0xfffff;
  const mantissaBits = (BigInt(mantHigh) << 32n) | BigInt(lo >>> 0);
  if (expBits === 0) {
    return { mantissa: mantissaBits, exponent: -1074 };
  }
  return { mantissa: mantissaBits | (1n << 52n), exponent: expBits - 1075 };
}

function fDigits(mantissa: bigint, exponent: number, precision: number): { int: string; frac: string } {
  const r = scaledRound(mantissa, exponent, precision);
  let s = r.toString();
  if (precision === 0) return { int: s, frac: '' };
  if (s.length <= precision) s = s.padStart(precision + 1, '0');
  return { int: s.slice(0, s.length - precision), frac: s.slice(s.length - precision) };
}

function eDigits(
  mantissa: bigint,
  exponent: number,
  precision: number,
  approxValue: number
): { digit0: string; frac: string; exp: number } {
  let exp10 = Math.floor(Math.log10(approxValue));
  const low = 10n ** BigInt(precision);
  const high = 10n ** BigInt(precision + 1);
  let r = scaledRound(mantissa, exponent, precision - exp10);
  while (r >= high) {
    exp10++;
    r = scaledRound(mantissa, exponent, precision - exp10);
  }
  while (r < low) {
    exp10--;
    r = scaledRound(mantissa, exponent, precision - exp10);
  }
  const s = r.toString().padStart(precision + 1, '0');
  return { digit0: s.slice(0, 1), frac: s.slice(1), exp: exp10 };
}

function fixedDigitsStr(int: string, frac: string, precision: number, hasHash: boolean): string {
  return int + (precision > 0 || hasHash ? '.' + frac : '');
}

function expDigitsStr(
  digit0: string,
  frac: string,
  precision: number,
  hasHash: boolean,
  exp: number,
  letter: string
): string {
  const fracPart = precision > 0 || hasHash ? '.' + frac : '';
  const expSign = exp < 0 ? '-' : '+';
  const expAbs = Math.abs(exp).toString().padStart(2, '0');
  return digit0 + fracPart + letter + expSign + expAbs;
}

function stripTrailingZerosG(s: string, expLetterIndex: number): string {
  let mantissaPart = expLetterIndex >= 0 ? s.slice(0, expLetterIndex) : s;
  const expPart = expLetterIndex >= 0 ? s.slice(expLetterIndex) : '';
  if (mantissaPart.includes('.')) {
    mantissaPart = mantissaPart.replace(/0+$/, '');
    mantissaPart = mantissaPart.replace(/\.$/, '');
  }
  return mantissaPart + expPart;
}

function applyWidth(
  sign: string,
  prefix: string,
  digits: string,
  width: number | undefined,
  leftAlign: boolean,
  zeroFill: boolean
): string {
  const content = sign + prefix + digits;
  if (width === undefined || content.length >= width) return content;
  const padLen = width - content.length;
  if (leftAlign) return content + ' '.repeat(padLen);
  if (zeroFill) return sign + prefix + '0'.repeat(padLen) + digits;
  return ' '.repeat(padLen) + content;
}

function toBig(v: number | bigint): bigint {
  return typeof v === 'bigint' ? v : BigInt(v);
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let argIndex = 0;
  const re = /%([-+#0 ]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc%])/g;
  return fmt.replace(re, (_match, flagsStr: string, widthStr: string, precStr: string | undefined, conv: string) => {
    if (conv === '%') return '%';

    const flags = flagsStr || '';
    const leftAlign = flags.includes('-');
    const hasHash = flags.includes('#');
    const hasPlus = flags.includes('+');
    const hasSpace = flags.includes(' ');
    const hasZero = flags.includes('0');
    const width = widthStr === '' ? undefined : parseInt(widthStr, 10);
    const precisionGiven = precStr !== undefined;
    const precision = precisionGiven ? (precStr === '' ? 0 : parseInt(precStr, 10)) : undefined;

    const arg = args[argIndex++];

    switch (conv) {
      case 'd':
      case 'i': {
        const big = toBig(arg as number | bigint);
        const neg = big < 0n;
        const abs = neg ? -big : big;
        let digitsStr: string;
        if (precisionGiven) {
          if (abs === 0n && precision === 0) digitsStr = '';
          else digitsStr = abs.toString().padStart(precision as number, '0');
        } else {
          digitsStr = abs.toString();
        }
        const sign = neg ? '-' : hasPlus ? '+' : hasSpace ? ' ' : '';
        const zeroFill = hasZero && !leftAlign && !precisionGiven;
        return applyWidth(sign, '', digitsStr, width, leftAlign, zeroFill);
      }
      case 'x':
      case 'X':
      case 'o': {
        const big = toBig(arg as number | bigint);
        let digitsStr: string;
        if (precisionGiven) {
          if (big === 0n && precision === 0) digitsStr = '';
          else digitsStr = big.toString(conv === 'o' ? 8 : 16).padStart(precision as number, '0');
        } else {
          digitsStr = big.toString(conv === 'o' ? 8 : 16);
        }
        if (conv === 'X') digitsStr = digitsStr.toUpperCase();
        let prefix = '';
        if (hasHash) {
          if (conv === 'o') {
            if (digitsStr === '' || digitsStr[0] !== '0') digitsStr = '0' + digitsStr;
          } else if (big !== 0n) {
            prefix = conv === 'X' ? '0X' : '0x';
          }
        }
        const zeroFill = hasZero && !leftAlign && !precisionGiven;
        return applyWidth('', prefix, digitsStr, width, leftAlign, zeroFill);
      }
      case 'e':
      case 'E':
      case 'f':
      case 'F':
      case 'g':
      case 'G': {
        const value = arg as number;
        const isUpper = conv === 'E' || conv === 'F' || conv === 'G';
        const isNegSign = Object.is(value, -0) || value < 0;
        const sign = Number.isNaN(value) ? '' : isNegSign ? '-' : hasPlus ? '+' : hasSpace ? ' ' : '';

        if (Number.isNaN(value)) {
          return applyWidth('', '', isUpper ? 'NAN' : 'nan', width, leftAlign, false);
        }
        if (!Number.isFinite(value)) {
          return applyWidth(sign, '', isUpper ? 'INF' : 'inf', width, leftAlign, false);
        }

        const absValue = Math.abs(value);
        const prec6 = precisionGiven ? (precision as number) : 6;

        if (conv === 'f' || conv === 'F') {
          let int: string, frac: string;
          if (absValue === 0) {
            int = '0';
            frac = '0'.repeat(prec6);
          } else {
            const { mantissa, exponent } = decomposeDouble(absValue);
            ({ int, frac } = fDigits(mantissa, exponent, prec6));
          }
          const digitsOut = fixedDigitsStr(int, frac, prec6, hasHash);
          return applyWidth(sign, '', digitsOut, width, leftAlign, hasZero && !leftAlign);
        }

        if (conv === 'e' || conv === 'E') {
          let digit0: string, frac: string, exp: number;
          if (absValue === 0) {
            digit0 = '0';
            frac = '0'.repeat(prec6);
            exp = 0;
          } else {
            const { mantissa, exponent } = decomposeDouble(absValue);
            ({ digit0, frac, exp } = eDigits(mantissa, exponent, prec6, absValue));
          }
          const letter = conv === 'E' ? 'E' : 'e';
          const digitsOut = expDigitsStr(digit0, frac, prec6, hasHash, exp, letter);
          return applyWidth(sign, '', digitsOut, width, leftAlign, hasZero && !leftAlign);
        }

        // g, G
        const p = precisionGiven ? (precision === 0 ? 1 : (precision as number)) : 6;
        const letter = conv === 'G' ? 'E' : 'e';
        let digitsOut: string;
        if (absValue === 0) {
          const fprecision = p - 1;
          const built = fixedDigitsStr('0', '0'.repeat(fprecision), fprecision, true);
          digitsOut = hasHash ? built : stripTrailingZerosG(built, -1);
        } else {
          const { mantissa, exponent } = decomposeDouble(absValue);
          const { digit0, frac, exp: X } = eDigits(mantissa, exponent, p - 1, absValue);
          if (p > X && X >= -4) {
            const fprecision = p - 1 - X;
            const { int, frac: f2 } = fDigits(mantissa, exponent, fprecision);
            const built = fixedDigitsStr(int, f2, fprecision, true);
            digitsOut = hasHash ? built : stripTrailingZerosG(built, -1);
          } else {
            const built = expDigitsStr(digit0, frac, p - 1, true, X, letter);
            if (hasHash) {
              digitsOut = built;
            } else {
              const eIdx = built.indexOf(letter);
              digitsOut = stripTrailingZerosG(built, eIdx);
            }
          }
        }
        return applyWidth(sign, '', digitsOut, width, leftAlign, hasZero && !leftAlign);
      }
      case 's': {
        let str = arg as string;
        if (precisionGiven) str = str.slice(0, precision as number);
        return applyWidth('', '', str, width, leftAlign, false);
      }
      case 'c': {
        const str = arg as string;
        return applyWidth('', '', str, width, leftAlign, false);
      }
      default:
        return _match;
    }
  });
}
