type Bits = { mantissa: bigint; e2: number };

function decompose(absV: number): Bits {
  if (absV === 0) return { mantissa: 0n, e2: 0 };
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setFloat64(0, absV);
  const bits = dv.getBigUint64(0);
  const exponentBits = Number((bits >> 52n) & 0x7ffn);
  const fraction = bits & 0xfffffffffffffn;
  if (exponentBits === 0) {
    return { mantissa: fraction, e2: -1074 };
  }
  return { mantissa: fraction | (1n << 52n), e2: exponentBits - 1075 };
}

// Rounds mantissa * 2^e2 * 10^m to the nearest integer, ties to even.
function scaledRound(mantissa: bigint, e2: number, m: number): bigint {
  if (mantissa === 0n) return 0n;
  const exp2 = e2 + m;
  const exp5 = m;
  const pos2 = exp2 > 0 ? exp2 : 0;
  const neg2 = exp2 < 0 ? -exp2 : 0;
  const pos5 = exp5 > 0 ? exp5 : 0;
  const neg5 = exp5 < 0 ? -exp5 : 0;
  const numerator = mantissa * 2n ** BigInt(pos2) * 5n ** BigInt(pos5);
  const denominator = 2n ** BigInt(neg2) * 5n ** BigInt(neg5);
  if (denominator === 1n) return numerator;
  const q = numerator / denominator;
  const r = numerator % denominator;
  const twice = r * 2n;
  if (twice < denominator) return q;
  if (twice > denominator) return q + 1n;
  return q % 2n === 0n ? q : q + 1n;
}

// Returns n significant decimal digits of mantissa*2^e2, rounded to nearest
// (ties to even), along with the decimal exponent E such that the value
// equals 0.digits[0]digits[1]...  * 10^(E+1) (i.e. digits[0] is the ones
// place of scientific notation with exponent E).
function toDigits(mantissa: bigint, e2: number, n: number): { digits: string; exp: number } {
  if (mantissa === 0n) return { digits: '0'.repeat(n), exp: 0 };
  let E = Math.floor(Math.log10(Number(mantissa)) + e2 * Math.log10(2));
  const lower = 10n ** BigInt(n - 1);
  const upper = 10n ** BigInt(n);
  for (let i = 0; i < 100; i++) {
    const m = n - 1 - E;
    const D = scaledRound(mantissa, e2, m);
    if (D < lower) {
      E--;
      continue;
    }
    if (D >= upper) {
      E++;
      continue;
    }
    return { digits: D.toString(), exp: E };
  }
  throw new Error('toDigits failed to converge');
}

function isNegativeNumber(v: number): boolean {
  if (Number.isNaN(v)) return false;
  if (v === 0) return Object.is(v, -0);
  if (v === Infinity) return false;
  if (v === -Infinity) return true;
  return v < 0;
}

function toBig(v: number | bigint): bigint {
  return typeof v === 'bigint' ? v : BigInt(v);
}

function pad(sign: string, prefix: string, digits: string, width: number, zeroPad: boolean, leftAlign: boolean): string {
  const body = sign + prefix + digits;
  if (body.length >= width) return body;
  const padLen = width - body.length;
  if (leftAlign) return body + ' '.repeat(padLen);
  if (zeroPad) return sign + prefix + '0'.repeat(padLen) + digits;
  return ' '.repeat(padLen) + body;
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  const re = /%(?:%|([-+ 0#]*)(\d*)(\.(\d*))?([diouxXeEfFgGsc]))/g;
  let result = '';
  let lastIndex = 0;
  let argi = 0;
  let match: RegExpExecArray | null;

  while ((match = re.exec(fmt)) !== null) {
    result += fmt.slice(lastIndex, match.index);
    lastIndex = re.lastIndex;

    if (match[0] === '%%') {
      result += '%';
      continue;
    }

    const flagsStr = match[1] ?? '';
    const flags = {
      minus: flagsStr.includes('-'),
      plus: flagsStr.includes('+'),
      space: flagsStr.includes(' '),
      zero: flagsStr.includes('0'),
      hash: flagsStr.includes('#'),
    };
    const width = match[2] ? parseInt(match[2], 10) : 0;
    const precisionGiven = match[3] !== undefined;
    const precisionVal = precisionGiven ? (match[4] === '' ? 0 : parseInt(match[4], 10)) : 0;
    const conv = match[5];

    let out: string;

    if (conv === 'd' || conv === 'i') {
      const v = args[argi++];
      const big = toBig(v as number | bigint);
      const neg = big < 0n;
      const absVal = neg ? -big : big;
      let digits = absVal.toString();
      if (precisionGiven) {
        if (precisionVal === 0 && absVal === 0n) digits = '';
        else digits = digits.padStart(precisionVal, '0');
      }
      const sign = neg ? '-' : flags.plus ? '+' : flags.space ? ' ' : '';
      const zeroPad = flags.zero && !flags.minus && !precisionGiven;
      out = pad(sign, '', digits, width, zeroPad, flags.minus);
    } else if (conv === 'x' || conv === 'X' || conv === 'o') {
      const v = args[argi++];
      const big = toBig(v as number | bigint);
      const base = conv === 'o' ? 8 : 16;
      let digits = big.toString(base);
      if (conv === 'X') digits = digits.toUpperCase();
      if (precisionGiven) {
        if (precisionVal === 0 && big === 0n) digits = '';
        else digits = digits.padStart(precisionVal, '0');
      }
      let prefix = '';
      if (flags.hash) {
        if ((conv === 'x' || conv === 'X') && big !== 0n) {
          prefix = conv === 'x' ? '0x' : '0X';
        } else if (conv === 'o') {
          if (digits === '' || digits[0] !== '0') digits = '0' + digits;
        }
      }
      const zeroPad = flags.zero && !flags.minus && !precisionGiven;
      out = pad('', prefix, digits, width, zeroPad, flags.minus);
    } else if (conv === 'e' || conv === 'E' || conv === 'f' || conv === 'F' || conv === 'g' || conv === 'G') {
      const v = args[argi++] as number;
      const isUpper = conv === 'E' || conv === 'F' || conv === 'G';
      const nan = Number.isNaN(v);
      let signStr = '';
      if (!nan) {
        signStr = isNegativeNumber(v) ? '-' : flags.plus ? '+' : flags.space ? ' ' : '';
      }

      if (nan || !Number.isFinite(v)) {
        const word = nan ? (isUpper ? 'NAN' : 'nan') : isUpper ? 'INF' : 'inf';
        out = pad(signStr, '', word, width, false, flags.minus);
      } else {
        const absV = Math.abs(v);
        const { mantissa, e2 } = decompose(absV);

        if (conv === 'f' || conv === 'F') {
          const precision = precisionGiven ? precisionVal : 6;
          const rounded = scaledRound(mantissa, e2, precision);
          let s = rounded.toString();
          if (s.length <= precision) s = s.padStart(precision + 1, '0');
          let intPart: string, fracPart: string;
          if (precision > 0) {
            intPart = s.slice(0, s.length - precision);
            fracPart = s.slice(s.length - precision);
          } else {
            intPart = s;
            fracPart = '';
          }
          if (intPart === '') intPart = '0';
          const dot = precision > 0 || flags.hash ? '.' : '';
          const digits = intPart + dot + fracPart;
          const zeroPad = flags.zero && !flags.minus;
          out = pad(signStr, '', digits, width, zeroPad, flags.minus);
        } else if (conv === 'e' || conv === 'E') {
          const precision = precisionGiven ? precisionVal : 6;
          const n = precision + 1;
          const { digits: dstr, exp } = toDigits(mantissa, e2, n);
          const lead = dstr[0];
          const frac = dstr.slice(1);
          const dot = precision > 0 || flags.hash ? '.' : '';
          const expSign = exp < 0 ? '-' : '+';
          const expAbs = Math.abs(exp).toString().padStart(2, '0');
          const body = lead + dot + frac + (isUpper ? 'E' : 'e') + expSign + expAbs;
          const zeroPad = flags.zero && !flags.minus;
          out = pad(signStr, '', body, width, zeroPad, flags.minus);
        } else {
          // g, G
          const P = precisionGiven ? (precisionVal === 0 ? 1 : precisionVal) : 6;
          const { digits: dstr, exp: X } = toDigits(mantissa, e2, P);
          let body: string;
          if (P > X && X >= -4) {
            let intPart: string, fracPart: string;
            if (X >= 0) {
              intPart = dstr.slice(0, X + 1);
              fracPart = dstr.slice(X + 1);
            } else {
              intPart = '0';
              fracPart = '0'.repeat(-X - 1) + dstr;
            }
            if (!flags.hash) fracPart = fracPart.replace(/0+$/, '');
            body = intPart + (fracPart.length > 0 || flags.hash ? '.' + fracPart : '');
          } else {
            const lead = dstr[0];
            let frac = dstr.slice(1);
            if (!flags.hash) frac = frac.replace(/0+$/, '');
            const expSign = X < 0 ? '-' : '+';
            const expAbs = Math.abs(X).toString().padStart(2, '0');
            body =
              lead +
              (frac.length > 0 || flags.hash ? '.' + frac : '') +
              (isUpper ? 'E' : 'e') +
              expSign +
              expAbs;
          }
          const zeroPad = flags.zero && !flags.minus;
          out = pad(signStr, '', body, width, zeroPad, flags.minus);
        }
      }
    } else if (conv === 's') {
      const v = args[argi++] as string;
      const str = precisionGiven ? v.slice(0, precisionVal) : v;
      out = pad('', '', str, width, false, flags.minus);
    } else {
      // 'c'
      const v = args[argi++] as string;
      out = pad('', '', v, width, false, flags.minus);
    }

    result += out;
  }

  result += fmt.slice(lastIndex);
  return result;
}
