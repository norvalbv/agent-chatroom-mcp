function decompose(x: number): { m: bigint; e: number } {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const exp = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (exp === 0) return { m, e: -1074 };
  m |= 1n << 52n;
  return { m, e: exp - 1075 };
}

// round-half-even of |x| * 10^k
function scaled(d: { m: bigint; e: number }, k: number): bigint {
  let num = d.m;
  let den = 1n;
  if (d.e >= 0) num <<= BigInt(d.e);
  else den <<= BigInt(-d.e);
  if (k >= 0) num *= 10n ** BigInt(k);
  else den *= 10n ** BigInt(-k);
  let q = num / den;
  const r = num - q * den;
  const twice = r * 2n;
  if (twice > den || (twice === den && (q & 1n) === 1n)) q += 1n;
  return q;
}

function fixedStr(d: { m: bigint; e: number }, p: number, alt: boolean): string {
  let s = scaled(d, p).toString();
  if (p > 0) {
    s = s.padStart(p + 1, '0');
    return s.slice(0, s.length - p) + '.' + s.slice(s.length - p);
  }
  return alt ? s + '.' : s;
}

function expParts(d: { m: bigint; e: number }, p: number): { digits: string; x: number } {
  if (d.m === 0n) return { digits: '0'.repeat(p + 1), x: 0 };
  let x = Math.floor(Math.log10(Number(d.m) * Math.pow(2, d.e)));
  if (!isFinite(x)) x = 0;
  for (;;) {
    const n = scaled(d, p - x);
    if (n < 10n ** BigInt(p)) x--;
    else if (n >= 10n ** BigInt(p + 1)) x++;
    else return { digits: n.toString(), x };
  }
}

function expStr(d: { m: bigint; e: number }, p: number, alt: boolean, upper: boolean): string {
  const { digits, x } = expParts(d, p);
  let s = digits[0];
  if (p > 0) s += '.' + digits.slice(1);
  else if (alt) s += '.';
  const ax = Math.abs(x);
  return s + (upper ? 'E' : 'e') + (x < 0 ? '-' : '+') + (ax < 10 ? '0' : '') + ax;
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
    let canZero = true;
    const lower = conv.toLowerCase();
    const upper = conv !== lower;

    if (conv === 'd' || conv === 'i') {
      const v = BigInt(arg as number | bigint);
      sign = v < 0n ? '-' : plus ? '+' : space ? ' ' : '';
      body = (v < 0n ? -v : v).toString();
      if (prec === 0 && v === 0n) body = '';
      if (prec >= 0) {
        body = body.padStart(prec, '0');
        canZero = false;
      }
    } else if (conv === 'x' || conv === 'X' || conv === 'o') {
      const v = BigInt(arg as number | bigint);
      body = v.toString(conv === 'o' ? 8 : 16);
      if (conv === 'X') body = body.toUpperCase();
      if (prec === 0 && v === 0n) body = '';
      if (prec >= 0) {
        body = body.padStart(prec, '0');
        canZero = false;
      }
      if (alt) {
        if (conv === 'o') {
          if (body[0] !== '0') body = '0' + body;
        } else if (v !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      }
    } else if ('efg'.includes(lower)) {
      const v = arg as number;
      const neg = v < 0 || Object.is(v, -0);
      if (Number.isNaN(v)) {
        body = 'nan';
        canZero = false;
      } else {
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        if (!isFinite(v)) {
          body = 'inf';
          canZero = false;
        } else {
          const d = decompose(Math.abs(v));
          if (lower === 'f') body = fixedStr(d, prec < 0 ? 6 : prec, alt);
          else if (lower === 'e') body = expStr(d, prec < 0 ? 6 : prec, alt, upper);
          else {
            const P = prec < 0 ? 6 : prec === 0 ? 1 : prec;
            const { x } = expParts(d, P - 1);
            if (P > x && x >= -4) body = fixedStr(d, P - 1 - x, alt);
            else body = expStr(d, P - 1, alt, upper);
            if (!alt) {
              const ei = body.search(/[eE]/);
              let mant = ei < 0 ? body : body.slice(0, ei);
              const rest = ei < 0 ? '' : body.slice(ei);
              if (mant.includes('.')) mant = mant.replace(/0+$/, '').replace(/\.$/, '');
              body = mant + rest;
            }
          }
        }
      }
      if (upper) body = body.toUpperCase();
    } else if (conv === 's') {
      body = String(arg);
      if (prec >= 0) body = body.slice(0, prec);
      canZero = false;
    } else {
      body = String(arg);
      canZero = false;
    }

    const len = sign.length + prefix.length + body.length;
    if (len >= width) out += sign + prefix + body;
    else if (minus) out += sign + prefix + body + ' '.repeat(width - len);
    else if (zero && canZero) out += sign + prefix + '0'.repeat(width - len) + body;
    else out += ' '.repeat(width - len) + sign + prefix + body;
  }
  return out;
}
