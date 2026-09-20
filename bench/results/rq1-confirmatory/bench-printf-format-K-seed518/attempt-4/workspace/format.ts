type Flags = {
  minus: boolean;
  plus: boolean;
  space: boolean;
  zero: boolean;
  hash: boolean;
};

function decompose(ax: number): { M: bigint; E: number } {
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setFloat64(0, ax);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const exp = (hi >>> 20) & 0x7ff;
  const fracHi = BigInt(hi & 0xfffff);
  const fracLo = BigInt(lo >>> 0);
  const frac = (fracHi << 32n) | fracLo;
  if (exp === 0) {
    return { M: frac, E: -1074 };
  }
  const M = frac | (1n << 52n);
  const E = exp - 1075;
  return { M, E };
}

// Rounds ax = M * 2^E to the nearest multiple of 10^placeExponent, ties to even,
// and returns the resulting integer (value / 10^placeExponent).
function roundAtPlace(M: bigint, E: number, placeExponent: number): bigint {
  const e2 = E - placeExponent;
  const e5 = -placeExponent;
  let N = M;
  let D = 1n;
  if (e2 >= 0) N *= 2n ** BigInt(e2);
  else D *= 2n ** BigInt(-e2);
  if (e5 >= 0) N *= 5n ** BigInt(e5);
  else D *= 5n ** BigInt(-e5);
  const q = N / D;
  const r = N % D;
  const twice = r * 2n;
  if (twice < D) return q;
  if (twice > D) return q + 1n;
  return q % 2n === 0n ? q : q + 1n;
}

function fBody(ax: number, precision: number): { intPart: string; fracPart: string } {
  if (ax === 0) {
    return { intPart: '0', fracPart: '0'.repeat(precision) };
  }
  const { M, E } = decompose(ax);
  const scaled = roundAtPlace(M, E, -precision);
  let s = scaled.toString();
  if (precision === 0) {
    return { intPart: s, fracPart: '' };
  }
  if (s.length <= precision) s = s.padStart(precision + 1, '0');
  const intPart = s.slice(0, s.length - precision);
  const fracPart = s.slice(s.length - precision);
  return { intPart, fracPart };
}

function eBody(ax: number, p: number): { digits: string; exponent: number } {
  if (ax === 0) return { digits: '0'.repeat(p + 1), exponent: 0 };
  const { M, E } = decompose(ax);
  let X = Math.floor(Math.log10(ax));
  const lowBound = 10n ** BigInt(p);
  const highBound = 10n ** BigInt(p + 1);
  for (;;) {
    const cand = roundAtPlace(M, E, X - p);
    if (cand < lowBound) {
      X -= 1;
      continue;
    }
    if (cand >= highBound) {
      X += 1;
      continue;
    }
    return { digits: cand.toString().padStart(p + 1, '0'), exponent: X };
  }
}

function stripTrailingZeros(s: string): string {
  const m = /^([^eE]*)([eE].*)?$/.exec(s)!;
  let mantissa = m[1];
  const rest = m[2] ?? '';
  if (mantissa.includes('.')) {
    mantissa = mantissa.replace(/0+$/, '');
    mantissa = mantissa.replace(/\.$/, '');
  }
  return mantissa + rest;
}

function gBody(ax: number, precisionArg: number, hash: boolean, upper: boolean): string {
  const P = precisionArg === 0 ? 1 : precisionArg;
  const { digits, exponent: X } = eBody(ax, P - 1);
  let body: string;
  if (P > X && X >= -4) {
    const fracLen = P - 1 - X;
    const { intPart, fracPart } = fBody(ax, fracLen);
    body = intPart + (fracLen > 0 ? '.' + fracPart : hash ? '.' : '');
  } else {
    const first = digits[0];
    const rest = digits.slice(1);
    const eChar = upper ? 'E' : 'e';
    const expSign = X < 0 ? '-' : '+';
    const expAbs = Math.abs(X).toString().padStart(2, '0');
    body = first + (rest.length > 0 ? '.' + rest : hash ? '.' : '') + eChar + expSign + expAbs;
  }
  if (!hash) body = stripTrailingZeros(body);
  return body;
}

function pad(
  sign: string,
  prefix: string,
  digits: string,
  width: number | undefined,
  minus: boolean,
  zero: boolean,
): string {
  const w = width ?? 0;
  const total = sign + prefix + digits;
  if (total.length >= w) return total;
  const padLen = w - total.length;
  if (zero) return sign + prefix + '0'.repeat(padLen) + digits;
  if (minus) return total + ' '.repeat(padLen);
  return ' '.repeat(padLen) + total;
}

function toBigInt(arg: number | bigint | string): bigint {
  return typeof arg === 'bigint' ? arg : BigInt(arg as number);
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  const re = /%([-+#0 ]*)(\d*)(\.\d*)?([diouxXeEfFgGsc%])/g;
  let out = '';
  let lastIndex = 0;
  let argIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = re.exec(fmt)) !== null) {
    out += fmt.slice(lastIndex, match.index);
    lastIndex = re.lastIndex;

    const [, flagStr, widthStr, precStr, conv] = match;

    if (conv === '%') {
      out += '%';
      continue;
    }

    const flags: Flags = {
      minus: flagStr.includes('-'),
      plus: flagStr.includes('+'),
      space: flagStr.includes(' '),
      zero: flagStr.includes('0'),
      hash: flagStr.includes('#'),
    };
    const width = widthStr.length > 0 ? parseInt(widthStr, 10) : undefined;
    const precision =
      precStr === undefined ? undefined : precStr.length === 1 ? 0 : parseInt(precStr.slice(1), 10);

    switch (conv) {
      case 'd':
      case 'i': {
        const arg = args[argIndex++];
        const value = toBigInt(arg);
        const neg = value < 0n;
        const mag = neg ? -value : value;
        let digits = mag.toString();
        if (precision !== undefined) {
          digits = precision === 0 && mag === 0n ? '' : digits.padStart(precision, '0');
        }
        const sign = neg ? '-' : flags.plus ? '+' : flags.space ? ' ' : '';
        const zero = flags.zero && !flags.minus && precision === undefined;
        out += pad(sign, '', digits, width, flags.minus, zero);
        break;
      }
      case 'x':
      case 'X':
      case 'o': {
        const arg = args[argIndex++];
        const value = toBigInt(arg);
        let digits = value.toString(conv === 'o' ? 8 : 16);
        if (conv === 'X') digits = digits.toUpperCase();
        if (precision !== undefined) {
          digits = precision === 0 && value === 0n ? '' : digits.padStart(precision, '0');
        }
        let prefix = '';
        if (flags.hash) {
          if (conv === 'o') {
            if (digits === '' || digits[0] !== '0') digits = '0' + digits;
          } else if (value !== 0n) {
            prefix = conv === 'X' ? '0X' : '0x';
          }
        }
        const zero = flags.zero && !flags.minus && precision === undefined;
        out += pad('', prefix, digits, width, flags.minus, zero);
        break;
      }
      case 's': {
        const arg = args[argIndex++] as string;
        const s = precision !== undefined ? arg.slice(0, precision) : arg;
        out += pad('', '', s, width, flags.minus, false);
        break;
      }
      case 'c': {
        const arg = args[argIndex++] as string;
        out += pad('', '', arg, width, flags.minus, false);
        break;
      }
      case 'e':
      case 'E':
      case 'f':
      case 'F':
      case 'g':
      case 'G': {
        const x = args[argIndex++] as number;
        const upper = conv === 'E' || conv === 'F' || conv === 'G';
        const isNaNVal = Number.isNaN(x);
        const neg = !isNaNVal && (x < 0 || Object.is(x, -0));
        const sign = isNaNVal ? '' : neg ? '-' : flags.plus ? '+' : flags.space ? ' ' : '';

        let body: string;
        let zeroOk = true;

        if (isNaNVal) {
          body = upper ? 'NAN' : 'nan';
          zeroOk = false;
        } else if (!Number.isFinite(x)) {
          body = upper ? 'INF' : 'inf';
          zeroOk = false;
        } else {
          const ax = Math.abs(x);
          const p = precision === undefined ? 6 : precision;
          if (conv === 'f' || conv === 'F') {
            const { intPart, fracPart } = fBody(ax, p);
            body = intPart + (p > 0 ? '.' + fracPart : flags.hash ? '.' : '');
          } else if (conv === 'e' || conv === 'E') {
            const { digits, exponent } = eBody(ax, p);
            const first = digits[0];
            const rest = digits.slice(1);
            const eChar = upper ? 'E' : 'e';
            const expSign = exponent < 0 ? '-' : '+';
            const expAbs = Math.abs(exponent).toString().padStart(2, '0');
            body =
              first +
              (p > 0 ? '.' + rest : flags.hash ? '.' : '') +
              eChar +
              expSign +
              expAbs;
          } else {
            body = gBody(ax, precision === undefined ? 6 : precision, flags.hash, upper);
          }
        }

        const zero = flags.zero && !flags.minus && zeroOk;
        out += pad(sign, '', body, width, flags.minus, zero);
        break;
      }
    }
  }

  out += fmt.slice(lastIndex);
  return out;
}
