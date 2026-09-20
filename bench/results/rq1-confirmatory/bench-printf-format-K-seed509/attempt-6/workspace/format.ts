type Arg = number | bigint | string;

interface Decomposed {
  mantissa: bigint; // magnitude mantissa, value = mantissa * 2^exp
  exp: number;
}

function decomposeDouble(x: number): Decomposed {
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setFloat64(0, Math.abs(x));
  const high = view.getUint32(0);
  const low = view.getUint32(4);
  const biasedExp = (high >>> 20) & 0x7ff;
  const mantHigh = high & 0xfffff;
  let mantissa = (BigInt(mantHigh) << 32n) | BigInt(low);
  let exp: number;
  if (biasedExp === 0) {
    exp = -1074;
  } else {
    mantissa = mantissa | (1n << 52n);
    exp = biasedExp - 1075;
  }
  return { mantissa, exp };
}

// round(mantissa * 2^exp * 10^p) to nearest integer, ties to even
function roundHalfEven(mantissa: bigint, exp: number, p: number): bigint {
  let num = mantissa;
  let den = 1n;
  const e2 = exp + p;
  const e5 = p;
  if (e2 >= 0) num *= 2n ** BigInt(e2);
  else den *= 2n ** BigInt(-e2);
  if (e5 >= 0) num *= 5n ** BigInt(e5);
  else den *= 5n ** BigInt(-e5);
  const q = num / den;
  const r = num % den;
  const twice = r * 2n;
  if (twice < den) return q;
  if (twice > den) return q + 1n;
  return q % 2n === 0n ? q : q + 1n;
}

function formatFixedDigits(mantissa: bigint, exp: number, precision: number): { intPart: string; fracPart: string } {
  const N = roundHalfEven(mantissa, exp, precision);
  let digits = N.toString();
  if (digits.length < precision + 1) {
    digits = '0'.repeat(precision + 1 - digits.length) + digits;
  }
  if (precision === 0) {
    return { intPart: digits, fracPart: '' };
  }
  const intPart = digits.slice(0, digits.length - precision);
  const fracPart = digits.slice(digits.length - precision);
  return { intPart, fracPart };
}

// significant-digit rounding: value ~ d[0].d[1:] * 10^exponent, digits.length === sig
function roundSignificant(mantissa: bigint, exp: number, sig: number): { digits: string; exponent: number } {
  if (mantissa === 0n) {
    return { digits: '0'.repeat(sig), exponent: 0 };
  }
  let E = Math.floor(Math.log10(Number(mantissa)) + exp * Math.log10(2));
  for (let iter = 0; iter < 10; iter++) {
    const p = sig - 1 - E;
    const N = roundHalfEven(mantissa, exp, p);
    const digits = N.toString();
    if (digits.length === sig) {
      return { digits, exponent: E };
    }
    if (digits.length > sig) {
      E += digits.length - sig;
    } else {
      E -= sig - digits.length;
    }
  }
  const p = sig - 1 - E;
  let digits = roundHalfEven(mantissa, exp, p).toString();
  if (digits.length < sig) digits = '0'.repeat(sig - digits.length) + digits;
  else if (digits.length > sig) digits = digits.slice(0, sig);
  return { digits, exponent: E };
}

interface Spec {
  flags: string;
  width: number | null;
  precision: number | null;
  conv: string;
}

function parseSpec(fmt: string, i: number): { spec: Spec; next: number } {
  let j = i + 1;
  let flags = '';
  while (j < fmt.length && '-+ 0#'.includes(fmt[j])) {
    flags += fmt[j];
    j++;
  }
  let widthStr = '';
  while (j < fmt.length && fmt[j] >= '0' && fmt[j] <= '9') {
    widthStr += fmt[j];
    j++;
  }
  let precision: number | null = null;
  if (fmt[j] === '.') {
    j++;
    let precStr = '';
    while (j < fmt.length && fmt[j] >= '0' && fmt[j] <= '9') {
      precStr += fmt[j];
      j++;
    }
    precision = precStr === '' ? 0 : parseInt(precStr, 10);
  }
  const conv = fmt[j];
  j++;
  return {
    spec: {
      flags,
      width: widthStr === '' ? null : parseInt(widthStr, 10),
      precision,
      conv,
    },
    next: j,
  };
}

function padNumeric(sign: string, prefix: string, digits: string, width: number | null, leftAlign: boolean, zeroPad: boolean): string {
  const bodyLen = sign.length + prefix.length + digits.length;
  if (width !== null && width > bodyLen) {
    if (zeroPad && !leftAlign) {
      return sign + prefix + '0'.repeat(width - bodyLen) + digits;
    }
    const content = sign + prefix + digits;
    const pad = ' '.repeat(width - bodyLen);
    return leftAlign ? content + pad : pad + content;
  }
  return sign + prefix + digits;
}

function padGeneric(content: string, width: number | null, leftAlign: boolean): string {
  if (width !== null && width > content.length) {
    const pad = ' '.repeat(width - content.length);
    return leftAlign ? content + pad : pad + content;
  }
  return content;
}

function toBigIntArg(arg: Arg): bigint {
  return typeof arg === 'bigint' ? arg : BigInt(arg as number);
}

function toNumberArg(arg: Arg): number {
  return typeof arg === 'number' ? arg : Number(arg);
}

function formatIntConv(conv: string, spec: Spec, arg: Arg): string {
  const value = toBigIntArg(arg);
  const leftAlign = spec.flags.includes('-');
  const zeroFlag = spec.flags.includes('0');
  const hasPrecision = spec.precision !== null;

  if (conv === 'd' || conv === 'i') {
    const neg = value < 0n;
    const magnitude = neg ? -value : value;
    let digits = magnitude.toString(10);
    if (hasPrecision) {
      const precision = spec.precision as number;
      if (precision === 0 && magnitude === 0n) {
        digits = '';
      } else if (digits.length < precision) {
        digits = '0'.repeat(precision - digits.length) + digits;
      }
    }
    const sign = neg ? '-' : spec.flags.includes('+') ? '+' : spec.flags.includes(' ') ? ' ' : '';
    const zeroPad = zeroFlag && !hasPrecision;
    return padNumeric(sign, '', digits, spec.width, leftAlign, zeroPad);
  }

  // x, X, o
  const magnitude = value;
  let base: number;
  if (conv === 'o') base = 8;
  else base = 16;
  let digits = magnitude.toString(base);
  if (conv === 'X') digits = digits.toUpperCase();
  if (hasPrecision) {
    const precision = spec.precision as number;
    if (precision === 0 && magnitude === 0n) {
      digits = '';
    } else if (digits.length < precision) {
      digits = '0'.repeat(precision - digits.length) + digits;
    }
  }
  const hash = spec.flags.includes('#');
  let prefix = '';
  if (hash) {
    if (conv === 'o') {
      if (digits === '' || digits[0] !== '0') {
        digits = '0' + digits;
      }
    } else if (magnitude !== 0n) {
      prefix = conv === 'x' ? '0x' : '0X';
    }
  }
  const zeroPad = zeroFlag && !hasPrecision;
  return padNumeric('', prefix, digits, spec.width, leftAlign, zeroPad);
}

function formatFloatConv(conv: string, spec: Spec, arg: Arg): string {
  const x = toNumberArg(arg);
  const leftAlign = spec.flags.includes('-');
  const zeroFlag = spec.flags.includes('0');
  const hashFlag = spec.flags.includes('#');
  const plusFlag = spec.flags.includes('+');
  const spaceFlag = spec.flags.includes(' ');
  const upper = conv === conv.toUpperCase();

  const negative = x < 0 || Object.is(x, -0);

  if (Number.isNaN(x)) {
    const text = upper ? 'NAN' : 'nan';
    return padGeneric(text, spec.width, leftAlign);
  }

  if (!Number.isFinite(x)) {
    const sign = negative ? '-' : plusFlag ? '+' : spaceFlag ? ' ' : '';
    const text = sign + (upper ? 'INF' : 'inf');
    return padGeneric(text, spec.width, leftAlign);
  }

  const sign = negative ? '-' : plusFlag ? '+' : spaceFlag ? ' ' : '';
  const { mantissa, exp } = decomposeDouble(x);

  let body: string;
  if (conv === 'f' || conv === 'F') {
    const precision = spec.precision === null ? 6 : spec.precision;
    const { intPart, fracPart } = formatFixedDigits(mantissa, exp, precision);
    body = intPart + (precision > 0 || hashFlag ? '.' + fracPart : '');
  } else if (conv === 'e' || conv === 'E') {
    const precision = spec.precision === null ? 6 : spec.precision;
    const { digits, exponent } = roundSignificant(mantissa, exp, precision + 1);
    const d1 = digits[0];
    const fracPart = digits.slice(1);
    const eChar = conv === 'E' ? 'E' : 'e';
    const expSign = exponent < 0 ? '-' : '+';
    const expDigits = Math.abs(exponent).toString().padStart(2, '0');
    body = d1 + (precision > 0 || hashFlag ? '.' + fracPart : '') + eChar + expSign + expDigits;
  } else {
    // g, G
    let P = spec.precision === null ? 6 : spec.precision;
    if (P === 0) P = 1;
    const { digits: sigDigits, exponent: X } = roundSignificant(mantissa, exp, P);
    if (P > X && X >= -4) {
      const fPrecision = P - 1 - X;
      const { intPart, fracPart } = formatFixedDigits(mantissa, exp, fPrecision);
      let frac = fracPart;
      let useDot = fPrecision > 0 || hashFlag;
      if (!hashFlag) {
        frac = frac.replace(/0+$/, '');
        useDot = frac.length > 0;
      }
      body = intPart + (useDot ? '.' + frac : '');
    } else {
      const ePrecision = P - 1;
      const d1 = sigDigits[0];
      let frac = sigDigits.slice(1);
      let useDot = ePrecision > 0 || hashFlag;
      if (!hashFlag) {
        frac = frac.replace(/0+$/, '');
        useDot = frac.length > 0;
      }
      const eChar = conv === 'G' ? 'E' : 'e';
      const expSign = X < 0 ? '-' : '+';
      const expDigits = Math.abs(X).toString().padStart(2, '0');
      body = d1 + (useDot ? '.' + frac : '') + eChar + expSign + expDigits;
    }
  }

  const bodyLen = sign.length + body.length;
  if (spec.width !== null && spec.width > bodyLen) {
    if (zeroFlag && !leftAlign) {
      return sign + '0'.repeat(spec.width - bodyLen) + body;
    }
    const content = sign + body;
    const pad = ' '.repeat(spec.width - bodyLen);
    return leftAlign ? content + pad : pad + content;
  }
  return sign + body;
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let result = '';
  let argIndex = 0;
  let i = 0;
  while (i < fmt.length) {
    const ch = fmt[i];
    if (ch !== '%') {
      result += ch;
      i++;
      continue;
    }
    const { spec, next } = parseSpec(fmt, i);
    i = next;
    const { conv } = spec;

    if (conv === '%') {
      result += '%';
      continue;
    }

    const arg = args[argIndex++];
    const leftAlign = spec.flags.includes('-');

    if (conv === 'd' || conv === 'i' || conv === 'x' || conv === 'X' || conv === 'o') {
      result += formatIntConv(conv, spec, arg);
    } else if (conv === 'e' || conv === 'E' || conv === 'f' || conv === 'F' || conv === 'g' || conv === 'G') {
      result += formatFloatConv(conv, spec, arg);
    } else if (conv === 's') {
      let str = arg as string;
      if (spec.precision !== null) {
        str = str.slice(0, spec.precision);
      }
      result += padGeneric(str, spec.width, leftAlign);
    } else if (conv === 'c') {
      const str = arg as string;
      result += padGeneric(str, spec.width, leftAlign);
    }
  }
  return result;
}
