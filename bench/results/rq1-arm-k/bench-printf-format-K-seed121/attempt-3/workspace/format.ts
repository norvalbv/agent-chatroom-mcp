function roundScaled(abs: number, k: number): bigint {
  // round-half-even of abs * 10^k, using the exact binary value
  if (abs === 0) return 0n;
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, abs);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const bexp = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let e: number;
  if (bexp === 0) {
    e = -1074;
  } else {
    m |= 1n << 52n;
    e = bexp - 1075;
  }
  let num = m;
  let den = 1n;
  if (e >= 0) num <<= BigInt(e);
  else den <<= BigInt(-e);
  if (k >= 0) num *= 10n ** BigInt(k);
  else den *= 10n ** BigInt(-k);
  let q = num / den;
  const r = num - q * den;
  const twice = r * 2n;
  if (twice > den || (twice === den && (q & 1n) === 1n)) q += 1n;
  return q;
}

function expStyle(abs: number, p: number): { digits: string; x: number } {
  if (abs === 0) return { digits: '0'.repeat(p + 1), x: 0 };
  let x = Math.floor(Math.log10(abs));
  for (let i = 0; i < 6; i++) {
    const n = roundScaled(abs, p - x);
    const s = n.toString();
    if (s.length > p + 1) x++;
    else if (s.length < p + 1) x--;
    else return { digits: s, x };
  }
  throw new Error('exp');
}

function fixedStyle(abs: number, p: number, alt: boolean): string {
  const s = roundScaled(abs, p).toString().padStart(p + 1, '0');
  if (p === 0) return alt ? s + '.' : s;
  return s.slice(0, s.length - p) + '.' + s.slice(s.length - p);
}

function fmtExp(digits: string, x: number, p: number, alt: boolean, upper: boolean): string {
  let r = digits[0];
  if (p > 0 || alt) r += '.';
  r += digits.slice(1);
  r += (upper ? 'E' : 'e') + (x < 0 ? '-' : '+') + String(Math.abs(x)).padStart(2, '0');
  return r;
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
    let width = 0;
    while (i < fmt.length && fmt[i] >= '0' && fmt[i] <= '9') width = width * 10 + Number(fmt[i++]);
    let prec = -1;
    if (fmt[i] === '.') {
      i++;
      prec = 0;
      while (i < fmt.length && fmt[i] >= '0' && fmt[i] <= '9') prec = prec * 10 + Number(fmt[i++]);
    }
    const conv = fmt[i++];
    const arg = args[ai++];
    let sign = '';
    let prefix = '';
    let body = '';
    let canZero = true;
    const lc = conv.toLowerCase();
    if (conv === 'd' || conv === 'i') {
      const v = BigInt(arg as number | bigint);
      const neg = v < 0n;
      body = (neg ? -v : v).toString();
      if (prec >= 0) {
        if (prec === 0 && v === 0n) body = '';
        body = body.padStart(prec, '0');
        canZero = false;
      }
      sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
    } else if (conv === 'x' || conv === 'X' || conv === 'o') {
      const v = BigInt(arg as number | bigint);
      body = v.toString(conv === 'o' ? 8 : 16);
      if (conv === 'X') body = body.toUpperCase();
      if (prec >= 0) {
        if (prec === 0 && v === 0n) body = '';
        body = body.padStart(prec, '0');
        canZero = false;
      }
      if (alt) {
        if (conv === 'o') {
          if (body[0] !== '0') body = '0' + body;
        } else if (v !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      }
    } else if ('efg'.includes(lc)) {
      const v = arg as number;
      const upper = conv !== lc;
      const neg = Object.is(v, -0) || v < 0;
      if (Number.isNaN(v)) {
        body = upper ? 'NAN' : 'nan';
        canZero = false;
      } else {
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        if (!Number.isFinite(v)) {
          body = upper ? 'INF' : 'inf';
          canZero = false;
        } else {
          const abs = Math.abs(v);
          if (lc === 'f') {
            body = fixedStyle(abs, prec < 0 ? 6 : prec, alt);
          } else if (lc === 'e') {
            const p = prec < 0 ? 6 : prec;
            const { digits, x } = expStyle(abs, p);
            body = fmtExp(digits, x, p, alt, upper);
          } else {
            let P = prec < 0 ? 6 : prec;
            if (P === 0) P = 1;
            const { digits, x } = expStyle(abs, P - 1);
            if (P > x && x >= -4) {
              body = fixedStyle(abs, P - 1 - x, alt);
              if (!alt && body.includes('.')) body = body.replace(/0+$/, '').replace(/\.$/, '');
            } else {
              body = fmtExp(digits, x, P - 1, alt, upper);
              if (!alt) {
                const ei = body.search(/[eE]/);
                let mant = body.slice(0, ei);
                if (mant.includes('.')) mant = mant.replace(/0+$/, '').replace(/\.$/, '');
                body = mant + body.slice(ei);
              }
            }
          }
        }
      }
    } else if (conv === 's') {
      body = String(arg);
      if (prec >= 0) body = body.slice(0, prec);
      canZero = false;
    } else {
      body = String(arg);
      canZero = false;
    }
    const len = sign.length + prefix.length + body.length;
    if (len < width) {
      if (minus) out += sign + prefix + body + ' '.repeat(width - len);
      else if (zero && canZero) out += sign + prefix + '0'.repeat(width - len) + body;
      else out += ' '.repeat(width - len) + sign + prefix + body;
    } else out += sign + prefix + body;
  }
  return out;
}
