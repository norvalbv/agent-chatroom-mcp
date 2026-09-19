function decompose(x: number): { m: bigint; e: number } {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, Math.abs(x));
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const expField = (hi >>> 20) & 0x7ff;
  const frac = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (expField === 0) return { m: frac, e: -1074 };
  return { m: frac | (1n << 52n), e: expField - 1075 };
}

// round(m * 2^e * 10^k), half to even
function scaled(m: bigint, e: number, k: number, floorOnly = false): bigint {
  let num = m;
  let den = 1n;
  if (e >= 0) num <<= BigInt(e);
  else den <<= BigInt(-e);
  if (k >= 0) num *= 10n ** BigInt(k);
  else den *= 10n ** BigInt(-k);
  const q = num / den;
  if (floorOnly) return q;
  const r = num % den;
  const twice = r * 2n;
  if (twice > den || (twice === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// digits (prec+1 significant) and decimal exponent, e-style
function sci(m: bigint, e: number, prec: number): { digits: string; exp: number } {
  if (m === 0n) return { digits: '0'.repeat(prec + 1), exp: 0 };
  const approx = Math.log10(Number(m)) + e * Math.log10(2);
  let x = Math.floor(Number.isFinite(approx) ? approx : 0);
  while (scaled(m, e, -x, true) < 1n) x--;
  while (scaled(m, e, -(x + 1), true) >= 1n) x++;
  let n = scaled(m, e, prec - x);
  if (n >= 10n ** BigInt(prec + 1)) {
    x++;
    n = scaled(m, e, prec - x);
  }
  return { digits: n.toString(), exp: x };
}

function fixed(m: bigint, e: number, prec: number, alt: boolean): string {
  let s = scaled(m, e, prec).toString();
  if (prec > 0) {
    s = s.padStart(prec + 1, '0');
    return s.slice(0, s.length - prec) + '.' + s.slice(s.length - prec);
  }
  return alt ? s + '.' : s;
}

function expStyle(digits: string, exp: number, prec: number, alt: boolean, upper: boolean): string {
  let s = digits[0];
  if (prec > 0) s += '.' + digits.slice(1);
  else if (alt) s += '.';
  const ae = Math.abs(exp).toString().padStart(2, '0');
  return s + (upper ? 'E' : 'e') + (exp < 0 ? '-' : '+') + ae;
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
    } else if ('dixXo'.includes(conv)) {
      let v = typeof arg === 'bigint' ? arg : BigInt(arg as number);
      if (conv === 'd' || conv === 'i') {
        if (v < 0n) {
          sign = '-';
          v = -v;
        } else sign = plus ? '+' : space ? ' ' : '';
      }
      let digits = conv === 'o' ? v.toString(8) : conv === 'd' || conv === 'i' ? v.toString() : v.toString(16);
      if (conv === 'X') digits = digits.toUpperCase();
      if (prec >= 0) {
        if (prec === 0 && v === 0n) digits = '';
        digits = digits.padStart(prec, '0');
        canZero = false;
      }
      if (alt) {
        if (conv === 'o') {
          if (digits[0] !== '0') digits = '0' + digits;
        } else if ((conv === 'x' || conv === 'X') && v !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      }
      body = digits;
    } else {
      const x = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      const neg = x < 0 || Object.is(x, -0);
      if (Number.isNaN(x)) {
        body = upper ? 'NAN' : 'nan';
        canZero = false;
      } else {
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        if (!Number.isFinite(x)) {
          body = upper ? 'INF' : 'inf';
          canZero = false;
        } else {
          const { m, e } = decompose(x);
          const p = prec < 0 ? 6 : prec;
          const lc = conv.toLowerCase();
          if (lc === 'f') body = fixed(m, e, p, alt);
          else if (lc === 'e') {
            const r = sci(m, e, p);
            body = expStyle(r.digits, r.exp, p, alt, upper);
          } else {
            const P = p === 0 ? 1 : p;
            const r = sci(m, e, P - 1);
            if (P > r.exp && r.exp >= -4) {
              body = fixed(m, e, P - 1 - r.exp, alt);
              if (!alt) body = stripZeros(body);
            } else {
              let mant = r.digits[0] + (P > 1 ? '.' + r.digits.slice(1) : alt ? '.' : '');
              if (!alt) mant = stripZeros(mant);
              const ae = Math.abs(r.exp).toString().padStart(2, '0');
              body = mant + (upper ? 'E' : 'e') + (r.exp < 0 ? '-' : '+') + ae;
            }
          }
        }
      }
    }

    const len = sign.length + prefix.length + body.length;
    if (len >= width) out += sign + prefix + body;
    else if (minus) out += sign + prefix + body + ' '.repeat(width - len);
    else if (canZero) out += sign + prefix + '0'.repeat(width - len) + body;
    else out += ' '.repeat(width - len) + sign + prefix + body;
  }
  return out;
}
