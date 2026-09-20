type Arg = number | bigint | string;

function exactDecimalOfAbs(x: number): { intPart: string; fracPart: string } {
  if (x === 0) return { intPart: '0', fracPart: '' };
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  const mantHi = BigInt(hi & 0xfffff);
  const mantLo = BigInt(lo >>> 0);
  let m: bigint;
  let e: number;
  if (expBits === 0) {
    m = (mantHi << 32n) | mantLo;
    e = 1 - 1023 - 52;
  } else {
    m = (1n << 52n) | (mantHi << 32n) | mantLo;
    e = expBits - 1023 - 52;
  }
  let digits: string;
  let pointFromRight: number;
  if (e >= 0) {
    digits = (m << BigInt(e)).toString();
    pointFromRight = 0;
  } else {
    digits = (m * 5n ** BigInt(-e)).toString();
    pointFromRight = -e;
  }
  if (pointFromRight === 0) return { intPart: digits, fracPart: '' };
  if (digits.length <= pointFromRight) digits = digits.padStart(pointFromRight + 1, '0');
  const intPart = digits.slice(0, digits.length - pointFromRight) || '0';
  const fracPart = digits.slice(digits.length - pointFromRight);
  return { intPart, fracPart };
}

function roundDigitString(digits: string, keepLen: number): { digits: string; carryOut: boolean } {
  if (digits.length < keepLen) digits = digits.padEnd(keepLen, '0');
  const kept = digits.slice(0, keepLen);
  const rest = digits.slice(keepLen);
  let roundUp = false;
  if (rest.length > 0) {
    const first = rest[0];
    if (first > '5') {
      roundUp = true;
    } else if (first === '5') {
      if (/[1-9]/.test(rest.slice(1))) {
        roundUp = true;
      } else {
        const lastKept = kept.length > 0 ? kept[kept.length - 1] : '0';
        roundUp = parseInt(lastKept, 10) % 2 === 1;
      }
    }
  }
  if (!roundUp) return { digits: kept, carryOut: false };
  const incremented = (BigInt(kept === '' ? '0' : kept) + 1n).toString();
  const padded = incremented.padStart(keepLen, '0');
  if (padded.length > keepLen) return { digits: padded, carryOut: true };
  return { digits: padded, carryOut: false };
}

function roundFrac(intPart: string, fracPart: string, places: number): { intPart: string; fracPart: string } {
  const combined = intPart + fracPart;
  const keepLen = intPart.length + places;
  const { digits: rd } = roundDigitString(combined, keepLen);
  const newIntLen = rd.length - places;
  return { intPart: rd.slice(0, newIntLen) || '0', fracPart: places > 0 ? rd.slice(newIntLen) : '' };
}

function normalize(intPart: string, fracPart: string): { digits: string; exponent: number } {
  const combined = intPart + fracPart;
  const pointPos = intPart.length;
  let idx = 0;
  while (idx < combined.length && combined[idx] === '0') idx++;
  if (idx === combined.length) return { digits: '0', exponent: 0 };
  return { digits: combined.slice(idx), exponent: pointPos - 1 - idx };
}

function roundSig(ndigits: string, exponent: number, sigCount: number): { digits: string; exponent: number } {
  const { digits: rd, carryOut } = roundDigitString(ndigits, sigCount);
  if (carryOut) return { digits: rd.slice(0, sigCount), exponent: exponent + 1 };
  return { digits: rd, exponent };
}

function pad(sign: string, rest: string, width: number | undefined, leftAlign: boolean, zeroPad: boolean): string {
  const body = sign + rest;
  if (width === undefined || body.length >= width) return body;
  const padLen = width - body.length;
  if (leftAlign) return body + ' '.repeat(padLen);
  if (zeroPad) return sign + '0'.repeat(padLen) + rest;
  return ' '.repeat(padLen) + body;
}

function stripTrailingZeros(frac: string): string {
  let end = frac.length;
  while (end > 0 && frac[end - 1] === '0') end--;
  return frac.slice(0, end);
}

export function format(fmt: string, ...args: Arg[]): string {
  let argIndex = 0;
  const re = /%([-+0# ]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc%])/g;

  return fmt.replace(re, (_match, flagsStr: string, widthStr: string, precisionStr: string | undefined, conv: string) => {
    if (conv === '%') return '%';

    const flags = new Set(flagsStr.split(''));
    const leftAlign = flags.has('-');
    const hasZero = flags.has('0');
    const hasPlus = flags.has('+');
    const hasSpace = flags.has(' ');
    const hasHash = flags.has('#');
    const width = widthStr === '' ? undefined : parseInt(widthStr, 10);
    const precisionGiven = precisionStr !== undefined;
    const precisionVal = precisionGiven ? (precisionStr === '' ? 0 : parseInt(precisionStr, 10)) : undefined;

    const arg = args[argIndex++];

    if (conv === 'd' || conv === 'i') {
      const raw = typeof arg === 'bigint' ? arg : BigInt(arg as number);
      const isNeg = raw < 0n;
      const magnitude = isNeg ? -raw : raw;
      let digits = magnitude.toString(10);
      if (precisionGiven) {
        const precision = precisionVal as number;
        if (precision === 0 && magnitude === 0n) digits = '';
        else digits = digits.padStart(precision, '0');
      }
      const sign = isNeg ? '-' : hasPlus ? '+' : hasSpace ? ' ' : '';
      const zeroPad = hasZero && !leftAlign && !precisionGiven;
      return pad(sign, digits, width, leftAlign, zeroPad);
    }

    if (conv === 'x' || conv === 'X' || conv === 'o') {
      const magnitude = typeof arg === 'bigint' ? arg : BigInt(arg as number);
      const base = conv === 'o' ? 8 : 16;
      let digits = magnitude.toString(base);
      if (conv === 'X') digits = digits.toUpperCase();
      if (precisionGiven) {
        const precision = precisionVal as number;
        if (precision === 0 && magnitude === 0n) digits = '';
        else digits = digits.padStart(precision, '0');
      }
      if (conv === 'o' && hasHash) {
        if (digits === '' || digits[0] !== '0') digits = '0' + digits;
      }
      let prefix = '';
      if ((conv === 'x' || conv === 'X') && hasHash && magnitude !== 0n) {
        prefix = conv === 'x' ? '0x' : '0X';
      }
      const zeroPad = hasZero && !leftAlign && !precisionGiven;
      return pad(prefix, digits, width, leftAlign, zeroPad);
    }

    if (conv === 'e' || conv === 'E' || conv === 'f' || conv === 'F' || conv === 'g' || conv === 'G') {
      const value = arg as number;
      const isUpper = conv === 'F' || conv === 'E' || conv === 'G';

      if (Number.isNaN(value)) {
        const body = isUpper ? 'NAN' : 'nan';
        return pad('', body, width, leftAlign, false);
      }

      const isNeg = value < 0 || Object.is(value, -0);
      const sign = isNeg ? '-' : hasPlus ? '+' : hasSpace ? ' ' : '';

      if (!Number.isFinite(value)) {
        const body = isUpper ? 'INF' : 'inf';
        return pad(sign, body, width, leftAlign, false);
      }

      const { intPart, fracPart } = exactDecimalOfAbs(Math.abs(value));
      const isZero = value === 0;

      if (conv === 'f' || conv === 'F') {
        const precision = precisionGiven ? (precisionVal as number) : 6;
        const { intPart: ri, fracPart: rf } = roundFrac(intPart, fracPart, precision);
        const fracStr = precision > 0 ? '.' + rf : hasHash ? '.' : '';
        const digitsStr = ri + fracStr;
        const zeroPad = hasZero && !leftAlign;
        return pad(sign, digitsStr, width, leftAlign, zeroPad);
      }

      if (conv === 'e' || conv === 'E') {
        const precision = precisionGiven ? (precisionVal as number) : 6;
        const eLetter = conv === 'E' ? 'E' : 'e';
        let leadDigit: string;
        let fracDigits: string;
        let exponent: number;
        if (isZero) {
          leadDigit = '0';
          fracDigits = '0'.repeat(precision);
          exponent = 0;
        } else {
          const norm = normalize(intPart, fracPart);
          const { digits: rd, exponent: exp2 } = roundSig(norm.digits, norm.exponent, precision + 1);
          leadDigit = rd[0];
          fracDigits = rd.slice(1);
          exponent = exp2;
        }
        const fracStr = precision > 0 ? '.' + fracDigits : hasHash ? '.' : '';
        const expSign = exponent < 0 ? '-' : '+';
        const expMag = Math.abs(exponent).toString().padStart(2, '0');
        const digitsStr = leadDigit + fracStr + eLetter + expSign + expMag;
        const zeroPad = hasZero && !leftAlign;
        return pad(sign, digitsStr, width, leftAlign, zeroPad);
      }

      // g, G
      let P = precisionGiven ? (precisionVal as number) : 6;
      if (P === 0) P = 1;
      const eLetter = conv === 'G' ? 'E' : 'e';

      let X: number;
      let norm: { digits: string; exponent: number } | null = null;
      if (isZero) {
        X = 0;
      } else {
        norm = normalize(intPart, fracPart);
        const { exponent: exp2 } = roundSig(norm.digits, norm.exponent, P);
        X = exp2;
      }

      let digitsStr: string;
      if (P > X && X >= -4) {
        const precision = P - 1 - X;
        const { intPart: ri, fracPart: rf } = roundFrac(intPart, fracPart, precision);
        let fracStr = precision > 0 ? rf : '';
        if (!hasHash) fracStr = stripTrailingZeros(fracStr);
        digitsStr = fracStr.length > 0 ? ri + '.' + fracStr : hasHash ? ri + '.' : ri;
      } else {
        const precision = P - 1;
        let leadDigit: string;
        let fracDigits: string;
        let exponent: number;
        if (isZero) {
          leadDigit = '0';
          fracDigits = '0'.repeat(precision);
          exponent = 0;
        } else {
          const { digits: rd, exponent: exp2 } = roundSig((norm as { digits: string; exponent: number }).digits, (norm as { digits: string; exponent: number }).exponent, P);
          leadDigit = rd[0];
          fracDigits = rd.slice(1);
          exponent = exp2;
        }
        if (!hasHash) fracDigits = stripTrailingZeros(fracDigits);
        const fracStr = fracDigits.length > 0 ? '.' + fracDigits : hasHash ? '.' : '';
        const expSign = exponent < 0 ? '-' : '+';
        const expMag = Math.abs(exponent).toString().padStart(2, '0');
        digitsStr = leadDigit + fracStr + eLetter + expSign + expMag;
      }
      const zeroPad = hasZero && !leftAlign;
      return pad(sign, digitsStr, width, leftAlign, zeroPad);
    }

    if (conv === 's') {
      let str = arg as string;
      if (precisionGiven) str = str.slice(0, precisionVal as number);
      return pad('', str, width, leftAlign, false);
    }

    if (conv === 'c') {
      const str = arg as string;
      return pad('', str, width, leftAlign, false);
    }

    return '';
  });
}
