function signBit(x: number): boolean {
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setFloat64(0, x, false);
  return (dv.getUint8(0) & 0x80) !== 0;
}

function exactDecimalParts(absX: number): { intPart: string; fracPart: string } {
  if (absX === 0) return { intPart: '0', fracPart: '' };
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setFloat64(0, absX, false);
  const bits = dv.getBigUint64(0, false);
  const expBits = (bits >> 52n) & 0x7ffn;
  const mantissaBits = bits & 0xfffffffffffffn;
  let mantissa: bigint;
  let exponent: number;
  if (expBits === 0n) {
    mantissa = mantissaBits;
    exponent = -1074;
  } else {
    mantissa = mantissaBits + (1n << 52n);
    exponent = Number(expBits) - 1075;
  }
  let numerator: bigint;
  let scale: number;
  if (exponent >= 0) {
    numerator = mantissa << BigInt(exponent);
    scale = 0;
  } else {
    const k = -exponent;
    numerator = mantissa * 5n ** BigInt(k);
    scale = k;
  }
  let digits = numerator.toString();
  if (digits.length <= scale) {
    digits = '0'.repeat(scale - digits.length + 1) + digits;
  }
  const cut = digits.length - scale;
  const intPart = digits.slice(0, cut) || '0';
  const fracPart = scale > 0 ? digits.slice(cut) : '';
  return { intPart, fracPart };
}

function incrementDecimalString(s: string): string {
  const arr = s.split('');
  let i = arr.length - 1;
  while (i >= 0) {
    if (arr[i] === '9') {
      arr[i] = '0';
      i--;
    } else {
      arr[i] = String(Number(arr[i]) + 1);
      return arr.join('');
    }
  }
  return '1' + arr.join('');
}

function decideRoundUp(restFirst: string, restAfter: string, lastKeptDigit: string): boolean {
  if (restFirst === '') return false;
  if (restFirst > '5') return true;
  if (restFirst < '5') return false;
  if (/[1-9]/.test(restAfter)) return true;
  return Number(lastKeptDigit) % 2 === 1;
}

function roundFrac(
  intPart: string,
  fracPart: string,
  ndigits: number
): { intPart: string; fracPart: string } {
  if (fracPart.length <= ndigits) {
    return { intPart, fracPart: fracPart.padEnd(ndigits, '0') };
  }
  const keep = fracPart.slice(0, ndigits);
  const rest = fracPart.slice(ndigits);
  const lastKept = ndigits > 0 ? keep[ndigits - 1] : intPart[intPart.length - 1];
  const roundUp = decideRoundUp(rest[0], rest.slice(1), lastKept);
  let combined = intPart + keep;
  if (roundUp) combined = incrementDecimalString(combined);
  const newIntLen = combined.length - ndigits;
  let newIntPart = combined.slice(0, newIntLen) || '0';
  const newFracPart = ndigits > 0 ? combined.slice(newIntLen) : '';
  newIntPart = newIntPart.replace(/^0+(?=\d)/, '');
  return { intPart: newIntPart, fracPart: newFracPart };
}

function roundSig(
  F: string,
  firstIndex: number,
  P: number
): { digits: string; expAdjust: number } {
  const significant = F.slice(firstIndex, firstIndex + P).padEnd(P, '0');
  const rest = F.slice(firstIndex + P);
  const lastKept = significant[P - 1];
  const roundUp = decideRoundUp(rest[0] ?? '', rest.slice(1), lastKept);
  if (!roundUp) return { digits: significant, expAdjust: 0 };
  const incremented = incrementDecimalString(significant);
  if (incremented.length > P) {
    return { digits: incremented.slice(0, P), expAdjust: 1 };
  }
  return { digits: incremented, expAdjust: 0 };
}

function getSign(negative: boolean, flags: string): string {
  if (negative) return '-';
  if (flags.includes('+')) return '+';
  if (flags.includes(' ')) return ' ';
  return '';
}

function padNumeric(
  signStr: string,
  prefix: string,
  body: string,
  width: number,
  flags: string,
  zeroAllowed: boolean
): string {
  const core = signStr + prefix + body;
  if (core.length >= width) return core;
  if (flags.includes('-')) return core + ' '.repeat(width - core.length);
  if (flags.includes('0') && zeroAllowed) {
    return signStr + prefix + '0'.repeat(width - core.length) + body;
  }
  return ' '.repeat(width - core.length) + core;
}

function padWidth(s: string, width: number, flags: string): string {
  if (s.length >= width) return s;
  const pad = ' '.repeat(width - s.length);
  return flags.includes('-') ? s + pad : pad + s;
}

function formatFloatConversion(
  value: number,
  conversion: string,
  flags: string,
  width: number,
  precisionArg: number | null
): string {
  const upperGroup = conversion === conversion.toUpperCase();
  const negative = signBit(value);

  if (Number.isNaN(value)) {
    const body = upperGroup ? 'NAN' : 'nan';
    return padNumeric('', '', body, width, flags, false);
  }
  if (!Number.isFinite(value)) {
    const body = upperGroup ? 'INF' : 'inf';
    const sign = getSign(negative, flags);
    return padNumeric(sign, '', body, width, flags, false);
  }

  const sign = getSign(negative, flags);
  const abs = Math.abs(value);
  const { intPart, fracPart } = exactDecimalParts(abs);
  const lower = conversion.toLowerCase();

  if (lower === 'f') {
    const precision = precisionArg ?? 6;
    const { intPart: ip, fracPart: fp } = roundFrac(intPart, fracPart, precision);
    const body = ip + (precision > 0 || flags.includes('#') ? '.' + fp : '');
    return padNumeric(sign, '', body, width, flags, true);
  }

  if (lower === 'e') {
    const precision = precisionArg ?? 6;
    const P = precision + 1;
    const F = intPart + fracPart;
    const L = intPart.length;
    let digits: string;
    let E: number;
    if (abs === 0) {
      digits = '0'.repeat(P);
      E = 0;
    } else {
      const firstIdx = F.search(/[1-9]/);
      E = L - 1 - firstIdx;
      const rs = roundSig(F, firstIdx, P);
      digits = rs.digits;
      E += rs.expAdjust;
    }
    const mantissa = digits[0] + (precision > 0 || flags.includes('#') ? '.' + digits.slice(1) : '');
    const letter = conversion === 'E' ? 'E' : 'e';
    const expSign = E < 0 ? '-' : '+';
    const expDigits = Math.abs(E).toString().padStart(2, '0');
    const body = mantissa + letter + expSign + expDigits;
    return padNumeric(sign, '', body, width, flags, true);
  }

  // g, G
  const rawPrecision = precisionArg ?? 6;
  const P = rawPrecision === 0 ? 1 : rawPrecision;
  const F = intPart + fracPart;
  const L = intPart.length;
  let digits: string;
  let X: number;
  if (abs === 0) {
    digits = '0'.repeat(P);
    X = 0;
  } else {
    const firstIdx = F.search(/[1-9]/);
    X = L - 1 - firstIdx;
    const rs = roundSig(F, firstIdx, P);
    digits = rs.digits;
    X += rs.expAdjust;
  }

  const hash = flags.includes('#');
  let body: string;
  if (P > X && X >= -4) {
    let ip: string;
    let fp: string;
    if (X >= 0) {
      ip = digits.slice(0, X + 1);
      fp = digits.slice(X + 1);
    } else {
      ip = '0';
      fp = '0'.repeat(-X - 1) + digits;
    }
    if (!hash) {
      fp = fp.replace(/0+$/, '');
    }
    body = ip + (fp.length > 0 || hash ? '.' + fp : '');
  } else {
    let ip = digits[0];
    let fp = digits.slice(1);
    if (!hash) {
      fp = fp.replace(/0+$/, '');
    }
    const letter = conversion === 'G' ? 'E' : 'e';
    const expSign = X < 0 ? '-' : '+';
    const expDigits = Math.abs(X).toString().padStart(2, '0');
    body = ip + (fp.length > 0 || hash ? '.' + fp : '') + letter + expSign + expDigits;
  }
  return padNumeric(sign, '', body, width, flags, true);
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  const re = /%([-+0 #]*)(\d*)(\.\d*)?([diouxXeEfFgGsc%])/g;
  let result = '';
  let lastIndex = 0;
  let argIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = re.exec(fmt)) !== null) {
    result += fmt.slice(lastIndex, match.index);
    lastIndex = re.lastIndex;

    const [, flags, widthStr, precisionStr, conversion] = match;
    const width = widthStr ? parseInt(widthStr, 10) : 0;
    const precision =
      precisionStr === undefined
        ? null
        : precisionStr === '.'
          ? 0
          : parseInt(precisionStr.slice(1), 10);

    if (conversion === '%') {
      result += '%';
      continue;
    }

    const arg = args[argIndex++];

    if (conversion === 'd' || conversion === 'i') {
      const big = typeof arg === 'bigint' ? arg : BigInt(Math.trunc(arg as number));
      const negative = big < 0n;
      const magnitude = negative ? -big : big;
      let digits = magnitude.toString();
      if (precision !== null) {
        digits = precision === 0 && magnitude === 0n ? '' : digits.padStart(precision, '0');
      }
      const sign = getSign(negative, flags);
      result += padNumeric(sign, '', digits, width, flags, precision === null);
    } else if (conversion === 'x' || conversion === 'X' || conversion === 'o') {
      const big = typeof arg === 'bigint' ? arg : BigInt(arg as number);
      let digits = conversion === 'o' ? big.toString(8) : big.toString(16);
      if (conversion === 'X') digits = digits.toUpperCase();
      if (precision !== null) {
        digits = precision === 0 && big === 0n ? '' : digits.padStart(precision, '0');
      }
      let prefix = '';
      if (flags.includes('#')) {
        if (conversion === 'x' && big !== 0n) prefix = '0x';
        else if (conversion === 'X' && big !== 0n) prefix = '0X';
        else if (conversion === 'o') {
          if (digits === '' || digits[0] !== '0') digits = '0' + digits;
        }
      }
      result += padNumeric('', prefix, digits, width, flags, precision === null);
    } else if (
      conversion === 'e' ||
      conversion === 'E' ||
      conversion === 'f' ||
      conversion === 'F' ||
      conversion === 'g' ||
      conversion === 'G'
    ) {
      result += formatFloatConversion(Number(arg), conversion, flags, width, precision);
    } else if (conversion === 's') {
      let s = String(arg);
      if (precision !== null) s = s.slice(0, precision);
      result += padWidth(s, width, flags);
    } else if (conversion === 'c') {
      const s = String(arg);
      result += padWidth(s, width, flags);
    }
  }

  result += fmt.slice(lastIndex);
  return result;
}
