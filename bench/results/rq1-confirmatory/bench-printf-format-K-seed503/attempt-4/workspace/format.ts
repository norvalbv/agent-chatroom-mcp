function incrementDecimalString(s: string): string {
  const arr = s.split('');
  let i = arr.length - 1;
  while (i >= 0 && arr[i] === '9') {
    arr[i] = '0';
    i--;
  }
  if (i < 0) return '1' + arr.join('');
  arr[i] = String(Number(arr[i]) + 1);
  return arr.join('');
}

function exactDecimal(x: number): { intDigits: string; fracDigits: string } {
  if (x === 0) return { intDigits: '0', fracDigits: '' };
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setFloat64(0, x);
  const hi = BigInt(dv.getUint32(0));
  const lo = BigInt(dv.getUint32(4));
  const bits = (hi << 32n) | lo;
  const expBits = Number((bits >> 52n) & 0x7ffn);
  const mantBits = bits & 0xfffffffffffffn;
  let m: bigint;
  let e: number;
  if (expBits === 0) {
    m = mantBits;
    e = -1074;
  } else {
    m = mantBits | (1n << 52n);
    e = expBits - 1075;
  }
  if (e >= 0) {
    const n = m << BigInt(e);
    return { intDigits: n.toString(), fracDigits: '' };
  }
  const k = -e;
  const n = m * 5n ** BigInt(k);
  const str = n.toString().padStart(k + 1, '0');
  const intDigits = str.slice(0, str.length - k);
  const fracDigits = str.slice(str.length - k);
  return { intDigits, fracDigits };
}

function roundFixed(
  intDigits: string,
  fracDigits: string,
  n: number,
): { intDigits: string; fracDigits: string } {
  if (fracDigits.length <= n) {
    return { intDigits, fracDigits: fracDigits.padEnd(n, '0') };
  }
  const keep = fracDigits.slice(0, n);
  const rest = fracDigits.slice(n);
  let roundUp: boolean;
  if (rest[0] < '5') roundUp = false;
  else if (rest[0] > '5') roundUp = true;
  else if (/[1-9]/.test(rest.slice(1))) roundUp = true;
  else {
    const lastDigit = n > 0 ? keep[keep.length - 1] : intDigits[intDigits.length - 1];
    roundUp = Number(lastDigit) % 2 === 1;
  }
  let combined = intDigits + keep;
  if (roundUp) combined = incrementDecimalString(combined);
  const newIntLen = combined.length - n;
  const newInt = combined.slice(0, newIntLen) || '0';
  const newFrac = n > 0 ? combined.slice(newIntLen) : '';
  return { intDigits: newInt, fracDigits: newFrac };
}

function roundSignificant(sig: string, n: number): { digits: string; exponentDelta: number } {
  if (sig.length <= n) {
    return { digits: sig.padEnd(n, '0'), exponentDelta: 0 };
  }
  const keep = sig.slice(0, n);
  const rest = sig.slice(n);
  let roundUp: boolean;
  if (rest[0] < '5') roundUp = false;
  else if (rest[0] > '5') roundUp = true;
  else if (/[1-9]/.test(rest.slice(1))) roundUp = true;
  else roundUp = Number(keep[keep.length - 1]) % 2 === 1;
  let combined = keep;
  if (roundUp) combined = incrementDecimalString(combined);
  if (combined.length > n) {
    return { digits: combined.slice(0, n), exponentDelta: 1 };
  }
  return { digits: combined, exponentDelta: 0 };
}

function getFixedParts(x: number, prec: number): { intDigits: string; fracDigits: string } {
  if (x === 0) return { intDigits: '0', fracDigits: '0'.repeat(prec) };
  const { intDigits, fracDigits } = exactDecimal(x);
  return roundFixed(intDigits, fracDigits, prec);
}

function getExpParts(
  x: number,
  prec: number,
): { leadDigit: string; fracDigits: string; exponent: number } {
  if (x === 0) return { leadDigit: '0', fracDigits: '0'.repeat(prec), exponent: 0 };
  const { intDigits, fracDigits } = exactDecimal(x);
  const full = intDigits + fracDigits;
  let firstNonZero = 0;
  while (full[firstNonZero] === '0') firstNonZero++;
  const exponent0 = intDigits.length - 1 - firstNonZero;
  const sig = full.slice(firstNonZero);
  const { digits, exponentDelta } = roundSignificant(sig, prec + 1);
  return { leadDigit: digits[0], fracDigits: digits.slice(1), exponent: exponent0 + exponentDelta };
}

function formatG(x: number, precision: number | null, hasHash: boolean, upper: boolean): string {
  const P = precision === null ? 6 : precision === 0 ? 1 : precision;
  const probe = getExpParts(x, P - 1);
  const X = probe.exponent;
  if (P > X && X >= -4) {
    const prec = P - 1 - X;
    const { intDigits, fracDigits } = getFixedParts(x, prec);
    let frac = fracDigits;
    if (!hasHash) frac = frac.replace(/0+$/, '');
    return intDigits + (frac.length > 0 || hasHash ? '.' + frac : '');
  }
  const expSign = probe.exponent >= 0 ? '+' : '-';
  const expMag = Math.abs(probe.exponent).toString().padStart(2, '0');
  let frac = probe.fracDigits;
  if (!hasHash) frac = frac.replace(/0+$/, '');
  const mantissa = probe.leadDigit + (frac.length > 0 || hasHash ? '.' + frac : '');
  return mantissa + (upper ? 'E' : 'e') + expSign + expMag;
}

function padNumeric(
  sign: string,
  prefix: string,
  digits: string,
  width: number,
  hasMinus: boolean,
  hasZero: boolean,
): string {
  const bodyLen = sign.length + prefix.length + digits.length;
  if (bodyLen >= width) return sign + prefix + digits;
  const padLen = width - bodyLen;
  if (hasMinus) return sign + prefix + digits + ' '.repeat(padLen);
  if (hasZero) return sign + prefix + '0'.repeat(padLen) + digits;
  return ' '.repeat(padLen) + sign + prefix + digits;
}

function padString(s: string, width: number, hasMinus: boolean): string {
  if (s.length >= width) return s;
  const pad = ' '.repeat(width - s.length);
  return hasMinus ? s + pad : pad + s;
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let result = '';
  let argIndex = 0;
  let i = 0;
  const n = fmt.length;
  while (i < n) {
    const ch = fmt[i];
    if (ch !== '%') {
      result += ch;
      i++;
      continue;
    }
    if (fmt[i + 1] === '%') {
      result += '%';
      i += 2;
      continue;
    }
    let j = i + 1;
    let flags = '';
    while (j < n && '-+0 #'.includes(fmt[j])) {
      flags += fmt[j];
      j++;
    }
    let widthStr = '';
    while (j < n && fmt[j] >= '0' && fmt[j] <= '9') {
      widthStr += fmt[j];
      j++;
    }
    let precision: number | null = null;
    if (fmt[j] === '.') {
      j++;
      let precStr = '';
      while (j < n && fmt[j] >= '0' && fmt[j] <= '9') {
        precStr += fmt[j];
        j++;
      }
      precision = precStr === '' ? 0 : parseInt(precStr, 10);
    }
    const conv = fmt[j];
    j++;

    const width = widthStr === '' ? 0 : parseInt(widthStr, 10);
    const hasMinus = flags.includes('-');
    const hasPlus = flags.includes('+');
    const hasSpace = flags.includes(' ');
    const hasZero = flags.includes('0');
    const hasHash = flags.includes('#');

    const arg = args[argIndex++];
    let converted: string;

    switch (conv) {
      case 'd':
      case 'i': {
        const big = typeof arg === 'bigint' ? arg : BigInt(arg as number);
        const negative = big < 0n;
        const abs = negative ? -big : big;
        const digitsStr = abs.toString();
        let digits: string;
        if (precision !== null) {
          digits = abs === 0n && precision === 0 ? '' : digitsStr.padStart(precision, '0');
        } else {
          digits = digitsStr;
        }
        const sign = negative ? '-' : hasPlus ? '+' : hasSpace ? ' ' : '';
        const zeroOk = hasZero && precision === null;
        converted = padNumeric(sign, '', digits, width, hasMinus, zeroOk);
        break;
      }
      case 'x':
      case 'X':
      case 'o': {
        const big = typeof arg === 'bigint' ? arg : BigInt(arg as number);
        const base = conv === 'o' ? 8 : 16;
        let digitsStr = big.toString(base);
        if (conv === 'X') digitsStr = digitsStr.toUpperCase();
        let digits: string;
        if (precision !== null) {
          digits = big === 0n && precision === 0 ? '' : digitsStr.padStart(precision, '0');
        } else {
          digits = digitsStr;
        }
        let prefix = '';
        if (hasHash) {
          if ((conv === 'x' || conv === 'X') && big !== 0n) {
            prefix = conv === 'x' ? '0x' : '0X';
          } else if (conv === 'o') {
            if (digits === '' || digits[0] !== '0') digits = '0' + digits;
          }
        }
        const zeroOk = hasZero && precision === null;
        converted = padNumeric('', prefix, digits, width, hasMinus, zeroOk);
        break;
      }
      case 'e':
      case 'E':
      case 'f':
      case 'F':
      case 'g':
      case 'G': {
        const value = arg as number;
        const upper = conv === conv.toUpperCase();
        const isNaN = Number.isNaN(value);
        const negative = !isNaN && (value < 0 || Object.is(value, -0));
        const sign = isNaN ? '' : negative ? '-' : hasPlus ? '+' : hasSpace ? ' ' : '';
        let bodyDigits: string;
        let zeroFlagAllowed = true;
        if (isNaN) {
          bodyDigits = upper ? 'NAN' : 'nan';
          zeroFlagAllowed = false;
        } else if (!Number.isFinite(value)) {
          bodyDigits = upper ? 'INF' : 'inf';
          zeroFlagAllowed = false;
        } else {
          const mag = Math.abs(value);
          const prec = precision === null ? 6 : precision;
          if (conv === 'f' || conv === 'F') {
            const { intDigits, fracDigits } = getFixedParts(mag, prec);
            bodyDigits = intDigits + (prec > 0 || hasHash ? '.' + fracDigits : '');
          } else if (conv === 'e' || conv === 'E') {
            const { leadDigit, fracDigits, exponent } = getExpParts(mag, prec);
            const expSign = exponent >= 0 ? '+' : '-';
            const expMag = Math.abs(exponent).toString().padStart(2, '0');
            bodyDigits =
              leadDigit +
              (prec > 0 || hasHash ? '.' + fracDigits : '') +
              (upper ? 'E' : 'e') +
              expSign +
              expMag;
          } else {
            bodyDigits = formatG(mag, precision, hasHash, upper);
          }
        }
        const effectiveZero = hasZero && zeroFlagAllowed;
        converted = padNumeric(sign, '', bodyDigits, width, hasMinus, effectiveZero);
        break;
      }
      case 's': {
        let str = arg as string;
        if (precision !== null) str = str.slice(0, precision);
        converted = padString(str, width, hasMinus);
        break;
      }
      case 'c': {
        const str = arg as string;
        converted = padString(str, width, hasMinus);
        break;
      }
      default:
        throw new Error(`Unsupported conversion: %${conv}`);
    }

    result += converted;
    i = j;
  }
  return result;
}
