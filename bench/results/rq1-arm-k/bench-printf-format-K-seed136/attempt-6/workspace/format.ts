const pow10 = (n: number): bigint => 10n ** BigInt(n);

// Exact rational of |x| (finite, non-zero): num / den.
function toRational(x: number): { num: bigint; den: bigint } {
  const f = new Float64Array(1);
  f[0] = Math.abs(x);
  const bits = new BigUint64Array(f.buffer)[0];
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
  return e >= 0 ? { num: m << BigInt(e), den: 1n } : { num: m, den: 1n << BigInt(-e) };
}

function roundDiv(num: bigint, den: bigint): bigint {
  const q = num / den;
  const r2 = (num % den) * 2n;
  if (r2 > den || (r2 === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// round(|x| * 10^k), half-even, exact
function scaled(x: number, k: number): bigint {
  if (x === 0) return 0n;
  const { num, den } = toRational(x);
  return k >= 0 ? roundDiv(num * pow10(k), den) : roundDiv(num, den * pow10(-k));
}

function decExp(x: number): number {
  const { num, den } = toRational(x);
  const ge = (E: number) => num * pow10(Math.max(-E, 0)) >= den * pow10(Math.max(E, 0));
  let E = Math.floor(Math.log10(Math.abs(x)));
  while (!ge(E)) E--;
  while (ge(E + 1)) E++;
  return E;
}

// digits (p+1 of them) and exponent in e style
function sci(x: number, p: number): { digits: string; exp: number } {
  if (x === 0) return { digits: '0'.repeat(p + 1), exp: 0 };
  let E = decExp(x);
  let d = scaled(x, p - E);
  if (d >= pow10(p + 1)) {
    E++;
    d = scaled(x, p - E);
  }
  return { digits: d.toString(), exp: E };
}

function fmtE(x: number, p: number, alt: boolean, upper: boolean, strip: boolean): string {
  const { digits, exp } = sci(x, p);
  let mant = digits[0];
  let fr = digits.slice(1);
  if (strip) fr = fr.replace(/0+$/, '');
  if (fr.length > 0 || alt) mant += '.' + fr;
  const ae = Math.abs(exp);
  return mant + (upper ? 'E' : 'e') + (exp < 0 ? '-' : '+') + (ae < 10 ? '0' : '') + ae;
}

function fmtF(x: number, p: number, alt: boolean, strip: boolean): string {
  let s = scaled(x, p).toString().padStart(p + 1, '0');
  let ip = s.slice(0, s.length - p);
  let fr = s.slice(s.length - p);
  if (strip) fr = fr.replace(/0+$/, '');
  return ip + (fr.length > 0 || alt ? '.' : '') + fr;
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
      const c = fmt[i];
      if (c === '-') minus = true;
      else if (c === '+') plus = true;
      else if (c === ' ') space = true;
      else if (c === '0') zero = true;
      else if (c === '#') alt = true;
      else break;
    }
    let width = 0;
    while (fmt[i] >= '0' && fmt[i] <= '9') width = width * 10 + Number(fmt[i++]);
    let prec: number | undefined;
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
    let canZero = false;

    if (conv === 's' || conv === 'c') {
      body = String(arg);
      if (conv === 's' && prec !== undefined) body = body.slice(0, prec);
    } else if (conv === 'd' || conv === 'i' || conv === 'x' || conv === 'X' || conv === 'o') {
      const v = typeof arg === 'bigint' ? arg : BigInt(arg as number);
      const neg = v < 0n;
      const mag = neg ? -v : v;
      let digits =
        conv === 'x' ? mag.toString(16) : conv === 'X' ? mag.toString(16).toUpperCase() : conv === 'o' ? mag.toString(8) : mag.toString();
      if (prec !== undefined) {
        if (prec === 0 && mag === 0n) digits = '';
        digits = digits.padStart(prec, '0');
      }
      if (conv === 'd' || conv === 'i') {
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
      } else if (alt) {
        if (conv === 'o') {
          if (digits[0] !== '0') digits = '0' + digits;
        } else if (mag !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      }
      body = digits;
      canZero = prec === undefined;
    } else {
      const x = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      const neg = x < 0 || Object.is(x, -0);
      if (Number.isNaN(x)) {
        body = upper ? 'NAN' : 'nan';
      } else {
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        if (!Number.isFinite(x)) {
          body = upper ? 'INF' : 'inf';
        } else {
          const a = Math.abs(x);
          canZero = true;
          const lc = conv.toLowerCase();
          if (lc === 'e') body = fmtE(a, prec ?? 6, alt, upper, false);
          else if (lc === 'f') body = fmtF(a, prec ?? 6, alt, false);
          else {
            const P = Math.max(prec ?? 6, 1);
            const X = sci(a, P - 1).exp;
            if (P > X && X >= -4) body = fmtF(a, P - 1 - X, alt, !alt);
            else body = fmtE(a, P - 1, alt, upper, !alt);
          }
        }
      }
    }

    const len = sign.length + prefix.length + body.length;
    if (len < width) {
      const pad = width - len;
      if (minus) out += sign + prefix + body + ' '.repeat(pad);
      else if (zero && canZero) out += sign + prefix + '0'.repeat(pad) + body;
      else out += ' '.repeat(pad) + sign + prefix + body;
    } else out += sign + prefix + body;
  }
  return out;
}
