// round(|x| * 10^k) to nearest, ties to even, using the exact binary value.
function roundScaled(x: number, k: number): bigint {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const be = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let e: number;
  if (be === 0) {
    e = -1074;
  } else {
    m |= 1n << 52n;
    e = be - 1075;
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

// digits (P of them) and decimal exponent of |x| rounded to P significant digits
function sig(x: number, P: number): { d: string; X: number } {
  if (x === 0) return { d: '0'.repeat(P), X: 0 };
  let X = Math.floor(Math.log10(x));
  const lo = 10n ** BigInt(P - 1);
  const hi = lo * 10n;
  for (;;) {
    const q = roundScaled(x, P - 1 - X);
    if (q >= hi) X++;
    else if (q < lo) X--;
    else return { d: q.toString(), X };
  }
}

function fixed(x: number, prec: number, alt: boolean): string {
  let s = roundScaled(x, prec).toString();
  if (s.length < prec + 1) s = '0'.repeat(prec + 1 - s.length) + s;
  const ip = s.slice(0, s.length - prec);
  const fp = s.slice(s.length - prec);
  return ip + (prec > 0 || alt ? '.' : '') + fp;
}

function expo(x: number, prec: number, alt: boolean, upper: boolean): string {
  const { d, X } = sig(x, prec + 1);
  const ax = Math.abs(X);
  return (
    d[0] + (prec > 0 || alt ? '.' : '') + d.slice(1) +
    (upper ? 'E' : 'e') + (X < 0 ? '-' : '+') + (ax < 10 ? '0' : '') + ax
  );
}

function stripZeros(s: string): string {
  if (!s.includes('.')) return s;
  return s.replace(/0+$/, '').replace(/\.$/, '');
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
    while (fmt[i] >= '0' && fmt[i] <= '9') width = width * 10 + (fmt.charCodeAt(i++) - 48);
    let prec = -1;
    if (fmt[i] === '.') {
      i++;
      prec = 0;
      while (fmt[i] >= '0' && fmt[i] <= '9') prec = prec * 10 + (fmt.charCodeAt(i++) - 48);
    }
    const conv = fmt[i++];
    const arg = args[ai++];
    let prefix = '';
    let body = '';
    let canZero = true;
    const lower = conv.toLowerCase();

    if (conv === 's' || conv === 'c') {
      body = String(arg);
      if (conv === 's' && prec >= 0) body = body.slice(0, prec);
      canZero = false;
    } else if (conv === 'd' || conv === 'i') {
      const v = BigInt(arg as number | bigint);
      const neg = v < 0n;
      body = (neg ? -v : v).toString();
      if (prec === 0 && v === 0n) body = '';
      if (prec > body.length) body = '0'.repeat(prec - body.length) + body;
      prefix = neg ? '-' : plus ? '+' : space ? ' ' : '';
      if (prec >= 0) canZero = false;
    } else if (lower === 'x' || conv === 'o') {
      const v = BigInt(arg as number | bigint);
      body = v.toString(conv === 'o' ? 8 : 16);
      if (conv === 'X') body = body.toUpperCase();
      if (prec === 0 && v === 0n) body = '';
      if (prec > body.length) body = '0'.repeat(prec - body.length) + body;
      if (alt) {
        if (conv === 'o') {
          if (body === '' || body[0] !== '0') body = '0' + body;
        } else if (v !== 0n) prefix = conv;
        if (conv !== 'o' && v !== 0n) prefix = '0' + conv;
      }
      if (prec >= 0) canZero = false;
    } else {
      const v = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      if (Number.isNaN(v)) {
        body = upper ? 'NAN' : 'nan';
        canZero = false;
      } else {
        const neg = v < 0 || Object.is(v, -0);
        prefix = neg ? '-' : plus ? '+' : space ? ' ' : '';
        const x = Math.abs(v);
        if (x === Infinity) {
          body = upper ? 'INF' : 'inf';
          canZero = false;
        } else if (lower === 'f') {
          body = fixed(x, prec < 0 ? 6 : prec, alt);
        } else if (lower === 'e') {
          body = expo(x, prec < 0 ? 6 : prec, alt, upper);
        } else {
          const P = prec < 0 ? 6 : prec === 0 ? 1 : prec;
          const { X } = sig(x, P);
          if (P > X && X >= -4) {
            body = fixed(x, P - 1 - X, alt);
            if (!alt) body = stripZeros(body);
          } else {
            body = expo(x, P - 1, alt, upper);
            if (!alt) {
              const k = body.search(/[eE]/);
              body = stripZeros(body.slice(0, k)) + body.slice(k);
            }
          }
        }
      }
    }

    const len = prefix.length + body.length;
    if (len < width) {
      const pad = width - len;
      if (minus) body = prefix + body + ' '.repeat(pad);
      else if (zero && canZero) body = prefix + '0'.repeat(pad) + body;
      else body = ' '.repeat(pad) + prefix + body;
    } else body = prefix + body;
    out += body;
  }
  return out;
}
