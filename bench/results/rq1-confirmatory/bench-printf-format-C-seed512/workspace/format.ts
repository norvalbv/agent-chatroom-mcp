export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let result = '';
  let argi = 0;
  let i = 0;
  while (i < fmt.length) {
    const c = fmt[i];
    if (c !== '%') {
      result += c;
      i++;
      continue;
    }
    let j = i + 1;
    const flags = new Set<string>();
    while (j < fmt.length && '-+ 0#'.includes(fmt[j])) {
      flags.add(fmt[j]);
      j++;
    }
    let widthStr = '';
    while (j < fmt.length && /[0-9]/.test(fmt[j])) {
      widthStr += fmt[j];
      j++;
    }
    const width = widthStr === '' ? 0 : parseInt(widthStr, 10);
    let precision: number | undefined = undefined;
    if (fmt[j] === '.') {
      j++;
      let precStr = '';
      while (j < fmt.length && /[0-9]/.test(fmt[j])) {
        precStr += fmt[j];
        j++;
      }
      precision = precStr === '' ? 0 : parseInt(precStr, 10);
    }
    const conv = fmt[j];
    j++;
    i = j;
    if (conv === '%') {
      result += '%';
      continue;
    }
    const arg = args[argi++];
    result += convert(conv, flags, width, precision, arg);
  }
  return result;
}

function convert(
  conv: string,
  flags: Set<string>,
  width: number,
  precision: number | undefined,
  arg: number | bigint | string,
): string {
  const leftAlign = flags.has('-');
  const zeroFlag = flags.has('0');
  const plusFlag = flags.has('+');
  const spaceFlag = flags.has(' ');
  const hashFlag = flags.has('#');

  switch (conv) {
    case 'd':
    case 'i': {
      const v = typeof arg === 'bigint' ? arg : BigInt(arg as number);
      const neg = v < 0n;
      const mag = neg ? -v : v;
      let digits: string;
      if (precision !== undefined) {
        if (precision === 0 && mag === 0n) {
          digits = '';
        } else {
          digits = mag.toString(10).padStart(precision, '0');
        }
      } else {
        digits = mag.toString(10);
      }
      const sign = neg ? '-' : plusFlag ? '+' : spaceFlag ? ' ' : '';
      const zeroPad = zeroFlag && !leftAlign && precision === undefined;
      return padNumeric(sign, '', digits, width, leftAlign, zeroPad);
    }
    case 'x':
    case 'X':
    case 'o': {
      const v = typeof arg === 'bigint' ? arg : BigInt(arg as number);
      const base = conv === 'o' ? 8 : 16;
      let digits: string;
      if (precision !== undefined) {
        if (precision === 0 && v === 0n) {
          digits = '';
        } else {
          digits = v.toString(base).padStart(precision, '0');
        }
      } else {
        digits = v.toString(base);
      }
      if (conv === 'X') digits = digits.toUpperCase();
      let prefix = '';
      if (hashFlag) {
        if (conv === 'o') {
          if (digits.length === 0 || digits[0] !== '0') {
            digits = '0' + digits;
          }
        } else if (v !== 0n) {
          prefix = conv === 'X' ? '0X' : '0x';
        }
      }
      const zeroPad = zeroFlag && !leftAlign && precision === undefined;
      return padNumeric('', prefix, digits, width, leftAlign, zeroPad);
    }
    case 'e':
    case 'E':
    case 'f':
    case 'F':
    case 'g':
    case 'G': {
      const x = arg as number;
      const upper = conv === conv.toUpperCase();
      if (Number.isNaN(x)) {
        const digits = upper ? 'NAN' : 'nan';
        return padNumeric('', '', digits, width, leftAlign, false);
      }
      const neg = signBit(x);
      const sign = neg ? '-' : plusFlag ? '+' : spaceFlag ? ' ' : '';
      if (!Number.isFinite(x)) {
        const digits = upper ? 'INF' : 'inf';
        return padNumeric(sign, '', digits, width, leftAlign, false);
      }
      const magnitude = Math.abs(x);
      const zeroPad = zeroFlag && !leftAlign;

      if (conv === 'f' || conv === 'F') {
        const p = precision === undefined ? 6 : precision;
        const body = formatF(magnitude, p, hashFlag);
        return padNumeric(sign, '', body, width, leftAlign, zeroPad);
      }
      if (conv === 'e' || conv === 'E') {
        const p = precision === undefined ? 6 : precision;
        const body = formatE(magnitude, p, hashFlag, upper);
        return padNumeric(sign, '', body, width, leftAlign, zeroPad);
      }
      // g, G
      let p = precision === undefined ? 6 : precision === 0 ? 1 : precision;
      const body = formatG(magnitude, p, hashFlag, upper);
      return padNumeric(sign, '', body, width, leftAlign, zeroPad);
    }
    case 's': {
      let s = arg as string;
      if (precision !== undefined) s = s.slice(0, precision);
      return padPlain(s, width, leftAlign);
    }
    case 'c': {
      const s = arg as string;
      return padPlain(s, width, leftAlign);
    }
    default:
      throw new Error(`unsupported conversion: ${conv}`);
  }
}

function padNumeric(
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

function padPlain(str: string, width: number, leftAlign: boolean): string {
  if (str.length >= width) return str;
  const pad = ' '.repeat(width - str.length);
  return leftAlign ? str + pad : pad + str;
}

function signBit(x: number): boolean {
  if (x < 0) return true;
  if (x === 0) return Object.is(x, -0);
  return false;
}

function floatToFraction(x: number): [bigint, bigint] {
  if (x === 0) return [0n, 1n];
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setFloat64(0, x);
  const hi = BigInt(view.getUint32(0));
  const lo = BigInt(view.getUint32(4));
  const bits = (hi << 32n) | lo;
  const mantissaBits = bits & 0xfffffffffffffn;
  const exponentBits = Number((bits >> 52n) & 0x7ffn);
  let mantissa: bigint;
  let exponent: number;
  if (exponentBits === 0) {
    mantissa = mantissaBits;
    exponent = -1074;
  } else {
    mantissa = mantissaBits | (1n << 52n);
    exponent = exponentBits - 1075;
  }
  if (exponent >= 0) {
    return [mantissa << BigInt(exponent), 1n];
  }
  return [mantissa, 1n << BigInt(-exponent)];
}

function bigRound(num: bigint, den: bigint, shift: number): bigint {
  let n = num;
  let d = den;
  if (shift >= 0) {
    n = n * 10n ** BigInt(shift);
  } else {
    d = d * 10n ** BigInt(-shift);
  }
  let q = n / d;
  const r = n % d;
  const twice = r * 2n;
  if (twice > d) {
    q += 1n;
  } else if (twice === d) {
    if (q % 2n === 1n) q += 1n;
  }
  return q;
}

function computeSigDigits(magnitude: number, P: number): { digits: string; E: number } {
  if (magnitude === 0) return { digits: '0'.repeat(P), E: 0 };
  const [num, den] = floatToFraction(magnitude);
  let E = Math.floor(Math.log10(magnitude));
  const lo = 10n ** BigInt(P - 1);
  const hi = 10n ** BigInt(P);
  let D: bigint;
  for (;;) {
    D = bigRound(num, den, P - 1 - E);
    if (D >= hi) {
      E++;
      continue;
    }
    if (D < lo) {
      E--;
      continue;
    }
    break;
  }
  return { digits: D.toString(), E };
}

function formatF(magnitude: number, p: number, hashFlag: boolean): string {
  const [num, den] = floatToFraction(magnitude);
  const D = bigRound(num, den, p);
  const Dstr = D.toString().padStart(p + 1, '0');
  const intPart = p > 0 ? Dstr.slice(0, Dstr.length - p) : Dstr;
  const fracDigits = p > 0 ? Dstr.slice(Dstr.length - p) : '';
  const frac = p > 0 ? '.' + fracDigits : hashFlag ? '.' : '';
  return intPart + frac;
}

function formatE(magnitude: number, p: number, hashFlag: boolean, upper: boolean): string {
  const { digits, E } = computeSigDigits(magnitude, p + 1);
  const first = digits[0];
  const rest = digits.slice(1);
  const frac = p > 0 ? '.' + rest : hashFlag ? '.' : '';
  const expSign = E >= 0 ? '+' : '-';
  const expDigits = Math.abs(E).toString().padStart(2, '0');
  const eChar = upper ? 'E' : 'e';
  return first + frac + eChar + expSign + expDigits;
}

function formatG(magnitude: number, P: number, hashFlag: boolean, upper: boolean): string {
  const { digits, E } = computeSigDigits(magnitude, P);
  const X = E;
  let body: string;
  if (P > X && X >= -4) {
    let intPart: string;
    let fracPart: string;
    if (X >= 0) {
      intPart = digits.slice(0, X + 1).padEnd(X + 1, '0');
      fracPart = digits.slice(X + 1);
    } else {
      intPart = '0';
      fracPart = '0'.repeat(-X - 1) + digits;
    }
    if (!hashFlag) {
      fracPart = fracPart.replace(/0+$/, '');
    }
    body = fracPart.length > 0 ? intPart + '.' + fracPart : hashFlag ? intPart + '.' : intPart;
  } else {
    const first = digits[0];
    let rest = digits.slice(1);
    if (!hashFlag) {
      rest = rest.replace(/0+$/, '');
    }
    const frac = rest.length > 0 ? '.' + rest : hashFlag ? '.' : '';
    const expSign = X >= 0 ? '+' : '-';
    const expDigits = Math.abs(X).toString().padStart(2, '0');
    const eChar = upper ? 'E' : 'e';
    body = first + frac + eChar + expSign + expDigits;
  }
  return body;
}
