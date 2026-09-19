// round(|v| * 10^k) to an integer, exact, half to even. v must be finite, nonzero or zero.
function decompose(v: number): { m: bigint; e: number } {
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, Math.abs(v));
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

function roundScaled(v: number, k: number): bigint {
  const { m, e } = decompose(v);
  let num = m;
  let den = 1n;
  if (e >= 0) num <<= BigInt(e);
  else den <<= BigInt(-e);
  if (k >= 0) num *= 10n ** BigInt(k);
  else den *= 10n ** BigInt(-k);
  const q = num / den;
  const r2 = (num % den) * 2n;
  if (r2 > den || (r2 === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// digits and exponent in e-style with p digits after the point
function expDigits(v: number, p: number): { digits: string; x: number } {
  if (v === 0) return { digits: '0'.repeat(p + 1), x: 0 };
  const a = Math.abs(v);
  let x = Math.floor(Math.log10(a));
  if (!isFinite(x)) x = -324;
  const lowB = 10n ** BigInt(p);
  const highB = lowB * 10n;
  for (let i = 0; i < 10; i++) {
    const n = roundScaled(a, p - x);
    if (n >= highB) x++;
    else if (n < lowB) x--;
    else return { digits: n.toString(), x };
  }
  throw new Error('exp');
}

function fixed(v: number, p: number, hash: boolean): string {
  let s = roundScaled(v, p).toString();
  if (p > 0) {
    s = s.padStart(p + 1, '0');
    return s.slice(0, s.length - p) + '.' + s.slice(s.length - p);
  }
  return hash ? s + '.' : s;
}

function expStyle(digits: string, x: number, p: number, hash: boolean, upper: boolean): string {
  let s = digits[0];
  if (p > 0) s += '.' + digits.slice(1);
  else if (hash) s += '.';
  const ax = Math.abs(x);
  return s + (upper ? 'E' : 'e') + (x < 0 ? '-' : '+') + (ax < 10 ? '0' + ax : String(ax));
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
    let minus = false, plus = false, space = false, zero = false, hash = false;
    for (; i < fmt.length; i++) {
      const f = fmt[i];
      if (f === '-') minus = true;
      else if (f === '+') plus = true;
      else if (f === ' ') space = true;
      else if (f === '0') zero = true;
      else if (f === '#') hash = true;
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
    let numeric = true;
    let canZero = true;
    const lc = conv.toLowerCase();
    if (conv === 'd' || conv === 'i') {
      const n = BigInt(arg as number | bigint);
      sign = n < 0n ? '-' : plus ? '+' : space ? ' ' : '';
      let d = (n < 0n ? -n : n).toString();
      if (prec === 0 && n === 0n) d = '';
      if (prec >= 0) {
        d = d.padStart(prec, '0');
        canZero = false;
      }
      body = d;
    } else if (conv === 'x' || conv === 'X' || conv === 'o') {
      const n = BigInt(arg as number | bigint);
      let d = n.toString(conv === 'o' ? 8 : 16);
      if (conv === 'X') d = d.toUpperCase();
      if (prec === 0 && n === 0n) d = '';
      if (prec >= 0) {
        d = d.padStart(prec, '0');
        canZero = false;
      }
      if (hash) {
        if (conv === 'o') {
          if (d[0] !== '0') d = '0' + d;
        } else if (n !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      }
      body = d;
    } else if ('efg'.includes(lc)) {
      const v = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      const neg = v < 0 || Object.is(v, -0);
      if (Number.isNaN(v)) {
        body = upper ? 'NAN' : 'nan';
        canZero = false;
      } else {
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        if (!isFinite(v)) {
          body = upper ? 'INF' : 'inf';
          canZero = false;
        } else if (lc === 'f') {
          body = fixed(v, prec < 0 ? 6 : prec, hash);
        } else if (lc === 'e') {
          const p = prec < 0 ? 6 : prec;
          const { digits, x } = expDigits(v, p);
          body = expStyle(digits, x, p, hash, upper);
        } else {
          let P = prec < 0 ? 6 : prec;
          if (P === 0) P = 1;
          const { digits, x } = expDigits(v, P - 1);
          const strip = (s: string) => {
            if (hash || !s.includes('.')) return s;
            return s.replace(/0+$/, '').replace(/\.$/, '');
          };
          if (P > x && x >= -4) {
            body = strip(fixed(v, P - 1 - x, hash));
          } else {
            let mant = digits[0] + (P - 1 > 0 ? '.' + digits.slice(1) : hash ? '.' : '');
            mant = strip(mant);
            const ax = Math.abs(x);
            body = mant + (upper ? 'E' : 'e') + (x < 0 ? '-' : '+') + (ax < 10 ? '0' + ax : String(ax));
          }
        }
      }
    } else if (conv === 's') {
      numeric = false;
      body = prec >= 0 ? (arg as string).slice(0, prec) : (arg as string);
    } else {
      numeric = false;
      body = arg as string;
    }
    const len = sign.length + prefix.length + body.length;
    if (len >= width) out += sign + prefix + body;
    else if (minus) out += sign + prefix + body + ' '.repeat(width - len);
    else if (numeric && zero && canZero) out += sign + prefix + '0'.repeat(width - len) + body;
    else out += ' '.repeat(width - len) + sign + prefix + body;
  }
  return out;
}
