type Flags = {
  minus: boolean;
  plus: boolean;
  space: boolean;
  zero: boolean;
  hash: boolean;
};

// Decompose a finite non-negative double x into D, k such that x === D * 10^-k exactly.
function decompose(x: number): { D: bigint; k: number } {
  if (x === 0) return { D: 0n, k: 0 };
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setFloat64(0, x);
  const hi = view.getUint32(0);
  const lo = view.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  const mantissaHigh = hi & 0xfffff;
  const mantissaBits = (BigInt(mantissaHigh) << 32n) | BigInt(lo);
  let m: bigint;
  let e: number;
  if (expBits === 0) {
    m = mantissaBits;
    e = -1074;
  } else {
    m = mantissaBits | (1n << 52n);
    e = expBits - 1075;
  }
  if (e >= 0) {
    return { D: m << BigInt(e), k: 0 };
  }
  const k = -e;
  return { D: m * 5n ** BigInt(k), k };
}

// Drop `digits` decimal digits from D, rounding half-to-even, exactly.
function roundDrop(D: bigint, digits: number): bigint {
  if (digits <= 0) return D * 10n ** BigInt(-digits);
  const pow = 10n ** BigInt(digits);
  const half = pow / 2n;
  const q = D / pow;
  const r = D % pow;
  if (r > half || (r === half && q % 2n === 1n)) return q + 1n;
  return q;
}

function roundTo(D: bigint, k: number, newK: number): bigint {
  return roundDrop(D, k - newK);
}

function fBody(D: bigint, k: number, precision: number, hash: boolean): string {
  const R = roundTo(D, k, precision);
  let s = R.toString();
  if (s.length <= precision) s = '0'.repeat(precision - s.length + 1) + s;
  if (precision > 0) {
    const intPart = s.slice(0, s.length - precision);
    const fracPart = s.slice(s.length - precision);
    return intPart + '.' + fracPart;
  }
  return s + (hash ? '.' : '');
}

function eParts(D: bigint, k: number, precision: number): { digit0: string; frac: string; exp: number } {
  const P = precision + 1;
  if (D === 0n) {
    return { digit0: '0', frac: '0'.repeat(precision), exp: 0 };
  }
  const Dstr = D.toString();
  const Lp = Dstr.length;
  const E0 = Lp - 1 - k;
  let Q = roundDrop(D, Lp - P);
  let Qstr = Q.toString();
  let exp = E0;
  if (Qstr.length > P) {
    exp += 1;
    Q = Q / 10n;
    Qstr = Q.toString();
  }
  if (Qstr.length < P) Qstr = '0'.repeat(P - Qstr.length) + Qstr;
  return { digit0: Qstr[0], frac: Qstr.slice(1), exp };
}

function eBody(D: bigint, k: number, precision: number, hash: boolean, expLetter: 'e' | 'E'): string {
  const { digit0, frac, exp } = eParts(D, k, precision);
  const mantissa = precision > 0 ? digit0 + '.' + frac : digit0 + (hash ? '.' : '');
  const expSign = exp < 0 ? '-' : '+';
  const expAbs = Math.abs(exp).toString().padStart(2, '0');
  return mantissa + expLetter + expSign + expAbs;
}

function trimTrailingZeros(s: string, hasExp: boolean): string {
  let mantissa = s;
  let suffix = '';
  if (hasExp) {
    const idx = s.search(/[eE]/);
    mantissa = s.slice(0, idx);
    suffix = s.slice(idx);
  }
  if (mantissa.includes('.')) {
    mantissa = mantissa.replace(/0+$/, '').replace(/\.$/, '');
  }
  return mantissa + suffix;
}

function gBody(D: bigint, k: number, precisionIn: number, hash: boolean, upper: boolean): string {
  const P = precisionIn === 0 ? 1 : precisionIn;
  const { exp: X } = eParts(D, k, P - 1);
  let body: string;
  let usedE: boolean;
  if (P > X && X >= -4) {
    const prec = P - 1 - X;
    body = fBody(D, k, prec, hash);
    usedE = false;
  } else {
    body = eBody(D, k, P - 1, hash, upper ? 'E' : 'e');
    usedE = true;
  }
  if (!hash) body = trimTrailingZeros(body, usedE);
  return body;
}

function sign(negative: boolean, plus: boolean, space: boolean): string {
  if (negative) return '-';
  if (plus) return '+';
  if (space) return ' ';
  return '';
}

function pad(signStr: string, prefix: string, digits: string, width: number, leftAlign: boolean, zeroPad: boolean): string {
  const body = signStr + prefix + digits;
  if (body.length >= width) return body;
  const padLen = width - body.length;
  if (leftAlign) return body + ' '.repeat(padLen);
  if (zeroPad) return signStr + prefix + '0'.repeat(padLen) + digits;
  return ' '.repeat(padLen) + body;
}

function toBigInt(v: number | bigint): bigint {
  return typeof v === 'bigint' ? v : BigInt(v);
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  const re = /%([-+0 #]*)(\d*)(?:\.(\d*))?([a-zA-Z%])/g;
  let result = '';
  let lastIndex = 0;
  let argIndex = 0;
  let m: RegExpExecArray | null;

  while ((m = re.exec(fmt)) !== null) {
    result += fmt.slice(lastIndex, m.index);
    lastIndex = re.lastIndex;

    const flagsStr = m[1];
    const widthStr = m[2];
    const precStr = m[3];
    const conv = m[4];

    if (conv === '%') {
      result += '%';
      continue;
    }

    const flags: Flags = {
      minus: flagsStr.includes('-'),
      plus: flagsStr.includes('+'),
      space: flagsStr.includes(' '),
      zero: flagsStr.includes('0'),
      hash: flagsStr.includes('#'),
    };
    const width = widthStr ? parseInt(widthStr, 10) : 0;
    const hasPrecision = precStr !== undefined;
    const precision = hasPrecision ? (precStr === '' ? 0 : parseInt(precStr, 10)) : undefined;

    const arg = args[argIndex++];

    if (conv === 'd' || conv === 'i') {
      const bv = toBigInt(arg as number | bigint);
      const negative = bv < 0n;
      let digits = (negative ? -bv : bv).toString();
      if (precision !== undefined) {
        if (digits === '0' && precision === 0) digits = '';
        else if (digits.length < precision) digits = '0'.repeat(precision - digits.length) + digits;
      }
      const s = sign(negative, flags.plus, flags.space);
      const zeroPad = flags.zero && !flags.minus && precision === undefined;
      result += pad(s, '', digits, width, flags.minus, zeroPad);
      continue;
    }

    if (conv === 'x' || conv === 'X' || conv === 'o') {
      const bv = toBigInt(arg as number | bigint);
      const base = conv === 'o' ? 8 : 16;
      let digits = bv.toString(base);
      if (conv === 'X') digits = digits.toUpperCase();
      if (precision !== undefined) {
        if (digits === '0' && precision === 0) digits = '';
        else if (digits.length < precision) digits = '0'.repeat(precision - digits.length) + digits;
      }
      let prefix = '';
      if (flags.hash) {
        if (conv === 'o') {
          if (digits.length === 0 || digits[0] !== '0') digits = '0' + digits;
        } else if (bv !== 0n) {
          prefix = conv === 'X' ? '0X' : '0x';
        }
      }
      const zeroPad = flags.zero && !flags.minus && precision === undefined;
      result += pad('', prefix, digits, width, flags.minus, zeroPad);
      continue;
    }

    if (conv === 'e' || conv === 'E' || conv === 'f' || conv === 'F' || conv === 'g' || conv === 'G') {
      const v = arg as number;
      const negative = v < 0 || Object.is(v, -0);
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      const isNaN_ = Number.isNaN(v);
      const isInf = !isNaN_ && !Number.isFinite(v);

      if (isNaN_) {
        const text = upper ? 'NAN' : 'nan';
        result += pad('', '', text, width, flags.minus, false);
        continue;
      }
      if (isInf) {
        const s = sign(negative, flags.plus, flags.space);
        const text = upper ? 'INF' : 'inf';
        result += pad(s, '', text, width, flags.minus, false);
        continue;
      }

      const { D, k } = decompose(Math.abs(v));
      const s = sign(negative, flags.plus, flags.space);
      const zeroPad = flags.zero && !flags.minus;
      let body: string;

      if (conv === 'f' || conv === 'F') {
        const p = precision !== undefined ? precision : 6;
        body = fBody(D, k, p, flags.hash);
      } else if (conv === 'e' || conv === 'E') {
        const p = precision !== undefined ? precision : 6;
        body = eBody(D, k, p, flags.hash, upper ? 'E' : 'e');
      } else {
        const p = precision !== undefined ? precision : 6;
        body = gBody(D, k, p, flags.hash, upper);
      }
      result += pad(s, '', body, width, flags.minus, zeroPad);
      continue;
    }

    if (conv === 's') {
      let text = arg as string;
      if (precision !== undefined) text = text.slice(0, precision);
      result += pad('', '', text, width, flags.minus, false);
      continue;
    }

    if (conv === 'c') {
      const text = arg as string;
      result += pad('', '', text, width, flags.minus, false);
      continue;
    }
  }

  result += fmt.slice(lastIndex);
  return result;
}
