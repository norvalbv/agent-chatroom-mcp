// Exact printf-style formatter (see README.md for the specification).

function divRoundHalfEven(num: bigint, den: bigint): bigint {
  const q = num / den;
  const r = num % den;
  const twice = r * 2n;
  if (twice > den) return q + 1n;
  if (twice < den) return q;
  return q % 2n === 0n ? q : q + 1n;
}

interface Decomposed {
  m: bigint; // mantissa, integer
  e: number; // exponent, value = m * 2^e
}

function decompose(x: number): Decomposed {
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setFloat64(0, Math.abs(x));
  const hi = view.getUint32(0);
  const lo = view.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  const mantHi = hi & 0xfffff;
  let mantissa = (BigInt(mantHi) << 32n) | BigInt(lo);
  let exp: number;
  if (expBits === 0) {
    exp = -1074;
  } else {
    mantissa = mantissa | (1n << 52n);
    exp = expBits - 1075;
  }
  return { m: mantissa, e: exp };
}

// Computes round(m * 2^e * 10^k) using round-half-to-even, exactly.
function scaledRound(m: bigint, e: number, k: number): bigint {
  if (m === 0n) return 0n;
  const e2 = e + k;
  const p5 = k;
  let num = m;
  let den = 1n;
  if (p5 >= 0) num *= 5n ** BigInt(p5);
  else den *= 5n ** BigInt(-p5);
  if (e2 >= 0) num *= 2n ** BigInt(e2);
  else den *= 2n ** BigInt(-e2);
  return divRoundHalfEven(num, den);
}

function formatFixedDigits(m: bigint, e: number, p: number): { intPart: string; fracPart: string } {
  const scaled = scaledRound(m, e, p);
  let s = scaled.toString();
  if (s.length < p + 1) s = '0'.repeat(p + 1 - s.length) + s;
  const intPart = p === 0 ? s : s.slice(0, s.length - p);
  const fracPart = p === 0 ? '' : s.slice(s.length - p);
  return { intPart, fracPart };
}

// Finds decimal exponent X and (p+1) significant digits for e-style rounding.
function computeExp(m: bigint, e: number, numValue: number, p: number): { X: number; digits: string } {
  if (m === 0n) return { X: 0, digits: '0'.repeat(p + 1) };
  let X = Math.floor(Math.log10(Math.abs(numValue)));
  for (let iter = 0; iter < 10; iter++) {
    const digits = scaledRound(m, e, p - X).toString();
    if (digits.length === p + 1) return { X, digits };
    if (digits.length > p + 1) {
      X += 1;
      continue;
    }
    X -= 1;
  }
  throw new Error('exponent computation failed to converge');
}

function isNegativeNumber(x: number): boolean {
  if (x !== 0) return x < 0;
  return Object.is(x, -0);
}

function padNumeric(
  sign: string,
  prefix: string,
  body: string,
  width: number,
  leftAlign: boolean,
  zeroFlag: boolean,
  allowZeroPad: boolean
): string {
  const total = sign.length + prefix.length + body.length;
  if (width <= total) return sign + prefix + body;
  const padLen = width - total;
  if (leftAlign) return sign + prefix + body + ' '.repeat(padLen);
  if (zeroFlag && allowZeroPad) return sign + prefix + '0'.repeat(padLen) + body;
  return ' '.repeat(padLen) + sign + prefix + body;
}

function padPlain(body: string, width: number, leftAlign: boolean): string {
  if (width <= body.length) return body;
  const padLen = width - body.length;
  return leftAlign ? body + ' '.repeat(padLen) : ' '.repeat(padLen) + body;
}

function toBigIntArg(v: number | bigint): bigint {
  return typeof v === 'bigint' ? v : BigInt(v);
}

function intDigits(abs: bigint, precisionGiven: boolean, precision: number): string {
  let digits = abs.toString();
  if (precisionGiven) {
    if (precision === 0 && abs === 0n) digits = '';
    else digits = digits.padStart(precision, '0');
  }
  return digits;
}

function signFor(neg: boolean, flags: Set<string>): string {
  if (neg) return '-';
  if (flags.has('+')) return '+';
  if (flags.has(' ')) return ' ';
  return '';
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let out = '';
  let argi = 0;
  const re = /%([-+ 0#]*)(\d*)(?:\.(\d*))?([dioxXeEfFgGsc%])/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = re.exec(fmt)) !== null) {
    out += fmt.slice(lastIndex, match.index);
    lastIndex = re.lastIndex;

    const flagsStr = match[1];
    const widthStr = match[2];
    const precStr = match[3];
    const conv = match[4];

    if (conv === '%') {
      out += '%';
      continue;
    }

    const flags = new Set(flagsStr.split(''));
    const width = widthStr ? parseInt(widthStr, 10) : 0;
    const precisionGiven = precStr !== undefined;
    const precision = precisionGiven ? (precStr === '' ? 0 : parseInt(precStr, 10)) : 0;
    const leftAlign = flags.has('-');
    const zeroFlag = flags.has('0');
    const hash = flags.has('#');

    if (conv === 'd' || conv === 'i') {
      const arg = args[argi++] as number | bigint;
      const big = toBigIntArg(arg);
      const neg = big < 0n;
      const abs = neg ? -big : big;
      const digits = intDigits(abs, precisionGiven, precision);
      const sign = signFor(neg, flags);
      out += padNumeric(sign, '', digits, width, leftAlign, zeroFlag, !precisionGiven);
    } else if (conv === 'x' || conv === 'X' || conv === 'o') {
      const arg = args[argi++] as number | bigint;
      const big = toBigIntArg(arg);
      let digits = conv === 'o' ? big.toString(8) : big.toString(16);
      if (precisionGiven) {
        if (precision === 0 && big === 0n) digits = '';
        else digits = digits.padStart(precision, '0');
      }
      if (conv === 'X') digits = digits.toUpperCase();
      if (conv === 'o' && hash) {
        if (digits.length === 0 || digits[0] !== '0') digits = '0' + digits;
      }
      let prefix = '';
      if (conv !== 'o' && hash && big !== 0n) {
        prefix = conv === 'x' ? '0x' : '0X';
      }
      out += padNumeric('', prefix, digits, width, leftAlign, zeroFlag, !precisionGiven);
    } else if (conv === 's') {
      const arg = args[argi++] as string;
      let s = arg;
      if (precisionGiven) s = s.slice(0, precision);
      out += padPlain(s, width, leftAlign);
    } else if (conv === 'c') {
      const arg = args[argi++] as string;
      out += padPlain(arg, width, leftAlign);
    } else {
      // e E f F g G
      const arg = args[argi++] as number;
      const upper = conv === conv.toUpperCase();
      const neg = Number.isNaN(arg) ? false : isNegativeNumber(arg);
      const sign = Number.isNaN(arg) ? '' : signFor(neg, flags);

      if (Number.isNaN(arg)) {
        const body = upper ? 'NAN' : 'nan';
        out += padNumeric('', '', body, width, leftAlign, zeroFlag, false);
        continue;
      }
      if (!Number.isFinite(arg)) {
        const body = upper ? 'INF' : 'inf';
        out += padNumeric(sign, '', body, width, leftAlign, zeroFlag, false);
        continue;
      }

      const { m, e } = decompose(arg);
      const lower = conv.toLowerCase();

      if (lower === 'f') {
        const p = precisionGiven ? precision : 6;
        const { intPart, fracPart } = formatFixedDigits(m, e, p);
        const dot = p > 0 || hash ? '.' : '';
        const body = intPart + dot + fracPart;
        out += padNumeric(sign, '', body, width, leftAlign, zeroFlag, true);
      } else if (lower === 'e') {
        const p = precisionGiven ? precision : 6;
        const { X, digits } = computeExp(m, e, Math.abs(arg), p);
        const first = digits[0];
        const rest = digits.slice(1);
        const dot = p > 0 || hash ? '.' : '';
        const expLetter = conv === 'E' ? 'E' : 'e';
        const expSign = X < 0 ? '-' : '+';
        const expAbs = Math.abs(X).toString().padStart(2, '0');
        const body = first + dot + rest + expLetter + expSign + expAbs;
        out += padNumeric(sign, '', body, width, leftAlign, zeroFlag, true);
      } else {
        // g G
        const P = precisionGiven ? (precision === 0 ? 1 : precision) : 6;
        const { X, digits } = computeExp(m, e, Math.abs(arg), P - 1);
        let body: string;
        if (P > X && X >= -4) {
          const p = P - 1 - X;
          const { intPart, fracPart: rawFrac } = formatFixedDigits(m, e, p);
          let fracPart = rawFrac;
          if (!hash) fracPart = fracPart.replace(/0+$/, '');
          const dot = fracPart.length > 0 || hash ? '.' : '';
          body = intPart + dot + fracPart;
        } else {
          const first = digits[0];
          let rest = digits.slice(1);
          if (!hash) rest = rest.replace(/0+$/, '');
          const dot = rest.length > 0 || hash ? '.' : '';
          const expLetter = conv === 'G' ? 'E' : 'e';
          const expSign = X < 0 ? '-' : '+';
          const expAbs = Math.abs(X).toString().padStart(2, '0');
          body = first + dot + rest + expLetter + expSign + expAbs;
        }
        out += padNumeric(sign, '', body, width, leftAlign, zeroFlag, true);
      }
    }
  }
  out += fmt.slice(lastIndex);
  return out;
}
