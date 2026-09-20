// Exact decomposition of a finite, non-negative, non-zero double into
// mantissa * 2^exp (mantissa a non-negative BigInt), using the raw IEEE-754
// bits, so that decimal rounding can be computed exactly with BigInt math.
function decompose(x: number): { mantissa: bigint; exp: number } {
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const biasedExp = (hi >>> 20) & 0x7ff;
  const mantHi = BigInt(hi & 0xfffff);
  const mantLo = BigInt(lo >>> 0);
  let mantissa = (mantHi << 32n) | mantLo;
  let exp: number;
  if (biasedExp === 0) {
    exp = -1074;
  } else {
    mantissa |= 1n << 52n;
    exp = biasedExp - 1075;
  }
  return { mantissa, exp };
}

function roundRatioHalfEven(num: bigint, den: bigint): bigint {
  const q = num / den;
  const r = num % den;
  const twice = r * 2n;
  if (twice < den) return q;
  if (twice > den) return q + 1n;
  return q % 2n === 0n ? q : q + 1n;
}

// round(mantissa * 2^exp * 10^d) to the nearest integer, ties to even.
function scaledRound(mantissa: bigint, exp: number, d: number): bigint {
  let num = mantissa;
  let den = 1n;
  if (d >= 0) num *= 5n ** BigInt(d);
  else den *= 5n ** BigInt(-d);
  const e2 = exp + d;
  if (e2 >= 0) num <<= BigInt(e2);
  else den <<= BigInt(-e2);
  return roundRatioHalfEven(num, den);
}

function fDigits(mantissa: bigint, exp: number, precision: number): { intPart: string; fracPart: string } {
  const n = scaledRound(mantissa, exp, precision);
  let s = n.toString();
  if (s.length <= precision) s = s.padStart(precision + 1, '0');
  const intPart = s.slice(0, s.length - precision) || '0';
  const fracPart = precision > 0 ? s.slice(s.length - precision) : '';
  return { intPart, fracPart };
}

function eFormat(mantissa: bigint, exp: number, absX: number, precision: number): { digits: string; exponent: number } {
  let e = Math.floor(Math.log10(absX));
  for (let iter = 0; iter < 20; iter++) {
    const d = precision - e;
    const n = scaledRound(mantissa, exp, d);
    const s = n.toString();
    if (s.length === precision + 1) return { digits: s, exponent: e };
    e += s.length - (precision + 1);
  }
  throw new Error('eFormat failed to converge');
}

function numSign(x: number, flags: Set<string>): string {
  const negative = x < 0 || Object.is(x, -0);
  if (negative) return '-';
  if (flags.has('+')) return '+';
  if (flags.has(' ')) return ' ';
  return '';
}

function pad(sign: string, prefix: string, body: string, width: number, flags: Set<string>, useZero: boolean): string {
  const core = sign + prefix + body;
  if (core.length >= width) return core;
  const padLen = width - core.length;
  if (flags.has('-')) return core + ' '.repeat(padLen);
  if (useZero) return sign + prefix + '0'.repeat(padLen) + body;
  return ' '.repeat(padLen) + core;
}

function padText(body: string, width: number, flags: Set<string>): string {
  if (body.length >= width) return body;
  const padLen = width - body.length;
  return flags.has('-') ? body + ' '.repeat(padLen) : ' '.repeat(padLen) + body;
}

function stripTrailingZeros(s: string): string {
  return s.replace(/0+$/, '');
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  const re = /%([-+ 0#]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc%])/g;
  let out = '';
  let last = 0;
  let argi = 0;
  let m: RegExpExecArray | null;

  while ((m = re.exec(fmt)) !== null) {
    out += fmt.slice(last, m.index);
    last = re.lastIndex;
    const [, flagsStr, widthStr, precStr, conv] = m;

    if (conv === '%') {
      out += '%';
      continue;
    }

    const flags = new Set(flagsStr.split(''));
    const width = widthStr ? parseInt(widthStr, 10) : 0;
    const precision = precStr !== undefined ? (precStr === '' ? 0 : parseInt(precStr, 10)) : undefined;

    switch (conv) {
      case 'd':
      case 'i': {
        const raw = args[argi++] as number | bigint;
        const value = typeof raw === 'bigint' ? raw : BigInt(raw);
        const neg = value < 0n;
        const absVal = neg ? -value : value;
        let digits: string;
        if (precision !== undefined) {
          digits = precision === 0 && absVal === 0n ? '' : absVal.toString(10).padStart(precision, '0');
        } else {
          digits = absVal.toString(10);
        }
        const sign = neg ? '-' : flags.has('+') ? '+' : flags.has(' ') ? ' ' : '';
        const useZero = flags.has('0') && precision === undefined;
        out += pad(sign, '', digits, width, flags, useZero);
        break;
      }
      case 'x':
      case 'X': {
        const raw = args[argi++] as number | bigint;
        const value = typeof raw === 'bigint' ? raw : BigInt(raw);
        let digits = value.toString(16);
        if (conv === 'X') digits = digits.toUpperCase();
        if (precision !== undefined) {
          digits = precision === 0 && value === 0n ? '' : digits.padStart(precision, '0');
        }
        const prefix = flags.has('#') && value !== 0n ? (conv === 'X' ? '0X' : '0x') : '';
        const useZero = flags.has('0') && precision === undefined;
        out += pad('', prefix, digits, width, flags, useZero);
        break;
      }
      case 'o': {
        const raw = args[argi++] as number | bigint;
        const value = typeof raw === 'bigint' ? raw : BigInt(raw);
        let digits: string;
        if (precision !== undefined) {
          digits = precision === 0 && value === 0n ? '' : value.toString(8).padStart(precision, '0');
        } else {
          digits = value.toString(8);
        }
        if (flags.has('#') && (digits.length === 0 || digits[0] !== '0')) {
          digits = '0' + digits;
        }
        const useZero = flags.has('0') && precision === undefined;
        out += pad('', '', digits, width, flags, useZero);
        break;
      }
      case 'e':
      case 'E': {
        const x = args[argi++] as number;
        const upper = conv === 'E';
        const prec = precision === undefined ? 6 : precision;
        if (Number.isNaN(x)) {
          out += pad('', '', upper ? 'NAN' : 'nan', width, flags, false);
          break;
        }
        const sign = numSign(x, flags);
        if (!Number.isFinite(x)) {
          out += pad(sign, '', upper ? 'INF' : 'inf', width, flags, false);
          break;
        }
        const absX = Math.abs(x);
        let digits: string, exponent: number;
        if (absX === 0) {
          digits = '0'.repeat(prec + 1);
          exponent = 0;
        } else {
          const { mantissa, exp } = decompose(absX);
          ({ digits, exponent } = eFormat(mantissa, exp, absX, prec));
        }
        const first = digits[0];
        const frac = digits.slice(1);
        const dot = prec === 0 ? (flags.has('#') ? '.' : '') : '.' + frac;
        const expSign = exponent < 0 ? '-' : '+';
        const expAbs = Math.abs(exponent).toString().padStart(2, '0');
        const body = first + dot + (upper ? 'E' : 'e') + expSign + expAbs;
        const useZero = flags.has('0');
        out += pad(sign, '', body, width, flags, useZero);
        break;
      }
      case 'f':
      case 'F': {
        const x = args[argi++] as number;
        const upper = conv === 'F';
        const prec = precision === undefined ? 6 : precision;
        if (Number.isNaN(x)) {
          out += pad('', '', upper ? 'NAN' : 'nan', width, flags, false);
          break;
        }
        const sign = numSign(x, flags);
        if (!Number.isFinite(x)) {
          out += pad(sign, '', upper ? 'INF' : 'inf', width, flags, false);
          break;
        }
        const absX = Math.abs(x);
        let intPart: string, fracPart: string;
        if (absX === 0) {
          intPart = '0';
          fracPart = '0'.repeat(prec);
        } else {
          const { mantissa, exp } = decompose(absX);
          ({ intPart, fracPart } = fDigits(mantissa, exp, prec));
        }
        const dot = prec === 0 ? (flags.has('#') ? '.' : '') : '.' + fracPart;
        const body = intPart + dot;
        const useZero = flags.has('0');
        out += pad(sign, '', body, width, flags, useZero);
        break;
      }
      case 'g':
      case 'G': {
        const x = args[argi++] as number;
        const upper = conv === 'G';
        const P = precision === undefined ? 6 : precision === 0 ? 1 : precision;
        if (Number.isNaN(x)) {
          out += pad('', '', upper ? 'NAN' : 'nan', width, flags, false);
          break;
        }
        const sign = numSign(x, flags);
        if (!Number.isFinite(x)) {
          out += pad(sign, '', upper ? 'INF' : 'inf', width, flags, false);
          break;
        }
        const absX = Math.abs(x);
        let mantissa = 0n;
        let exp = 0;
        let X: number;
        if (absX !== 0) {
          ({ mantissa, exp } = decompose(absX));
          X = eFormat(mantissa, exp, absX, P - 1).exponent;
        } else {
          X = 0;
        }
        let body: string;
        if (P > X && X >= -4) {
          const fprec = P - 1 - X;
          let intPart: string, fracPart: string;
          if (absX === 0) {
            intPart = '0';
            fracPart = '0'.repeat(fprec);
          } else {
            ({ intPart, fracPart } = fDigits(mantissa, exp, fprec));
          }
          if (!flags.has('#')) fracPart = stripTrailingZeros(fracPart);
          body = fracPart.length > 0 ? intPart + '.' + fracPart : flags.has('#') ? intPart + '.' : intPart;
        } else {
          const eprec = P - 1;
          let digits: string, exponent: number;
          if (absX === 0) {
            digits = '0'.repeat(eprec + 1);
            exponent = 0;
          } else {
            ({ digits, exponent } = eFormat(mantissa, exp, absX, eprec));
          }
          const first = digits[0];
          let frac = digits.slice(1);
          if (!flags.has('#')) frac = stripTrailingZeros(frac);
          const dot = frac.length > 0 ? '.' + frac : flags.has('#') ? '.' : '';
          const expSign = exponent < 0 ? '-' : '+';
          const expAbs = Math.abs(exponent).toString().padStart(2, '0');
          body = first + dot + (upper ? 'E' : 'e') + expSign + expAbs;
        }
        const useZero = flags.has('0');
        out += pad(sign, '', body, width, flags, useZero);
        break;
      }
      case 's': {
        const s = args[argi++] as string;
        const truncated = precision !== undefined ? s.slice(0, precision) : s;
        out += padText(truncated, width, flags);
        break;
      }
      case 'c': {
        const s = args[argi++] as string;
        out += padText(s, width, flags);
        break;
      }
    }
  }

  out += fmt.slice(last);
  return out;
}
