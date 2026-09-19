function decompose(v: number): { m: bigint; e: number } {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, Math.abs(v));
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const be = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (be === 0) return { m, e: -1074 };
  m |= 1n << 52n;
  return { m, e: be - 1075 };
}

// round-half-even of |v| * 10^p, exactly
function scaled(d: { m: bigint; e: number }, p: number): bigint {
  let num = d.m;
  let den = 1n;
  if (d.e >= 0) num <<= BigInt(d.e);
  else den <<= BigInt(-d.e);
  if (p >= 0) num *= 10n ** BigInt(p);
  else den *= 10n ** BigInt(-p);
  const q = num / den;
  const r = num % den;
  const twice = r * 2n;
  if (twice > den || (twice === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

function fixedStr(d: { m: bigint; e: number }, p: number, alt: boolean): string {
  let s = scaled(d, p).toString();
  if (s.length < p + 1) s = '0'.repeat(p + 1 - s.length) + s;
  const ip = s.slice(0, s.length - p);
  const fp = s.slice(s.length - p);
  return p > 0 ? ip + '.' + fp : alt ? ip + '.' : ip;
}

// digits (P of them) and decimal exponent
function expDigits(v: number, d: { m: bigint; e: number }, P: number): { digits: string; x: number } {
  if (d.m === 0n) return { digits: '0'.repeat(P), x: 0 };
  let x = Math.floor(Math.log10(Math.abs(v)));
  const lowB = 10n ** BigInt(P - 1);
  const highB = 10n ** BigInt(P);
  for (let i = 0; i < 20; i++) {
    const n = scaled(d, P - 1 - x);
    if (n >= highB) x++;
    else if (n < lowB) x--;
    else return { digits: n.toString(), x };
  }
  throw new Error('exp');
}

function expStr(v: number, d: { m: bigint; e: number }, p: number, alt: boolean, upper: boolean, strip: boolean): string {
  const { digits, x } = expDigits(v, d, p + 1);
  let frac = digits.slice(1);
  if (strip) frac = frac.replace(/0+$/, '');
  let s = digits[0];
  if (frac.length > 0) s += '.' + frac;
  else if (alt) s += '.';
  const ax = Math.abs(x);
  s += (upper ? 'E' : 'e') + (x < 0 ? '-' : '+') + (ax < 10 ? '0' : '') + ax;
  return s;
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
    let left = false, plus = false, space = false, zero = false, alt = false;
    for (;; i++) {
      const f = fmt[i];
      if (f === '-') left = true;
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
    let canZero = false;

    if (conv === 's' || conv === 'c') {
      body = String(arg);
      if (conv === 's' && prec >= 0) body = body.slice(0, prec);
    } else if (conv === 'd' || conv === 'i' || conv === 'x' || conv === 'X' || conv === 'o') {
      const n = BigInt(arg as number | bigint);
      const neg = n < 0n;
      const mag = neg ? -n : n;
      if (conv === 'd' || conv === 'i') {
        body = mag.toString();
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
      } else if (conv === 'o') {
        body = mag.toString(8);
      } else {
        body = mag.toString(16);
        if (conv === 'X') body = body.toUpperCase();
      }
      if (prec === 0 && mag === 0n) body = '';
      if (prec > body.length) body = '0'.repeat(prec - body.length) + body;
      if (alt) {
        if (conv === 'o') {
          if (body[0] !== '0') body = '0' + body;
        } else if ((conv === 'x' || conv === 'X') && mag !== 0n) {
          prefix = conv === 'x' ? '0x' : '0X';
        }
      }
      canZero = prec < 0;
    } else {
      const v = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      const neg = Object.is(v, -0) || (v < 0);
      if (Number.isNaN(v)) {
        body = upper ? 'NAN' : 'nan';
      } else {
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        if (!Number.isFinite(v)) {
          body = upper ? 'INF' : 'inf';
        } else {
          canZero = true;
          const d = decompose(v);
          const p = prec < 0 ? 6 : prec;
          const lc = conv.toLowerCase();
          if (lc === 'f') body = fixedStr(d, p, alt);
          else if (lc === 'e') body = expStr(v, d, p, alt, upper, false);
          else {
            const P = p === 0 ? 1 : p;
            const { x } = expDigits(v, d, P);
            if (P > x && x >= -4) {
              body = fixedStr(d, P - 1 - x, alt);
              if (!alt && body.includes('.')) body = body.replace(/0+$/, '').replace(/\.$/, '');
            } else {
              body = expStr(v, d, P - 1, alt, upper, !alt);
            }
          }
          if (upper && lc === 'f') body = body.toUpperCase();
        }
        if (!Number.isFinite(v)) canZero = false;
      }
    }

    const len = sign.length + prefix.length + body.length;
    if (len < width) {
      const pad = width - len;
      if (left) body = sign + prefix + body + ' '.repeat(pad);
      else if (zero && canZero) body = sign + prefix + '0'.repeat(pad) + body;
      else body = ' '.repeat(pad) + sign + prefix + body;
    } else {
      body = sign + prefix + body;
    }
    out += body;
  }
  return out;
}
