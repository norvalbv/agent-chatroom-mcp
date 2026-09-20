type Arg = number | bigint | string;

interface Spec {
  flags: Set<string>;
  width: number;
  hasPrecision: boolean;
  precision: number;
  conv: string;
}

function decompose(x: number): { m: bigint; e: number } {
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setFloat64(0, x);
  const hi = view.getUint32(0);
  const lo = view.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  const mantHi = hi & 0xfffff;
  const mantissa = (BigInt(mantHi) << 32n) | BigInt(lo);
  if (expBits === 0) {
    return { m: mantissa, e: 1 - 1023 - 52 };
  }
  return { m: mantissa | (1n << 52n), e: expBits - 1023 - 52 };
}

// round(value * 10^fracDigits) with round-half-to-even, value = m * 2^e (m, e as given, m >= 0)
function roundExact(m: bigint, e: number, fracDigits: number): bigint {
  if (m === 0n) return 0n;
  let numPow2 = 0,
    denPow2 = 0;
  if (e >= 0) numPow2 = e;
  else denPow2 = -e;
  let numPow10 = 0,
    denPow10 = 0;
  if (fracDigits >= 0) numPow10 = fracDigits;
  else denPow10 = -fracDigits;

  const numerator = m * 2n ** BigInt(numPow2) * 10n ** BigInt(numPow10);
  const denominator = 2n ** BigInt(denPow2) * 10n ** BigInt(denPow10);

  let q = numerator / denominator;
  const r = numerator % denominator;
  const twiceR = r * 2n;
  if (twiceR > denominator || (twiceR === denominator && q % 2n === 1n)) {
    q += 1n;
  }
  return q;
}

function fDigits(m: bigint, e: number, precision: number): { intPart: string; fracPart: string } {
  const N = roundExact(m, e, precision);
  const digits = N.toString().padStart(precision + 1, '0');
  const cut = digits.length - precision;
  return { intPart: digits.slice(0, cut), fracPart: precision === 0 ? '' : digits.slice(cut) };
}

function eDigits(m: bigint, e: number, absX: number, precision: number): { digits: string; X: number } {
  const target = precision + 1;
  if (m === 0n) {
    return { digits: '0'.repeat(target), X: 0 };
  }
  let X = Math.floor(Math.log10(absX));
  for (let i = 0; i < 20; i++) {
    const N = roundExact(m, e, precision - X);
    const digits = N.toString();
    if (digits.length === target) {
      return { digits, X };
    }
    X += digits.length - target;
  }
  const N = roundExact(m, e, precision - X);
  return { digits: N.toString(), X };
}

function assembleNumber(sign: string, prefix: string, digits: string, width: number, leftAlign: boolean, zeroPad: boolean): string {
  const body = sign + prefix + digits;
  if (body.length >= width) return body;
  const padLen = width - body.length;
  if (leftAlign) return body + ' '.repeat(padLen);
  if (zeroPad) return sign + prefix + '0'.repeat(padLen) + digits;
  return ' '.repeat(padLen) + body;
}

function assembleWord(body: string, width: number, leftAlign: boolean): string {
  if (body.length >= width) return body;
  const padLen = width - body.length;
  return leftAlign ? body + ' '.repeat(padLen) : ' '.repeat(padLen) + body;
}

function signFor(neg: boolean, flags: Set<string>): string {
  if (neg) return '-';
  if (flags.has('+')) return '+';
  if (flags.has(' ')) return ' ';
  return '';
}

export function format(fmt: string, ...args: Arg[]): string {
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

    const flags = new Set<string>();
    while (i < n && '-+ 0#'.includes(fmt[i])) {
      flags.add(fmt[i]);
      i++;
    }

    let widthStr = '';
    while (i < n && fmt[i] >= '0' && fmt[i] <= '9') {
      widthStr += fmt[i];
      i++;
    }
    const width = widthStr === '' ? 0 : parseInt(widthStr, 10);

    let hasPrecision = false;
    let precision = 0;
    if (fmt[i] === '.') {
      hasPrecision = true;
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
    const arg = args[argIndex++];

    if (conv === 'd' || conv === 'i') {
      const v = arg as number | bigint;
      let neg: boolean;
      let abs: bigint;
      if (typeof v === 'bigint') {
        neg = v < 0n;
        abs = neg ? -v : v;
      } else {
        neg = v < 0;
        abs = BigInt(Math.abs(v));
      }
      let digitStr: string;
      if (hasPrecision) {
        digitStr = precision === 0 && abs === 0n ? '' : abs.toString().padStart(precision, '0');
      } else {
        digitStr = abs.toString();
      }
      const sign = signFor(neg, flags);
      const zeroPad = flags.has('0') && !leftAlign && !hasPrecision;
      out += assembleNumber(sign, '', digitStr, width, leftAlign, zeroPad);
      continue;
    }

    if (conv === 'x' || conv === 'X' || conv === 'o') {
      const v = arg as number | bigint;
      const abs = typeof v === 'bigint' ? v : BigInt(v);
      const base = conv === 'o' ? 8 : 16;
      let digitStr: string;
      if (hasPrecision) {
        digitStr = precision === 0 && abs === 0n ? '' : abs.toString(base).padStart(precision, '0');
      } else {
        digitStr = abs.toString(base);
      }
      if (conv === 'X') digitStr = digitStr.toUpperCase();

      let prefix = '';
      if (flags.has('#')) {
        if (conv === 'o') {
          if (digitStr.length === 0 || digitStr[0] !== '0') {
            digitStr = '0' + digitStr;
          }
        } else if (abs !== 0n) {
          prefix = conv === 'X' ? '0X' : '0x';
        }
      }
      const zeroPad = flags.has('0') && !leftAlign && !hasPrecision;
      out += assembleNumber('', prefix, digitStr, width, leftAlign, zeroPad);
      continue;
    }

    if (conv === 'e' || conv === 'E' || conv === 'f' || conv === 'F' || conv === 'g' || conv === 'G') {
      const x = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      const neg = x < 0 || Object.is(x, -0);
      const sign = Number.isNaN(x) ? '' : signFor(neg, flags);

      if (Number.isNaN(x)) {
        const word = upper ? 'NAN' : 'nan';
        out += assembleWord(sign + word, width, leftAlign);
        continue;
      }
      if (!Number.isFinite(x)) {
        const word = upper ? 'INF' : 'inf';
        out += assembleWord(sign + word, width, leftAlign);
        continue;
      }

      const absX = Math.abs(x);
      const { m, e } = decompose(absX);
      const prec = hasPrecision ? precision : 6;
      const zeroPad = flags.has('0') && !leftAlign;

      if (conv === 'f' || conv === 'F') {
        const { intPart, fracPart } = fDigits(m, e, prec);
        let body: string;
        if (prec === 0) {
          body = intPart + (flags.has('#') ? '.' : '');
        } else {
          body = intPart + '.' + fracPart;
        }
        out += assembleNumber(sign, '', body, width, leftAlign, zeroPad);
        continue;
      }

      if (conv === 'e' || conv === 'E') {
        const { digits, X } = eDigits(m, e, absX, prec);
        let mantissa: string;
        if (prec === 0) {
          mantissa = digits[0] + (flags.has('#') ? '.' : '');
        } else {
          mantissa = digits[0] + '.' + digits.slice(1);
        }
        const eChar = conv === 'E' ? 'E' : 'e';
        const expSign = X >= 0 ? '+' : '-';
        const expAbs = Math.abs(X).toString().padStart(2, '0');
        const body = mantissa + eChar + expSign + expAbs;
        out += assembleNumber(sign, '', body, width, leftAlign, zeroPad);
        continue;
      }

      // g, G
      const P = prec === 0 ? 1 : prec;
      const { X } = eDigits(m, e, absX, P - 1);
      let body: string;
      if (P > X && X >= -4) {
        const fp = P - 1 - X;
        const { intPart, fracPart } = fDigits(m, e, fp);
        if (flags.has('#')) {
          body = fp === 0 ? intPart + '.' : intPart + '.' + fracPart;
        } else {
          const stripped = fracPart.replace(/0+$/, '');
          body = stripped.length > 0 ? intPart + '.' + stripped : intPart;
        }
      } else {
        const { digits } = eDigits(m, e, absX, P - 1);
        const fracRaw = digits.slice(1);
        const eChar = conv === 'G' ? 'E' : 'e';
        const expSign = X >= 0 ? '+' : '-';
        const expAbs = Math.abs(X).toString().padStart(2, '0');
        let mantissa: string;
        if (flags.has('#')) {
          mantissa = fracRaw.length > 0 ? digits[0] + '.' + fracRaw : digits[0] + '.';
        } else {
          const stripped = fracRaw.replace(/0+$/, '');
          mantissa = stripped.length > 0 ? digits[0] + '.' + stripped : digits[0];
        }
        body = mantissa + eChar + expSign + expAbs;
      }
      out += assembleNumber(sign, '', body, width, leftAlign, zeroPad);
      continue;
    }

    if (conv === 's') {
      let s = arg as string;
      if (hasPrecision) s = s.slice(0, precision);
      out += assembleWord(s, width, leftAlign);
      continue;
    }

    if (conv === 'c') {
      const s = arg as string;
      out += assembleWord(s, width, leftAlign);
      continue;
    }
  }

  return out;
}
