type Flags = { minus: boolean; plus: boolean; space: boolean; zero: boolean; hash: boolean };

interface DoubleParts {
  sign: 0 | 1;
  mantissa: bigint; // integer significand
  binExp: number; // value = (-1)^sign * mantissa * 2^binExp
  isInf: boolean;
  isNan: boolean;
  isZero: boolean;
}

function decomposeDouble(x: number): DoubleParts {
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setFloat64(0, x, false);
  const hi = dv.getUint32(0, false);
  const lo = dv.getUint32(4, false);
  const sign: 0 | 1 = (hi >>> 31) as 0 | 1;
  const expBits = (hi >>> 20) & 0x7ff;
  const mantHi = hi & 0xfffff;
  const mantissaBits = (BigInt(mantHi) << 32n) | BigInt(lo >>> 0);

  if (expBits === 0x7ff) {
    return { sign, mantissa: 0n, binExp: 0, isInf: mantissaBits === 0n, isNan: mantissaBits !== 0n, isZero: false };
  }
  if (expBits === 0) {
    if (mantissaBits === 0n) {
      return { sign, mantissa: 0n, binExp: 0, isInf: false, isNan: false, isZero: true };
    }
    return { sign, mantissa: mantissaBits, binExp: 1 - 1023 - 52, isInf: false, isNan: false, isZero: false };
  }
  const mantissa = mantissaBits | (1n << 52n);
  const binExp = expBits - 1023 - 52;
  return { sign, mantissa, binExp, isInf: false, isNan: false, isZero: false };
}

// Computes round(mantissa * 2^binExp * 10^Q) to nearest integer, ties to even.
function roundScaled(mantissa: bigint, binExp: number, Q: number): bigint {
  if (mantissa === 0n) return 0n;
  let num = mantissa;
  let den = 1n;
  if (Q >= 0) {
    num *= 5n ** BigInt(Q);
  } else {
    den *= 5n ** BigInt(-Q);
  }
  const combinedExp = binExp + Q;
  if (combinedExp >= 0) {
    num <<= BigInt(combinedExp);
  } else {
    den <<= BigInt(-combinedExp);
  }
  if (den === 1n) return num;
  const quotient = num / den;
  const remainder = num % den;
  const twice = remainder * 2n;
  if (twice > den) return quotient + 1n;
  if (twice < den) return quotient;
  // exact tie: round to even
  return quotient % 2n === 0n ? quotient : quotient + 1n;
}

function signChar(negative: boolean, flags: Flags): string {
  if (negative) return '-';
  if (flags.plus) return '+';
  if (flags.space) return ' ';
  return '';
}

function padNumeric(sign: string, prefix: string, digits: string, width: number, flags: Flags): string {
  const content = sign + prefix + digits;
  if (content.length >= width) return content;
  const padLen = width - content.length;
  if (flags.minus) return content + ' '.repeat(padLen);
  if (flags.zero) return sign + prefix + '0'.repeat(padLen) + digits;
  return ' '.repeat(padLen) + content;
}

function padGeneral(content: string, width: number, minus: boolean): string {
  if (content.length >= width) return content;
  const padLen = width - content.length;
  return minus ? content + ' '.repeat(padLen) : ' '.repeat(padLen) + content;
}

function intDigits(abs: bigint, base: number, precision: number | undefined): string {
  let s = abs.toString(base);
  if (precision === undefined) return s;
  if (precision === 0 && abs === 0n) return '';
  if (s.length < precision) s = s.padStart(precision, '0');
  return s;
}

function fDigitsBody(mantissa: bigint, binExp: number, Q: number, hash: boolean): string {
  const R = roundScaled(mantissa, binExp, Q);
  let s = R.toString();
  if (Q === 0) {
    return hash ? s + '.' : s;
  }
  s = s.padStart(Q + 1, '0');
  const intPart = s.slice(0, s.length - Q);
  const fracPart = s.slice(s.length - Q);
  return intPart + '.' + fracPart;
}

function eDigitsRaw(mantissa: bigint, binExp: number, absX: number, P: number): { digits: string; X: number } {
  if (mantissa === 0n) {
    return { digits: '0'.repeat(P + 1), X: 0 };
  }
  let guess = Math.floor(Math.log10(absX));
  const lower = 10n ** BigInt(P);
  const upper = 10n ** BigInt(P + 1);
  for (let i = 0; i < 6; i++) {
    const Q = P - guess;
    const R = roundScaled(mantissa, binExp, Q);
    if (R < lower) {
      guess -= 1;
      continue;
    }
    if (R >= upper) {
      guess += 1;
      continue;
    }
    return { digits: R.toString(), X: guess };
  }
  // fallback (should not normally happen)
  const Q = P - guess;
  const R = roundScaled(mantissa, binExp, Q);
  return { digits: R.toString().padStart(P + 1, '0'), X: guess };
}

function eBody(mantissa: bigint, binExp: number, absX: number, P: number, hash: boolean, expChar: string): string {
  const { digits, X } = eDigitsRaw(mantissa, binExp, absX, P);
  const first = digits[0];
  const rest = digits.slice(1);
  const dot = P > 0 || hash ? '.' : '';
  const expSign = X >= 0 ? '+' : '-';
  let expDigits = Math.abs(X).toString();
  if (expDigits.length < 2) expDigits = expDigits.padStart(2, '0');
  return first + dot + rest + expChar + expSign + expDigits;
}

function stripTrailingZeros(body: string): string {
  if (!body.includes('.')) return body;
  body = body.replace(/0+$/, '');
  if (body.endsWith('.')) body = body.slice(0, -1);
  return body;
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

    const flagStr = m[1];
    const widthStr = m[2];
    const precStr = m[3];
    const conv = m[4];

    if (conv === '%') {
      result += '%';
      continue;
    }

    const flags: Flags = {
      minus: flagStr.includes('-'),
      plus: flagStr.includes('+'),
      space: flagStr.includes(' '),
      zero: flagStr.includes('0'),
      hash: flagStr.includes('#'),
    };
    const width = widthStr ? parseInt(widthStr, 10) : 0;
    const precGiven = precStr !== undefined;
    const precision = precGiven ? (precStr === '' ? 0 : parseInt(precStr, 10)) : undefined;

    const arg = args[argIndex++];

    switch (conv) {
      case 'd':
      case 'i': {
        const v = typeof arg === 'bigint' ? arg : BigInt(arg as number);
        const neg = v < 0n;
        const abs = neg ? -v : v;
        const digits = intDigits(abs, 10, precision);
        const sign = signChar(neg, flags);
        const zeroActive = flags.zero && !flags.minus && !precGiven;
        result += padNumeric(sign, '', digits, width, { ...flags, zero: zeroActive });
        break;
      }
      case 'x':
      case 'X':
      case 'o': {
        const v = typeof arg === 'bigint' ? arg : BigInt(arg as number);
        let digits = intDigits(v, conv === 'o' ? 8 : 16, precision);
        if (conv === 'X') digits = digits.toUpperCase();
        let prefix = '';
        if (flags.hash) {
          if (conv === 'o') {
            if (digits.length === 0 || digits[0] !== '0') digits = '0' + digits;
          } else if (v !== 0n) {
            prefix = conv === 'X' ? '0X' : '0x';
          }
        }
        const zeroActive = flags.zero && !flags.minus && !precGiven;
        result += padNumeric('', prefix, digits, width, { ...flags, zero: zeroActive });
        break;
      }
      case 'e':
      case 'E':
      case 'f':
      case 'F':
      case 'g':
      case 'G': {
        const x = arg as number;
        const parts = decomposeDouble(x);
        const negative = parts.sign === 1;
        const upper = conv === 'E' || conv === 'F' || conv === 'G';

        if (parts.isNan) {
          const body = upper ? 'NAN' : 'nan';
          result += padGeneral(body, width, flags.minus);
          break;
        }

        const sign = signChar(negative, flags);

        if (parts.isInf) {
          const body = sign + (upper ? 'INF' : 'inf');
          result += padGeneral(body, width, flags.minus);
          break;
        }

        let body: string;
        const zeroActive = flags.zero && !flags.minus;

        if (conv === 'f' || conv === 'F') {
          const Q = precision === undefined ? 6 : precision;
          body = fDigitsBody(parts.mantissa, parts.binExp, Q, flags.hash);
          result += padNumeric(sign, '', body, width, { ...flags, zero: zeroActive });
        } else if (conv === 'e' || conv === 'E') {
          const P = precision === undefined ? 6 : precision;
          const absX = Math.abs(x);
          body = eBody(parts.mantissa, parts.binExp, absX, P, flags.hash, upper ? 'E' : 'e');
          result += padNumeric(sign, '', body, width, { ...flags, zero: zeroActive });
        } else {
          // g, G
          let P = precision === undefined ? 6 : precision;
          if (P === 0) P = 1;
          const absX = Math.abs(x);
          const expChar = upper ? 'E' : 'e';
          const { X } = eDigitsRaw(parts.mantissa, parts.binExp, absX, P - 1);
          if (P > X && X >= -4) {
            const Q = P - 1 - X;
            body = fDigitsBody(parts.mantissa, parts.binExp, Q, flags.hash);
          } else {
            body = eBody(parts.mantissa, parts.binExp, absX, P - 1, flags.hash, expChar);
          }
          if (!flags.hash) {
            const eIdx = body.indexOf(expChar);
            if (eIdx === -1) {
              body = stripTrailingZeros(body);
            } else {
              body = stripTrailingZeros(body.slice(0, eIdx)) + body.slice(eIdx);
            }
          }
          result += padNumeric(sign, '', body, width, { ...flags, zero: zeroActive });
        }
        break;
      }
      case 's': {
        let s = arg as string;
        if (precision !== undefined) s = s.slice(0, precision);
        result += padGeneral(s, width, flags.minus);
        break;
      }
      case 'c': {
        const s = arg as string;
        result += padGeneral(s, width, flags.minus);
        break;
      }
    }
  }
  result += fmt.slice(lastIndex);
  return result;
}
