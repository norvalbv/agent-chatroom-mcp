// Exact |x| * 10^k rounded half-even to a BigInt (x finite, non-negative).
function scaleRound(x: number, k: number): bigint {
  if (x === 0) return 0n;
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, x);
  const hi = buf.getUint32(0);
  const lo = buf.getUint32(4);
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
  const q = num / den;
  const r = num % den;
  const twice = r * 2n;
  if (twice > den || (twice === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// Digits (p+1 digits) and decimal exponent of x in e style.
function eDigits(x: number, p: number): { digits: string; exp: number } {
  if (x === 0) return { digits: '0'.repeat(p + 1), exp: 0 };
  let exp = Math.floor(Math.log10(x));
  if (!isFinite(exp)) exp = 0;
  const lo = 10n ** BigInt(p);
  const hi = lo * 10n;
  for (let i = 0; i < 20; i++) {
    const n = scaleRound(x, p - exp);
    if (n >= hi) exp++;
    else if (n < lo) exp--;
    else return { digits: n.toString(), exp };
  }
  throw new Error('unreachable');
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
    let canZero = true;
    const lower = conv.toLowerCase();

    if (conv === 's' || conv === 'c') {
      body = String(arg);
      if (conv === 's' && prec >= 0) body = body.slice(0, prec);
      canZero = false;
    } else {
      const signFor = (neg: boolean) => (neg ? '-' : plus ? '+' : space ? ' ' : '');
      if (conv === 'd' || conv === 'i' || lower === 'x' || conv === 'o') {
        const v = BigInt(arg as number | bigint);
        if (conv === 'd' || conv === 'i') sign = signFor(v < 0n);
        const mag = v < 0n ? -v : v;
        body = conv === 'd' || conv === 'i' ? mag.toString() : mag.toString(conv === 'o' ? 8 : 16);
        if (conv === 'X') body = body.toUpperCase();
        if (prec >= 0) {
          if (prec === 0 && mag === 0n) body = '';
          if (body.length < prec) body = '0'.repeat(prec - body.length) + body;
          canZero = false;
        }
        if (alt) {
          if (lower === 'x' && mag !== 0n) prefix = conv === 'x' ? '0x' : '0X';
          else if (conv === 'o' && body[0] !== '0') body = '0' + body;
        }
      } else {
        const x = arg as number;
        const upper = conv === 'E' || conv === 'F' || conv === 'G';
        const neg = x < 0 || Object.is(x, -0);
        if (Number.isNaN(x)) {
          sign = '';
          body = upper ? 'NAN' : 'nan';
          canZero = false;
        } else {
          sign = signFor(neg);
          const ax = Math.abs(x);
          if (ax === Infinity) {
            body = upper ? 'INF' : 'inf';
            canZero = false;
          } else {
            const fStyle = (p: number) => {
              let s = scaleRound(ax, p).toString();
              if (s.length < p + 1) s = '0'.repeat(p + 1 - s.length) + s;
              const ip = s.slice(0, s.length - p);
              const fp = s.slice(s.length - p);
              return ip + (p > 0 || alt ? '.' : '') + fp;
            };
            const eStyle = (p: number) => {
              const { digits, exp } = eDigits(ax, p);
              const es = String(Math.abs(exp)).padStart(2, '0');
              return (
                digits[0] + (p > 0 || alt ? '.' : '') + digits.slice(1) +
                (upper ? 'E' : 'e') + (exp < 0 ? '-' : '+') + es
              );
            };
            if (lower === 'f') body = fStyle(prec < 0 ? 6 : prec);
            else if (lower === 'e') body = eStyle(prec < 0 ? 6 : prec);
            else {
              let P = prec < 0 ? 6 : prec;
              if (P === 0) P = 1;
              const X = eDigits(ax, P - 1).exp;
              if (P > X && X >= -4) body = fStyle(P - 1 - X);
              else body = eStyle(P - 1);
              if (!alt) {
                const m = body.match(/^([^eE]*)(.*)$/)!;
                let mant = m[1];
                if (mant.includes('.')) mant = mant.replace(/0+$/, '').replace(/\.$/, '');
                body = mant + m[2];
              }
            }
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
