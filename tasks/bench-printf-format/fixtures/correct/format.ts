const buf = new DataView(new ArrayBuffer(8));

function decompose(x: number): { neg: boolean; num: bigint; den: bigint } {
  buf.setFloat64(0, x);
  const bits = buf.getBigUint64(0);
  const neg = (bits >> 63n) === 1n;
  const expBits = Number((bits >> 52n) & 0x7ffn);
  const frac = bits & 0xfffffffffffffn;
  const m = expBits === 0 ? frac : frac | (1n << 52n);
  const e = (expBits === 0 ? 1 : expBits) - 1075;
  return e >= 0 ? { neg, num: m << BigInt(e), den: 1n } : { neg, num: m, den: 1n << BigInt(-e) };
}

// round-half-even of (num/den) * 10^k as an integer, for any integer k
function scaled(num: bigint, den: bigint, k: number): bigint {
  let n = num;
  let d = den;
  if (k >= 0) n *= 10n ** BigInt(k);
  else d *= 10n ** BigInt(-k);
  const q = n / d;
  const r = n % d;
  const twice = 2n * r;
  if (twice > d) return q + 1n;
  if (twice < d) return q;
  return q % 2n === 0n ? q : q + 1n;
}

function fixedDigits(num: bigint, den: bigint, prec: number): { int: string; frac: string } {
  let s = scaled(num, den, prec).toString();
  if (s.length <= prec) s = '0'.repeat(prec + 1 - s.length) + s;
  return { int: s.slice(0, s.length - prec), frac: s.slice(s.length - prec) };
}

function expDigits(num: bigint, den: bigint, prec: number): { digits: string; exp: number } {
  if (num === 0n) return { digits: '0'.repeat(prec + 1), exp: 0 };
  let X = 0;
  while (num * 10n ** BigInt(Math.max(0, -X)) < den * 10n ** BigInt(Math.max(0, X))) X--;
  while (num * 10n ** BigInt(Math.max(0, -(X + 1))) >= den * 10n ** BigInt(Math.max(0, X + 1))) X++;
  let n = scaled(num, den, prec - X);
  if (n >= 10n ** BigInt(prec + 1)) {
    X++;
    n = scaled(num, den, prec - X);
  }
  return { digits: n.toString(), exp: X };
}

function expText(digits: string, exp: number, alt: boolean, upper: boolean): string {
  const point = digits.length > 1 || alt ? '.' : '';
  const e = Math.abs(exp).toString().padStart(2, '0');
  return digits[0] + point + digits.slice(1) + (upper ? 'E' : 'e') + (exp < 0 ? '-' : '+') + e;
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let out = '';
  let ai = 0;
  for (let i = 0; i < fmt.length; ) {
    if (fmt[i] !== '%') {
      out += fmt[i++];
      continue;
    }
    i++;
    if (fmt[i] === '%') {
      out += '%';
      i++;
      continue;
    }
    let minus = false, plus = false, space = false, zero = false, alt = false;
    for (; '-+ 0#'.includes(fmt[i]); i++) {
      if (fmt[i] === '-') minus = true;
      else if (fmt[i] === '+') plus = true;
      else if (fmt[i] === ' ') space = true;
      else if (fmt[i] === '0') zero = true;
      else alt = true;
    }
    let width = 0;
    while (fmt[i] >= '0' && fmt[i] <= '9') width = width * 10 + Number(fmt[i++]);
    let prec: number | null = null;
    if (fmt[i] === '.') {
      i++;
      prec = 0;
      while (fmt[i] >= '0' && fmt[i] <= '9') prec = prec * 10 + Number(fmt[i++]);
    }
    const conv = fmt[i++];
    const arg = args[ai++];
    let sign = '';
    let prefix = '';
    let body = '';
    let numeric = true;
    let allowZero = true;
    const signFor = (neg: boolean) => (neg ? '-' : plus ? '+' : space ? ' ' : '');
    if (conv === 'd' || conv === 'i') {
      const v = BigInt(arg as number | bigint);
      sign = signFor(v < 0n);
      body = (v < 0n ? -v : v).toString();
      if (prec !== null) {
        if (prec === 0 && v === 0n) body = '';
        body = body.padStart(prec, '0');
        allowZero = false;
      }
    } else if (conv === 'x' || conv === 'X' || conv === 'o') {
      const v = BigInt(arg as number | bigint);
      body = v.toString(conv === 'o' ? 8 : 16);
      if (conv === 'X') body = body.toUpperCase();
      if (prec !== null) {
        if (prec === 0 && v === 0n) body = '';
        body = body.padStart(prec, '0');
        allowZero = false;
      }
      if (alt && conv === 'o' && !body.startsWith('0')) body = '0' + body;
      if (alt && conv !== 'o' && v !== 0n) prefix = conv === 'x' ? '0x' : '0X';
    } else if ('eEfFgG'.includes(conv)) {
      const x = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      if (Number.isNaN(x)) {
        body = upper ? 'NAN' : 'nan';
        allowZero = false;
      } else {
        const { neg, num, den } = decompose(x);
        sign = signFor(neg);
        if (!Number.isFinite(x)) {
          body = upper ? 'INF' : 'inf';
          allowZero = false;
        } else if (conv === 'f' || conv === 'F') {
          const p = prec ?? 6;
          const { int, frac } = fixedDigits(num, den, p);
          body = int + (p > 0 || alt ? '.' : '') + frac;
        } else if (conv === 'e' || conv === 'E') {
          const p = prec ?? 6;
          const { digits, exp } = expDigits(num, den, p);
          body = expText(digits, exp, alt, upper);
        } else {
          const P = prec === null ? 6 : prec === 0 ? 1 : prec;
          const { digits, exp } = expDigits(num, den, P - 1);
          if (P > exp && exp >= -4) {
            const { int, frac } = fixedDigits(num, den, P - 1 - exp);
            let f = frac;
            if (!alt) f = f.replace(/0+$/, '');
            body = int + (f.length > 0 || alt ? '.' : '') + f;
          } else {
            let d = digits;
            if (!alt) d = d[0] + digits.slice(1).replace(/0+$/, '');
            body = expText(d, exp, alt, upper);
          }
        }
      }
    } else if (conv === 's') {
      body = prec === null ? (arg as string) : (arg as string).slice(0, prec);
      numeric = false;
    } else {
      body = arg as string;
      numeric = false;
    }
    const len = sign.length + prefix.length + body.length;
    if (len >= width) out += sign + prefix + body;
    else if (minus) out += sign + prefix + body + ' '.repeat(width - len);
    else if (numeric && zero && allowZero) out += sign + prefix + '0'.repeat(width - len) + body;
    else out += ' '.repeat(width - len) + sign + prefix + body;
  }
  return out;
}
