function ratio(x: number): [bigint, bigint] {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
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

function divRound(n: bigint, d: bigint): bigint {
  let q = n / d;
  const r2 = (n % d) * 2n;
  if (r2 > d || (r2 === d && (q & 1n) === 1n)) q += 1n;
  return q;
}

// round(x * 10^k), x = [n, d]
function scaled(x: [bigint, bigint], k: number): bigint {
  const p = 10n ** BigInt(Math.abs(k));
  return k >= 0 ? divRound(x[0] * p, x[1]) : divRound(x[0], x[1] * p);
}

function fixed(x: number, prec: number, alt: boolean): string {
  let s = scaled(ratio(x), prec).toString();
  if (prec > 0) {
    s = s.padStart(prec + 1, '0');
    return s.slice(0, s.length - prec) + '.' + s.slice(s.length - prec);
  }
  return alt ? s + '.' : s;
}

function expo(x: number, prec: number, alt: boolean, upper: boolean): { s: string; X: number } {
  const r = ratio(x);
  let X = 0;
  let digits = 0n;
  if (x !== 0) {
    X = Math.floor(Math.log10(x));
    if (!isFinite(X)) X = -324;
    const ge = (k: number) => {
      // x >= 10^k ?
      return k >= 0 ? r[0] >= 10n ** BigInt(k) * r[1] : r[0] * 10n ** BigInt(-k) >= r[1];
    };
    while (!ge(X)) X--;
    while (ge(X + 1)) X++;
    digits = scaled(r, prec - X);
    if (digits >= 10n ** BigInt(prec + 1)) {
      X++;
      digits = scaled(r, prec - X);
    }
  }
  const ds = digits.toString().padStart(prec + 1, '0');
  let s = ds[0] + (prec > 0 ? '.' + ds.slice(1) : alt ? '.' : '');
  const ax = Math.abs(X);
  s += (upper ? 'E' : 'e') + (X < 0 ? '-' : '+') + (ax < 10 ? '0' : '') + ax;
  return { s, X };
}

function stripZeros(s: string): string {
  const ei = s.search(/[eE]/);
  let mant = ei >= 0 ? s.slice(0, ei) : s;
  const tail = ei >= 0 ? s.slice(ei) : '';
  if (mant.includes('.')) mant = mant.replace(/0+$/, '').replace(/\.$/, '');
  return mant + tail;
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
    let prec = -1;
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
    const lc = conv.toLowerCase();
    if (conv === 's' || conv === 'c') {
      body = String(arg);
      if (conv === 's' && prec >= 0) body = body.slice(0, prec);
    } else if (conv === 'd' || conv === 'i' || lc === 'x' || conv === 'o') {
      const v = BigInt(arg as number | bigint);
      const neg = v < 0n;
      const mag = neg ? -v : v;
      body = conv === 'd' || conv === 'i' ? mag.toString() : conv === 'o' ? mag.toString(8) : mag.toString(16);
      if (conv === 'X') body = body.toUpperCase();
      if (prec >= 0) {
        if (prec === 0 && mag === 0n) body = '';
        body = body.padStart(prec, '0');
      }
      if (conv === 'd' || conv === 'i') sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
      else if (conv === 'o') {
        if (alt && body[0] !== '0') body = '0' + body;
      } else if (alt && mag !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      canZero = prec < 0;
    } else {
      const x = arg as number;
      const upper = conv === conv.toUpperCase();
      const neg = x < 0 || Object.is(x, -0);
      if (Number.isNaN(x)) {
        body = upper ? 'NAN' : 'nan';
      } else {
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        const ax = Math.abs(x);
        if (ax === Infinity) body = upper ? 'INF' : 'inf';
        else {
          canZero = true;
          if (lc === 'f') body = fixed(ax, prec < 0 ? 6 : prec, alt);
          else if (lc === 'e') body = expo(ax, prec < 0 ? 6 : prec, alt, upper).s;
          else {
            const P = prec < 0 ? 6 : prec === 0 ? 1 : prec;
            const X = expo(ax, P - 1, alt, upper).X;
            body = P > X && X >= -4 ? fixed(ax, P - 1 - X, alt) : expo(ax, P - 1, alt, upper).s;
            if (!alt) body = stripZeros(body);
          }
        }
      }
    }
    const len = sign.length + prefix.length + body.length;
    if (len < width) {
      if (minus) body = body + ' '.repeat(width - len);
      else if (zero && canZero) body = '0'.repeat(width - len) + body;
      else sign = ' '.repeat(width - len) + sign;
    }
    out += sign + prefix + body;
  }
  return out;
}
