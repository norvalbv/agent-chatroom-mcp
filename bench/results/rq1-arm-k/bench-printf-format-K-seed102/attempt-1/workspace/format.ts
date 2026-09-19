function decompose(v: number): [bigint, number] {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, v);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const be = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (be === 0) return [m, -1074];
  m |= 1n << 52n;
  return [m, be - 1075];
}

// round(m * 2^e * 10^k), ties to even
function scaled(m: bigint, e: number, k: number): bigint {
  let num = m;
  let den = 1n;
  if (e >= 0) num <<= BigInt(e);
  else den <<= BigInt(-e);
  if (k >= 0) num *= 10n ** BigInt(k);
  else den *= 10n ** BigInt(-k);
  const q = num / den;
  const r = num - q * den;
  const twice = r * 2n;
  if (twice > den || (twice === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// v > 0: digits (p+1 of them) and decimal exponent
function eDigits(v: number, p: number): [string, number] {
  const [m, e] = decompose(v);
  let x = Math.floor(Math.log10(v));
  if (!isFinite(x)) x = -324;
  const lo = 10n ** BigInt(p);
  for (;;) {
    const n = scaled(m, e, p - x);
    if (n >= lo * 10n) x++;
    else if (n < lo) x--;
    else return [n.toString(), x];
  }
}

function fmtE(v: number, p: number, upper: boolean, alt: boolean, strip = false): string {
  let digits: string;
  let x: number;
  if (v === 0) {
    digits = '0'.repeat(p + 1);
    x = 0;
  } else [digits, x] = eDigits(v, p);
  let frac = digits.slice(1);
  if (strip) frac = frac.replace(/0+$/, '');
  let s = digits[0] + (frac.length > 0 || alt ? '.' + frac : '');
  const ax = Math.abs(x);
  s += (upper ? 'E' : 'e') + (x < 0 ? '-' : '+') + (ax < 10 ? '0' : '') + ax;
  return s;
}

function fmtF(v: number, p: number, alt: boolean, strip = false): string {
  let n: bigint;
  if (v === 0) n = 0n;
  else {
    const [m, e] = decompose(v);
    n = scaled(m, e, p);
  }
  let d = n.toString();
  if (d.length < p + 1) d = '0'.repeat(p + 1 - d.length) + d;
  const ip = d.slice(0, d.length - p);
  let frac = d.slice(d.length - p);
  if (strip) frac = frac.replace(/0+$/, '');
  return ip + (frac.length > 0 || alt ? '.' + frac : '');
}

function fmtG(v: number, prec: number | null, upper: boolean, alt: boolean): string {
  let P = prec === null ? 6 : prec;
  if (P === 0) P = 1;
  let x = 0;
  if (v !== 0) x = eDigits(v, P - 1)[1];
  if (P > x && x >= -4) return fmtF(v, P - 1 - x, alt, !alt);
  return fmtE(v, P - 1, upper, alt, !alt);
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
    let prec: number | null = null;
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
    if (conv === 'd' || conv === 'i') {
      const b = BigInt(arg as number | bigint);
      sign = b < 0n ? '-' : plus ? '+' : space ? ' ' : '';
      body = (b < 0n ? -b : b).toString();
      if (prec !== null) {
        if (prec === 0 && b === 0n) body = '';
        else if (body.length < prec) body = '0'.repeat(prec - body.length) + body;
      }
      canZero = prec === null;
    } else if (lc === 'x' || conv === 'o') {
      const b = BigInt(arg as number | bigint);
      body = b.toString(conv === 'o' ? 8 : 16);
      if (conv === 'X') body = body.toUpperCase();
      if (prec !== null) {
        if (prec === 0 && b === 0n) body = '';
        else if (body.length < prec) body = '0'.repeat(prec - body.length) + body;
      }
      if (alt) {
        if (conv === 'o') {
          if (body[0] !== '0') body = '0' + body;
        } else if (b !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      }
      canZero = prec === null;
    } else if ('eEfFgG'.includes(conv)) {
      const v = arg as number;
      const upper = conv === conv.toUpperCase();
      const neg = v < 0 || Object.is(v, -0);
      if (Number.isNaN(v)) {
        body = upper ? 'NAN' : 'nan';
      } else {
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        const a = Math.abs(v);
        if (a === Infinity) body = upper ? 'INF' : 'inf';
        else {
          canZero = true;
          if (lc === 'e') body = fmtE(a, prec === null ? 6 : prec, upper, alt);
          else if (lc === 'f') body = fmtF(a, prec === null ? 6 : prec, alt);
          else body = fmtG(a, prec, upper, alt);
        }
      }
    } else if (conv === 's') {
      body = String(arg);
      if (prec !== null) body = body.slice(0, prec);
    } else {
      body = String(arg);
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
