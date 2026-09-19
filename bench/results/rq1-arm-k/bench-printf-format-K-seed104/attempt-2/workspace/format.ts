function toRational(x: number): [bigint, bigint] {
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, x);
  const bits = buf.getBigUint64(0);
  const expBits = Number((bits >> 52n) & 0x7ffn);
  const frac = bits & ((1n << 52n) - 1n);
  let m: bigint;
  let e: number;
  if (expBits === 0) {
    m = frac;
    e = -1074;
  } else {
    m = frac | (1n << 52n);
    e = expBits - 1075;
  }
  return e >= 0 ? [m << BigInt(e), 1n] : [m, 1n << BigInt(-e)];
}

function roundDiv(n: bigint, d: bigint): bigint {
  const q = n / d;
  const r2 = (n % d) * 2n;
  if (r2 > d || (r2 === d && (q & 1n) === 1n)) return q + 1n;
  return q;
}

const pow10 = (n: number): bigint => 10n ** BigInt(n);

function fixed(abs: number, prec: number, alt: boolean): string {
  const [n, d] = toRational(abs);
  const q = roundDiv(n * pow10(prec), d);
  let s = q.toString();
  if (s.length < prec + 1) s = '0'.repeat(prec + 1 - s.length) + s;
  const ip = s.slice(0, s.length - prec);
  const fp = s.slice(s.length - prec);
  return ip + (prec > 0 || alt ? '.' : '') + fp;
}

function expDigits(abs: number, prec: number): { digits: string; exp: number } {
  if (abs === 0) return { digits: '0'.repeat(prec + 1), exp: 0 };
  const [n, d] = toRational(abs);
  let e = Math.floor(Math.log10(abs));
  const lo = pow10(prec);
  const hi = pow10(prec + 1);
  for (;;) {
    const s = e - prec;
    const q = s >= 0 ? roundDiv(n, d * pow10(s)) : roundDiv(n * pow10(-s), d);
    if (q >= hi) e++;
    else if (q < lo) e--;
    else return { digits: q.toString(), exp: e };
  }
}

function expStyle(abs: number, prec: number, alt: boolean, upper: boolean): string {
  const { digits, exp } = expDigits(abs, prec);
  let s = digits[0];
  if (prec > 0 || alt) s += '.';
  s += digits.slice(1);
  const ae = Math.abs(exp);
  return s + (upper ? 'E' : 'e') + (exp < 0 ? '-' : '+') + (ae < 10 ? '0' : '') + ae;
}

function stripZeros(s: string): string {
  const m = /^([^eE]*)(.*)$/.exec(s)!;
  let mant = m[1];
  if (mant.includes('.')) mant = mant.replace(/0+$/, '').replace(/\.$/, '');
  return mant + m[2];
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let out = '';
  let ai = 0;
  let i = 0;
  while (i < fmt.length) {
    const ch = fmt[i];
    if (ch !== '%') {
      out += ch;
      i++;
      continue;
    }
    i++;
    if (fmt[i] === '%') {
      out += '%';
      i++;
      continue;
    }
    let minus = false, plus = false, space = false, zero = false, alt = false;
    for (;; i++) {
      const f = fmt[i];
      if (f === '-') minus = true;
      else if (f === '+') plus = true;
      else if (f === ' ') space = true;
      else if (f === '0') zero = true;
      else if (f === '#') alt = true;
      else break;
    }
    let width = 0;
    while (fmt[i] >= '0' && fmt[i] <= '9') width = width * 10 + Number(fmt[i++]);
    let prec = -1;
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
    let allowZero = zero && !minus;

    if (conv === 'd' || conv === 'i' || conv === 'x' || conv === 'X' || conv === 'o') {
      let v = BigInt(arg as number | bigint);
      if (conv === 'd' || conv === 'i') {
        if (v < 0n) {
          sign = '-';
          v = -v;
        } else sign = plus ? '+' : space ? ' ' : '';
      }
      let digits = conv === 'x' ? v.toString(16) : conv === 'X' ? v.toString(16).toUpperCase() : conv === 'o' ? v.toString(8) : v.toString();
      if (prec >= 0) {
        if (prec === 0 && v === 0n) digits = '';
        if (digits.length < prec) digits = '0'.repeat(prec - digits.length) + digits;
        allowZero = false;
      }
      if (alt) {
        if (conv === 'o') {
          if (!digits.startsWith('0')) digits = '0' + digits;
        } else if ((conv === 'x' || conv === 'X') && v !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      }
      body = digits;
    } else if ('eEfFgG'.includes(conv)) {
      const x = arg as number;
      const upper = conv === conv.toUpperCase();
      if (Number.isNaN(x)) {
        body = upper ? 'NAN' : 'nan';
        allowZero = false;
      } else {
        const neg = x < 0 || Object.is(x, -0);
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        const abs = Math.abs(x);
        if (abs === Infinity) {
          body = upper ? 'INF' : 'inf';
          allowZero = false;
        } else {
          const lc = conv.toLowerCase();
          if (lc === 'f') body = fixed(abs, prec < 0 ? 6 : prec, alt);
          else if (lc === 'e') body = expStyle(abs, prec < 0 ? 6 : prec, alt, upper);
          else {
            const P = prec < 0 ? 6 : prec === 0 ? 1 : prec;
            const X = expDigits(abs, P - 1).exp;
            if (P > X && X >= -4) body = fixed(abs, P - 1 - X, alt);
            else body = expStyle(abs, P - 1, alt, upper);
            if (!alt) body = stripZeros(body);
          }
        }
      }
    } else if (conv === 's') {
      numeric = false;
      body = arg as string;
      if (prec >= 0) body = body.slice(0, prec);
    } else {
      numeric = false;
      body = arg as string;
    }

    const len = sign.length + prefix.length + body.length;
    if (len >= width) out += sign + prefix + body;
    else if (minus) out += sign + prefix + body + ' '.repeat(width - len);
    else if (numeric && allowZero) out += sign + prefix + '0'.repeat(width - len) + body;
    else out += ' '.repeat(width - len) + sign + prefix + body;
  }
  return out;
}
