// Exact value of a finite non-negative double as num / den (den is a power of two).
function exact(x: number): [bigint, bigint] {
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, x);
  const hi = buf.getUint32(0);
  const lo = buf.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  let mant = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let e: number;
  if (expBits === 0) {
    e = -1074;
  } else {
    mant |= 1n << 52n;
    e = expBits - 1075;
  }
  return e >= 0 ? [mant << BigInt(e), 1n] : [mant, 1n << BigInt(-e)];
}

// round(num/den * 10^k) to nearest, ties to even, for integer k (may be negative).
function scaledRound(num: bigint, den: bigint, k: number): bigint {
  let n = num;
  let d = den;
  if (k >= 0) n *= 10n ** BigInt(k);
  else d *= 10n ** BigInt(-k);
  let q = n / d;
  const r = n - q * d;
  const twice = r * 2n;
  if (twice > d || (twice === d && (q & 1n) === 1n)) q += 1n;
  return q;
}

// Fixed notation digits: integer part and fraction string.
function fixedDigits(x: number, prec: number): [string, string] {
  const [n, d] = exact(x);
  let s = scaledRound(n, d, prec).toString();
  if (prec === 0) return [s, ''];
  if (s.length <= prec) s = '0'.repeat(prec + 1 - s.length) + s;
  return [s.slice(0, s.length - prec), s.slice(s.length - prec)];
}

// Exponent-style digits: p+1 significant digits and decimal exponent.
function expDigits(x: number, p: number): [string, number] {
  if (x === 0) return ['0'.repeat(p + 1), 0];
  const [n, d] = exact(x);
  let E = Math.floor(Math.log10(x));
  if (!isFinite(E)) E = -324;
  const lowB = 10n ** BigInt(p);
  const highB = lowB * 10n;
  for (;;) {
    const q = scaledRound(n, d, p - E);
    if (q >= highB) E++;
    else if (q < lowB) E--;
    else return [q.toString(), E];
  }
}

function expText(digs: string, E: number, upper: boolean, alt: boolean, strip: boolean): string {
  let frac = digs.slice(1);
  if (strip) frac = frac.replace(/0+$/, '');
  let s = digs[0] + (frac.length > 0 || alt ? '.' : '') + frac;
  const ae = Math.abs(E);
  s += (upper ? 'E' : 'e') + (E < 0 ? '-' : '+') + (ae < 10 ? '0' : '') + ae;
  return s;
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
    if (conv === 'd' || conv === 'i' || conv === 'x' || conv === 'X' || conv === 'o') {
      let v = typeof arg === 'bigint' ? arg : BigInt(arg as number);
      if (conv === 'd' || conv === 'i') {
        if (v < 0n) {
          sign = '-';
          v = -v;
        } else sign = plus ? '+' : space ? ' ' : '';
      }
      let digits = conv === 'x' ? v.toString(16) : conv === 'X' ? v.toString(16).toUpperCase() : conv === 'o' ? v.toString(8) : v.toString();
      if (prec === 0 && v === 0n) digits = '';
      if (prec > digits.length) digits = '0'.repeat(prec - digits.length) + digits;
      if (alt) {
        if (conv === 'x' && v !== 0n) prefix = '0x';
        else if (conv === 'X' && v !== 0n) prefix = '0X';
        else if (conv === 'o' && digits[0] !== '0') digits = '0' + digits;
      }
      body = digits;
      canZero = prec < 0;
    } else if (lc === 'e' || lc === 'f' || lc === 'g') {
      const upper = conv !== lc;
      const x = arg as number;
      const neg = x < 0 || Object.is(x, -0);
      if (Number.isNaN(x)) sign = '';
      else sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
      if (!isFinite(x)) {
        body = Number.isNaN(x) ? 'nan' : 'inf';
        if (upper) body = body.toUpperCase();
      } else {
        const ax = Math.abs(x);
        canZero = true;
        if (lc === 'f') {
          const p = prec < 0 ? 6 : prec;
          const [ip, fp] = fixedDigits(ax, p);
          body = ip + (p > 0 || alt ? '.' : '') + fp;
        } else if (lc === 'e') {
          const p = prec < 0 ? 6 : prec;
          const [digs, E] = expDigits(ax, p);
          body = expText(digs, E, upper, alt, false);
        } else {
          let P = prec < 0 ? 6 : prec;
          if (P === 0) P = 1;
          const [digs, X] = expDigits(ax, P - 1);
          if (P > X && X >= -4) {
            const p = P - 1 - X;
            const [ip, fp0] = fixedDigits(ax, p);
            let fp = fp0;
            if (!alt) fp = fp.replace(/0+$/, '');
            body = ip + (fp.length > 0 || alt ? '.' : '') + fp;
          } else {
            body = expText(digs, X, upper, alt, !alt);
          }
        }
      }
      if (!isFinite(x)) canZero = false;
    } else if (conv === 's') {
      body = String(arg);
      if (prec >= 0) body = body.slice(0, prec);
    } else {
      body = String(arg);
    }

    const len = sign.length + prefix.length + body.length;
    if (len >= width) out += sign + prefix + body;
    else if (minus) out += sign + prefix + body + ' '.repeat(width - len);
    else if (zero && canZero) out += sign + prefix + '0'.repeat(width - len) + body;
    else out += ' '.repeat(width - len) + sign + prefix + body;
  }
  return out;
}
