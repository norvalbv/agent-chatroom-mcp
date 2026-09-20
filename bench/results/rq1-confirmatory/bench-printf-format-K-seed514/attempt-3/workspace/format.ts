type Flags = {
  minus: boolean;
  plus: boolean;
  space: boolean;
  zero: boolean;
  hash: boolean;
};

function decompose(value: number): { m: bigint; e: number } {
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setFloat64(0, value);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  const mantissa = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (expBits === 0) {
    return { m: mantissa, e: -1074 };
  }
  return { m: mantissa | (1n << 52n), e: expBits - 1075 };
}

function roundHalfEven(numerator: bigint, denominator: bigint): bigint {
  const q = numerator / denominator;
  const r = numerator % denominator;
  const twice = r * 2n;
  if (twice < denominator) return q;
  if (twice > denominator) return q + 1n;
  return q % 2n === 0n ? q : q + 1n;
}

function roundedScale(m: bigint, e: number, tenExp: number): bigint {
  let numerator = m;
  let denominator = 1n;
  if (e >= 0) numerator *= 2n ** BigInt(e);
  else denominator *= 2n ** BigInt(-e);
  if (tenExp >= 0) numerator *= 10n ** BigInt(tenExp);
  else denominator *= 10n ** BigInt(-tenExp);
  return roundHalfEven(numerator, denominator);
}

function sigDigits(value: number, n: number): { digits: string; exp: number } {
  const { m, e } = decompose(value);
  let exp0 = Math.floor(Math.log10(value));
  const low = 10n ** BigInt(n - 1);
  const high = 10n ** BigInt(n);
  let scaled = roundedScale(m, e, n - 1 - exp0);
  while (scaled < low) {
    exp0--;
    scaled = roundedScale(m, e, n - 1 - exp0);
  }
  while (scaled >= high) {
    exp0++;
    scaled = roundedScale(m, e, n - 1 - exp0);
  }
  return { digits: scaled.toString(), exp: exp0 };
}

function padNumeric(
  prefix: string,
  digitsPart: string,
  width: number,
  leftAlign: boolean,
  zeroFill: boolean
): string {
  const body = prefix + digitsPart;
  if (body.length >= width) return body;
  const pad = width - body.length;
  if (leftAlign) return body + ' '.repeat(pad);
  if (zeroFill) return prefix + '0'.repeat(pad) + digitsPart;
  return ' '.repeat(pad) + body;
}

function signStrFor(negative: boolean, plus: boolean, space: boolean): string {
  return negative ? '-' : plus ? '+' : space ? ' ' : '';
}

function expPart(x: number, upper: boolean): string {
  const sign = x < 0 ? '-' : '+';
  let digs = Math.abs(x).toString();
  if (digs.length < 2) digs = '0' + digs;
  return (upper ? 'E' : 'e') + sign + digs;
}

function fracPartFE(fracDigits: string, p: number, hash: boolean): string {
  if (p === 0) return hash ? '.' : '';
  return '.' + fracDigits;
}

function fracPartG(fracDigits: string, hash: boolean): string {
  if (hash) return '.' + fracDigits;
  const trimmed = fracDigits.replace(/0+$/, '');
  return trimmed.length > 0 ? '.' + trimmed : '';
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let argIndex = 0;
  const regex = /%([-+0# ]*)(\d*)(\.(\d*))?([diouxXeEfFgGsc%])/g;

  return fmt.replace(regex, (_match, flagsStr: string, widthStr: string, precGroup: string | undefined, precDigits: string | undefined, conv: string) => {
    if (conv === '%') return '%';

    const flags: Flags = {
      minus: flagsStr.includes('-'),
      plus: flagsStr.includes('+'),
      space: flagsStr.includes(' '),
      zero: flagsStr.includes('0'),
      hash: flagsStr.includes('#'),
    };
    const width = widthStr ? parseInt(widthStr, 10) : 0;
    const precision: number | null = precGroup === undefined ? null : precDigits === '' ? 0 : parseInt(precDigits, 10);

    const arg = args[argIndex++];

    switch (conv) {
      case 'd':
      case 'i': {
        const n = typeof arg === 'bigint' ? arg : BigInt(arg as number);
        const negative = n < 0n;
        const mag = negative ? -n : n;
        let digits = mag.toString();
        if (precision !== null) {
          if (precision === 0 && mag === 0n) digits = '';
          else while (digits.length < precision) digits = '0' + digits;
        }
        const sign = signStrFor(negative, flags.plus, flags.space);
        const zeroFill = flags.zero && !flags.minus && precision === null;
        return padNumeric(sign, digits, width, flags.minus, zeroFill);
      }
      case 'x':
      case 'X':
      case 'o': {
        const n = typeof arg === 'bigint' ? arg : BigInt(arg as number);
        let digits = conv === 'o' ? n.toString(8) : n.toString(16);
        if (conv === 'X') digits = digits.toUpperCase();
        if (precision !== null) {
          if (precision === 0 && n === 0n) digits = '';
          else while (digits.length < precision) digits = '0' + digits;
        }
        let prefix = '';
        if (flags.hash) {
          if (conv === 'o') {
            if (digits.length === 0 || digits[0] !== '0') digits = '0' + digits;
          } else if (n !== 0n) {
            prefix = conv === 'x' ? '0x' : '0X';
          }
        }
        const zeroFill = flags.zero && !flags.minus && precision === null;
        return padNumeric(prefix, digits, width, flags.minus, zeroFill);
      }
      case 'e':
      case 'E':
      case 'f':
      case 'F':
      case 'g':
      case 'G': {
        const value = arg as number;
        const upper = conv === conv.toUpperCase();

        if (Number.isNaN(value)) {
          const word = upper ? 'NAN' : 'nan';
          return padNumeric('', word, width, flags.minus, false);
        }

        const negative = value < 0 || Object.is(value, -0);
        const sign = signStrFor(negative, flags.plus, flags.space);

        if (!Number.isFinite(value)) {
          const word = upper ? 'INF' : 'inf';
          return padNumeric(sign, word, width, flags.minus, false);
        }

        const absValue = Math.abs(value);
        const zeroFill = flags.zero && !flags.minus;

        if (conv === 'e' || conv === 'E') {
          const p = precision === null ? 6 : precision;
          let firstDigit: string;
          let frac: string;
          let exp: number;
          if (absValue === 0) {
            firstDigit = '0';
            frac = '0'.repeat(p);
            exp = 0;
          } else {
            const { digits, exp: x } = sigDigits(absValue, p + 1);
            firstDigit = digits[0];
            frac = digits.slice(1);
            exp = x;
          }
          const decPart = fracPartFE(frac, p, flags.hash);
          const rest = firstDigit + decPart + expPart(exp, upper);
          return padNumeric(sign, rest, width, flags.minus, zeroFill);
        }

        if (conv === 'f' || conv === 'F') {
          const p = precision === null ? 6 : precision;
          let intPart: string;
          let fracDigits: string;
          if (absValue === 0) {
            intPart = '0';
            fracDigits = '0'.repeat(p);
          } else {
            const { m, e } = decompose(absValue);
            const scaledInt = roundedScale(m, e, p);
            let str = scaledInt.toString();
            while (str.length <= p) str = '0' + str;
            intPart = str.slice(0, str.length - p);
            fracDigits = str.slice(str.length - p);
          }
          const decPart = fracPartFE(fracDigits, p, flags.hash);
          const rest = intPart + decPart;
          return padNumeric(sign, rest, width, flags.minus, zeroFill);
        }

        // g, G
        const p = precision === null ? 6 : precision;
        const P = p === 0 ? 1 : p;
        let digits: string;
        let x: number;
        if (absValue === 0) {
          digits = '0'.repeat(P);
          x = 0;
        } else {
          const res = sigDigits(absValue, P);
          digits = res.digits;
          x = res.exp;
        }

        let rest: string;
        if (P > x && x >= -4) {
          let intPart: string;
          let fracDigits: string;
          if (x >= 0) {
            intPart = digits.slice(0, x + 1);
            fracDigits = digits.slice(x + 1);
          } else {
            intPart = '0';
            fracDigits = '0'.repeat(-x - 1) + digits;
          }
          rest = intPart + fracPartG(fracDigits, flags.hash);
        } else {
          const frac = digits.slice(1);
          rest = digits[0] + fracPartG(frac, flags.hash) + expPart(x, upper);
        }
        return padNumeric(sign, rest, width, flags.minus, zeroFill);
      }
      case 's': {
        let text = arg as string;
        if (precision !== null) text = text.slice(0, precision);
        return padNumeric('', text, width, flags.minus, false);
      }
      case 'c': {
        const text = arg as string;
        return padNumeric('', text, width, flags.minus, false);
      }
      default:
        return _match;
    }
  });
}
