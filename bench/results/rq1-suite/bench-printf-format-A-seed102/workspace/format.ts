function roundDiv(num: bigint, den: bigint): bigint {
  const q = num / den;
  const r2 = (num % den) * 2n;
  if (r2 > den || (r2 === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// abs value of finite double as [num, den]
function ratio(v: number): [bigint, bigint] {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, v);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const be = (hi >>> 20) & 0x7ff;
  let mant = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let e: number;
  if (be === 0) e = -1074;
  else {
    mant |= 1n << 52n;
    e = be - 1075;
  }
  return e >= 0 ? [mant << BigInt(e), 1n] : [mant, 1n << BigInt(-e)];
}

function scaled(v: number, k: number): bigint {
  // round(v * 10^k)
  let [n, d] = ratio(v);
  if (k >= 0) n *= 10n ** BigInt(k);
  else d *= 10n ** BigInt(-k);
  return roundDiv(n, d);
}

function fixed(v: number, p: number, alt: boolean): string {
  let s = scaled(v, p).toString();
  if (p > 0) {
    s = s.padStart(p + 1, '0');
    return s.slice(0, s.length - p) + '.' + s.slice(s.length - p);
  }
  return alt ? s + '.' : s;
}

// returns digit string (p+1 digits) and exponent
function sci(v: number, p: number): [string, number] {
  if (v === 0) return ['0'.repeat(p + 1), 0];
  let E = Math.floor(Math.log10(v));
  if (!isFinite(E)) E = 0;
  for (;;) {
    const d = scaled(v, p - E);
    const s = d.toString();
    if (s.length > p + 1) E++;
    else if (s.length < p + 1) E--;
    else return [s, E];
  }
}

function expStr(digits: string, E: number, alt: boolean, upper: boolean): string {
  let m = digits[0];
  if (digits.length > 1) m += '.' + digits.slice(1);
  else if (alt) m += '.';
  const a = Math.abs(E);
  return m + (upper ? 'E' : 'e') + (E < 0 ? '-' : '+') + (a < 10 ? '0' + a : String(a));
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
    const lc = conv.toLowerCase();
    if (conv === 's') {
      body = String(arg);
      if (prec >= 0) body = body.slice(0, prec);
      canZero = false;
    } else if (conv === 'c') {
      body = String(arg);
      canZero = false;
    } else if (conv === 'd' || conv === 'i') {
      const v = BigInt(arg as number | bigint);
      const neg = v < 0n;
      body = (neg ? -v : v).toString();
      if (prec >= 0) {
        if (prec === 0 && v === 0n) body = '';
        body = body.padStart(prec, '0');
        canZero = false;
      }
      sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
    } else if (conv === 'x' || conv === 'X' || conv === 'o') {
      const v = BigInt(arg as number | bigint);
      body = v.toString(conv === 'o' ? 8 : 16);
      if (conv === 'X') body = body.toUpperCase();
      if (prec >= 0) {
        if (prec === 0 && v === 0n) body = '';
        body = body.padStart(prec, '0');
        canZero = false;
      }
      if (alt) {
        if (conv === 'o') {
          if (body[0] !== '0') body = '0' + body;
        } else if (v !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      }
    } else {
      const v = arg as number;
      const upper = conv === lc.toUpperCase() && conv !== lc;
      const nan = Number.isNaN(v);
      const neg = !nan && (v < 0 || Object.is(v, -0));
      sign = nan ? '' : neg ? '-' : plus ? '+' : space ? ' ' : '';
      const a = Math.abs(v);
      if (nan || !isFinite(v)) {
        body = nan ? 'nan' : 'inf';
        if (upper) body = body.toUpperCase();
        canZero = false;
      } else if (lc === 'f') {
        body = fixed(a, prec < 0 ? 6 : prec, alt);
      } else if (lc === 'e') {
        const p = prec < 0 ? 6 : prec;
        const [d, E] = sci(a, p);
        body = expStr(d, E, alt, upper);
      } else {
        let P = prec < 0 ? 6 : prec;
        if (P === 0) P = 1;
        const [d, X] = sci(a, P - 1);
        const strip = (s: string) =>
          alt || !s.includes('.') ? s : s.replace(/0+$/, '').replace(/\.$/, '');
        if (P > X && X >= -4) {
          body = strip(fixed(a, P - 1 - X, alt));
        } else {
          let m = d[0] + (d.length > 1 ? '.' + d.slice(1) : alt ? '.' : '');
          m = strip(m);
          const ae = Math.abs(X);
          body = m + (upper ? 'E' : 'e') + (X < 0 ? '-' : '+') + (ae < 10 ? '0' + ae : ae);
        }
      }
    }
    let text = sign + prefix + body;
    if (text.length < width) {
      const n = width - text.length;
      if (minus) text += ' '.repeat(n);
      else if (zero && canZero) text = sign + prefix + '0'.repeat(n) + body;
      else text = ' '.repeat(n) + text;
    }
    out += text;
  }
  return out;
}
