type Flags = {
  minus: boolean;
  plus: boolean;
  space: boolean;
  zero: boolean;
  hash: boolean;
};

function parseFlags(s: string): Flags {
  return {
    minus: s.includes('-'),
    plus: s.includes('+'),
    space: s.includes(' '),
    zero: s.includes('0'),
    hash: s.includes('#'),
  };
}

// ---- Exact decimal representation of a finite double's magnitude ----

function doubleBits(x: number): { mantissa: bigint; exponent: number } {
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setFloat64(0, x, false);
  const hi = view.getUint32(0, false);
  const lo = view.getUint32(4, false);
  const expBits = (hi >>> 20) & 0x7ff;
  let mantissa = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo >>> 0);
  let exponent: number;
  if (expBits === 0) {
    exponent = 1 - 1023 - 52;
  } else {
    mantissa = mantissa | (1n << 52n);
    exponent = expBits - 1023 - 52;
  }
  return { mantissa, exponent };
}

// Returns exact digit string D and pointPos such that magnitude ==
// D interpreted as an integer with a decimal point inserted `pointPos`
// characters from the left (pointPos may be <= 0 or == D.length).
function doubleToExact(x: number): { D: string; pointPos: number } {
  if (x === 0) return { D: '0', pointPos: 1 };
  const { mantissa, exponent } = doubleBits(x);
  if (exponent >= 0) {
    const value = mantissa << BigInt(exponent);
    const D = value.toString();
    return { D, pointPos: D.length };
  } else {
    const shift = -exponent;
    const numerator = mantissa * 5n ** BigInt(shift);
    let D = numerator.toString();
    if (D.length <= shift) D = '0'.repeat(shift - D.length + 1) + D;
    return { D, pointPos: D.length - shift };
  }
}

function getDigit(D: string, i: number): string {
  if (i < 0 || i >= D.length) return '0';
  return D[i];
}

function restIsZero(D: string, from: number): boolean {
  const start = Math.max(from, 0);
  for (let k = start; k < D.length; k++) if (D[k] !== '0') return false;
  return true;
}

// Rounds the exact decimal digit string D (round-half-to-even) keeping
// the digits at indices [start, cutIndex) where start = min(0, cutIndex).
// Returns the (possibly carried) kept digits and the new start index.
function roundAt(D: string, cutIndex: number): { kept: string; start: number } {
  const start = Math.min(0, cutIndex);
  let kept = '';
  for (let i = start; i < cutIndex; i++) kept += getDigit(D, i);
  if (kept === '') kept = '0';

  const firstRest = getDigit(D, cutIndex);
  let roundUp = false;
  if (firstRest > '5') {
    roundUp = true;
  } else if (firstRest === '5') {
    if (!restIsZero(D, cutIndex + 1)) {
      roundUp = true;
    } else {
      const lastDigit = kept[kept.length - 1];
      roundUp = (lastDigit.charCodeAt(0) - 48) % 2 === 1;
    }
  }

  let newStart = start;
  if (roundUp) {
    const big = BigInt(kept) + 1n;
    let s = big.toString();
    if (s.length > kept.length) {
      newStart = start - (s.length - kept.length);
    } else {
      s = s.padStart(kept.length, '0');
    }
    kept = s;
  }
  return { kept, start: newStart };
}

function formatFixedDigits(D: string, pointPos: number, n: number): { intPart: string; fracPart: string } {
  const cutIndex = pointPos + n;
  const { kept, start } = roundAt(D, cutIndex);
  const intLen = pointPos - start;
  let intPart: string;
  let fracPart: string;
  if (intLen <= 0) {
    intPart = '0';
    fracPart = '0'.repeat(-intLen) + kept;
  } else {
    intPart = kept.slice(0, intLen);
    fracPart = kept.slice(intLen);
    if (intPart === '') intPart = '0';
  }
  if (fracPart.length < n) fracPart = fracPart.padEnd(n, '0');
  else if (fracPart.length > n) fracPart = fracPart.slice(0, n);
  return { intPart, fracPart };
}

function formatSignificant(D: string, pointPos: number, P: number): { sig: string; E: number } {
  let fnz = 0;
  while (fnz < D.length && D[fnz] === '0') fnz++;
  if (fnz === D.length) {
    return { sig: '0'.repeat(P), E: 0 };
  }
  const E0 = pointPos - 1 - fnz;
  const cutIndex = fnz + P;
  const { kept } = roundAt(D, cutIndex);
  let sig = kept.replace(/^0+/, '');
  if (sig === '') sig = '0';
  let E = E0;
  if (sig.length > P) {
    E += sig.length - P;
    sig = sig.slice(0, P);
  } else if (sig.length < P) {
    sig = sig.padEnd(P, '0');
  }
  return { sig, E };
}

function signOf(x: number, flags: Flags): { neg: boolean; sign: string } {
  const neg = x < 0 || Object.is(x, -0);
  const sign = neg ? '-' : flags.plus ? '+' : flags.space ? ' ' : '';
  return { neg, sign };
}

function padNum(prefix: string, digits: string, width: number, dash: boolean, zero: boolean): string {
  const body = prefix + digits;
  if (body.length >= width) return body;
  const padLen = width - body.length;
  if (dash) return body + ' '.repeat(padLen);
  if (zero) return prefix + '0'.repeat(padLen) + digits;
  return ' '.repeat(padLen) + body;
}

function padStr(body: string, width: number, dash: boolean): string {
  if (body.length >= width) return body;
  const padLen = width - body.length;
  return dash ? body + ' '.repeat(padLen) : ' '.repeat(padLen) + body;
}

function expString(E: number, upper: boolean): string {
  const letter = upper ? 'E' : 'e';
  const expSign = E < 0 ? '-' : '+';
  let expAbs = Math.abs(E).toString();
  if (expAbs.length < 2) expAbs = '0' + expAbs;
  return letter + expSign + expAbs;
}

function formatEBody(D: string, pointPos: number, precision: number, upper: boolean, hash: boolean): string {
  const { sig, E } = formatSignificant(D, pointPos, precision + 1);
  const digit0 = sig[0];
  const rest = sig.slice(1);
  const fracStr = precision > 0 ? '.' + rest : hash ? '.' : '';
  return digit0 + fracStr + expString(E, upper);
}

function formatFBody(D: string, pointPos: number, precision: number, hash: boolean): string {
  const { intPart, fracPart } = formatFixedDigits(D, pointPos, precision);
  const fracStr = precision > 0 ? '.' + fracPart : hash ? '.' : '';
  return intPart + fracStr;
}

function trimTrailingZerosFrac(body: string, hash: boolean): string {
  if (hash) return body;
  if (!body.includes('.')) return body;
  body = body.replace(/0+$/, '');
  if (body.endsWith('.')) body = body.slice(0, -1);
  return body;
}

function formatGBody(D: string, pointPos: number, precision: number, upper: boolean, hash: boolean): string {
  const P = precision === 0 ? 1 : precision;
  const { E: X } = formatSignificant(D, pointPos, P);
  if (P > X && X >= -4) {
    const body = formatFBody(D, pointPos, P - 1 - X, hash);
    return trimTrailingZerosFrac(body, hash);
  }
  const { sig, E } = formatSignificant(D, pointPos, P);
  const digit0 = sig[0];
  let rest = sig.slice(1);
  if (!hash) rest = rest.replace(/0+$/, '');
  const fracStr = rest.length > 0 ? '.' + rest : hash ? '.' : '';
  return digit0 + fracStr + expString(E, upper);
}

function toBigInt(v: number | bigint): bigint {
  return typeof v === 'bigint' ? v : BigInt(v);
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let result = '';
  let argIndex = 0;
  const re = /%([-+ 0#]*)(\d*)(?:\.(\d*))?([a-zA-Z%])/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;

  while ((m = re.exec(fmt)) !== null) {
    result += fmt.slice(lastIndex, m.index);
    lastIndex = re.lastIndex;

    const [, flagsStr, widthStr, precStr, conv] = m;

    if (conv === '%') {
      result += '%';
      continue;
    }

    const flags = parseFlags(flagsStr);
    const width = widthStr ? parseInt(widthStr, 10) : 0;
    const hasPrecision = precStr !== undefined;
    const precision = hasPrecision ? (precStr === '' ? 0 : parseInt(precStr, 10)) : undefined;

    const arg = args[argIndex++];

    if (conv === 'd' || conv === 'i') {
      const value = toBigInt(arg as number | bigint);
      const neg = value < 0n;
      const magnitude = neg ? -value : value;
      const sign = neg ? '-' : flags.plus ? '+' : flags.space ? ' ' : '';
      let digits: string;
      if (hasPrecision) {
        if (precision === 0 && magnitude === 0n) {
          digits = '';
        } else {
          digits = magnitude.toString();
          if (digits.length < (precision as number)) digits = digits.padStart(precision as number, '0');
        }
      } else {
        digits = magnitude.toString();
      }
      const zero = flags.zero && !flags.minus && !hasPrecision;
      result += padNum(sign, digits, width, flags.minus, zero);
    } else if (conv === 'x' || conv === 'X' || conv === 'o') {
      const magnitude = toBigInt(arg as number | bigint);
      let digits: string;
      if (hasPrecision) {
        if (precision === 0 && magnitude === 0n) {
          digits = '';
        } else {
          digits = magnitude.toString(conv === 'o' ? 8 : 16);
          if (digits.length < (precision as number)) digits = digits.padStart(precision as number, '0');
        }
      } else {
        digits = magnitude.toString(conv === 'o' ? 8 : 16);
      }
      if (conv === 'X') digits = digits.toUpperCase();

      let prefix = '';
      if (flags.hash) {
        if (conv === 'o') {
          if (!(digits.length > 0 && digits[0] === '0')) digits = '0' + digits;
        } else if (magnitude !== 0n) {
          prefix = conv === 'X' ? '0X' : '0x';
        }
      }
      const zero = flags.zero && !flags.minus && !hasPrecision;
      result += padNum(prefix, digits, width, flags.minus, zero);
    } else if (conv === 'e' || conv === 'E' || conv === 'f' || conv === 'F' || conv === 'g' || conv === 'G') {
      const x = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      const { neg, sign } = signOf(x, flags);
      const mag = Math.abs(x);
      const prec = precision === undefined ? 6 : precision;

      let body: string;
      let zeroOk = true;
      if (Number.isNaN(x)) {
        body = upper ? 'NAN' : 'nan';
        zeroOk = false;
      } else if (!Number.isFinite(mag)) {
        body = upper ? 'INF' : 'inf';
        zeroOk = false;
      } else {
        const { D, pointPos } = doubleToExact(mag);
        if (conv === 'e' || conv === 'E') {
          body = formatEBody(D, pointPos, prec, upper, flags.hash);
        } else if (conv === 'f' || conv === 'F') {
          body = formatFBody(D, pointPos, prec, flags.hash);
        } else {
          body = formatGBody(D, pointPos, prec, upper, flags.hash);
        }
      }
      const zero = flags.zero && !flags.minus && zeroOk;
      result += padNum(sign, body, width, flags.minus, zero);
    } else if (conv === 's') {
      let s = arg as string;
      if (hasPrecision) s = s.slice(0, precision as number);
      result += padStr(s, width, flags.minus);
    } else if (conv === 'c') {
      const s = arg as string;
      result += padStr(s, width, flags.minus);
    }
  }

  result += fmt.slice(lastIndex);
  return result;
}
