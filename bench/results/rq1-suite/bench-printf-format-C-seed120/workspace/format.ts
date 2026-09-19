// round(|v| * 10^k) half-to-even, exactly, for finite v >= 0
function scaledRound(v: number, k: number): bigint {
  if (v === 0) return 0n;
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, v);
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

// digits and exponent in e-style with `prec` digits after the point
function expParts(v: number, prec: number): { digits: string; exp: number } {
  if (v === 0) return { digits: '0'.repeat(prec + 1), exp: 0 };
  const P = prec + 1;
  let E = Math.floor(Math.log10(v));
  if (!isFinite(E)) E = -324;
  for (;;) {
    const s = scaledRound(v, P - 1 - E);
    const str = s.toString();
    if (str.length > P) E++;
    else if (str.length < P) E--;
    else return { digits: str, exp: E };
  }
}

function fixedStr(v: number, prec: number, alt: boolean): string {
  let s = scaledRound(v, prec).toString();
  if (prec > 0) {
    s = s.padStart(prec + 1, '0');
    return s.slice(0, s.length - prec) + '.' + s.slice(s.length - prec);
  }
  return alt ? s + '.' : s;
}

function expStr(v: number, prec: number, alt: boolean, upper: boolean): string {
  const { digits, exp } = expParts(v, prec);
  let s = digits[0];
  if (prec > 0) s += '.' + digits.slice(1);
  else if (alt) s += '.';
  const ae = Math.abs(exp);
  s += (upper ? 'E' : 'e') + (exp < 0 ? '-' : '+') + (ae < 10 ? '0' + ae : String(ae));
  return s;
}

function stripZeros(s: string): string {
  if (!s.includes('.')) return s;
  return s.replace(/0+$/, '').replace(/\.$/, '');
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let out = '';
  let ai = 0;
  let i = 0;
  const n = fmt.length;
  while (i < n) {
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
    let numeric = true;
    let zeroOk = zero && !minus;

    if (conv === 's' || conv === 'c') {
      numeric = false;
      body = String(arg);
      if (conv === 's' && prec >= 0) body = body.slice(0, prec);
    } else if (conv === 'd' || conv === 'i') {
      const b = BigInt(arg as number | bigint);
      sign = b < 0n ? '-' : plus ? '+' : space ? ' ' : '';
      body = (b < 0n ? -b : b).toString();
      if (prec >= 0) {
        if (prec === 0 && b === 0n) body = '';
        body = body.padStart(prec, '0');
        zeroOk = false;
      }
    } else if (conv === 'x' || conv === 'X' || conv === 'o') {
      const b = BigInt(arg as number | bigint);
      body = b.toString(conv === 'o' ? 8 : 16);
      if (conv === 'X') body = body.toUpperCase();
      if (prec >= 0) {
        if (prec === 0 && b === 0n) body = '';
        body = body.padStart(prec, '0');
        zeroOk = false;
      }
      if (alt) {
        if (conv === 'o') {
          if (body[0] !== '0') body = '0' + body;
        } else if (b !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      }
    } else {
      const v = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      const neg = v < 0 || Object.is(v, -0);
      sign = Number.isNaN(v) ? '' : neg ? '-' : plus ? '+' : space ? ' ' : '';
      if (!isFinite(v)) {
        body = Number.isNaN(v) ? 'nan' : 'inf';
        if (upper) body = body.toUpperCase();
        zeroOk = false;
      } else {
        const a = Math.abs(v);
        const lc = conv.toLowerCase();
        const p = prec < 0 ? 6 : prec;
        if (lc === 'f') body = fixedStr(a, p, alt);
        else if (lc === 'e') body = expStr(a, p, alt, upper);
        else {
          const P = p === 0 ? 1 : p;
          const X = expParts(a, P - 1).exp;
          if (P > X && X >= -4) {
            body = fixedStr(a, P - 1 - X, alt);
            if (!alt) body = stripZeros(body);
          } else {
            body = expStr(a, P - 1, alt, upper);
            if (!alt) {
              const ei = body.search(/[eE]/);
              body = stripZeros(body.slice(0, ei)) + body.slice(ei);
            }
          }
        }
      }
    }

    const len = sign.length + prefix.length + body.length;
    if (len >= width) out += sign + prefix + body;
    else if (minus) out += sign + prefix + body + ' '.repeat(width - len);
    else if (numeric && zeroOk) out += sign + prefix + '0'.repeat(width - len) + body;
    else out += ' '.repeat(width - len) + sign + prefix + body;
  }
  return out;
}
