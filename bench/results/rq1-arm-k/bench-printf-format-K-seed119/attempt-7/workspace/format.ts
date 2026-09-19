function decompose(v: number): [bigint, number] {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, v);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  const frac = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (expBits === 0) return [frac, -1074];
  return [frac | (1n << 52n), expBits - 1075];
}

// round(m * 2^e * 10^s) to nearest integer, ties to even
function scaledRound(m: bigint, e: number, s: number): bigint {
  let num = m;
  let den = 1n;
  if (e >= 0) num <<= BigInt(e);
  else den <<= BigInt(-e);
  if (s >= 0) num *= 10n ** BigInt(s);
  else den *= 10n ** BigInt(-s);
  let q = num / den;
  const r2 = (num % den) * 2n;
  if (r2 > den || (r2 === den && (q & 1n) === 1n)) q += 1n;
  return q;
}

function fixed(v: number, prec: number, alt: boolean): string {
  const [m, e] = v === 0 ? [0n, 0] : decompose(v);
  let s = scaledRound(m, e, prec).toString();
  if (prec > 0) {
    s = s.padStart(prec + 1, '0');
    s = s.slice(0, s.length - prec) + '.' + s.slice(s.length - prec);
  } else if (alt) s += '.';
  return s;
}

// nd+1 significant digits and decimal exponent
function sci(v: number, nd: number): [string, number] {
  if (v === 0) return ['0'.repeat(nd + 1), 0];
  const [m, e] = decompose(v);
  let E = Math.floor(Math.log10(v));
  const lo = 10n ** BigInt(nd);
  const hi = lo * 10n;
  for (;;) {
    const q = scaledRound(m, e, nd - E);
    if (q >= hi) E++;
    else if (q < lo) E--;
    else return [q.toString(), E];
  }
}

function expStr(digits: string, E: number, alt: boolean, upper: boolean, strip: boolean): string {
  let frac = digits.slice(1);
  if (strip) frac = frac.replace(/0+$/, '');
  let s = digits[0];
  if (frac.length > 0) s += '.' + frac;
  else if (alt) s += '.';
  const ae = Math.abs(E);
  s += (upper ? 'E' : 'e') + (E < 0 ? '-' : '+') + (ae < 10 ? '0' + ae : String(ae));
  return s;
}

function stripFixed(s: string): string {
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
    let sign = '';
    let prefix = '';
    let body = '';
    let numeric = true;
    let canZero = true;
    const lc = conv.toLowerCase();
    if (conv === 's' || conv === 'c') {
      numeric = false;
      body = String(arg);
      if (conv === 's' && prec >= 0) body = body.slice(0, prec);
    } else if (conv === 'd' || conv === 'i' || lc === 'x' || conv === 'o') {
      let n = typeof arg === 'bigint' ? arg : BigInt(arg as number);
      if (conv === 'd' || conv === 'i') {
        if (n < 0n) {
          sign = '-';
          n = -n;
        } else sign = plus ? '+' : space ? ' ' : '';
      }
      let digits = n.toString(conv === 'o' ? 8 : lc === 'x' ? 16 : 10);
      if (conv === 'X') digits = digits.toUpperCase();
      if (prec === 0 && n === 0n) digits = '';
      if (prec > 0) digits = digits.padStart(prec, '0');
      if (alt && lc === 'x' && n !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      if (alt && conv === 'o' && !digits.startsWith('0')) digits = '0' + digits;
      body = digits;
      if (prec >= 0) canZero = false;
    } else {
      const x = arg as number;
      const upper = conv === conv.toUpperCase();
      const neg = x < 0 || Object.is(x, -0);
      if (Number.isNaN(x)) sign = '';
      else sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
      if (!Number.isFinite(x)) {
        body = Number.isNaN(x) ? 'nan' : 'inf';
        if (upper) body = body.toUpperCase();
        canZero = false;
      } else {
        const v = Math.abs(x);
        const P = prec < 0 ? 6 : prec;
        if (lc === 'f') body = fixed(v, P, alt);
        else if (lc === 'e') {
          const [d, E] = sci(v, P);
          body = expStr(d, E, alt, upper, false);
        } else {
          const PP = P === 0 ? 1 : P;
          const [d, E] = sci(v, PP - 1);
          if (PP > E && E >= -4) {
            body = fixed(v, PP - 1 - E, alt);
            if (!alt) body = stripFixed(body);
          } else body = expStr(d, E, alt, upper, !alt);
        }
      }
    }
    if (!numeric) canZero = false;
    const len = sign.length + prefix.length + body.length;
    if (len >= width) out += sign + prefix + body;
    else if (minus) out += sign + prefix + body + ' '.repeat(width - len);
    else if (zero && canZero) out += sign + prefix + '0'.repeat(width - len) + body;
    else out += ' '.repeat(width - len) + sign + prefix + body;
  }
  return out;
}
