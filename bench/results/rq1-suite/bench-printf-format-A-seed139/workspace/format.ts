type Rat = { n: bigint; d: bigint };

function toRat(x: number): Rat {
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, Math.abs(x));
  const bits = buf.getBigUint64(0);
  const ex = Number((bits >> 52n) & 0x7ffn);
  const frac = bits & ((1n << 52n) - 1n);
  const m = ex === 0 ? frac : frac | (1n << 52n);
  const e = (ex === 0 ? 1 : ex) - 1075;
  return e >= 0 ? { n: m << BigInt(e), d: 1n } : { n: m, d: 1n << BigInt(-e) };
}

function roundDiv(n: bigint, d: bigint): bigint {
  const q = n / d;
  const r2 = (n - q * d) * 2n;
  if (r2 > d || (r2 === d && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// round(v * 10^k) half-even
function scaled(v: Rat, k: number): bigint {
  return k >= 0 ? roundDiv(v.n * 10n ** BigInt(k), v.d) : roundDiv(v.n, v.d * 10n ** BigInt(-k));
}

function fixedDigits(v: Rat, p: number): { int: string; frac: string } {
  let s = scaled(v, p).toString();
  if (s.length <= p) s = '0'.repeat(p + 1 - s.length) + s;
  return { int: s.slice(0, s.length - p), frac: s.slice(s.length - p) };
}

// returns digits (p+1 digits) and decimal exponent for nonzero v
function expDigits(v: Rat, p: number): { digits: string; exp: number } {
  let X = Math.floor(Math.log10(Number(v.n) / Number(v.d) || 1));
  if (!isFinite(X)) X = 0;
  const ge = (k: number) => (k >= 0 ? v.n >= v.d * 10n ** BigInt(k) : v.n * 10n ** BigInt(-k) >= v.d);
  while (ge(X + 1)) X++;
  while (!ge(X)) X--;
  let q = scaled(v, p - X);
  if (q >= 10n ** BigInt(p + 1)) {
    X++;
    q = scaled(v, p - X);
  }
  return { digits: q.toString(), exp: X };
}

function expStr(digits: string, exp: number, p: number, alt: boolean, upper: boolean): string {
  let s = digits[0];
  if (p > 0 || alt) s += '.';
  s += digits.slice(1);
  const ae = Math.abs(exp);
  s += (upper ? 'E' : 'e') + (exp < 0 ? '-' : '+') + (ae < 10 ? '0' + ae : String(ae));
  return s;
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let out = '';
  let ai = 0;
  let i = 0;
  while (i < fmt.length) {
    const ch = fmt[i++];
    if (ch !== '%') {
      out += ch;
      continue;
    }
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
    let canZero = true;

    const lower = conv.toLowerCase();
    if (conv === 's' || conv === 'c') {
      body = String(arg);
      if (conv === 's' && prec >= 0) body = body.slice(0, prec);
      canZero = false;
    } else if (conv === 'd' || conv === 'i') {
      const b = BigInt(arg as number | bigint);
      sign = b < 0n ? '-' : plus ? '+' : space ? ' ' : '';
      body = (b < 0n ? -b : b).toString();
      if (prec === 0 && b === 0n) body = '';
      if (prec >= 0) {
        body = body.padStart(prec, '0');
        canZero = false;
      }
    } else if (conv === 'x' || conv === 'X' || conv === 'o') {
      const b = BigInt(arg as number | bigint);
      body = b.toString(conv === 'o' ? 8 : 16);
      if (conv === 'X') body = body.toUpperCase();
      if (prec === 0 && b === 0n) body = '';
      if (prec >= 0) {
        body = body.padStart(prec, '0');
        canZero = false;
      }
      if (alt) {
        if (conv === 'o') {
          if (body[0] !== '0') body = '0' + body;
        } else if (b !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      }
    } else {
      const x = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      const neg = x < 0 || Object.is(x, -0);
      if (Number.isNaN(x)) {
        body = upper ? 'NAN' : 'nan';
        canZero = false;
      } else {
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        if (!isFinite(x)) {
          body = upper ? 'INF' : 'inf';
          canZero = false;
        } else {
          const v = toRat(x);
          const isZero = x === 0;
          const P = prec < 0 ? 6 : prec;
          const fixed = (p: number) => {
            const { int, frac } = fixedDigits(v, p);
            return int + (p > 0 || alt ? '.' : '') + frac;
          };
          const expo = (p: number) => {
            if (isZero) return expStr('0'.repeat(p + 1), 0, p, alt, upper);
            const r = expDigits(v, p);
            return expStr(r.digits, r.exp, p, alt, upper);
          };
          if (lower === 'f') body = fixed(P);
          else if (lower === 'e') body = expo(P);
          else {
            const Pg = P === 0 ? 1 : P;
            const X = isZero ? 0 : expDigits(v, Pg - 1).exp;
            if (Pg > X && X >= -4) body = fixed(Pg - 1 - X);
            else body = expo(Pg - 1);
            if (!alt) {
              if (body.includes('e') || body.includes('E')) {
                const k = body.search(/[eE]/);
                let m = body.slice(0, k);
                if (m.includes('.')) m = m.replace(/0+$/, '').replace(/\.$/, '');
                body = m + body.slice(k);
              } else if (body.includes('.')) {
                body = body.replace(/0+$/, '').replace(/\.$/, '');
              }
            }
          }
        }
      }
    }

    const len = sign.length + prefix.length + body.length;
    if (len >= width) out += sign + prefix + body;
    else if (minus) out += sign + prefix + body + ' '.repeat(width - len);
    else if (zero && canZero) out += sign + prefix + '0'.repeat(width - len) + body;
    else out += ' '.repeat(width - len) + sign + prefix + body;
  }
  return out;
}
