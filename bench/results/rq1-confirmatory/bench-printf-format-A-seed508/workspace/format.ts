export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  const specRe = /%([-+ 0#]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc%])/y;
  let out = '';
  let argIndex = 0;
  let i = 0;
  while (i < fmt.length) {
    const pct = fmt.indexOf('%', i);
    if (pct === -1) {
      out += fmt.slice(i);
      break;
    }
    out += fmt.slice(i, pct);
    specRe.lastIndex = pct;
    const m = specRe.exec(fmt);
    if (!m) {
      // shouldn't happen given the guarantees, but be safe
      out += fmt[pct];
      i = pct + 1;
      continue;
    }
    const [full, flagsStr, widthStr, precStr, conv] = m;
    i = pct + full.length;

    if (conv === '%') {
      out += '%';
      continue;
    }

    const flags = {
      minus: flagsStr.includes('-'),
      plus: flagsStr.includes('+'),
      space: flagsStr.includes(' '),
      zero: flagsStr.includes('0'),
      hash: flagsStr.includes('#'),
    };
    const width = widthStr.length > 0 ? parseInt(widthStr, 10) : null;
    const precisionGiven = precStr !== undefined;
    const precision = precisionGiven ? (precStr.length > 0 ? parseInt(precStr, 10) : 0) : null;

    const arg = args[argIndex++];
    out += formatOne(conv, flags, width, precisionGiven, precision, arg);
  }
  return out;
}

interface Flags {
  minus: boolean;
  plus: boolean;
  space: boolean;
  zero: boolean;
  hash: boolean;
}

function formatOne(
  conv: string,
  flags: Flags,
  width: number | null,
  precisionGiven: boolean,
  precision: number,
  arg: number | bigint | string,
): string {
  let sign = '';
  let prefix = '';
  let digits = '';
  let zeroPadAllowed = false;

  switch (conv) {
    case 'd':
    case 'i': {
      const { neg, mag } = toBigIntMagnitude(arg as number | bigint);
      sign = signFor(neg, flags, false);
      if (precisionGiven) {
        if (precision === 0 && mag === 0n) {
          digits = '';
        } else {
          digits = mag.toString().padStart(precision, '0');
        }
      } else {
        digits = mag.toString();
      }
      zeroPadAllowed = !precisionGiven;
      break;
    }
    case 'x':
    case 'X':
    case 'o': {
      const mag = typeof arg === 'bigint' ? arg : BigInt(arg as number);
      let base10 = conv === 'o' ? mag.toString(8) : mag.toString(16);
      if (conv === 'X') base10 = base10.toUpperCase();
      if (precisionGiven) {
        if (precision === 0 && mag === 0n) {
          base10 = '';
        } else {
          base10 = base10.padStart(precision, '0');
        }
      }
      if (conv === 'o' && flags.hash) {
        if (base10.length === 0 || base10[0] !== '0') {
          base10 = '0' + base10;
        }
      }
      if ((conv === 'x' || conv === 'X') && flags.hash && mag !== 0n) {
        prefix = conv === 'x' ? '0x' : '0X';
      }
      digits = base10;
      zeroPadAllowed = !precisionGiven;
      break;
    }
    case 'e':
    case 'E':
    case 'f':
    case 'F':
    case 'g':
    case 'G': {
      const x = arg as number;
      const upper = conv === conv.toUpperCase();
      const prec = precisionGiven ? precision : 6;
      if (Number.isNaN(x)) {
        sign = '';
        digits = upper ? 'NAN' : 'nan';
        zeroPadAllowed = false;
        break;
      }
      const neg = x < 0 || Object.is(x, -0);
      sign = signFor(neg, flags, false);
      if (!Number.isFinite(x)) {
        digits = upper ? 'INF' : 'inf';
        zeroPadAllowed = false;
        break;
      }
      const { m, e } = doubleParts(Math.abs(x));
      let num: bigint, den: bigint;
      if (e >= 0) {
        num = m << BigInt(e);
        den = 1n;
      } else {
        num = m;
        den = 1n << BigInt(-e);
      }
      zeroPadAllowed = true;

      if (conv === 'e' || conv === 'E') {
        const { digitsStr, exp } = formatExponential(num, den, prec);
        digits = buildExpString(digitsStr, exp, prec, flags.hash, upper);
      } else if (conv === 'f' || conv === 'F') {
        const digitsStr = formatFixed(num, den, prec);
        digits = buildFixedString(digitsStr, prec, flags.hash);
      } else {
        const P = precisionGiven ? (precision === 0 ? 1 : precision) : 6;
        const { digitsStr: eDigits, exp: X } = formatExponential(num, den, P - 1);
        if (P > X && X >= -4) {
          const fp = P - 1 - X;
          let fixedDigits = formatFixed(num, den, fp);
          let body = buildFixedString(fixedDigits, fp, true);
          if (!flags.hash) body = stripTrailingZeros(body);
          digits = body;
        } else {
          let body = buildExpString(eDigits, X, P - 1, true, upper);
          if (!flags.hash) body = stripTrailingZerosExp(body);
          digits = body;
        }
      }
      break;
    }
    case 's': {
      let s = arg as string;
      if (precisionGiven) s = s.slice(0, precision);
      digits = s;
      zeroPadAllowed = false;
      break;
    }
    case 'c': {
      digits = arg as string;
      zeroPadAllowed = false;
      break;
    }
  }

  let unpadded = sign + prefix + digits;
  if (width !== null && unpadded.length < width) {
    const padLen = width - unpadded.length;
    if (flags.minus) {
      unpadded = unpadded + ' '.repeat(padLen);
    } else if (flags.zero && zeroPadAllowed) {
      unpadded = sign + prefix + '0'.repeat(padLen) + digits;
    } else {
      unpadded = ' '.repeat(padLen) + unpadded;
    }
  }
  return unpadded;
}

function toBigIntMagnitude(v: number | bigint): { neg: boolean; mag: bigint } {
  if (typeof v === 'bigint') {
    return v < 0n ? { neg: true, mag: -v } : { neg: false, mag: v };
  }
  const neg = v < 0 || Object.is(v, -0);
  const mag = BigInt(Math.abs(v));
  return { neg, mag };
}

function signFor(neg: boolean, flags: Flags, isNaN: boolean): string {
  if (isNaN) return '';
  if (neg) return '-';
  if (flags.plus) return '+';
  if (flags.space) return ' ';
  return '';
}

function doubleParts(x: number): { m: bigint; e: number } {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, x);
  const bits = dv.getBigUint64(0);
  const expBits = Number((bits >> 52n) & 0x7ffn);
  const mantissaBits = bits & 0xfffffffffffffn;
  if (expBits === 0) {
    return { m: mantissaBits, e: -1074 };
  }
  return { m: mantissaBits | (1n << 52n), e: expBits - 1075 };
}

function scaleRound(num: bigint, den: bigint, shift: number): bigint {
  let n = num;
  let d = den;
  if (shift >= 0) {
    n = n * 10n ** BigInt(shift);
  } else {
    d = d * 10n ** BigInt(-shift);
  }
  const q = n / d;
  const r = n % d;
  const twice = r * 2n;
  if (twice < d) return q;
  if (twice > d) return q + 1n;
  return q % 2n === 0n ? q : q + 1n;
}

function geTenPow(num: bigint, den: bigint, k: number): boolean {
  if (k >= 0) return num >= den * 10n ** BigInt(k);
  return num * 10n ** BigInt(-k) >= den;
}

function findExponent(num: bigint, den: bigint, x: number): number {
  let E = Math.floor(Math.log10(x));
  while (!geTenPow(num, den, E)) E--;
  while (geTenPow(num, den, E + 1)) E++;
  return E;
}

function formatExponential(num: bigint, den: bigint, precision: number): { digitsStr: string; exp: number } {
  if (num === 0n) {
    return { digitsStr: '0'.repeat(precision + 1), exp: 0 };
  }
  // reconstruct approximate value for exponent estimation
  const approx = Number(num) / Number(den);
  let E = findExponent(num, den, approx);
  const shift = precision - E;
  let Q = scaleRound(num, den, shift);
  const upperBound = 10n ** BigInt(precision + 1);
  if (Q >= upperBound) {
    Q = Q / 10n;
    E += 1;
  }
  const digitsStr = Q.toString().padStart(precision + 1, '0');
  return { digitsStr, exp: E };
}

function formatFixed(num: bigint, den: bigint, precision: number): string {
  const Q = scaleRound(num, den, precision);
  return Q.toString().padStart(precision + 1, '0');
}

function buildFixedString(digitsStr: string, precision: number, hash: boolean): string {
  if (precision === 0) {
    return digitsStr + (hash ? '.' : '');
  }
  const intPart = digitsStr.slice(0, digitsStr.length - precision);
  const fracPart = digitsStr.slice(digitsStr.length - precision);
  return intPart + '.' + fracPart;
}

function buildExpString(digitsStr: string, exp: number, precision: number, hash: boolean, upper: boolean): string {
  const d0 = digitsStr[0];
  const rest = digitsStr.slice(1);
  let mantissa: string;
  if (precision === 0) {
    mantissa = d0 + (hash ? '.' : '');
  } else {
    mantissa = d0 + '.' + rest;
  }
  const eLetter = upper ? 'E' : 'e';
  const expSign = exp < 0 ? '-' : '+';
  const expDigits = Math.abs(exp).toString().padStart(2, '0');
  return mantissa + eLetter + expSign + expDigits;
}

function stripTrailingZeros(s: string): string {
  if (!s.includes('.')) return s;
  s = s.replace(/0+$/, '');
  s = s.replace(/\.$/, '');
  return s;
}

function stripTrailingZerosExp(s: string): string {
  const idx = s.search(/[eE]/);
  const mantissa = s.slice(0, idx);
  const rest = s.slice(idx);
  return stripTrailingZeros(mantissa) + rest;
}
