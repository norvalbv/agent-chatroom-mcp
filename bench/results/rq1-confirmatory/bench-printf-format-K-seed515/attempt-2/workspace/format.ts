type Arg = number | bigint | string;

function decompose(x: number): { m: bigint; e: number } {
  // x must be finite and > 0
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  const mantHi = hi & 0xfffff;
  let mantissa = (BigInt(mantHi) << 32n) | BigInt(lo);
  let e: number;
  if (expBits === 0) {
    e = -1074;
  } else {
    mantissa += 1n << 52n;
    e = expBits - 1075;
  }
  return { m: mantissa, e };
}

function roundHalfEven(N: bigint, D: bigint): bigint {
  let q = N / D;
  const r = N % D;
  const twice = r * 2n;
  if (twice > D) q += 1n;
  else if (twice === D && q % 2n === 1n) q += 1n;
  return q;
}

// round(m * 2^e * 10^t), t may be negative
function scaledRound(m: bigint, e: number, t: number): bigint {
  if (m === 0n) return 0n;
  if (t >= 0) {
    const pow5 = 5n ** BigInt(t);
    const N = m * pow5;
    const exp2 = e + t;
    if (exp2 >= 0) return N * (2n ** BigInt(exp2));
    return roundHalfEven(N, 2n ** BigInt(-exp2));
  } else {
    const pow5den = 5n ** BigInt(-t);
    const exp2 = e + t;
    if (exp2 >= 0) return roundHalfEven(m * (2n ** BigInt(exp2)), pow5den);
    return roundHalfEven(m, pow5den * (2n ** BigInt(-exp2)));
  }
}

function fDigits(absX: number, k: number): { intPart: string; fracPart: string } {
  let m = 0n, e = 0;
  if (absX !== 0) ({ m, e } = decompose(absX));
  let q = scaledRound(m, e, k);
  let digits = q.toString();
  while (digits.length < k + 1) digits = '0' + digits;
  const cut = digits.length - k;
  return { intPart: digits.slice(0, cut), fracPart: k > 0 ? digits.slice(cut) : '' };
}

function eDigits(absX: number, k: number): { digits: string; exp: number } {
  if (absX === 0) return { digits: '0'.repeat(k + 1), exp: 0 };
  const { m, e } = decompose(absX);
  let E0 = Math.floor(Math.log10(absX));
  for (let i = 0; i < 10; i++) {
    const t = k - E0;
    const q = scaledRound(m, e, t);
    const qs = q.toString();
    if (qs.length === k + 1) return { digits: qs, exp: E0 };
    if (qs.length > k + 1) {
      E0 += qs.length - (k + 1);
    } else {
      E0 -= (k + 1) - qs.length;
    }
  }
  // fallback (shouldn't happen)
  const t = k - E0;
  const q = scaledRound(m, e, t);
  return { digits: q.toString().padStart(k + 1, '0'), exp: E0 };
}

function trimTrailingZeros(s: string): string {
  if (!s.includes('.')) return s;
  s = s.replace(/0+$/, '');
  if (s.endsWith('.')) s = s.slice(0, -1);
  return s;
}

function padNum(sign: string, prefix: string, body: string, width: number, dash: boolean, zero: boolean): string {
  const core = sign + prefix + body;
  if (core.length >= width) return core;
  const padLen = width - core.length;
  if (dash) return core + ' '.repeat(padLen);
  if (zero) return sign + prefix + '0'.repeat(padLen) + body;
  return ' '.repeat(padLen) + core;
}

function padStr(body: string, width: number, dash: boolean): string {
  if (body.length >= width) return body;
  const padLen = width - body.length;
  return dash ? body + ' '.repeat(padLen) : ' '.repeat(padLen) + body;
}

function toBigIntMagnitude(arg: Arg): { neg: boolean; abs: bigint } {
  if (typeof arg === 'bigint') {
    return arg < 0n ? { neg: true, abs: -arg } : { neg: false, abs: arg };
  }
  const n = arg as number;
  return n < 0 ? { neg: true, abs: BigInt(-n) } : { neg: false, abs: BigInt(n) };
}

function intDigitsWithPrecision(abs: bigint, base: number, precision: number | undefined): string {
  if (abs === 0n && precision === 0) return '';
  let s = abs.toString(base);
  if (precision !== undefined && s.length < precision) s = '0'.repeat(precision - s.length) + s;
  return s;
}

function signFor(neg: boolean, plusFlag: boolean, spaceFlag: boolean): string {
  if (neg) return '-';
  if (plusFlag) return '+';
  if (spaceFlag) return ' ';
  return '';
}

function floatSignPrefix(x: number): boolean {
  return x < 0 || Object.is(x, -0);
}

export function format(fmt: string, ...args: Arg[]): string {
  let out = '';
  let argIdx = 0;
  const re = /%([-+0 #]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc%])/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(fmt)) !== null) {
    out += fmt.slice(lastIndex, match.index);
    lastIndex = re.lastIndex;
    const [, flagsStr, widthStr, precStr, conv] = match;

    if (conv === '%') {
      out += '%';
      continue;
    }

    const dash = flagsStr.includes('-');
    const plus = flagsStr.includes('+');
    const space = flagsStr.includes(' ');
    const zero = flagsStr.includes('0');
    const hash = flagsStr.includes('#');
    const width = widthStr ? parseInt(widthStr, 10) : 0;
    const precision = precStr !== undefined ? (precStr === '' ? 0 : parseInt(precStr, 10)) : undefined;

    const arg = args[argIdx++];

    switch (conv) {
      case 'd':
      case 'i': {
        const { neg, abs } = toBigIntMagnitude(arg);
        const digits = intDigitsWithPrecision(abs, 10, precision);
        const sign = signFor(neg, plus, space);
        out += padNum(sign, '', digits, width, dash, zero && precision === undefined);
        break;
      }
      case 'x':
      case 'X':
      case 'o': {
        const { abs } = toBigIntMagnitude(arg);
        const base = conv === 'o' ? 8 : 16;
        let digits = intDigitsWithPrecision(abs, base, precision);
        if (conv === 'X') digits = digits.toUpperCase();
        let prefix = '';
        if (hash) {
          if (conv === 'o') {
            if (digits === '' || digits[0] !== '0') digits = '0' + digits;
          } else if (abs !== 0n) {
            prefix = conv === 'X' ? '0X' : '0x';
          }
        }
        out += padNum('', prefix, digits, width, dash, zero && precision === undefined);
        break;
      }
      case 's': {
        let s = String(arg);
        if (precision !== undefined) s = s.slice(0, precision);
        out += padStr(s, width, dash);
        break;
      }
      case 'c': {
        const s = String(arg);
        out += padStr(s, width, dash);
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
        const neg = Number.isNaN(x) ? false : floatSignPrefix(x);
        const sign = Number.isNaN(x) ? '' : signFor(neg, plus, space);

        if (Number.isNaN(x)) {
          const body = upper ? 'NAN' : 'nan';
          out += padNum('', '', body, width, dash, false);
          break;
        }
        if (!Number.isFinite(x)) {
          const body = upper ? 'INF' : 'inf';
          out += padNum(sign, '', body, width, dash, false);
          break;
        }

        const absX = Math.abs(x);

        if (conv === 'f' || conv === 'F') {
          const k = precision === undefined ? 6 : precision;
          const { intPart, fracPart } = fDigits(absX, k);
          let body: string;
          if (k === 0) body = hash ? intPart + '.' : intPart;
          else body = intPart + '.' + fracPart;
          out += padNum(sign, '', body, width, dash, zero);
        } else if (conv === 'e' || conv === 'E') {
          const k = precision === undefined ? 6 : precision;
          const { digits, exp } = eDigits(absX, k);
          const lead = digits[0];
          const frac = digits.slice(1);
          let mantissa: string;
          if (k === 0) mantissa = hash ? lead + '.' : lead;
          else mantissa = lead + '.' + frac;
          const expLetter = conv === 'E' ? 'E' : 'e';
          const expSign = exp < 0 ? '-' : '+';
          const expDigits = Math.abs(exp).toString().padStart(2, '0');
          const body = mantissa + expLetter + expSign + expDigits;
          out += padNum(sign, '', body, width, dash, zero);
        } else {
          // g, G
          const P = precision === undefined ? 6 : (precision === 0 ? 1 : precision);
          const { digits, exp: X } = eDigits(absX, P - 1);
          let body: string;
          if (P > X && X >= -4) {
            const precision2 = P - 1 - X;
            const { intPart, fracPart } = fDigits(absX, precision2);
            const mantissaRaw = intPart + '.' + fracPart;
            body = hash ? mantissaRaw : trimTrailingZeros(mantissaRaw);
          } else {
            const lead = digits[0];
            const frac = digits.slice(1);
            const mantissaRaw = lead + '.' + frac;
            const mantissa = hash ? mantissaRaw : trimTrailingZeros(mantissaRaw);
            const expLetter = conv === 'G' ? 'E' : 'e';
            const expSign = X < 0 ? '-' : '+';
            const expDigitsStr = Math.abs(X).toString().padStart(2, '0');
            body = mantissa + expLetter + expSign + expDigitsStr;
          }
          out += padNum(sign, '', body, width, dash, zero);
        }
        break;
      }
    }
  }
  out += fmt.slice(lastIndex);
  return out;
}
