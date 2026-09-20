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

function signFor(negative: boolean, flags: Flags): string {
  if (negative) return '-';
  if (flags.plus) return '+';
  if (flags.space) return ' ';
  return '';
}

function padNumber(
  sign: string,
  prefix: string,
  digits: string,
  minus: boolean,
  zero: boolean,
  width: number
): string {
  const content = sign + prefix + digits;
  if (content.length >= width) return content;
  const padLen = width - content.length;
  if (minus) return content + ' '.repeat(padLen);
  if (zero) return sign + prefix + '0'.repeat(padLen) + digits;
  return ' '.repeat(padLen) + content;
}

function padText(text: string, minus: boolean, width: number): string {
  if (text.length >= width) return text;
  const padLen = width - text.length;
  return minus ? text + ' '.repeat(padLen) : ' '.repeat(padLen) + text;
}

// ---- exact double decomposition: |x| = m * 2^e ----
function getFloatParts(x: number): {
  negative: boolean;
  isNaN: boolean;
  isInf: boolean;
  m: bigint;
  e: number;
} {
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const sign = (hi >>> 31) & 1;
  const exp = (hi >>> 20) & 0x7ff;
  const mantHi = hi & 0xfffff;
  const mantissa = (BigInt(mantHi) << 32n) | BigInt(lo);
  if (exp === 0x7ff) {
    return { negative: sign === 1, isNaN: mantissa !== 0n, isInf: mantissa === 0n, m: 0n, e: 0 };
  }
  if (exp === 0) {
    return { negative: sign === 1, isNaN: false, isInf: false, m: mantissa, e: -1074 };
  }
  const m = mantissa | (1n << 52n);
  const e = exp - 1075;
  return { negative: sign === 1, isNaN: false, isInf: false, m, e };
}

function roundHalfEven(num: bigint, den: bigint): bigint {
  let q = num / den;
  const r = num % den;
  const twiceR = r * 2n;
  if (twiceR > den) q += 1n;
  else if (twiceR === den && q % 2n === 1n) q += 1n;
  return q;
}

// round(|x| * 10^k) with ties-to-even, |x| = m*2^e
function roundToFractionalDigits(m: bigint, e: number, k: number): bigint {
  if (m === 0n) return 0n;
  let num = m;
  let den = 1n;
  if (k >= 0) num *= 5n ** BigInt(k);
  else den *= 5n ** BigInt(-k);
  const exp2 = e + k;
  if (exp2 >= 0) num *= 2n ** BigInt(exp2);
  else den *= 2n ** BigInt(-exp2);
  return roundHalfEven(num, den);
}

// compare |x| (m*2^e) to 10^X, m>0
function cmpAbsToPow10(m: bigint, e: number, X: number): number {
  let lnum = m;
  let lden = 1n;
  if (e >= 0) lnum *= 2n ** BigInt(e);
  else lden *= 2n ** BigInt(-e);
  let rnum = 1n;
  let rden = 1n;
  if (X >= 0) rnum = 2n ** BigInt(X) * 5n ** BigInt(X);
  else rden = 2n ** BigInt(-X) * 5n ** BigInt(-X);
  const left = lnum * rden;
  const right = rnum * lden;
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function findExponent(m: bigint, e: number, guessVal: number): number {
  let X = Math.floor(Math.log10(Math.abs(guessVal)));
  if (!isFinite(X)) X = 0;
  while (cmpAbsToPow10(m, e, X) < 0) X--;
  while (cmpAbsToPow10(m, e, X + 1) <= 0) X++;
  return X;
}

// Returns S = p+1 significant digits (rounded, carry-normalized) and the base-10 exponent X.
function computeSigDigits(m: bigint, e: number, guessVal: number, p: number): { digits: string; X: number } {
  const S = p + 1;
  if (m === 0n) return { digits: '0'.repeat(S), X: 0 };
  let X = findExponent(m, e, guessVal);
  const k = p - X;
  const N = roundToFractionalDigits(m, e, k);
  let digits = N.toString();
  if (digits.length === S + 1) {
    X += 1;
    digits = '1' + '0'.repeat(S - 1);
  } else if (digits.length < S) {
    digits = '0'.repeat(S - digits.length) + digits;
  }
  return { digits, X };
}

function toBigIntArg(v: number | bigint): bigint {
  return typeof v === 'bigint' ? v : BigInt(v);
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let argIndex = 0;
  const re = /%([-+ 0#]*)(\d*)(\.\d*)?([diouxXeEfFgGsc%])/g;

  return fmt.replace(re, (_match, flagsStr: string, widthStr: string, precStr: string | undefined, conv: string) => {
    if (conv === '%') return '%';

    const flags = parseFlags(flagsStr);
    const width = widthStr === '' ? 0 : parseInt(widthStr, 10);
    const precisionGiven = precStr !== undefined;
    const precision = precisionGiven ? (precStr!.slice(1) === '' ? 0 : parseInt(precStr!.slice(1), 10)) : undefined;

    const arg = args[argIndex++];

    if (conv === 'd' || conv === 'i') {
      const v = toBigIntArg(arg as number | bigint);
      const negative = v < 0n;
      const abs = negative ? -v : v;
      let digits = abs.toString();
      if (precisionGiven) {
        digits = precision === 0 && abs === 0n ? '' : digits.padStart(precision!, '0');
      }
      const sign = signFor(negative, flags);
      const zeroActive = flags.zero && !flags.minus && !precisionGiven;
      return padNumber(sign, '', digits, flags.minus, zeroActive, width);
    }

    if (conv === 'x' || conv === 'X' || conv === 'o') {
      const v = toBigIntArg(arg as number | bigint);
      const base = conv === 'o' ? 8 : 16;
      let digits = v.toString(base);
      if (conv === 'X') digits = digits.toUpperCase();
      if (precisionGiven) {
        digits = precision === 0 && v === 0n ? '' : digits.padStart(precision!, '0');
      }
      let prefix = '';
      if (flags.hash) {
        if (conv === 'o') {
          if (digits.length === 0 || digits[0] !== '0') digits = '0' + digits;
        } else if (v !== 0n) {
          prefix = conv === 'X' ? '0X' : '0x';
        }
      }
      const zeroActive = flags.zero && !flags.minus && !precisionGiven;
      return padNumber('', prefix, digits, flags.minus, zeroActive, width);
    }

    if (conv === 'e' || conv === 'E' || conv === 'f' || conv === 'F' || conv === 'g' || conv === 'G') {
      const xVal = arg as number;
      const isUpper = conv === conv.toUpperCase();
      const parts = getFloatParts(xVal);

      if (parts.isNaN) {
        const body = isUpper ? 'NAN' : 'nan';
        return padNumber('', '', body, flags.minus, false, width);
      }
      if (parts.isInf) {
        const sign = signFor(parts.negative, flags);
        const body = isUpper ? 'INF' : 'inf';
        return padNumber(sign, '', body, flags.minus, false, width);
      }

      const { m, e, negative } = parts;
      const sign = signFor(negative, flags);
      const zeroActive = flags.zero && !flags.minus;

      if (conv === 'e' || conv === 'E') {
        const p = precisionGiven ? precision! : 6;
        const { digits, X } = computeSigDigits(m, e, xVal, p);
        let mantissa = digits[0];
        const frac = digits.slice(1);
        if (p > 0 || flags.hash) mantissa += '.' + frac;
        const expSign = X < 0 ? '-' : '+';
        const expDigits = Math.abs(X).toString().padStart(2, '0');
        const body = mantissa + (isUpper ? 'E' : 'e') + expSign + expDigits;
        return padNumber(sign, '', body, flags.minus, zeroActive, width);
      }

      if (conv === 'f' || conv === 'F') {
        const p = precisionGiven ? precision! : 6;
        const N = roundToFractionalDigits(m, e, p);
        let s = N.toString();
        if (s.length <= p) s = '0'.repeat(p - s.length + 1) + s;
        const intPart = p > 0 ? s.slice(0, s.length - p) : s;
        const fracPart = p > 0 ? s.slice(s.length - p) : '';
        const body = intPart + (p > 0 || flags.hash ? '.' + fracPart : '');
        return padNumber(sign, '', body, flags.minus, zeroActive, width);
      }

      // g, G
      const pGiven = precisionGiven ? precision! : 6;
      const P = pGiven === 0 ? 1 : pGiven;
      const { digits, X } = computeSigDigits(m, e, xVal, P - 1);
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
        if (!flags.hash) fracPart = fracPart.replace(/0+$/, '');
        body = intPart + (fracPart !== '' ? '.' + fracPart : flags.hash ? '.' : '');
      } else {
        let mantissa = digits[0];
        let frac = digits.slice(1);
        if (!flags.hash) frac = frac.replace(/0+$/, '');
        mantissa += frac !== '' ? '.' + frac : flags.hash ? '.' : '';
        const expSign = X < 0 ? '-' : '+';
        const expDigits = Math.abs(X).toString().padStart(2, '0');
        body = mantissa + (isUpper ? 'E' : 'e') + expSign + expDigits;
      }
      return padNumber(sign, '', body, flags.minus, zeroActive, width);
    }

    if (conv === 's') {
      let str = arg as string;
      if (precisionGiven) str = str.slice(0, precision!);
      return padText(str, flags.minus, width);
    }

    // c
    const ch = arg as string;
    return padText(ch, flags.minus, width);
  });
}
