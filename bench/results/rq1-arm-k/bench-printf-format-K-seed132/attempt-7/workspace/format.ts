function decompose(x: number): { m: bigint; e: number } {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (expBits === 0) return { m, e: -1074 };
  m |= 1n << 52n;
  return { m, e: expBits - 1075 };
}

// round-half-even(|x| * 10^k) as a BigInt
function scaled(m: bigint, e: number, k: number): bigint {
  let num = m;
  let den = 1n;
  if (e >= 0) num <<= BigInt(e);
  else den <<= BigInt(-e);
  if (k >= 0) num *= 10n ** BigInt(k);
  else den *= 10n ** BigInt(-k);
  const q = num / den;
  const r = num % den;
  const twice = r * 2n;
  if (twice > den || (twice === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// digits (p+1 of them) and decimal exponent of |x| in e style
function eDigits(x: number, p: number): { ds: string; exp: number } {
  const { m, e } = decompose(Math.abs(x));
  if (m === 0n) return { ds: '0'.repeat(p + 1), exp: 0 };
  let E = Math.floor(Math.log10(Math.abs(x)));
  if (!isFinite(E)) E = -324;
  const lo = 10n ** BigInt(p);
  const hi = lo * 10n;
  for (;;) {
    const d = scaled(m, e, p - E);
    if (d >= hi) E++;
    else if (d < lo) E--;
    else return { ds: d.toString(), exp: E };
  }
}

function fixed(x: number, p: number, alt: boolean): string {
  const { m, e } = decompose(Math.abs(x));
  let s = scaled(m, e, p).toString();
  if (s.length <= p) s = '0'.repeat(p + 1 - s.length) + s;
  const ip = s.slice(0, s.length - p);
  const fp = s.slice(s.length - p);
  return ip + (p > 0 || alt ? '.' : '') + fp;
}

function expo(ds: string, exp: number, p: number, alt: boolean, upper: boolean): string {
  const a = Math.abs(exp);
  return (
    ds[0] +
    (p > 0 || alt ? '.' : '') +
    ds.slice(1) +
    (upper ? 'E' : 'e') +
    (exp < 0 ? '-' : '+') +
    (a < 10 ? '0' : '') +
    a
  );
}

function stripZeros(s: string): string {
  // s has the form I[.F] possibly followed by an exponent part
  const ei = s.search(/[eE]/);
  const mant = ei < 0 ? s : s.slice(0, ei);
  const tail = ei < 0 ? '' : s.slice(ei);
  if (!mant.includes('.')) return s;
  return mant.replace(/0+$/, '').replace(/\.$/, '') + tail;
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
    while (fmt[i] >= '0' && fmt[i] <= '9') width = width * 10 + (fmt.charCodeAt(i++) - 48);
    let prec: number | undefined;
    if (fmt[i] === '.') {
      i++;
      prec = 0;
      while (fmt[i] >= '0' && fmt[i] <= '9') prec = prec * 10 + (fmt.charCodeAt(i++) - 48);
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
      const v = BigInt(arg as number | bigint);
      const neg = v < 0n;
      const mag = neg ? -v : v;
      let digits: string;
      if (conv === 'd' || conv === 'i') digits = mag.toString(10);
      else if (conv === 'o') digits = mag.toString(8);
      else digits = mag.toString(16);
      if (conv === 'X') digits = digits.toUpperCase();
      if (prec !== undefined) {
        if (prec === 0 && mag === 0n) digits = '';
        if (digits.length < prec) digits = '0'.repeat(prec - digits.length) + digits;
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
      const isNaNv = Number.isNaN(x);
      const negBit = !isNaNv && (x < 0 || Object.is(x, -0));
      sign = negBit ? '-' : isNaNv ? '' : plus ? '+' : space ? ' ' : '';
      if (isNaNv || !isFinite(x)) {
        body = isNaNv ? 'nan' : 'inf';
        if (upper) body = body.toUpperCase();
      } else {
        canZero = true;
        const lc = conv.toLowerCase();
        if (lc === 'f') {
          body = fixed(x, prec ?? 6, alt);
        } else if (lc === 'e') {
          const p = prec ?? 6;
          const { ds, exp } = eDigits(x, p);
          body = expo(ds, exp, p, alt, upper);
        } else {
          const P = prec === undefined ? 6 : prec === 0 ? 1 : prec;
          const { ds, exp } = eDigits(x, P - 1);
          if (P > exp && exp >= -4) body = fixed(x, P - 1 - exp, alt);
          else body = expo(ds, exp, P - 1, alt, upper);
          if (!alt) body = stripZeros(body);
        }
      }
      if (isNaNv || !isFinite(x)) canZero = false;
    }

    const len = sign.length + prefix.length + body.length;
    if (len >= width) out += sign + prefix + body;
    else if (minus) out += sign + prefix + body + ' '.repeat(width - len);
    else if (zero && canZero) out += sign + prefix + '0'.repeat(width - len) + body;
    else out += ' '.repeat(width - len) + sign + prefix + body;
  }
  return out;
}
