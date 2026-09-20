type Decomposed = { mantissa: bigint; exp: number };

function decomposeAbs(x: number): Decomposed {
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setFloat64(0, x);
  const hi = view.getUint32(0);
  const lo = view.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  const fracBig = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo >>> 0);
  if (expBits === 0) {
    return { mantissa: fracBig, exp: -1074 };
  }
  return { mantissa: fracBig | (1n << 52n), exp: expBits - 1075 };
}

function toFraction(x: number): { num: bigint; den: bigint } {
  const { mantissa, exp } = decomposeAbs(x);
  if (exp >= 0) {
    return { num: mantissa << BigInt(exp), den: 1n };
  }
  return { num: mantissa, den: 1n << BigInt(-exp) };
}

// round(num/den * 10^shift) with ties-to-even, num/den >= 0
function scaledRound(num: bigint, den: bigint, shift: number): bigint {
  let numerator: bigint;
  let denominator: bigint;
  if (shift >= 0) {
    numerator = num * 10n ** BigInt(shift);
    denominator = den;
  } else {
    numerator = num;
    denominator = den * 10n ** BigInt(-shift);
  }
  let q = numerator / denominator;
  const r = numerator % denominator;
  const twiceR = r * 2n;
  if (twiceR > denominator || (twiceR === denominator && q % 2n === 1n)) {
    q += 1n;
  }
  return q;
}

function ge10(num: bigint, den: bigint, k: number): boolean {
  if (k >= 0) {
    return num >= den * 10n ** BigInt(k);
  }
  return num * 10n ** BigInt(-k) >= den;
}

// Returns the P most-significant decimal digits of |value| (value > 0, finite)
// together with the decimal exponent X such that value ~= 0.d1d2...dP * 10^(X+1),
// i.e. digits[0] is the units digit of value * 10^-X.
function significantDigits(value: number, sigDigits: number): { digits: string; exp: number } {
  const { num, den } = toFraction(value);
  let est = Math.floor(Math.log10(value));
  while (!ge10(num, den, est)) est--;
  while (ge10(num, den, est + 1)) est++;
  let X = est;
  const shift = sigDigits - 1 - X;
  let D = scaledRound(num, den, shift);
  const upper = 10n ** BigInt(sigDigits);
  if (D >= upper) {
    D = D / 10n;
    X += 1;
  }
  let digits = D.toString(10);
  if (digits.length < sigDigits) digits = digits.padStart(sigDigits, '0');
  return { digits, exp: X };
}

function formatNumeric(
  sign: string,
  prefix: string,
  digits: string,
  width: number,
  leftAlign: boolean,
  zeroPad: boolean
): string {
  const core = sign + prefix + digits;
  const padLen = Math.max(0, width - core.length);
  if (padLen === 0) return core;
  if (leftAlign) return core + ' '.repeat(padLen);
  if (zeroPad) return sign + prefix + '0'.repeat(padLen) + digits;
  return ' '.repeat(padLen) + core;
}

function padPlain(str: string, width: number, leftAlign: boolean): string {
  const padLen = Math.max(0, width - str.length);
  if (padLen === 0) return str;
  return leftAlign ? str + ' '.repeat(padLen) : ' '.repeat(padLen) + str;
}

function toBigIntValue(v: number | bigint): bigint {
  return typeof v === 'bigint' ? v : BigInt(v);
}

function signForFinite(
  isNegative: boolean,
  plusFlag: boolean,
  spaceFlag: boolean
): string {
  if (isNegative) return '-';
  if (plusFlag) return '+';
  if (spaceFlag) return ' ';
  return '';
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let result = '';
  let argIndex = 0;
  const re = /%([-+0# ]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc%])/g;
  let lastEnd = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(fmt)) !== null) {
    result += fmt.slice(lastEnd, m.index);
    lastEnd = re.lastIndex;

    const flagsStr = m[1];
    const widthStr = m[2];
    const precStr = m[3];
    const conv = m[4];

    if (conv === '%') {
      result += '%';
      continue;
    }

    const leftAlign = flagsStr.includes('-');
    const plusFlag = flagsStr.includes('+');
    const spaceFlag = flagsStr.includes(' ');
    const zeroFlag = flagsStr.includes('0');
    const hashFlag = flagsStr.includes('#');
    const width = widthStr ? parseInt(widthStr, 10) : 0;
    const precisionGiven = precStr !== undefined;
    const precision = precisionGiven ? (precStr === '' ? 0 : parseInt(precStr, 10)) : undefined;

    const arg = args[argIndex++];

    if (conv === 'd' || conv === 'i') {
      const n = toBigIntValue(arg as number | bigint);
      const isNeg = n < 0n;
      const magnitude = isNeg ? -n : n;
      const sign = signForFinite(isNeg, plusFlag, spaceFlag);
      let digits: string;
      if (precision !== undefined) {
        if (precision === 0 && magnitude === 0n) {
          digits = '';
        } else {
          digits = magnitude.toString(10).padStart(precision, '0');
        }
      } else {
        digits = magnitude.toString(10);
      }
      const zeroPad = zeroFlag && !leftAlign && precision === undefined;
      result += formatNumeric(sign, '', digits, width, leftAlign, zeroPad);
      continue;
    }

    if (conv === 'x' || conv === 'X' || conv === 'o') {
      const n = toBigIntValue(arg as number | bigint);
      let digits: string;
      if (conv === 'o') {
        digits = n.toString(8);
      } else {
        digits = n.toString(16);
        if (conv === 'X') digits = digits.toUpperCase();
      }
      if (precision !== undefined) {
        if (precision === 0 && n === 0n) {
          digits = '';
        } else {
          digits = digits.padStart(precision, '0');
        }
      }
      let prefix = '';
      if (hashFlag) {
        if (conv === 'o') {
          if (digits.length === 0 || digits[0] !== '0') {
            digits = '0' + digits;
          }
        } else if (n !== 0n) {
          prefix = conv === 'X' ? '0X' : '0x';
        }
      }
      const zeroPad = zeroFlag && !leftAlign && precision === undefined;
      result += formatNumeric('', prefix, digits, width, leftAlign, zeroPad);
      continue;
    }

    if (conv === 'e' || conv === 'E' || conv === 'f' || conv === 'F' || conv === 'g' || conv === 'G') {
      const value = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';

      if (Number.isNaN(value)) {
        const text = upper ? 'NAN' : 'nan';
        result += padPlain(text, width, leftAlign);
        continue;
      }

      const isNegSign = value < 0 || Object.is(value, -0);
      const sign = signForFinite(isNegSign, plusFlag, spaceFlag);

      if (!Number.isFinite(value)) {
        const text = sign + (upper ? 'INF' : 'inf');
        result += padPlain(text, width, leftAlign);
        continue;
      }

      const absVal = Math.abs(value);
      const zeroPadBase = zeroFlag && !leftAlign;

      if (conv === 'e' || conv === 'E') {
        const p = precision !== undefined ? precision : 6;
        const sigDigits = p + 1;
        let digits: string;
        let X: number;
        if (absVal === 0) {
          digits = '0'.repeat(sigDigits);
          X = 0;
        } else {
          const r = significantDigits(absVal, sigDigits);
          digits = r.digits;
          X = r.exp;
        }
        const lead = digits[0];
        const frac = digits.slice(1);
        const mant = lead + (p > 0 || hashFlag ? '.' + frac : '');
        const expSign = X >= 0 ? '+' : '-';
        const expDigits = Math.abs(X).toString(10).padStart(2, '0');
        const full = mant + (conv === 'E' ? 'E' : 'e') + expSign + expDigits;
        result += formatNumeric(sign, '', full, width, leftAlign, zeroPadBase);
        continue;
      }

      if (conv === 'f' || conv === 'F') {
        const p = precision !== undefined ? precision : 6;
        const { num, den } = toFraction(absVal);
        let D = scaledRound(num, den, p);
        let Dstr = D.toString(10).padStart(p + 1, '0');
        let intPart: string;
        let fracPart: string;
        if (p === 0) {
          intPart = Dstr;
          fracPart = '';
        } else {
          intPart = Dstr.slice(0, Dstr.length - p);
          fracPart = Dstr.slice(Dstr.length - p);
        }
        const digits = intPart + (p > 0 || hashFlag ? '.' + fracPart : '');
        result += formatNumeric(sign, '', digits, width, leftAlign, zeroPadBase);
        continue;
      }

      // g, G
      let P = precision !== undefined ? (precision === 0 ? 1 : precision) : 6;
      let digits: string;
      let X: number;
      if (absVal === 0) {
        digits = '0'.repeat(P);
        X = 0;
      } else {
        const r = significantDigits(absVal, P);
        digits = r.digits;
        X = r.exp;
      }

      let out: string;
      if (P > X && X >= -4) {
        const pointPos = X + 1;
        let intPart: string;
        let fracPart: string;
        if (pointPos <= 0) {
          intPart = '0';
          fracPart = '0'.repeat(-pointPos) + digits;
        } else if (pointPos >= P) {
          intPart = digits + '0'.repeat(pointPos - P);
          fracPart = '';
        } else {
          intPart = digits.slice(0, pointPos);
          fracPart = digits.slice(pointPos);
        }
        if (!hashFlag) {
          fracPart = fracPart.replace(/0+$/, '');
        }
        out = intPart;
        if (fracPart.length > 0) {
          out += '.' + fracPart;
        } else if (hashFlag) {
          out += '.';
        }
      } else {
        const lead = digits[0];
        let frac = digits.slice(1);
        if (!hashFlag) {
          frac = frac.replace(/0+$/, '');
        }
        let mant = lead;
        if (frac.length > 0) {
          mant += '.' + frac;
        } else if (hashFlag) {
          mant += '.';
        }
        const expSign = X >= 0 ? '+' : '-';
        const expDigits = Math.abs(X).toString(10).padStart(2, '0');
        out = mant + (conv === 'G' ? 'E' : 'e') + expSign + expDigits;
      }

      result += formatNumeric(sign, '', out, width, leftAlign, zeroPadBase);
      continue;
    }

    if (conv === 's') {
      let str = arg as string;
      if (precision !== undefined) str = str.slice(0, precision);
      result += padPlain(str, width, leftAlign);
      continue;
    }

    if (conv === 'c') {
      const str = arg as string;
      result += padPlain(str, width, leftAlign);
      continue;
    }
  }
  result += fmt.slice(lastEnd);
  return result;
}
