// printf-style format() implementation.
// Floating point rounding uses the exact binary value of the number (via
// decomposition into mantissa/exponent bigints) so that round-half-to-even
// decisions match the true value rather than an intermediate double->string
// approximation.

function decompose(ax: number): { mantissa: bigint; exp: number } {
  if (ax === 0) return { mantissa: 0n, exp: 0 };
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setFloat64(0, ax);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const biasedExp = (hi >>> 20) & 0x7ff;
  const fracHi = hi & 0xfffff;
  const frac = (BigInt(fracHi) << 32n) | BigInt(lo);
  if (biasedExp === 0) {
    return { mantissa: frac, exp: -1074 };
  }
  return { mantissa: frac | (1n << 52n), exp: biasedExp - 1075 };
}

function toRatio(ax: number): { num: bigint; den: bigint } {
  const { mantissa, exp } = decompose(ax);
  if (exp >= 0) return { num: mantissa << BigInt(exp), den: 1n };
  return { num: mantissa, den: 1n << BigInt(-exp) };
}

// round(value * 10^p) using round-half-to-even on the exact value num/den.
function roundFrac(num: bigint, den: bigint, p: number): bigint {
  const scaledNum = p >= 0 ? num * 10n ** BigInt(p) : num;
  const scaledDen = p >= 0 ? den : den * 10n ** BigInt(-p);
  let q = scaledNum / scaledDen;
  const r = scaledNum % scaledDen;
  const twice = r * 2n;
  if (twice > scaledDen || (twice === scaledDen && (q & 1n) === 1n)) q += 1n;
  return q;
}

// Round num/den (>0) to exactly N significant digits, returning the digits
// as an integer with N digits, along with the decimal exponent k such that
// value ~= digits * 10^(k - N + 1).
function roundSig(num: bigint, den: bigint, kGuess: number, N: number): { digits: bigint; k: number } {
  let k = kGuess;
  const lower = 10n ** BigInt(N - 1);
  const upper = 10n ** BigInt(N);
  for (;;) {
    const shift = k - N + 1;
    let sNum: bigint;
    let sDen: bigint;
    if (shift >= 0) {
      sNum = num;
      sDen = den * 10n ** BigInt(shift);
    } else {
      sNum = num * 10n ** BigInt(-shift);
      sDen = den;
    }
    let q = sNum / sDen;
    const r = sNum % sDen;
    const twice = r * 2n;
    if (twice > sDen || (twice === sDen && (q & 1n) === 1n)) q += 1n;
    if (q >= upper) {
      k += 1;
      continue;
    }
    if (q < lower) {
      k -= 1;
      continue;
    }
    return { digits: q, k };
  }
}

function padGeneric(body: string, width: number, flags: string): string {
  if (body.length >= width) return body;
  const n = width - body.length;
  return flags.includes('-') ? body + ' '.repeat(n) : ' '.repeat(n) + body;
}

function padNumeric(sign: string, digits: string, width: number, flags: string, allowZero: boolean): string {
  const body = sign + digits;
  if (body.length >= width) return body;
  const n = width - body.length;
  if (flags.includes('-')) return body + ' '.repeat(n);
  if (allowZero && flags.includes('0')) return sign + '0'.repeat(n) + digits;
  return ' '.repeat(n) + body;
}

function formatInt(value: number | bigint, flags: string, width: number, precision: number | undefined, conv: string): string {
  let neg: boolean;
  let v: bigint;
  if (typeof value === 'bigint') {
    neg = value < 0n;
    v = neg ? -value : value;
  } else {
    neg = value < 0;
    v = BigInt(Math.trunc(Math.abs(value)));
  }

  let base = 10;
  let upper = false;
  if (conv === 'x') base = 16;
  else if (conv === 'X') {
    base = 16;
    upper = true;
  } else if (conv === 'o') base = 8;

  let raw: string;
  if (precision === 0 && v === 0n) raw = '';
  else raw = v.toString(base);
  if (upper) raw = raw.toUpperCase();
  if (precision !== undefined && raw.length < precision) {
    raw = '0'.repeat(precision - raw.length) + raw;
  }

  let sign = '';
  let prefix = '';
  if (conv === 'd' || conv === 'i') {
    sign = neg ? '-' : flags.includes('+') ? '+' : flags.includes(' ') ? ' ' : '';
  } else if (conv === 'o') {
    if (flags.includes('#') && (raw === '' || raw[0] !== '0')) raw = '0' + raw;
  } else if (conv === 'x' || conv === 'X') {
    if (flags.includes('#') && v !== 0n) prefix = conv === 'X' ? '0X' : '0x';
  }

  const allowZero = precision === undefined;
  return padNumeric(sign + prefix, raw, width, flags, allowZero);
}

function computeFCore(num: bigint, den: bigint, p: number, hash: boolean): string {
  const Q = roundFrac(num, den, p);
  let s = Q.toString();
  let intPart: string;
  let fracPart: string;
  if (p > 0) {
    if (s.length <= p) s = '0'.repeat(p + 1 - s.length) + s;
    intPart = s.slice(0, s.length - p);
    fracPart = s.slice(s.length - p);
  } else {
    intPart = s;
    fracPart = '';
  }
  return intPart + (p > 0 || hash ? '.' + fracPart : '');
}

function computeECore(num: bigint, den: bigint, p: number, hash: boolean, upperE: boolean, kGuess: number): string {
  const N = p + 1;
  let digits: bigint;
  let k: number;
  if (num === 0n) {
    digits = 0n;
    k = 0;
  } else {
    const res = roundSig(num, den, kGuess, N);
    digits = res.digits;
    k = res.k;
  }
  const ds = digits.toString().padStart(N, '0');
  const first = ds[0];
  const rest = ds.slice(1);
  const fracStr = p > 0 || hash ? '.' + rest : '';
  const expSign = k >= 0 ? '+' : '-';
  const expAbs = Math.abs(k).toString().padStart(2, '0');
  return first + fracStr + (upperE ? 'E' : 'e') + expSign + expAbs;
}

function gStrip(s: string): string {
  const idx = s.search(/[eE]/);
  let mantissa = idx === -1 ? s : s.slice(0, idx);
  const suffix = idx === -1 ? '' : s.slice(idx);
  if (mantissa.includes('.')) {
    mantissa = mantissa.replace(/0+$/, '').replace(/\.$/, '');
  }
  return mantissa + suffix;
}

function formatFloat(x: number, flags: string, width: number, precision: number | undefined, conv: string): string {
  const isUpper = conv === 'E' || conv === 'F' || conv === 'G';
  const hash = flags.includes('#');

  if (Number.isNaN(x)) {
    const text = isUpper ? 'NAN' : 'nan';
    return padGeneric(text, width, flags);
  }

  const neg = x < 0 || Object.is(x, -0);
  const signStr = neg ? '-' : flags.includes('+') ? '+' : flags.includes(' ') ? ' ' : '';

  if (!Number.isFinite(x)) {
    const body = signStr + (isUpper ? 'INF' : 'inf');
    return padGeneric(body, width, flags);
  }

  const ax = Math.abs(x);
  const { num, den } = toRatio(ax);

  let core: string;
  const lower = conv.toLowerCase();
  if (lower === 'f') {
    const p = precision === undefined ? 6 : precision;
    core = computeFCore(num, den, p, hash);
  } else if (lower === 'e') {
    const p = precision === undefined ? 6 : precision;
    const kGuess = ax === 0 ? 0 : Math.floor(Math.log10(ax));
    core = computeECore(num, den, p, hash, conv === 'E', kGuess);
  } else {
    // g / G
    const P = precision === undefined ? 6 : precision === 0 ? 1 : precision;
    let X: number;
    if (ax === 0) {
      X = 0;
    } else {
      const kGuess = Math.floor(Math.log10(ax));
      X = roundSig(num, den, kGuess, P).k;
    }
    if (P > X && X >= -4) {
      core = computeFCore(num, den, P - 1 - X, hash);
    } else {
      const kGuess = ax === 0 ? 0 : Math.floor(Math.log10(ax));
      core = computeECore(num, den, P - 1, hash, conv === 'G', kGuess);
    }
    if (!hash) core = gStrip(core);
  }

  return padNumeric(signStr, core, width, flags, true);
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  const re = /%([-+0 #]*)(\d*)(\.\d*)?([diouxXeEfFgGsc%])/g;
  let result = '';
  let lastIndex = 0;
  let argIndex = 0;
  let m: RegExpExecArray | null;

  while ((m = re.exec(fmt)) !== null) {
    result += fmt.slice(lastIndex, m.index);
    lastIndex = re.lastIndex;

    const [, flags, widthStr, precStr, conv] = m;

    if (conv === '%') {
      result += '%';
      continue;
    }

    const width = widthStr ? parseInt(widthStr, 10) : 0;
    const precision = precStr === undefined ? undefined : precStr === '.' ? 0 : parseInt(precStr.slice(1), 10);

    const arg = args[argIndex++];

    if (conv === 'd' || conv === 'i' || conv === 'x' || conv === 'X' || conv === 'o') {
      result += formatInt(arg as number | bigint, flags, width, precision, conv);
    } else if ('eEfFgG'.includes(conv)) {
      result += formatFloat(arg as number, flags, width, precision, conv);
    } else if (conv === 's') {
      let str = String(arg);
      if (precision !== undefined) str = str.slice(0, precision);
      result += padGeneric(str, width, flags);
    } else if (conv === 'c') {
      const str = String(arg);
      result += padGeneric(str, width, flags);
    }
  }

  result += fmt.slice(lastIndex);
  return result;
}
