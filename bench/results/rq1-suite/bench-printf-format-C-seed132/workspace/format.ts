const dv = new DataView(new ArrayBuffer(8));

// |v| = m * 2^e exactly (v finite, nonzero or zero)
function decompose(v: number): [bigint, number] {
  dv.setFloat64(0, Math.abs(v));
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const bexp = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (bexp === 0) return [m, -1074];
  m |= 1n << 52n;
  return [m, bexp - 1075];
}

// round-half-even(|v| * 10^k)
function scaled(m: bigint, e: number, k: number): bigint {
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

// digits of |v| in e style: [digit string of length p+1, exponent]
function eDigits(v: number, p: number): [string, number] {
  const [m, e] = decompose(v);
  if (m === 0n) return ['0'.repeat(p + 1), 0];
  let X = Math.floor(Math.log10(Math.abs(v)));
  if (!isFinite(X)) X = -324;
  const lim = 10n ** BigInt(p);
  for (;;) {
    const n = scaled(m, e, p - X);
    if (n >= lim * 10n) X++;
    else if (n < lim) X--;
    else return [n.toString(), X];
  }
}

function fDigits(v: number, p: number): string {
  const [m, e] = decompose(v);
  let s = scaled(m, e, p).toString();
  if (s.length < p + 1) s = '0'.repeat(p + 1 - s.length) + s;
  if (p === 0) return s;
  return s.slice(0, s.length - p) + '.' + s.slice(s.length - p);
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
      const c = fmt[i];
      if (c === '-') minus = true;
      else if (c === '+') plus = true;
      else if (c === ' ') space = true;
      else if (c === '0') zero = true;
      else if (c === '#') alt = true;
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
    const lower = conv.toLowerCase();
    const upper = conv !== lower;
    const signFor = (neg: boolean) => (neg ? '-' : plus ? '+' : space ? ' ' : '');

    if (conv === 'd' || conv === 'i') {
      const n = BigInt(arg as number | bigint);
      sign = signFor(n < 0n);
      body = (n < 0n ? -n : n).toString();
      if (prec === 0 && n === 0n) body = '';
      if (prec > body.length) body = '0'.repeat(prec - body.length) + body;
      canZero = prec < 0;
    } else if (conv === 'x' || conv === 'X' || conv === 'o') {
      const n = BigInt(arg as number | bigint);
      body = n.toString(conv === 'o' ? 8 : 16);
      if (conv === 'X') body = body.toUpperCase();
      if (prec === 0 && n === 0n) body = '';
      if (prec > body.length) body = '0'.repeat(prec - body.length) + body;
      if (alt) {
        if (conv === 'o') {
          if (body[0] !== '0') body = '0' + body;
        } else if (n !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      }
      canZero = prec < 0;
    } else if ('efgEFG'.includes(conv)) {
      const v = arg as number;
      if (Number.isNaN(v)) {
        body = 'nan';
      } else {
        const neg = v < 0 || Object.is(v, -0);
        sign = signFor(neg);
        if (!isFinite(v)) body = 'inf';
        else {
          canZero = true;
          let p = prec < 0 ? 6 : prec;
          const fmtE = (pp: number) => {
            const [d, X] = eDigits(v, pp);
            let s = d[0];
            if (pp > 0 || alt) s += '.';
            s += d.slice(1);
            const ax = Math.abs(X);
            return s + 'e' + (X < 0 ? '-' : '+') + (ax < 10 ? '0' : '') + ax;
          };
          const fmtF = (pp: number) => {
            const s = fDigits(v, pp);
            return pp === 0 && alt ? s + '.' : s;
          };
          const strip = (s: string) => {
            if (alt) return s;
            const ei = s.indexOf('e');
            let mant = ei < 0 ? s : s.slice(0, ei);
            const exp = ei < 0 ? '' : s.slice(ei);
            if (mant.includes('.')) mant = mant.replace(/0+$/, '').replace(/\.$/, '');
            return mant + exp;
          };
          if (lower === 'e') body = fmtE(p);
          else if (lower === 'f') body = fmtF(p);
          else {
            if (p === 0) p = 1;
            const X = eDigits(v, p - 1)[1];
            body = p > X && X >= -4 ? strip(fmtF(p - 1 - X)) : strip(fmtE(p - 1));
          }
        }
      }
      if (upper) body = body.toUpperCase();
    } else if (conv === 's') {
      body = String(arg);
      if (prec >= 0) body = body.slice(0, prec);
    } else if (conv === 'c') {
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
