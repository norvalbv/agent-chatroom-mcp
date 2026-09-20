function roundDiv(n: bigint, d: bigint): bigint {
  const q = n / d;
  const r = n % d;
  const c = 2n * r;
  if (c > d || (c === d && (q & 1n) === 1n)) return q + 1n;
  return q;
}

function ratio(x: number): [bigint, bigint] {
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, x);
  const hi = buf.getUint32(0);
  const lo = buf.getUint32(4);
  const be = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let e: number;
  if (be === 0) e = -1074;
  else {
    m |= 1n << 52n;
    e = be - 1075;
  }
  return e >= 0 ? [m << BigInt(e), 1n] : [m, 1n << BigInt(-e)];
}

const p10 = (k: number) => 10n ** BigInt(k);

// round(x * 10^k) half-even
function scaled(r: [bigint, bigint], k: number): bigint {
  return k >= 0 ? roundDiv(r[0] * p10(k), r[1]) : roundDiv(r[0], r[1] * p10(-k));
}

function fixed(x: number, p: number, alt: boolean): string {
  const s = scaled(ratio(x), p).toString().padStart(p + 1, '0');
  const ip = s.slice(0, s.length - p);
  return p > 0 ? ip + '.' + s.slice(s.length - p) : ip + (alt ? '.' : '');
}

// returns digits (p+1 of them) and exponent
function expo(x: number, p: number): [string, number] {
  if (x === 0) return ['0'.repeat(p + 1), 0];
  const r = ratio(x);
  let X = Math.floor(Math.log10(x));
  if (!isFinite(X)) X = -324;
  const ge = (k: number) => (k >= 0 ? r[0] >= p10(k) * r[1] : r[0] * p10(-k) >= r[1]);
  while (ge(X + 1)) X++;
  while (!ge(X)) X--;
  let d = scaled(r, p - X);
  if (d >= p10(p + 1)) {
    X++;
    d = scaled(r, p - X);
  }
  return [d.toString(), X];
}

function expStr(digits: string, X: number, alt: boolean, upper: boolean): string {
  const m = digits.length > 1 ? digits[0] + '.' + digits.slice(1) : digits + (alt ? '.' : '');
  const a = Math.abs(X);
  return m + (upper ? 'E' : 'e') + (X < 0 ? '-' : '+') + (a < 10 ? '0' : '') + a;
}

function stripZeros(s: string): string {
  const ei = s.search(/[eE]/);
  let mant = ei >= 0 ? s.slice(0, ei) : s;
  const rest = ei >= 0 ? s.slice(ei) : '';
  if (mant.includes('.')) mant = mant.replace(/0+$/, '').replace(/\.$/, '');
  return mant + rest;
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
    const lc = conv.toLowerCase();
    if (conv === 's') {
      body = String(arg);
      if (prec >= 0) body = body.slice(0, prec);
      canZero = false;
    } else if (conv === 'c') {
      body = String(arg);
      canZero = false;
    } else if (conv === 'd' || conv === 'i' || lc === 'x' || conv === 'o') {
      let v = BigInt(arg as number | bigint);
      if (v < 0n) {
        sign = '-';
        v = -v;
      } else sign = plus && (conv === 'd' || conv === 'i') ? '+' : space && (conv === 'd' || conv === 'i') ? ' ' : '';
      let digits = v.toString(conv === 'o' ? 8 : lc === 'x' ? 16 : 10);
      if (conv === 'X') digits = digits.toUpperCase();
      if (prec === 0 && v === 0n) digits = '';
      if (prec > digits.length) digits = digits.padStart(prec, '0');
      if (alt) {
        if (conv === 'o') {
          if (digits[0] !== '0') digits = '0' + digits;
        } else if (lc === 'x' && v !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      }
      body = digits;
      if (prec >= 0) canZero = false;
    } else {
      const x = arg as number;
      const upper = conv === conv.toUpperCase();
      const neg = x < 0 || Object.is(x, -0);
      if (!Number.isNaN(x)) sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
      const a = Math.abs(x);
      if (Number.isNaN(x) || a === Infinity) {
        body = Number.isNaN(x) ? 'nan' : 'inf';
        if (upper) body = body.toUpperCase();
        canZero = false;
      } else if (lc === 'f') {
        body = fixed(a, prec < 0 ? 6 : prec, alt);
      } else if (lc === 'e') {
        const p = prec < 0 ? 6 : prec;
        const [d, X] = expo(a, p);
        body = expStr(d, X, alt, upper);
      } else {
        const P = prec < 0 ? 6 : prec === 0 ? 1 : prec;
        const [d, X] = expo(a, P - 1);
        if (P > X && X >= -4) {
          body = fixed(a, P - 1 - X, alt);
        } else {
          body = expStr(d, X, alt, upper);
        }
        if (!alt) body = stripZeros(body);
      }
    }
    const len = sign.length + prefix.length + body.length;
    if (len < width) {
      const pad = width - len;
      if (minus) body = sign + prefix + body + ' '.repeat(pad);
      else if (zero && canZero) body = sign + prefix + '0'.repeat(pad) + body;
      else body = ' '.repeat(pad) + sign + prefix + body;
    } else body = sign + prefix + body;
    out += body;
  }
  return out;
}
