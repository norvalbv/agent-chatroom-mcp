type Arg = number | bigint | string;

function decompose(absX: number): { N: bigint; D: bigint } {
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setFloat64(0, absX);
  const bits = dv.getBigUint64(0);
  const expBits = Number((bits >> 52n) & 0x7ffn);
  const mantissaBits = bits & 0xfffffffffffffn;
  let M: bigint;
  let E: number;
  if (expBits === 0) {
    M = mantissaBits;
    E = -1074;
  } else {
    M = mantissaBits | (1n << 52n);
    E = expBits - 1075;
  }
  if (E >= 0) {
    return { N: M << BigInt(E), D: 1n };
  }
  return { N: M, D: 1n << BigInt(-E) };
}

// round(N/D * 10^shiftExp), half-to-even, N>=0, D>0
function computeRounded(N: bigint, D: bigint, shiftExp: number): bigint {
  let numerator: bigint;
  let denominator: bigint;
  if (shiftExp >= 0) {
    numerator = N * 10n ** BigInt(shiftExp);
    denominator = D;
  } else {
    numerator = N;
    denominator = D * 10n ** BigInt(-shiftExp);
  }
  let q = numerator / denominator;
  const r = numerator - q * denominator;
  const twiceR = r * 2n;
  if (twiceR > denominator) {
    q += 1n;
  } else if (twiceR === denominator) {
    if (q % 2n !== 0n) q += 1n;
  }
  return q;
}

function gePow10(N: bigint, D: bigint, X: number): boolean {
  if (X >= 0) {
    return N >= D * 10n ** BigInt(X);
  }
  return N * 10n ** BigInt(-X) >= D;
}

function findExponent(N: bigint, D: bigint, guess: number): number {
  let X = guess;
  while (!gePow10(N, D, X)) X--;
  while (gePow10(N, D, X + 1)) X++;
  return X;
}

function pad(prefix: string, body: string, width: number, leftAlign: boolean, zeroPad: boolean): string {
  const total = prefix.length + body.length;
  if (total >= width) return prefix + body;
  const padLen = width - total;
  if (leftAlign) return prefix + body + ' '.repeat(padLen);
  if (zeroPad) return prefix + '0'.repeat(padLen) + body;
  return ' '.repeat(padLen) + prefix + body;
}

function expString(X: number): string {
  const sign = X < 0 ? '-' : '+';
  const digits = Math.abs(X).toString().padStart(2, '0');
  return sign + digits;
}

interface Spec {
  flags: string;
  width: number | undefined;
  precision: number | undefined;
  conv: string;
}

function formatInt(value: bigint, spec: Spec): string {
  const hasMinus = spec.flags.includes('-');
  const hasZero = spec.flags.includes('0');
  const hasPlus = spec.flags.includes('+');
  const hasSpace = spec.flags.includes(' ');
  const neg = value < 0n;
  const abs = neg ? -value : value;
  let digits = abs.toString();
  if (spec.precision !== undefined) {
    if (spec.precision === 0 && abs === 0n) {
      digits = '';
    } else {
      digits = digits.padStart(spec.precision, '0');
    }
  }
  const sign = neg ? '-' : hasPlus ? '+' : hasSpace ? ' ' : '';
  const zeroPad = hasZero && !hasMinus && spec.precision === undefined;
  const width = spec.width ?? 0;
  return pad(sign, digits, width, hasMinus, zeroPad);
}

function formatHexOct(value: bigint, spec: Spec): string {
  const hasMinus = spec.flags.includes('-');
  const hasZero = spec.flags.includes('0');
  const hasHash = spec.flags.includes('#');
  let digits: string;
  if (spec.conv === 'o') {
    digits = value.toString(8);
  } else {
    digits = value.toString(16);
    if (spec.conv === 'X') digits = digits.toUpperCase();
  }
  if (spec.precision !== undefined) {
    if (spec.precision === 0 && value === 0n) {
      digits = '';
    } else {
      digits = digits.padStart(spec.precision, '0');
    }
  }
  let prefix = '';
  if (hasHash) {
    if (spec.conv === 'o') {
      if (digits === '' || digits[0] !== '0') {
        digits = '0' + digits;
      }
    } else {
      if (value !== 0n) {
        prefix = spec.conv === 'X' ? '0X' : '0x';
      }
    }
  }
  const zeroPad = hasZero && !hasMinus && spec.precision === undefined;
  const width = spec.width ?? 0;
  return pad(prefix, digits, width, hasMinus, zeroPad);
}

function floatSign(x: number, spec: Spec): string {
  const hasPlus = spec.flags.includes('+');
  const hasSpace = spec.flags.includes(' ');
  const negative = x < 0 || Object.is(x, -0);
  if (negative) return '-';
  if (hasPlus) return '+';
  if (hasSpace) return ' ';
  return '';
}

function formatSpecialFloat(x: number, spec: Spec, upper: boolean): string {
  const hasMinus = spec.flags.includes('-');
  const width = spec.width ?? 0;
  if (Number.isNaN(x)) {
    const text = upper ? 'NAN' : 'nan';
    return pad('', text, width, hasMinus, false);
  }
  const sign = floatSign(x, spec);
  const text = upper ? 'INF' : 'inf';
  return pad(sign, text, width, hasMinus, false);
}

function formatF(x: number, spec: Spec, upper: boolean): string {
  if (!Number.isFinite(x)) return formatSpecialFloat(x, spec, upper);
  const hasMinus = spec.flags.includes('-');
  const hasZero = spec.flags.includes('0');
  const hasHash = spec.flags.includes('#');
  const precision = spec.precision ?? 6;
  const sign = floatSign(x, spec);
  const abs = Math.abs(x);
  let body: string;
  if (abs === 0) {
    const intPart = '0';
    const fracPart = '0'.repeat(precision);
    body = intPart + (precision > 0 || hasHash ? '.' + fracPart : '');
  } else {
    const { N, D } = decompose(abs);
    const rounded = computeRounded(N, D, precision);
    const digitsStr = rounded.toString();
    const padded = digitsStr.padStart(precision + 1, '0');
    const intPart = padded.slice(0, padded.length - precision) || '0';
    const fracPart = precision > 0 ? padded.slice(padded.length - precision) : '';
    body = intPart + (precision > 0 || hasHash ? '.' + fracPart : '');
  }
  const width = spec.width ?? 0;
  const zeroPad = hasZero && !hasMinus;
  return pad(sign, body, width, hasMinus, zeroPad);
}

function significantDigits(abs: number, P: number): { digits: string; X: number } {
  const { N, D } = decompose(abs);
  const guess = Math.floor(Math.log10(abs));
  let X = findExponent(N, D, guess);
  const shiftExp = P - 1 - X;
  const rounded = computeRounded(N, D, shiftExp);
  let digitsStr = rounded.toString();
  if (digitsStr.length === P + 1) {
    X += 1;
    digitsStr = digitsStr.slice(0, P);
  } else if (digitsStr.length < P) {
    digitsStr = digitsStr.padStart(P, '0');
  }
  return { digits: digitsStr, X };
}

function formatE(x: number, spec: Spec, upper: boolean): string {
  if (!Number.isFinite(x)) return formatSpecialFloat(x, spec, upper);
  const hasMinus = spec.flags.includes('-');
  const hasZero = spec.flags.includes('0');
  const hasHash = spec.flags.includes('#');
  const precision = spec.precision ?? 6;
  const sign = floatSign(x, spec);
  const abs = Math.abs(x);
  const eLetter = upper ? 'E' : 'e';
  let body: string;
  if (abs === 0) {
    const frac = '0'.repeat(precision);
    body = '0' + (precision > 0 || hasHash ? '.' + frac : '') + eLetter + expString(0);
  } else {
    const P = precision + 1;
    const { digits, X } = significantDigits(abs, P);
    const frac = digits.slice(1);
    body = digits[0] + (precision > 0 || hasHash ? '.' + frac : '') + eLetter + expString(X);
  }
  const width = spec.width ?? 0;
  const zeroPad = hasZero && !hasMinus;
  return pad(sign, body, width, hasMinus, zeroPad);
}

function formatG(x: number, spec: Spec, upper: boolean): string {
  if (!Number.isFinite(x)) return formatSpecialFloat(x, spec, upper);
  const hasMinus = spec.flags.includes('-');
  const hasZero = spec.flags.includes('0');
  const hasHash = spec.flags.includes('#');
  const rawPrecision = spec.precision ?? 6;
  const P = rawPrecision === 0 ? 1 : rawPrecision;
  const sign = floatSign(x, spec);
  const abs = Math.abs(x);
  const eLetter = upper ? 'E' : 'e';
  let body: string;
  if (abs === 0) {
    if (hasHash) {
      body = '0.' + '0'.repeat(P - 1);
    } else {
      body = '0';
    }
  } else {
    const { digits, X } = significantDigits(abs, P);
    if (P > X && X >= -4) {
      let intPart: string;
      let fracPart: string;
      if (X >= 0) {
        const introLen = X + 1;
        intPart = digits.slice(0, introLen);
        fracPart = digits.slice(introLen);
      } else {
        intPart = '0';
        fracPart = '0'.repeat(-X - 1) + digits;
      }
      if (!hasHash) {
        fracPart = fracPart.replace(/0+$/, '');
        body = intPart + (fracPart.length > 0 ? '.' + fracPart : '');
      } else {
        body = intPart + '.' + fracPart;
      }
    } else {
      let fracPart = digits.slice(1);
      if (!hasHash) {
        fracPart = fracPart.replace(/0+$/, '');
        body = digits[0] + (fracPart.length > 0 ? '.' + fracPart : '') + eLetter + expString(X);
      } else {
        body = digits[0] + '.' + fracPart + eLetter + expString(X);
      }
    }
  }
  const width = spec.width ?? 0;
  const zeroPad = hasZero && !hasMinus;
  return pad(sign, body, width, hasMinus, zeroPad);
}

function formatS(value: string, spec: Spec): string {
  const hasMinus = spec.flags.includes('-');
  let text = value;
  if (spec.precision !== undefined) {
    text = text.slice(0, spec.precision);
  }
  const width = spec.width ?? 0;
  return pad('', text, width, hasMinus, false);
}

function formatC(value: string, spec: Spec): string {
  const hasMinus = spec.flags.includes('-');
  const width = spec.width ?? 0;
  return pad('', value, width, hasMinus, false);
}

export function format(fmt: string, ...args: Arg[]): string {
  let argIndex = 0;
  const re = /%(?:%|([-+0 #]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc]))/g;
  return fmt.replace(re, (match, flagsG, widthG, precG, convG) => {
    if (match === '%%') return '%';
    const flags: string = flagsG ?? '';
    const width = widthG === '' ? undefined : parseInt(widthG, 10);
    const precision = precG === undefined ? undefined : precG === '' ? 0 : parseInt(precG, 10);
    const conv: string = convG;
    const spec: Spec = { flags, width, precision, conv };
    const arg = args[argIndex++];

    switch (conv) {
      case 'd':
      case 'i': {
        const value = typeof arg === 'bigint' ? arg : BigInt(arg as number);
        return formatInt(value, spec);
      }
      case 'x':
      case 'X':
      case 'o': {
        const value = typeof arg === 'bigint' ? arg : BigInt(arg as number);
        return formatHexOct(value, spec);
      }
      case 'e':
        return formatE(arg as number, spec, false);
      case 'E':
        return formatE(arg as number, spec, true);
      case 'f':
        return formatF(arg as number, spec, false);
      case 'F':
        return formatF(arg as number, spec, true);
      case 'g':
        return formatG(arg as number, spec, false);
      case 'G':
        return formatG(arg as number, spec, true);
      case 's':
        return formatS(arg as string, spec);
      case 'c':
        return formatC(arg as string, spec);
      default:
        return match;
    }
  });
}
