function decomposeMag(x: number): { M: bigint; E: number } {
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setFloat64(0, x);
  const hi = view.getUint32(0);
  const lo = view.getUint32(4);
  const exp = (hi >>> 20) & 0x7ff;
  const mantHi = hi & 0xfffff;
  const mantissa = (BigInt(mantHi) << 32n) | BigInt(lo >>> 0);
  if (exp === 0) {
    return { M: mantissa, E: -1074 };
  }
  return { M: mantissa | (1n << 52n), E: exp - 1075 };
}

// Rounds M * 2^E * 10^k to the nearest integer, ties to even.
function roundExact(M: bigint, E: number, k: number): bigint {
  const E2 = E + k;
  let numerator = M;
  let denominator = 1n;
  if (k > 0) numerator *= 5n ** BigInt(k);
  else if (k < 0) denominator *= 5n ** BigInt(-k);
  if (E2 > 0) numerator <<= BigInt(E2);
  else if (E2 < 0) denominator <<= BigInt(-E2);
  if (denominator === 1n) return numerator;
  let q = numerator / denominator;
  const r = numerator % denominator;
  const twiceR = r * 2n;
  if (twiceR > denominator) q += 1n;
  else if (twiceR === denominator && q % 2n === 1n) q += 1n;
  return q;
}

function eStyleDigits(
  M: bigint,
  E: number,
  prec: number,
  approx: number
): { X: number; digits: string } {
  let X = Math.floor(Math.log10(approx));
  for (let i = 0; i < 10; i++) {
    const q = roundExact(M, E, prec - X);
    const digits = q.toString();
    if (digits.length === prec + 1) return { X, digits };
    if (digits.length > prec + 1) X++;
    else X--;
  }
  const q = roundExact(M, E, prec - X);
  return { X, digits: q.toString().padStart(prec + 1, '0') };
}

function digitsToFixed(digits: string, X: number): { intPart: string; fracPart: string } {
  if (X >= 0) {
    if (digits.length > X + 1) {
      return { intPart: digits.slice(0, X + 1), fracPart: digits.slice(X + 1) };
    }
    return { intPart: digits.padEnd(X + 1, '0'), fracPart: '' };
  }
  return { intPart: '0', fracPart: '0'.repeat(-X - 1) + digits };
}

function stripTrailingZeros(s: string): string {
  let end = s.length;
  while (end > 0 && s[end - 1] === '0') end--;
  return s.slice(0, end);
}

function padStr(content: string, width: number, leftAlign: boolean): string {
  if (content.length >= width) return content;
  const pad = ' '.repeat(width - content.length);
  return leftAlign ? content + pad : pad + content;
}

function padNumeric(
  sign: string,
  prefix: string,
  digits: string,
  width: number,
  leftAlign: boolean,
  zeroPad: boolean
): string {
  const content = sign + prefix + digits;
  if (content.length >= width) return content;
  const padLen = width - content.length;
  if (leftAlign) return content + ' '.repeat(padLen);
  if (zeroPad) return sign + prefix + '0'.repeat(padLen) + digits;
  return ' '.repeat(padLen) + content;
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let result = '';
  let argi = 0;
  const re = /%([-+ 0#]*)(\d*)(\.\d*)?([diouxXeEfFgGsc%])/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = re.exec(fmt)) !== null) {
    result += fmt.slice(lastIndex, match.index);
    lastIndex = re.lastIndex;

    const [, flagsStr, widthStr, precStr, conv] = match;

    if (conv === '%') {
      result += '%';
      continue;
    }

    const leftAlign = flagsStr.includes('-');
    const plusFlag = flagsStr.includes('+');
    const spaceFlag = flagsStr.includes(' ');
    const hashFlag = flagsStr.includes('#');
    const zeroFlag = flagsStr.includes('0') && !leftAlign;
    const width = widthStr ? parseInt(widthStr, 10) : 0;
    const precisionGiven = precStr !== undefined;
    const precision = precisionGiven
      ? precStr.length > 1
        ? parseInt(precStr.slice(1), 10)
        : 0
      : undefined;
    const isUpper = conv === 'X' || conv === 'E' || conv === 'F' || conv === 'G';

    if (conv === 'd' || conv === 'i') {
      const arg = args[argi++] as number | bigint;
      let neg: boolean;
      let magnitude: bigint;
      if (typeof arg === 'bigint') {
        neg = arg < 0n;
        magnitude = neg ? -arg : arg;
      } else {
        neg = arg < 0;
        magnitude = BigInt(Math.abs(arg));
      }
      let digits: string;
      if (precisionGiven) {
        if (precision === 0 && magnitude === 0n) digits = '';
        else digits = magnitude.toString(10).padStart(precision as number, '0');
      } else {
        digits = magnitude.toString(10);
      }
      const sign = neg ? '-' : plusFlag ? '+' : spaceFlag ? ' ' : '';
      result += padNumeric(sign, '', digits, width, leftAlign, zeroFlag && !precisionGiven);
      continue;
    }

    if (conv === 'x' || conv === 'X' || conv === 'o') {
      const arg = args[argi++] as number | bigint;
      const magnitude = typeof arg === 'bigint' ? arg : BigInt(arg);
      const base = conv === 'o' ? 8 : 16;
      let digits: string;
      if (precisionGiven) {
        if (precision === 0 && magnitude === 0n) digits = '';
        else digits = magnitude.toString(base).padStart(precision as number, '0');
      } else {
        digits = magnitude.toString(base);
      }
      let prefix = '';
      if (hashFlag) {
        if (conv === 'o') {
          if (digits === '' || digits[0] !== '0') digits = '0' + digits;
        } else if (magnitude !== 0n) {
          prefix = '0x';
        }
      }
      let out = padNumeric('', prefix, digits, width, leftAlign, zeroFlag && !precisionGiven);
      if (isUpper) out = out.toUpperCase();
      result += out;
      continue;
    }

    if (conv === 's' || conv === 'c') {
      const arg = args[argi++] as string;
      let str = conv === 'c' ? arg : precisionGiven ? arg.slice(0, precision) : arg;
      result += padStr(str, width, leftAlign);
      continue;
    }

    // e, E, f, F, g, G
    const arg = args[argi++] as number;

    if (Number.isNaN(arg) || !Number.isFinite(arg)) {
      let body: string;
      let signStr = '';
      if (Number.isNaN(arg)) {
        body = 'nan';
      } else {
        body = 'inf';
        signStr = arg < 0 ? '-' : plusFlag ? '+' : spaceFlag ? ' ' : '';
      }
      if (isUpper) body = body.toUpperCase();
      result += padStr(signStr + body, width, leftAlign);
      continue;
    }

    const signBit = arg < 0 || Object.is(arg, -0);
    const signStr = signBit ? '-' : plusFlag ? '+' : spaceFlag ? ' ' : '';
    const absArg = Math.abs(arg);
    const isZero = absArg === 0;
    const { M, E } = isZero ? { M: 0n, E: 0 } : decomposeMag(absArg);

    let numericBody: string;

    if (conv === 'f' || conv === 'F') {
      const p = precisionGiven ? (precision as number) : 6;
      const q = isZero ? 0n : roundExact(M, E, p);
      const s = q.toString().padStart(p + 1, '0');
      const intPart = p === 0 ? s : s.slice(0, s.length - p);
      const fracPart = p === 0 ? '' : s.slice(s.length - p);
      const dot = p > 0 || hashFlag ? '.' : '';
      numericBody = intPart + dot + fracPart;
    } else if (conv === 'e' || conv === 'E') {
      const prec = precisionGiven ? (precision as number) : 6;
      const { X, digits } = isZero
        ? { X: 0, digits: '0'.repeat(prec + 1) }
        : eStyleDigits(M, E, prec, absArg);
      const first = digits[0];
      const rest = digits.slice(1);
      const dot = prec > 0 || hashFlag ? '.' : '';
      const expSign = X >= 0 ? '+' : '-';
      const expAbs = Math.abs(X).toString().padStart(2, '0');
      numericBody = first + dot + rest + 'e' + expSign + expAbs;
    } else {
      // g, G
      const P = precisionGiven ? (precision === 0 ? 1 : (precision as number)) : 6;
      const { X, digits } = isZero
        ? { X: 0, digits: '0'.repeat(P) }
        : eStyleDigits(M, E, P - 1, absArg);
      const useF = P > X && X >= -4;
      if (useF) {
        let { intPart, fracPart } = digitsToFixed(digits, X);
        if (!hashFlag) fracPart = stripTrailingZeros(fracPart);
        const dot = fracPart.length > 0 || hashFlag ? '.' : '';
        numericBody = intPart + dot + fracPart;
      } else {
        const first = digits[0];
        let rest = digits.slice(1);
        if (!hashFlag) rest = stripTrailingZeros(rest);
        const dot = rest.length > 0 || hashFlag ? '.' : '';
        const expSign = X >= 0 ? '+' : '-';
        const expAbs = Math.abs(X).toString().padStart(2, '0');
        numericBody = first + dot + rest + 'e' + expSign + expAbs;
      }
    }

    let out = padNumeric(signStr, '', numericBody, width, leftAlign, zeroFlag);
    if (isUpper) out = out.toUpperCase();
    result += out;
  }

  result += fmt.slice(lastIndex);
  return result;
}
