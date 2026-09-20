// Exact decimal decomposition of a finite double: |x| = N * 10^-k, N a non-negative BigInt.
function decomposeFloat(x: number): { sign: number; N: bigint; k: number } {
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setFloat64(0, x);
  const bits = view.getBigUint64(0);
  const sign = Number(bits >> 63n);
  const expField = Number((bits >> 52n) & 0x7ffn);
  const frac = bits & 0xfffffffffffffn;

  let M: bigint;
  let E: number;
  if (expField === 0) {
    M = frac;
    E = -1074;
  } else {
    M = frac | (1n << 52n);
    E = expField - 1075;
  }

  if (M === 0n) return { sign, N: 0n, k: 0 };

  let N: bigint;
  let k: number;
  if (E >= 0) {
    N = M * (2n ** BigInt(E));
    k = 0;
  } else {
    k = -E;
    N = M * (5n ** BigInt(k));
  }
  return { sign, N, k };
}

// Round(N/10^k * 10^d) with round-half-to-even, returned as a BigInt (representing value*10^d).
function scaleRound(N: bigint, k: number, d: number): bigint {
  const diff = d - k;
  if (diff >= 0) return N * (10n ** BigInt(diff));
  const shift = -diff;
  const divisor = 10n ** BigInt(shift);
  const q = N / divisor;
  const r = N % divisor;
  const twice = r * 2n;
  if (twice > divisor) return q + 1n;
  if (twice < divisor) return q;
  return q % 2n === 0n ? q : q + 1n;
}

function roundToSig(N: bigint, k: number, S: number): { digits: string; exp: number } {
  if (N === 0n) return { digits: '0'.repeat(S), exp: 0 };
  const nd = N.toString().length;
  const exp0 = nd - k - 1;
  const d = S - 1 - exp0;
  const R = scaleRound(N, k, d);
  let digits = R.toString();
  let exp = exp0;
  if (digits.length > S) {
    exp += digits.length - S;
    digits = digits.slice(0, S);
  } else if (digits.length < S) {
    digits = digits.padStart(S, '0');
  }
  return { digits, exp };
}

function buildF(N: bigint, k: number, precision: number, hash: boolean): string {
  const R = scaleRound(N, k, precision);
  let s = R.toString();
  if (s.length < precision + 1) s = s.padStart(precision + 1, '0');
  const splitAt = precision > 0 ? s.length - precision : s.length;
  const intPart = s.slice(0, splitAt);
  const fracPart = precision > 0 ? s.slice(splitAt) : '';
  const dot = precision > 0 || hash ? '.' : '';
  return intPart + dot + fracPart;
}

function buildE(N: bigint, k: number, precision: number, hash: boolean, letter: string): string {
  const S = precision + 1;
  const { digits, exp } = roundToSig(N, k, S);
  const first = digits[0];
  const rest = digits.slice(1);
  const dot = precision > 0 || hash ? '.' : '';
  const expSign = exp < 0 ? '-' : '+';
  let expAbs = Math.abs(exp).toString();
  if (expAbs.length < 2) expAbs = '0' + expAbs;
  return first + dot + rest + letter + expSign + expAbs;
}

function trimTrailingZeros(s: string, letter?: string): string {
  if (letter) {
    const idx = s.indexOf(letter);
    let mant = s.slice(0, idx);
    const tail = s.slice(idx);
    if (mant.includes('.')) mant = mant.replace(/0+$/, '').replace(/\.$/, '');
    return mant + tail;
  }
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s;
}

function padNumeric(
  prefix: string,
  digits: string,
  width: number,
  minus: boolean,
  zero: boolean,
  zeroAllowed: boolean
): string {
  const body = prefix + digits;
  if (body.length >= width) return body;
  const padLen = width - body.length;
  if (minus) return body + ' '.repeat(padLen);
  if (zero && zeroAllowed) return prefix + '0'.repeat(padLen) + digits;
  return ' '.repeat(padLen) + body;
}

function padGeneric(body: string, width: number, minus: boolean): string {
  if (body.length >= width) return body;
  const padLen = width - body.length;
  return minus ? body + ' '.repeat(padLen) : ' '.repeat(padLen) + body;
}

function getSign(negative: boolean, plus: boolean, space: boolean): string {
  if (negative) return '-';
  if (plus) return '+';
  if (space) return ' ';
  return '';
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  const specRe = /%([-+0 #]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc%])/g;
  let result = '';
  let lastIndex = 0;
  let argIdx = 0;
  let m: RegExpExecArray | null;

  while ((m = specRe.exec(fmt))) {
    result += fmt.slice(lastIndex, m.index);
    lastIndex = specRe.lastIndex;
    const [, flagsStr, widthStr, precStr, conv] = m;

    if (conv === '%') {
      result += '%';
      continue;
    }

    const minus = flagsStr.includes('-');
    const plus = flagsStr.includes('+');
    const space = flagsStr.includes(' ');
    const zero = flagsStr.includes('0');
    const hash = flagsStr.includes('#');
    const width = widthStr ? parseInt(widthStr, 10) : 0;
    const precision = precStr === undefined ? undefined : precStr === '' ? 0 : parseInt(precStr, 10);

    const arg = args[argIdx++];
    let body: string;

    if (conv === 'd' || conv === 'i') {
      const v = typeof arg === 'bigint' ? arg : BigInt(arg as number);
      const neg = v < 0n;
      const magnitude = neg ? -v : v;
      let digits: string;
      if (precision !== undefined) {
        if (precision === 0 && magnitude === 0n) {
          digits = '';
        } else {
          digits = magnitude.toString().padStart(precision, '0');
        }
      } else {
        digits = magnitude.toString();
      }
      const sign = getSign(neg, plus, space);
      const zeroAllowed = precision === undefined;
      body = padNumeric(sign, digits, width, minus, zero, zeroAllowed);
    } else if (conv === 'x' || conv === 'X' || conv === 'o') {
      const v = typeof arg === 'bigint' ? arg : BigInt(arg as number);
      let digits: string;
      if (conv === 'x') digits = v.toString(16);
      else if (conv === 'X') digits = v.toString(16).toUpperCase();
      else digits = v.toString(8);

      if (precision !== undefined) {
        if (precision === 0 && v === 0n) {
          digits = '';
        } else {
          digits = digits.padStart(precision, '0');
        }
      }

      if (hash && conv === 'o') {
        if (digits.length === 0 || digits[0] !== '0') digits = '0' + digits;
      }

      let prefix = '';
      if (hash && (conv === 'x' || conv === 'X') && v !== 0n) {
        prefix = conv === 'x' ? '0x' : '0X';
      }

      const zeroAllowed = precision === undefined;
      body = padNumeric(prefix, digits, width, minus, zero, zeroAllowed);
    } else if (conv === 'f' || conv === 'F' || conv === 'e' || conv === 'E' || conv === 'g' || conv === 'G') {
      const x = arg as number;
      const isUpper = conv === 'F' || conv === 'E' || conv === 'G';

      if (Number.isNaN(x)) {
        const word = isUpper ? 'NAN' : 'nan';
        body = padNumeric('', word, width, minus, zero, false);
      } else if (!Number.isFinite(x)) {
        const word = isUpper ? 'INF' : 'inf';
        const sign = getSign(x < 0, plus, space);
        body = padNumeric(sign, word, width, minus, zero, false);
      } else {
        const { sign: signBit, N, k } = decomposeFloat(x);
        const signChar = getSign(signBit === 1, plus, space);
        const zeroAllowed = !minus;

        let digitsStr: string;
        if (conv === 'f' || conv === 'F') {
          const p = precision === undefined ? 6 : precision;
          digitsStr = buildF(N, k, p, hash);
        } else if (conv === 'e' || conv === 'E') {
          const p = precision === undefined ? 6 : precision;
          digitsStr = buildE(N, k, p, hash, conv === 'E' ? 'E' : 'e');
        } else {
          const P = precision === undefined ? 6 : precision === 0 ? 1 : precision;
          const { exp: X } = roundToSig(N, k, P);
          const letter = conv === 'G' ? 'E' : 'e';
          if (P > X && X >= -4) {
            const precisionUsed = P - 1 - X;
            digitsStr = buildF(N, k, precisionUsed, hash);
            if (!hash) digitsStr = trimTrailingZeros(digitsStr);
          } else {
            const precisionUsed = P - 1;
            digitsStr = buildE(N, k, precisionUsed, hash, letter);
            if (!hash) digitsStr = trimTrailingZeros(digitsStr, letter);
          }
        }

        body = padNumeric(signChar, digitsStr, width, minus, zero, zeroAllowed);
      }
    } else if (conv === 's') {
      let str = arg as string;
      if (precision !== undefined) str = str.slice(0, precision);
      body = padGeneric(str, width, minus);
    } else {
      // conv === 'c'
      body = padGeneric(arg as string, width, minus);
    }

    result += body;
  }

  result += fmt.slice(lastIndex);
  return result;
}
