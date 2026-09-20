type Digits = { intDigits: string; fracDigits: string };

function addOne(s: string): string {
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

function decideRoundUp(dropped: string, lastKeptDigit: string): boolean {
  const first = dropped[0];
  if (first < '5') return false;
  if (first > '5') return true;
  const restNonZero = /[1-9]/.test(dropped.slice(1));
  if (restNonZero) return true;
  return Number(lastKeptDigit) % 2 === 1;
}

// Decompose a non-negative finite JS number into its exact decimal digits
// (using the exact binary value), split at the decimal point.
function getExactDigits(abs: number): Digits {
  if (abs === 0) return { intDigits: '0', fracDigits: '' };

  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setFloat64(0, abs);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  const mantHi = hi & 0xfffff;
  const mantissa = (BigInt(mantHi) << 32n) | BigInt(lo);

  let m: bigint;
  let e: number;
  if (expBits === 0) {
    m = mantissa;
    e = -1074;
  } else {
    m = mantissa | (1n << 52n);
    e = expBits - 1075;
  }

  if (e >= 0) {
    const intVal = m << BigInt(e);
    return { intDigits: intVal.toString(), fracDigits: '' };
  }

  const k = -e;
  const scaled = m * 5n ** BigInt(k);
  let digits = scaled.toString();
  if (digits.length <= k) digits = '0'.repeat(k - digits.length + 1) + digits;
  const intDigits = digits.slice(0, digits.length - k) || '0';
  const fracDigits = digits.slice(digits.length - k);
  return { intDigits, fracDigits };
}

function roundFraction(intDigits: string, fracDigits: string, precision: number): Digits {
  if (precision >= fracDigits.length) {
    return { intDigits, fracDigits: fracDigits.padEnd(precision, '0') };
  }
  const kept = fracDigits.slice(0, precision);
  const dropped = fracDigits.slice(precision);
  const lastKept = precision > 0 ? kept[precision - 1] : intDigits[intDigits.length - 1];
  const roundUp = decideRoundUp(dropped, lastKept);
  if (!roundUp) return { intDigits, fracDigits: kept };

  const combined = intDigits + kept;
  const newCombined = addOne(combined);
  if (newCombined.length > combined.length) {
    const newIntLen = intDigits.length + 1;
    return { intDigits: newCombined.slice(0, newIntLen), fracDigits: newCombined.slice(newIntLen) };
  }
  return { intDigits: newCombined.slice(0, intDigits.length), fracDigits: newCombined.slice(intDigits.length) };
}

function toSignificant(intDigits: string, fracDigits: string, sig: number): { digits: string; exponent: number } {
  const D = intDigits + fracDigits;
  let idx = 0;
  while (idx < D.length && D[idx] === '0') idx++;
  if (idx === D.length) {
    return { digits: '0'.repeat(sig), exponent: 0 };
  }
  let exponent = intDigits.length - 1 - idx;
  const window = D.slice(idx);
  let digits: string;
  if (window.length <= sig) {
    digits = window.padEnd(sig, '0');
  } else {
    const keep = window.slice(0, sig);
    const dropped = window.slice(sig);
    const roundUp = decideRoundUp(dropped, keep[sig - 1]);
    if (roundUp) {
      const newKeep = addOne(keep);
      if (newKeep.length > keep.length) {
        exponent += 1;
        digits = newKeep.slice(0, sig);
      } else {
        digits = newKeep;
      }
    } else {
      digits = keep;
    }
  }
  return { digits, exponent };
}

function trimFraction(intPart: string, fracPart: string, hash: boolean): string {
  let frac = fracPart;
  if (!hash) frac = frac.replace(/0+$/, '');
  const dot = frac.length > 0 || hash ? '.' : '';
  return intPart + dot + frac;
}

function assembleNumeric(prefix: string, digits: string, width: number, leftAlign: boolean, zeroPad: boolean): string {
  const body = prefix + digits;
  if (body.length >= width) return body;
  if (leftAlign) return body + ' '.repeat(width - body.length);
  if (zeroPad) return prefix + '0'.repeat(width - body.length) + digits;
  return ' '.repeat(width - body.length) + body;
}

function padSimple(str: string, width: number, leftAlign: boolean): string {
  if (str.length >= width) return str;
  const padding = ' '.repeat(width - str.length);
  return leftAlign ? str + padding : padding + str;
}

function toBigIntArg(value: number | bigint): bigint {
  return typeof value === 'bigint' ? value : BigInt(value);
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let argIndex = 0;
  const regex = /%([-+0# ]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc%])/g;

  return fmt.replace(regex, (_match, flagsStr: string, widthStr: string, precStr: string | undefined, conv: string) => {
    if (conv === '%') return '%';

    const hasMinus = flagsStr.includes('-');
    const hasPlus = flagsStr.includes('+');
    const hasSpace = flagsStr.includes(' ');
    const hasZero = flagsStr.includes('0');
    const hasHash = flagsStr.includes('#');
    const width = widthStr ? parseInt(widthStr, 10) : 0;
    const precisionGiven = precStr !== undefined;
    const precision = precisionGiven ? (precStr === '' ? 0 : parseInt(precStr, 10)) : undefined;

    const arg = args[argIndex++];

    if (conv === 's') {
      let str = String(arg);
      if (precision !== undefined) str = str.slice(0, precision);
      return padSimple(str, width, hasMinus);
    }

    if (conv === 'c') {
      const str = String(arg);
      return padSimple(str, width, hasMinus);
    }

    if (conv === 'd' || conv === 'i') {
      const value = arg as number | bigint;
      const neg = typeof value === 'bigint' ? value < 0n : value < 0 || Object.is(value, -0);
      const absBig = typeof value === 'bigint' ? (value < 0n ? -value : value) : BigInt(Math.abs(value));
      let digits = absBig.toString();
      if (precision !== undefined) {
        if (precision === 0 && absBig === 0n) digits = '';
        else digits = digits.padStart(precision, '0');
      }
      const sign = neg ? '-' : hasPlus ? '+' : hasSpace ? ' ' : '';
      const zeroPad = hasZero && !precisionGiven;
      return assembleNumeric(sign, digits, width, hasMinus, zeroPad);
    }

    if (conv === 'x' || conv === 'X' || conv === 'o') {
      const value = arg as number | bigint;
      const big = toBigIntArg(value);
      let digits = conv === 'o' ? big.toString(8) : big.toString(16);
      if (conv === 'X') digits = digits.toUpperCase();
      if (precision !== undefined) {
        if (precision === 0 && big === 0n) digits = '';
        else digits = digits.padStart(precision, '0');
      }
      let prefix = '';
      if (hasHash) {
        if ((conv === 'x' || conv === 'X') && big !== 0n) {
          prefix = conv === 'x' ? '0x' : '0X';
        } else if (conv === 'o') {
          if (digits.length === 0 || digits[0] !== '0') digits = '0' + digits;
        }
      }
      const zeroPad = hasZero && !precisionGiven;
      return assembleNumeric(prefix, digits, width, hasMinus, zeroPad);
    }

    // e E f F g G
    const value = arg as number;
    const isUpper = conv === 'E' || conv === 'F' || conv === 'G';
    const neg = value < 0 || Object.is(value, -0);
    const signStr = neg ? '-' : hasPlus ? '+' : hasSpace ? ' ' : '';

    if (Number.isNaN(value)) {
      const text = isUpper ? 'NAN' : 'nan';
      return assembleNumeric('', text, width, hasMinus, false);
    }
    if (!Number.isFinite(value)) {
      const text = isUpper ? 'INF' : 'inf';
      return assembleNumeric(signStr, text, width, hasMinus, false);
    }

    const abs = Math.abs(value);
    const { intDigits, fracDigits } = getExactDigits(abs);
    const zeroPad = hasZero;

    if (conv === 'f' || conv === 'F') {
      const prec = precision !== undefined ? precision : 6;
      const rounded = roundFraction(intDigits, fracDigits, prec);
      const dot = prec > 0 || hasHash ? '.' : '';
      const digits = rounded.intDigits + dot + rounded.fracDigits;
      return assembleNumeric(signStr, digits, width, hasMinus, zeroPad);
    }

    if (conv === 'e' || conv === 'E') {
      const prec = precision !== undefined ? precision : 6;
      const sig = prec + 1;
      const { digits: sigDigits, exponent } = toSignificant(intDigits, fracDigits, sig);
      const first = sigDigits[0];
      const rest = sigDigits.slice(1);
      const dot = prec > 0 || hasHash ? '.' : '';
      const expLetter = conv === 'E' ? 'E' : 'e';
      const expSign = exponent < 0 ? '-' : '+';
      const expAbs = Math.abs(exponent).toString().padStart(2, '0');
      const digits = first + dot + rest + expLetter + expSign + expAbs;
      return assembleNumeric(signStr, digits, width, hasMinus, zeroPad);
    }

    // g G
    let P = precision !== undefined ? precision : 6;
    if (P === 0) P = 1;
    const { digits: sigDigits, exponent: X } = toSignificant(intDigits, fracDigits, P);

    let digits: string;
    if (P > X && X >= -4) {
      const prec = P - 1 - X;
      const rounded = roundFraction(intDigits, fracDigits, prec);
      digits = trimFraction(rounded.intDigits, rounded.fracDigits, hasHash);
    } else {
      const first = sigDigits[0];
      let rest = sigDigits.slice(1);
      if (!hasHash) rest = rest.replace(/0+$/, '');
      const dot = rest.length > 0 || hasHash ? '.' : '';
      const expLetter = conv === 'G' ? 'E' : 'e';
      const expSign = X < 0 ? '-' : '+';
      const expAbs = Math.abs(X).toString().padStart(2, '0');
      digits = first + dot + rest + expLetter + expSign + expAbs;
    }
    return assembleNumeric(signStr, digits, width, hasMinus, zeroPad);
  });
}
