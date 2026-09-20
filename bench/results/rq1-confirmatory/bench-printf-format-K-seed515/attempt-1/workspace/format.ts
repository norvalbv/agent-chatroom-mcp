type Arg = number | bigint | string;

function decomposeAbs(x: number): { M: bigint; E: number } {
  const buf = new ArrayBuffer(8);
  new Float64Array(buf)[0] = x;
  const bits = new BigUint64Array(buf)[0];
  const exp = Number((bits >> 52n) & 0x7ffn);
  const mant = bits & 0xfffffffffffffn;
  if (exp === 0) return { M: mant, E: -1074 };
  return { M: mant | (1n << 52n), E: exp - 1075 };
}

function exactDecimal(M: bigint, E: number): { intDigits: string; fracDigits: string } {
  if (E >= 0) {
    const intPart = M << BigInt(E);
    return { intDigits: intPart.toString(), fracDigits: '' };
  }
  const k = -E;
  const denom = 1n << BigInt(k);
  const intPart = M / denom;
  const rem = M % denom;
  const frac = (rem * 5n ** BigInt(k)).toString().padStart(k, '0');
  return { intDigits: intPart.toString(), fracDigits: frac };
}

function roundStream(stream: string, keep: number, priorDigit: string): { digits: string; carry: boolean } {
  const kept = stream.slice(0, keep).padEnd(keep, '0');
  const nextDigit = stream[keep] ?? '0';
  const rest = stream.slice(keep + 1);
  let roundUp: boolean;
  if (nextDigit < '5') roundUp = false;
  else if (nextDigit > '5') roundUp = true;
  else if (/[1-9]/.test(rest)) roundUp = true;
  else {
    const lastKept = keep > 0 ? kept[keep - 1] : priorDigit;
    roundUp = parseInt(lastKept, 10) % 2 === 1;
  }
  if (!roundUp) return { digits: kept, carry: false };
  const num = BigInt(kept === '' ? '0' : kept) + 1n;
  const modulus = 10n ** BigInt(keep);
  if (num === modulus) return { digits: '0'.repeat(keep), carry: true };
  return { digits: num.toString().padStart(keep, '0'), carry: false };
}

function fMagnitude(x: number, precision: number): { intDigits: string; fracDigits: string } {
  const { M, E } = decomposeAbs(x);
  let { intDigits, fracDigits } = exactDecimal(M, E);
  const { digits, carry } = roundStream(fracDigits, precision, intDigits[intDigits.length - 1]);
  if (carry) intDigits = (BigInt(intDigits) + 1n).toString();
  return { intDigits, fracDigits: digits };
}

function eMagnitude(x: number, precision: number): { digit0: string; restDigits: string; X: number } {
  if (x === 0) return { digit0: '0', restDigits: '0'.repeat(precision), X: 0 };
  const { M, E } = decomposeAbs(x);
  const { intDigits, fracDigits } = exactDecimal(M, E);
  const S = intDigits + fracDigits;
  const pointPos = intDigits.length;
  const firstNZ = S.search(/[1-9]/);
  let X = pointPos - 1 - firstNZ;
  const sig = S.slice(firstNZ);
  const { digits, carry } = roundStream(sig, precision + 1, '0');
  if (carry) {
    X += 1;
    return { digit0: '1', restDigits: '0'.repeat(precision), X };
  }
  return { digit0: digits[0], restDigits: digits.slice(1), X };
}

function numSign(isNegative: boolean, flags: string): string {
  if (isNegative) return '-';
  if (flags.includes('+')) return '+';
  if (flags.includes(' ')) return ' ';
  return '';
}

function assembleNumeric(sign: string, prefix: string, digits: string, width: number, leftAlign: boolean, zeroFlag: boolean): string {
  const core = sign + prefix + digits;
  const padLen = width - core.length;
  if (padLen <= 0) return core;
  if (leftAlign) return core + ' '.repeat(padLen);
  if (zeroFlag) return sign + prefix + '0'.repeat(padLen) + digits;
  return ' '.repeat(padLen) + core;
}

function padPlain(str: string, width: number, leftAlign: boolean): string {
  const padLen = width - str.length;
  if (padLen <= 0) return str;
  return leftAlign ? str + ' '.repeat(padLen) : ' '.repeat(padLen) + str;
}

function formatExponent(X: number, upper: boolean): string {
  const expSign = X < 0 ? '-' : '+';
  const expAbs = Math.abs(X).toString().padStart(2, '0');
  return (upper ? 'E' : 'e') + expSign + expAbs;
}

function toBigIntMagnitude(value: number | bigint): bigint {
  return typeof value === 'bigint' ? value : BigInt(Math.trunc(value));
}

function formatDI(value: number | bigint, flags: string, width: number, precision: number | undefined): string {
  const neg = typeof value === 'bigint' ? value < 0n : value < 0;
  let big = toBigIntMagnitude(value);
  if (big < 0n) big = -big;
  let digits = big.toString();
  if (precision !== undefined) {
    digits = precision === 0 && big === 0n ? '' : digits.padStart(precision, '0');
  }
  const sign = numSign(neg, flags);
  const zeroFlag = flags.includes('0') && precision === undefined;
  return assembleNumeric(sign, '', digits, width, flags.includes('-'), zeroFlag);
}

function formatXXO(value: number | bigint, flags: string, width: number, precision: number | undefined, conv: 'x' | 'X' | 'o'): string {
  const big = toBigIntMagnitude(value);
  let digits = conv === 'o' ? big.toString(8) : big.toString(16);
  if (conv === 'X') digits = digits.toUpperCase();
  const hash = flags.includes('#');
  if (precision !== undefined) {
    digits = precision === 0 && big === 0n ? '' : digits.padStart(precision, '0');
  }
  if (conv === 'o' && hash) {
    if (digits.length === 0 || digits[0] !== '0') digits = '0' + digits;
  }
  let prefix = '';
  if ((conv === 'x' || conv === 'X') && hash && big !== 0n) {
    prefix = conv === 'x' ? '0x' : '0X';
  }
  const zeroFlag = flags.includes('0') && precision === undefined;
  return assembleNumeric('', prefix, digits, width, flags.includes('-'), zeroFlag);
}

function isNegativeValue(value: number): boolean {
  return value < 0 || Object.is(value, -0);
}

function formatSpecialFloat(value: number, flags: string, width: number, upper: boolean): string {
  let text: string;
  let sign: string;
  if (Number.isNaN(value)) {
    text = upper ? 'NAN' : 'nan';
    sign = '';
  } else {
    text = upper ? 'INF' : 'inf';
    sign = numSign(value < 0, flags);
  }
  return assembleNumeric(sign, '', text, width, flags.includes('-'), false);
}

function formatF(value: number, flags: string, width: number, precision: number, upper: boolean): string {
  if (!Number.isFinite(value)) return formatSpecialFloat(value, flags, width, upper);
  const hash = flags.includes('#');
  const x = Math.abs(value);
  const { intDigits, fracDigits } = fMagnitude(x, precision);
  const includeDot = precision > 0 || hash;
  const body = intDigits + (includeDot ? '.' + fracDigits : '');
  const sign = numSign(isNegativeValue(value), flags);
  const zeroFlag = flags.includes('0');
  return assembleNumeric(sign, '', body, width, flags.includes('-'), zeroFlag);
}

function formatE(value: number, flags: string, width: number, precision: number, upper: boolean): string {
  if (!Number.isFinite(value)) return formatSpecialFloat(value, flags, width, upper);
  const hash = flags.includes('#');
  const x = Math.abs(value);
  const { digit0, restDigits, X } = eMagnitude(x, precision);
  const includeDot = precision > 0 || hash;
  const body = digit0 + (includeDot ? '.' + restDigits : '') + formatExponent(X, upper);
  const sign = numSign(isNegativeValue(value), flags);
  const zeroFlag = flags.includes('0');
  return assembleNumeric(sign, '', body, width, flags.includes('-'), zeroFlag);
}

function formatG(value: number, flags: string, width: number, precisionArg: number | undefined, upper: boolean): string {
  if (!Number.isFinite(value)) return formatSpecialFloat(value, flags, width, upper);
  const hash = flags.includes('#');
  const P = precisionArg === undefined ? 6 : precisionArg === 0 ? 1 : precisionArg;
  const x = Math.abs(value);
  const { X } = eMagnitude(x, P - 1);

  let intDigits: string;
  let fracDigits: string;
  let exp: number | null = null;
  let precision: number;

  if (P > X && X >= -4) {
    precision = P - 1 - X;
    const m = fMagnitude(x, precision);
    intDigits = m.intDigits;
    fracDigits = m.fracDigits;
  } else {
    precision = P - 1;
    const m = eMagnitude(x, precision);
    intDigits = m.digit0;
    fracDigits = m.restDigits;
    exp = m.X;
  }

  let includeDot = precision > 0 || hash;
  if (!hash) {
    const trimmed = fracDigits.replace(/0+$/, '');
    if (trimmed === '') {
      includeDot = false;
      fracDigits = '';
    } else {
      fracDigits = trimmed;
    }
  }

  const body = intDigits + (includeDot ? '.' + fracDigits : '') + (exp !== null ? formatExponent(exp, upper) : '');
  const sign = numSign(isNegativeValue(value), flags);
  const zeroFlag = flags.includes('0');
  return assembleNumeric(sign, '', body, width, flags.includes('-'), zeroFlag);
}

export function format(fmt: string, ...args: Arg[]): string {
  let argIndex = 0;
  const re = /%%|%([-+0 #]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc])/g;

  return fmt.replace(re, (match, flagsG: string | undefined, widthG: string | undefined, precG: string | undefined, convG: string | undefined) => {
    if (match === '%%') return '%';
    const flags = flagsG ?? '';
    const width = widthG ? parseInt(widthG, 10) : 0;
    const precision = precG === undefined ? undefined : precG === '' ? 0 : parseInt(precG, 10);
    const conv = convG as string;
    const arg = args[argIndex++];

    switch (conv) {
      case 'd':
      case 'i':
        return formatDI(arg as number | bigint, flags, width, precision);
      case 'x':
      case 'X':
      case 'o':
        return formatXXO(arg as number | bigint, flags, width, precision, conv);
      case 'f':
        return formatF(arg as number, flags, width, precision ?? 6, false);
      case 'F':
        return formatF(arg as number, flags, width, precision ?? 6, true);
      case 'e':
        return formatE(arg as number, flags, width, precision ?? 6, false);
      case 'E':
        return formatE(arg as number, flags, width, precision ?? 6, true);
      case 'g':
        return formatG(arg as number, flags, width, precision, false);
      case 'G':
        return formatG(arg as number, flags, width, precision, true);
      case 's': {
        let str = arg as string;
        if (precision !== undefined) str = str.slice(0, precision);
        return padPlain(str, width, flags.includes('-'));
      }
      case 'c':
        return padPlain(arg as string, width, flags.includes('-'));
      default:
        return match;
    }
  });
}
