type Arg = number | bigint | string;

function decompose(x: number): { sign: number; M: bigint; E: number } {
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setFloat64(0, x);
  const bits = view.getBigUint64(0);
  const sign = Number(bits >> 63n);
  const expBits = Number((bits >> 52n) & 0x7ffn);
  const mantBits = bits & 0xfffffffffffffn;
  let M: bigint;
  let E: number;
  if (expBits === 0) {
    M = mantBits;
    E = -1074;
  } else {
    M = mantBits | (1n << 52n);
    E = expBits - 1075;
  }
  return { sign, M, E };
}

// round_half_even(M * 2^E * 10^s)
function scaledRound(M: bigint, E: number, s: number): bigint {
  let num = M;
  let den = 1n;
  if (s >= 0) {
    num *= 5n ** BigInt(s);
  } else {
    den *= 5n ** BigInt(-s);
  }
  const e2 = E + s;
  if (e2 >= 0) {
    num *= 2n ** BigInt(e2);
  } else {
    den *= 2n ** BigInt(-e2);
  }
  if (den === 1n) return num;
  const q = num / den;
  const r = num % den;
  const twiceR = r * 2n;
  if (twiceR > den) return q + 1n;
  if (twiceR < den) return q;
  return q % 2n === 0n ? q : q + 1n;
}

function computeExponentDigits(M: bigint, E: number, p: number): { digits: string; exp: number } {
  if (M === 0n) return { digits: '0'.repeat(p + 1), exp: 0 };
  const log2M = Math.log2(Number(M));
  let exp = Math.floor((log2M + E) * Math.log10(2));
  for (let iter = 0; iter < 8; iter++) {
    const s = p - exp;
    const D = scaledRound(M, E, s);
    const digits = D.toString();
    if (digits.length === p + 1) {
      return { digits, exp };
    } else if (digits.length > p + 1) {
      exp += 1;
    } else {
      exp -= 1;
    }
  }
  throw new Error('exponent computation failed to converge');
}

function fixedDigits(M: bigint, E: number, p: number): { intPart: string; fracPart: string } {
  const D = scaledRound(M, E, p);
  let digits = D.toString();
  if (digits.length < p + 1) digits = digits.padStart(p + 1, '0');
  const intPart = p > 0 ? digits.slice(0, digits.length - p) : digits;
  const fracPart = p > 0 ? digits.slice(digits.length - p) : '';
  return { intPart: intPart === '' ? '0' : intPart, fracPart };
}

function getSign(negative: boolean, flags: string): string {
  if (negative) return '-';
  if (flags.includes('+')) return '+';
  if (flags.includes(' ')) return ' ';
  return '';
}

function applyWidth(
  sign: string,
  prefix: string,
  digits: string,
  width: number,
  leftAlign: boolean,
  zeroPad: boolean,
): string {
  const bodyLen = sign.length + prefix.length + digits.length;
  if (bodyLen >= width) return sign + prefix + digits;
  const padLen = width - bodyLen;
  if (leftAlign) return sign + prefix + digits + ' '.repeat(padLen);
  if (zeroPad) return sign + prefix + '0'.repeat(padLen) + digits;
  return ' '.repeat(padLen) + sign + prefix + digits;
}

function trimTrailingZeros(frac: string): string {
  let end = frac.length;
  while (end > 0 && frac[end - 1] === '0') end--;
  return frac.slice(0, end);
}

export function format(fmt: string, ...args: Arg[]): string {
  let result = '';
  let argIndex = 0;
  const re = /%([-+ 0#]*)(\d*)(?:\.(\d*))?([a-zA-Z%])/g;
  let lastEnd = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(fmt)) !== null) {
    result += fmt.slice(lastEnd, match.index);
    lastEnd = re.lastIndex;
    const [, flags, widthStr, precStr, conv] = match;

    if (conv === '%') {
      result += '%';
      continue;
    }

    const width = widthStr ? parseInt(widthStr, 10) : 0;
    const hasPrecision = precStr !== undefined;
    const precision = hasPrecision ? (precStr === '' ? 0 : parseInt(precStr, 10)) : undefined;
    const leftAlign = flags.includes('-');
    const arg = args[argIndex++];

    if (conv === 'd' || conv === 'i') {
      const v: bigint = typeof arg === 'bigint' ? arg : BigInt(arg as number);
      const negative = v < 0n;
      const mag = negative ? -v : v;
      let digits = mag.toString();
      const p = precision ?? 1;
      if (precision === 0 && mag === 0n) {
        digits = '';
      } else {
        digits = digits.padStart(p, '0');
      }
      const sign = getSign(negative, flags);
      const zeroPad = flags.includes('0') && !leftAlign && !hasPrecision;
      result += applyWidth(sign, '', digits, width, leftAlign, zeroPad);
    } else if (conv === 'x' || conv === 'X' || conv === 'o') {
      const v: bigint = typeof arg === 'bigint' ? arg : BigInt(arg as number);
      let digits = conv === 'o' ? v.toString(8) : v.toString(16);
      if (conv === 'X') digits = digits.toUpperCase();
      if (hasPrecision) {
        if (precision === 0 && v === 0n) {
          digits = '';
        } else {
          digits = digits.padStart(precision as number, '0');
        }
      }
      let prefix = '';
      if (flags.includes('#')) {
        if (conv === 'o') {
          if (digits.length === 0 || digits[0] !== '0') {
            digits = digits.padStart(digits.length + 1, '0');
          }
        } else if (v !== 0n) {
          prefix = conv === 'X' ? '0X' : '0x';
        }
      }
      const zeroPad = flags.includes('0') && !leftAlign && !hasPrecision;
      result += applyWidth('', prefix, digits, width, leftAlign, zeroPad);
    } else if (conv === 'e' || conv === 'E' || conv === 'f' || conv === 'F' || conv === 'g' || conv === 'G') {
      const value = arg as number;
      const upper = conv === conv.toUpperCase();
      const alt = flags.includes('#');

      if (Number.isNaN(value)) {
        const sign = '';
        const text = upper ? 'NAN' : 'nan';
        result += applyWidth(sign, '', text, width, leftAlign, false);
        continue;
      }

      const { sign: signBit } = decompose(value);
      const negative = signBit === 1;

      if (!Number.isFinite(value)) {
        const sign = getSign(negative, flags);
        const text = upper ? 'INF' : 'inf';
        result += applyWidth(sign, '', text, width, leftAlign, false);
        continue;
      }

      const { M, E } = decompose(value);
      const sign = getSign(negative, flags);

      if (conv === 'e' || conv === 'E') {
        const p = precision ?? 6;
        const { digits, exp } = computeExponentDigits(M, E, p);
        const frac = p > 0 ? digits.slice(1) : '';
        const dot = p > 0 ? '.' : alt ? '.' : '';
        const expLetter = conv === 'E' ? 'E' : 'e';
        const expSign = exp >= 0 ? '+' : '-';
        const expAbs = Math.abs(exp).toString().padStart(2, '0');
        const digitsOut = digits[0] + dot + frac + expLetter + expSign + expAbs;
        const zeroPad = flags.includes('0') && !leftAlign;
        result += applyWidth(sign, '', digitsOut, width, leftAlign, zeroPad);
      } else if (conv === 'f' || conv === 'F') {
        const p = precision ?? 6;
        const { intPart, fracPart } = fixedDigits(M, E, p);
        const dot = p > 0 ? '.' : alt ? '.' : '';
        const digitsOut = intPart + dot + fracPart;
        const zeroPad = flags.includes('0') && !leftAlign;
        result += applyWidth(sign, '', digitsOut, width, leftAlign, zeroPad);
      } else {
        // g, G
        let P = precision ?? 6;
        if (P === 0) P = 1;
        const expLetter = conv === 'G' ? 'E' : 'e';

        let X: number;
        let eDigits: string | null = null;
        if (M === 0n) {
          X = 0;
        } else {
          const r = computeExponentDigits(M, E, P - 1);
          X = r.exp;
          eDigits = r.digits;
        }

        let digitsOut: string;
        if (P > X && X >= -4) {
          const fp = P - 1 - X;
          const { intPart, fracPart } = fixedDigits(M, E, fp);
          let frac = fracPart;
          if (!alt) frac = trimTrailingZeros(frac);
          const dot = frac.length > 0 ? '.' : alt ? '.' : '';
          digitsOut = intPart + dot + frac;
        } else {
          const digits = eDigits as string;
          let frac = digits.slice(1);
          if (!alt) frac = trimTrailingZeros(frac);
          const dot = frac.length > 0 ? '.' : alt ? '.' : '';
          const expSign = X >= 0 ? '+' : '-';
          const expAbs = Math.abs(X).toString().padStart(2, '0');
          digitsOut = digits[0] + dot + frac + expLetter + expSign + expAbs;
        }
        const zeroPad = flags.includes('0') && !leftAlign;
        result += applyWidth(sign, '', digitsOut, width, leftAlign, zeroPad);
      }
    } else if (conv === 's') {
      let s = arg as string;
      if (hasPrecision) s = s.slice(0, precision);
      result += applyWidth('', '', s, width, leftAlign, false);
    } else if (conv === 'c') {
      const s = arg as string;
      result += applyWidth('', '', s, width, leftAlign, false);
    }
  }
  result += fmt.slice(lastEnd);
  return result;
}
