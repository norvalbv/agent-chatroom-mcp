// Extract sign, mantissa (M) and binary exponent (E) of a finite double x
// such that |x| === M * 2^E exactly, with M a non-negative bigint.
function bitsOf(x: number): { sign: number; M: bigint; E: number } {
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setFloat64(0, x);
  const hi = view.getUint32(0);
  const lo = view.getUint32(4);
  const sign = hi >>> 31;
  const biasedExp = (hi >>> 20) & 0x7ff;
  const mantHigh = hi & 0xfffff;
  let M: bigint;
  let E: number;
  if (biasedExp === 0) {
    M = (BigInt(mantHigh) << 32n) | BigInt(lo >>> 0);
    E = -1074;
  } else {
    M = ((BigInt(mantHigh) | 0x100000n) << 32n) | BigInt(lo >>> 0);
    E = biasedExp - 1075;
  }
  return { sign, M, E };
}

// Exact decimal representation: value === N / 10^d, N a non-negative bigint.
function exactDecimal(M: bigint, E: number): { N: bigint; d: number } {
  if (E >= 0) {
    return { N: M << BigInt(E), d: 0 };
  }
  return { N: M * 5n ** BigInt(-E), d: -E };
}

// Returns round(N/10^d * 10^p) with ties-to-even, as an exact integer bigint.
function roundToFracDigits(N: bigint, d: number, p: number): bigint {
  if (p >= d) {
    return N * 10n ** BigInt(p - d);
  }
  const r = d - p;
  const divisor = 10n ** BigInt(r);
  const q = N / divisor;
  const rem = N % divisor;
  const twiceRem = rem * 2n;
  if (twiceRem > divisor) return q + 1n;
  if (twiceRem < divisor) return q;
  return q % 2n === 0n ? q : q + 1n;
}

// Rounds N/10^d to `totalSig` significant decimal digits (ties-to-even).
function roundSignificant(
  N: bigint,
  d: number,
  totalSig: number
): { digits: string; X: number } {
  if (N === 0n) {
    return { digits: '0'.repeat(totalSig), X: 0 };
  }
  const L = N.toString().length;
  const X0 = L - 1 - d;
  const p = totalSig - 1 - X0;
  let result = roundToFracDigits(N, d, p);
  let resultStr = result.toString();
  let X = X0;
  if (resultStr.length > totalSig) {
    result = result / 10n;
    resultStr = result.toString();
    X = X0 + 1;
  }
  resultStr = resultStr.padStart(totalSig, '0');
  return { digits: resultStr, X };
}

function signStr(negative: boolean, isNaN: boolean, flags: Set<string>): string {
  if (isNaN) return '';
  if (negative) return '-';
  if (flags.has('+')) return '+';
  if (flags.has(' ')) return ' ';
  return '';
}

function padNumeric(
  prefix: string,
  digits: string,
  width: number | undefined,
  flags: Set<string>,
  zeroAllowed: boolean
): string {
  const body = prefix + digits;
  if (width === undefined || body.length >= width) return body;
  const padLen = width - body.length;
  if (flags.has('-')) return body + ' '.repeat(padLen);
  if (flags.has('0') && zeroAllowed) return prefix + '0'.repeat(padLen) + digits;
  return ' '.repeat(padLen) + body;
}

function padPlain(str: string, width: number | undefined, leftAlign: boolean): string {
  if (width === undefined || str.length >= width) return str;
  const pad = ' '.repeat(width - str.length);
  return leftAlign ? str + pad : pad + str;
}

function stripFrac(fracPart: string, hasHash: boolean): { fracPart: string; dot: string } {
  let fp = fracPart;
  if (!hasHash) {
    fp = fp.replace(/0+$/, '');
  }
  const dot = fp.length > 0 || hasHash ? '.' : '';
  return { fracPart: fp, dot };
}

function toBigIntArg(arg: number | bigint): bigint {
  return typeof arg === 'bigint' ? arg : BigInt(arg);
}

function digitsWithPrecision(base: string, magnitude: bigint, precision: number | undefined): string {
  if (precision === undefined) return base;
  if (magnitude === 0n && precision === 0) return '';
  let s = base;
  if (s.length < precision) s = '0'.repeat(precision - s.length) + s;
  return s;
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  const re = /%([-+0# ]*)(\d*)(\.(\d*))?([%diouxXeEfFgGsc])/g;
  let out = '';
  let lastIndex = 0;
  let argIdx = 0;
  let m: RegExpExecArray | null;

  while ((m = re.exec(fmt)) !== null) {
    out += fmt.slice(lastIndex, m.index);
    lastIndex = re.lastIndex;

    const flagsStr = m[1];
    const flags = new Set(flagsStr.split('').filter((c) => c.length > 0));
    const widthStr = m[2];
    const width = widthStr === '' ? undefined : parseInt(widthStr, 10);
    const hasPrecision = m[3] !== undefined;
    const precision = hasPrecision ? (m[4] === '' ? 0 : parseInt(m[4], 10)) : undefined;
    const conv = m[5];

    if (conv === '%') {
      out += '%';
      continue;
    }

    const arg = args[argIdx++];

    switch (conv) {
      case 'd':
      case 'i': {
        const v = toBigIntArg(arg as number | bigint);
        const negative = v < 0n;
        const magnitude = negative ? -v : v;
        const sign = negative ? '-' : flags.has('+') ? '+' : flags.has(' ') ? ' ' : '';
        const digits = digitsWithPrecision(magnitude.toString(10), magnitude, precision);
        const zeroAllowed = precision === undefined;
        out += padNumeric(sign, digits, width, flags, zeroAllowed);
        break;
      }
      case 'x':
      case 'X': {
        const v = toBigIntArg(arg as number | bigint);
        let base = v.toString(16);
        if (conv === 'X') base = base.toUpperCase();
        const digits = digitsWithPrecision(base, v, precision);
        const prefix = flags.has('#') && v !== 0n ? (conv === 'x' ? '0x' : '0X') : '';
        const zeroAllowed = precision === undefined;
        out += padNumeric(prefix, digits, width, flags, zeroAllowed);
        break;
      }
      case 'o': {
        const v = toBigIntArg(arg as number | bigint);
        let digits = digitsWithPrecision(v.toString(8), v, precision);
        if (flags.has('#') && (digits.length === 0 || digits[0] !== '0')) {
          digits = '0' + digits;
        }
        const zeroAllowed = precision === undefined;
        out += padNumeric('', digits, width, flags, zeroAllowed);
        break;
      }
      case 'e':
      case 'E':
      case 'f':
      case 'F':
      case 'g':
      case 'G': {
        const x = arg as number;
        const upper = conv === conv.toUpperCase() && conv !== conv.toLowerCase();
        const { sign: signBit } = bitsOf(x);
        const negative = signBit === 1;

        if (Number.isNaN(x)) {
          const text = upper ? 'NAN' : 'nan';
          out += padPlain(text, width, flags.has('-'));
          break;
        }
        if (!Number.isFinite(x)) {
          const sign = signStr(negative, false, flags);
          const text = sign + (upper ? 'INF' : 'inf');
          out += padPlain(text, width, flags.has('-'));
          break;
        }

        const sign = signStr(negative, false, flags);
        const { M, E } = bitsOf(x);
        const { N, d } = exactDecimal(M, E);

        if (conv === 'f' || conv === 'F') {
          const p = precision === undefined ? 6 : precision;
          const result = roundToFracDigits(N, d, p);
          const resultStr = result.toString().padStart(p + 1, '0');
          const intPart = p > 0 ? resultStr.slice(0, resultStr.length - p) : resultStr;
          const fracPart = p > 0 ? resultStr.slice(resultStr.length - p) : '';
          const dot = p > 0 || flags.has('#') ? '.' : '';
          const body = intPart + dot + fracPart;
          out += padNumeric(sign, body, width, flags, true);
        } else if (conv === 'e' || conv === 'E') {
          const p = precision === undefined ? 6 : precision;
          const { digits, X } = roundSignificant(N, d, p + 1);
          const first = digits[0];
          const rest = digits.slice(1);
          const dot = p > 0 || flags.has('#') ? '.' : '';
          const expSign = X < 0 ? '-' : '+';
          const expAbs = Math.abs(X).toString().padStart(2, '0');
          const body = first + dot + rest + (upper ? 'E' : 'e') + expSign + expAbs;
          out += padNumeric(sign, body, width, flags, true);
        } else {
          // g, G
          let P = precision === undefined ? 6 : precision;
          if (P === 0) P = 1;
          const { digits, X } = roundSignificant(N, d, P);
          const useF = P > X && X >= -4;
          const hasHash = flags.has('#');
          let body: string;
          if (useF) {
            const p = P - 1 - X;
            let intPart: string;
            let fracRaw: string;
            if (X >= 0) {
              intPart = digits.slice(0, X + 1);
              fracRaw = digits.slice(X + 1);
            } else {
              intPart = '0';
              fracRaw = '0'.repeat(-X - 1) + digits;
            }
            const { fracPart, dot } = stripFrac(fracRaw, hasHash);
            body = intPart + dot + fracPart;
          } else {
            const first = digits[0];
            const rest = digits.slice(1);
            const { fracPart, dot } = stripFrac(rest, hasHash);
            const expSign = X < 0 ? '-' : '+';
            const expAbs = Math.abs(X).toString().padStart(2, '0');
            body = first + dot + fracPart + (upper ? 'E' : 'e') + expSign + expAbs;
          }
          out += padNumeric(sign, body, width, flags, true);
        }
        break;
      }
      case 's': {
        let str = arg as string;
        if (precision !== undefined) str = str.slice(0, precision);
        out += padPlain(str, width, flags.has('-'));
        break;
      }
      case 'c': {
        const str = arg as string;
        out += padPlain(str, width, flags.has('-'));
        break;
      }
    }
  }

  out += fmt.slice(lastIndex);
  return out;
}
