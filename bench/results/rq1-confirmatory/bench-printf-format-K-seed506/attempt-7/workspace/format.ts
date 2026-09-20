type Flags = Set<string>;

function signStrFor(negative: boolean, flags: Flags): string {
  if (negative) return '-';
  if (flags.has('+')) return '+';
  if (flags.has(' ')) return ' ';
  return '';
}

function assemble(
  sign: string,
  prefix: string,
  digits: string,
  width: number | null,
  leftAlign: boolean,
  zeroPad: boolean
): string {
  const body = sign + prefix + digits;
  if (width === null || body.length >= width) return body;
  const padLen = width - body.length;
  if (leftAlign) return body + ' '.repeat(padLen);
  if (zeroPad) return sign + prefix + '0'.repeat(padLen) + digits;
  return ' '.repeat(padLen) + body;
}

function padPlain(s: string, width: number | null, leftAlign: boolean): string {
  if (width === null || s.length >= width) return s;
  const pad = ' '.repeat(width - s.length);
  return leftAlign ? s + pad : pad + s;
}

// Extract exact sign/mantissa/exponent of a finite double: value = (sign?-1:1) * M * 2^E
function getBits(x: number): { sign: boolean; M: bigint; E: number } {
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setFloat64(0, x);
  const hi = BigInt(view.getUint32(0));
  const lo = BigInt(view.getUint32(4));
  const bits = (hi << 32n) | lo;
  const sign = ((bits >> 63n) & 1n) === 1n;
  const exp = Number((bits >> 52n) & 0x7ffn);
  const mant = bits & 0xfffffffffffffn;
  let M: bigint;
  let E: number;
  if (exp === 0) {
    M = mant;
    E = -1074;
  } else {
    M = mant | (1n << 52n);
    E = exp - 1075;
  }
  return { sign, M, E };
}

// round(M * 2^E * 10^p) to nearest integer, ties to even. M >= 0.
function roundDecimal(M: bigint, E: number, p: number): bigint {
  if (M === 0n) return 0n;
  const e2 = E + p;
  const e5 = p;
  let num = M;
  let den = 1n;
  if (e5 >= 0) num *= 5n ** BigInt(e5);
  else den *= 5n ** BigInt(-e5);
  if (e2 >= 0) num *= 2n ** BigInt(e2);
  else den *= 2n ** BigInt(-e2);
  let q = num / den;
  const r = num % den;
  const twice = r * 2n;
  if (twice > den) q += 1n;
  else if (twice === den && q % 2n === 1n) q += 1n;
  return q;
}

// Round value = M*2^E to `precision+1` significant decimal digits.
// Returns the decimal exponent (style: d.ddddd * 10^expo) and the digit string.
function eDigits(M: bigint, E: number, precision: number): { expo: number; digits: string } {
  if (M === 0n) return { expo: 0, digits: '0'.repeat(precision + 1) };
  let xEst = Math.floor(Math.log10(Number(M)) + E * Math.log10(2));
  for (let attempt = 0; attempt < 6; attempt++) {
    const p = precision - xEst;
    const digits = roundDecimal(M, E, p).toString();
    if (digits.length === precision + 1) return { expo: xEst, digits };
    if (digits.length > precision + 1) xEst += 1;
    else xEst -= 1;
  }
  const p = precision - xEst;
  const digits = roundDecimal(M, E, p).toString().padStart(precision + 1, '0');
  return { expo: xEst, digits };
}

function toBigIntAbs(arg: number | bigint): { negative: boolean; abs: bigint } {
  if (typeof arg === 'bigint') {
    const negative = arg < 0n;
    return { negative, abs: negative ? -arg : arg };
  }
  const negative = arg < 0;
  const abs = BigInt(negative ? -arg : arg);
  return { negative, abs };
}

function formatIntDigits(abs: bigint, precision: number | null): string {
  const raw = abs.toString();
  if (precision === null) return raw;
  if (abs === 0n && precision === 0) return '';
  return raw.padStart(precision, '0');
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let out = '';
  let argIndex = 0;
  let i = 0;
  const n = fmt.length;

  while (i < n) {
    const ch = fmt[i];
    if (ch !== '%') {
      out += ch;
      i++;
      continue;
    }

    i++; // skip '%'
    if (fmt[i] === '%') {
      out += '%';
      i++;
      continue;
    }

    const flags: Flags = new Set();
    while (i < n && '-+ 0#'.includes(fmt[i])) {
      flags.add(fmt[i]);
      i++;
    }

    let width: number | null = null;
    let widthStr = '';
    while (i < n && fmt[i] >= '0' && fmt[i] <= '9') {
      widthStr += fmt[i];
      i++;
    }
    if (widthStr !== '') width = parseInt(widthStr, 10);

    let precision: number | null = null;
    if (fmt[i] === '.') {
      i++;
      let precStr = '';
      while (i < n && fmt[i] >= '0' && fmt[i] <= '9') {
        precStr += fmt[i];
        i++;
      }
      precision = precStr === '' ? 0 : parseInt(precStr, 10);
    }

    const conv = fmt[i];
    i++;

    const leftAlign = flags.has('-');
    const zeroFlagBase = flags.has('0') && !leftAlign;

    switch (conv) {
      case 'd':
      case 'i': {
        const arg = args[argIndex++] as number | bigint;
        const { negative, abs } = toBigIntAbs(arg);
        const digits = formatIntDigits(abs, precision);
        const sign = signStrFor(negative, flags);
        const zeroFlag = zeroFlagBase && precision === null;
        out += assemble(sign, '', digits, width, leftAlign, zeroFlag);
        break;
      }
      case 'x':
      case 'X':
      case 'o': {
        const arg = args[argIndex++] as number | bigint;
        const v = typeof arg === 'bigint' ? arg : BigInt(arg);
        const base = conv === 'o' ? 8 : 16;
        const raw = v.toString(base);
        let digits: string;
        if (precision !== null) {
          digits = v === 0n && precision === 0 ? '' : raw.padStart(precision, '0');
        } else {
          digits = raw;
        }
        if (conv === 'x') digits = digits;
        if (conv === 'X') digits = digits.toUpperCase();

        let prefix = '';
        if (flags.has('#')) {
          if (conv === 'o') {
            if (digits === '' || digits[0] !== '0') digits = '0' + digits;
          } else {
            if (v !== 0n) prefix = conv === 'x' ? '0x' : '0X';
          }
        }

        const zeroFlag = zeroFlagBase && precision === null;
        out += assemble('', prefix, digits, width, leftAlign, zeroFlag);
        break;
      }
      case 'e':
      case 'E':
      case 'f':
      case 'F':
      case 'g':
      case 'G': {
        const x = args[argIndex++] as number;
        const isUpper = conv === conv.toUpperCase() && conv !== conv.toLowerCase();

        if (Number.isNaN(x)) {
          const body = isUpper ? 'NAN' : 'nan';
          out += assemble('', '', body, width, leftAlign, false);
          break;
        }

        const { sign: signBit, M, E } = getBits(x);
        const negative = signBit;
        const signStr = signStrFor(negative, flags);

        if (!Number.isFinite(x)) {
          const body = isUpper ? 'INF' : 'inf';
          out += assemble(signStr, '', body, width, leftAlign, false);
          break;
        }

        const zeroFlag = zeroFlagBase;

        if (conv === 'e' || conv === 'E') {
          const precisionVal = precision === null ? 6 : precision;
          const { expo, digits } = eDigits(M, E, precisionVal);
          const intDigit = digits[0];
          const frac = digits.slice(1);
          const dot = precisionVal > 0 || flags.has('#') ? '.' : '';
          const expSign = expo < 0 ? '-' : '+';
          const expDigits = Math.abs(expo).toString().padStart(2, '0');
          const eChar = conv === 'E' ? 'E' : 'e';
          const body = intDigit + dot + frac + eChar + expSign + expDigits;
          out += assemble(signStr, '', body, width, leftAlign, zeroFlag);
        } else if (conv === 'f' || conv === 'F') {
          const precisionVal = precision === null ? 6 : precision;
          let digitsStr = roundDecimal(M, E, precisionVal).toString();
          if (digitsStr.length <= precisionVal) digitsStr = digitsStr.padStart(precisionVal + 1, '0');
          const intPart = digitsStr.slice(0, digitsStr.length - precisionVal);
          const fracPart = precisionVal > 0 ? digitsStr.slice(digitsStr.length - precisionVal) : '';
          const dot = precisionVal > 0 || flags.has('#') ? '.' : '';
          const body = intPart + dot + fracPart;
          out += assemble(signStr, '', body, width, leftAlign, zeroFlag);
        } else {
          // g, G
          let P = precision === null ? 6 : precision === 0 ? 1 : precision;
          const { expo: X, digits } = eDigits(M, E, P - 1);
          const hashFlag = flags.has('#');
          const eChar = conv === 'G' ? 'E' : 'e';
          let body: string;
          if (P > X && X >= -4) {
            let intPart: string;
            let fracPart: string;
            if (X >= 0) {
              intPart = digits.slice(0, X + 1);
              fracPart = digits.slice(X + 1);
            } else {
              intPart = '0';
              fracPart = '0'.repeat(-X - 1) + digits;
            }
            let frac = fracPart;
            if (!hashFlag) frac = frac.replace(/0+$/, '');
            const dot = frac.length > 0 || hashFlag ? '.' : '';
            body = intPart + dot + frac;
          } else {
            const intDigit = digits[0];
            let frac = digits.slice(1);
            if (!hashFlag) frac = frac.replace(/0+$/, '');
            const dot = frac.length > 0 || hashFlag ? '.' : '';
            const expSign = X < 0 ? '-' : '+';
            const expDigits = Math.abs(X).toString().padStart(2, '0');
            body = intDigit + dot + frac + eChar + expSign + expDigits;
          }
          out += assemble(signStr, '', body, width, leftAlign, zeroFlag);
        }
        break;
      }
      case 's': {
        const arg = args[argIndex++] as string;
        const body = precision !== null ? arg.slice(0, precision) : arg;
        out += padPlain(body, width, leftAlign);
        break;
      }
      case 'c': {
        const arg = args[argIndex++] as string;
        out += padPlain(arg, width, leftAlign);
        break;
      }
      default:
        throw new Error(`Unsupported conversion: %${conv}`);
    }
  }

  return out;
}
