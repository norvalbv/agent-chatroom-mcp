function decompose(x: number): { m: bigint; e: number } {
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, x);
  const hi = buf.getUint32(0);
  const lo = buf.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let e: number;
  if (expBits === 0) {
    e = -1074;
  } else {
    m |= 1n << 52n;
    e = expBits - 1075;
  }
  return { m, e };
}

// round(|x| * 10^k), half to even, exactly
function roundScaled(d: { m: bigint; e: number }, k: number): bigint {
  let num = d.m;
  let den = 1n;
  if (d.e >= 0) num <<= BigInt(d.e);
  else den <<= BigInt(-d.e);
  if (k >= 0) num *= 10n ** BigInt(k);
  else den *= 10n ** BigInt(-k);
  let q = num / den;
  const r2 = (num % den) * 2n;
  if (r2 > den || (r2 === den && (q & 1n) === 1n)) q += 1n;
  return q;
}

function fixedStr(d: { m: bigint; e: number }, p: number, alt: boolean): string {
  let s = roundScaled(d, p).toString();
  if (p > 0) {
    s = s.padStart(p + 1, '0');
    s = s.slice(0, s.length - p) + '.' + s.slice(s.length - p);
  } else if (alt) s += '.';
  return s;
}

// returns digits (p+1 of them) and decimal exponent
function expParts(d: { m: bigint; e: number }, p: number): { digits: string; x: number } {
  if (d.m === 0n) return { digits: '0'.repeat(p + 1), x: 0 };
  let x = Math.floor(Math.log10(Number(d.m) * Math.pow(2, d.e)));
  if (!Number.isFinite(x)) x = 0;
  const lim = 10n ** BigInt(p);
  for (let i = 0; i < 20; i++) {
    const r = roundScaled(d, p - x);
    if (r >= lim * 10n) x++;
    else if (r < lim) x--;
    else return { digits: r.toString(), x };
  }
  throw new Error('exp');
}

function expStr(digits: string, x: number, p: number, alt: boolean, upper: boolean): string {
  let s = digits[0];
  if (p > 0) s += '.' + digits.slice(1);
  else if (alt) s += '.';
  const ax = Math.abs(x);
  s += (upper ? 'E' : 'e') + (x < 0 ? '-' : '+') + (ax < 10 ? '0' + ax : String(ax));
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
    for (; i < fmt.length; i++) {
      const c = fmt[i];
      if (c === '-') minus = true;
      else if (c === '+') plus = true;
      else if (c === ' ') space = true;
      else if (c === '0') zero = true;
      else if (c === '#') alt = true;
      else break;
    }
    let w = '';
    while (i < fmt.length && fmt[i] >= '0' && fmt[i] <= '9') w += fmt[i++];
    const width = w ? parseInt(w, 10) : 0;
    let prec: number | null = null;
    if (fmt[i] === '.') {
      i++;
      let ps = '';
      while (i < fmt.length && fmt[i] >= '0' && fmt[i] <= '9') ps += fmt[i++];
      prec = ps ? parseInt(ps, 10) : 0;
    }
    const conv = fmt[i++];
    const arg = args[ai++];

    let sign = '';
    let prefix = '';
    let body = '';
    let canZero = false;

    const signFor = (neg: boolean) => (neg ? '-' : plus ? '+' : space ? ' ' : '');

    if (conv === 's') {
      body = String(arg);
      if (prec !== null) body = body.slice(0, prec);
    } else if (conv === 'c') {
      body = String(arg);
    } else if (conv === 'd' || conv === 'i') {
      const v = typeof arg === 'bigint' ? arg : BigInt(arg as number);
      sign = signFor(v < 0n);
      body = (v < 0n ? -v : v).toString();
      if (prec !== null) {
        if (prec === 0 && v === 0n) body = '';
        body = body.padStart(prec, '0');
      }
      canZero = prec === null;
    } else if (conv === 'x' || conv === 'X' || conv === 'o') {
      const v = typeof arg === 'bigint' ? arg : BigInt(arg as number);
      body = v.toString(conv === 'o' ? 8 : 16);
      if (conv === 'X') body = body.toUpperCase();
      if (prec !== null) {
        if (prec === 0 && v === 0n) body = '';
        body = body.padStart(prec, '0');
      }
      if (alt) {
        if (conv === 'o') {
          if (!body.startsWith('0')) body = '0' + body;
        } else if (v !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      }
      canZero = prec === null;
    } else {
      const v = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      const neg = Object.is(v, -0) || (v < 0);
      if (Number.isNaN(v)) {
        body = upper ? 'NAN' : 'nan';
      } else if (!Number.isFinite(v)) {
        sign = signFor(neg);
        body = upper ? 'INF' : 'inf';
      } else {
        sign = signFor(neg);
        canZero = true;
        const d = decompose(v);
        const lc = conv.toLowerCase();
        if (lc === 'f') {
          body = fixedStr(d, prec ?? 6, alt);
        } else if (lc === 'e') {
          const p = prec ?? 6;
          const { digits, x } = expParts(d, p);
          body = expStr(digits, x, p, alt, upper);
        } else {
          const P = prec === null ? 6 : prec === 0 ? 1 : prec;
          const { digits, x } = expParts(d, P - 1);
          if (P > x && x >= -4) {
            body = fixedStr(d, P - 1 - x, alt);
            if (!alt) body = stripZeros(body);
          } else {
            let mant = digits[0];
            if (P - 1 > 0) mant += '.' + digits.slice(1);
            else if (alt) mant += '.';
            if (!alt) mant = stripZeros(mant);
            const ax = Math.abs(x);
            body = mant + (upper ? 'E' : 'e') + (x < 0 ? '-' : '+') + (ax < 10 ? '0' + ax : String(ax));
          }
        }
      }
    }

    const len = sign.length + prefix.length + body.length;
    if (len >= width) out += sign + prefix + body;
    else if (minus) out += sign + prefix + body + ' '.repeat(width - len);
    else if (zero && canZero) out += sign + prefix + '0'.repeat(width - len) + body;
    else out += ' '.repeat(width - len) + sign + prefix + body;
  }
  return out;
}
