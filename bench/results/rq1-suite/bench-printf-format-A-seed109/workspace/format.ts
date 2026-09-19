// round-half-even of |x| * 10^k, exact
function scaled(x: number, k: number): bigint {
  if (x === 0) return 0n;
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, x);
  const hi = buf.getUint32(0);
  const lo = buf.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let e: number;
  if (expBits === 0) e = -1074;
  else {
    m |= 1n << 52n;
    e = expBits - 1075;
  }
  let num = m;
  let den = 1n;
  if (e >= 0) num <<= BigInt(e);
  else den <<= BigInt(-e);
  if (k >= 0) num *= 10n ** BigInt(k);
  else den *= 10n ** BigInt(-k);
  let q = num / den;
  const r2 = (num % den) * 2n;
  if (r2 > den || (r2 === den && (q & 1n) === 1n)) q += 1n;
  return q;
}

function fixed(x: number, prec: number, alt: boolean): string {
  let s = scaled(x, prec).toString();
  if (prec > 0) {
    s = s.padStart(prec + 1, '0');
    return s.slice(0, s.length - prec) + '.' + s.slice(s.length - prec);
  }
  return alt ? s + '.' : s;
}

// significant digits (prec+1 of them) and decimal exponent
function sci(x: number, prec: number): { digits: string; exp: number } {
  if (x === 0) return { digits: '0'.repeat(prec + 1), exp: 0 };
  let X = Math.floor(Math.log10(x));
  if (!isFinite(X)) X = -324;
  const lim = 10n ** BigInt(prec + 1);
  const low = 10n ** BigInt(prec);
  for (let i = 0; i < 20; i++) {
    const n = scaled(x, prec - X);
    if (n >= lim) X++;
    else if (n < low) X--;
    else return { digits: n.toString(), exp: X };
  }
  throw new Error('sci');
}

function expStr(exp: number, upper: boolean): string {
  const a = Math.abs(exp);
  return (upper ? 'E' : 'e') + (exp < 0 ? '-' : '+') + (a < 10 ? '0' + a : String(a));
}

function sciStr(x: number, prec: number, alt: boolean, upper: boolean, strip: boolean): string {
  const { digits, exp } = sci(x, prec);
  let frac = digits.slice(1);
  if (strip) frac = frac.replace(/0+$/, '');
  const dot = frac.length > 0 || alt ? '.' : '';
  return digits[0] + dot + frac + expStr(exp, upper);
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
    let canZero = zero && !minus;

    if (conv === 's' || conv === 'c') {
      body = String(arg);
      if (conv === 's' && prec >= 0) body = body.slice(0, prec);
      canZero = false;
    } else if (conv === 'd' || conv === 'i' || conv === 'x' || conv === 'X' || conv === 'o') {
      const v = typeof arg === 'bigint' ? arg : BigInt(arg as number);
      const neg = v < 0n;
      const mag = neg ? -v : v;
      if (conv === 'd' || conv === 'i') {
        body = mag.toString();
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
      } else if (conv === 'o') body = mag.toString(8);
      else {
        body = mag.toString(16);
        if (conv === 'X') body = body.toUpperCase();
      }
      if (prec >= 0) {
        if (prec === 0 && mag === 0n) body = '';
        body = body.padStart(prec, '0');
        canZero = false;
      }
      if (conv === 'o' && alt && body[0] !== '0') body = '0' + body;
      if ((conv === 'x' || conv === 'X') && alt && mag !== 0n) prefix = conv === 'x' ? '0x' : '0X';
    } else {
      const x = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      const neg = !Number.isNaN(x) && (x < 0 || Object.is(x, -0));
      sign = Number.isNaN(x) ? '' : neg ? '-' : plus ? '+' : space ? ' ' : '';
      if (!Number.isFinite(x)) {
        body = Number.isNaN(x) ? 'nan' : 'inf';
        if (upper) body = body.toUpperCase();
        canZero = false;
      } else {
        const a = Math.abs(x);
        const lc = conv.toLowerCase();
        if (lc === 'f') body = fixed(a, prec < 0 ? 6 : prec, alt);
        else if (lc === 'e') body = sciStr(a, prec < 0 ? 6 : prec, alt, upper, false);
        else {
          let P = prec < 0 ? 6 : prec;
          if (P === 0) P = 1;
          const X = sci(a, P - 1).exp;
          if (P > X && X >= -4) {
            body = fixed(a, P - 1 - X, alt);
            if (!alt && body.includes('.')) body = body.replace(/0+$/, '').replace(/\.$/, '');
          } else body = sciStr(a, P - 1, alt, upper, !alt);
        }
      }
    }

    const len = sign.length + prefix.length + body.length;
    if (len < width) {
      const pad = width - len;
      if (minus) body = body + ' '.repeat(pad);
      else if (canZero) body = '0'.repeat(pad) + body;
      else sign = ' '.repeat(pad) + sign;
    }
    out += sign + prefix + body;
  }
  return out;
}
