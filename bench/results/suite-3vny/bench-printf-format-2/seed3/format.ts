function decompose(x: number): [bigint, number] {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const be = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (be === 0) return [m, -1074];
  m |= 1n << 52n;
  return [m, be - 1075];
}

// round-half-even of |x| * 10^k, exact
function roundScaled(x: number, k: number): bigint {
  const [m, e] = decompose(x);
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

function eParts(x: number, p: number): { digits: string; exp: number } {
  if (x === 0) return { digits: '0'.repeat(p + 1), exp: 0 };
  let e10 = Math.floor(Math.log10(x));
  for (let i = 0; i < 10; i++) {
    const n = roundScaled(x, p - e10);
    const s = n.toString();
    if (s.length > p + 1) e10++;
    else if (s.length < p + 1) e10--;
    else return { digits: s, exp: e10 };
  }
  throw new Error('exp search failed');
}

function fStyle(x: number, p: number, alt: boolean): string {
  let s = roundScaled(x, p).toString();
  if (s.length < p + 1) s = '0'.repeat(p + 1 - s.length) + s;
  const ip = s.slice(0, s.length - p);
  const fp = s.slice(s.length - p);
  return p > 0 ? ip + '.' + fp : alt ? ip + '.' : ip;
}

function eStyle(x: number, p: number, alt: boolean, upper: boolean): string {
  const { digits, exp } = eParts(x, p);
  let s = digits[0];
  if (p > 0) s += '.' + digits.slice(1);
  else if (alt) s += '.';
  const a = Math.abs(exp);
  return s + (upper ? 'E' : 'e') + (exp < 0 ? '-' : '+') + (a < 10 ? '0' + a : String(a));
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
    if (fmt[i] === '*') {
      width = Number(args[ai++]);
      i++;
      if (width < 0) {
        minus = true;
        width = -width;
      }
    } else {
      while (fmt[i] >= '0' && fmt[i] <= '9') width = width * 10 + (fmt.charCodeAt(i++) - 48);
    }
    let prec = -1;
    if (fmt[i] === '.') {
      i++;
      if (fmt[i] === '*') {
        prec = Number(args[ai++]);
        i++;
        if (prec < 0) prec = -1;
      } else {
        prec = 0;
        while (fmt[i] >= '0' && fmt[i] <= '9') prec = prec * 10 + (fmt.charCodeAt(i++) - 48);
      }
    }
    let bits = 32;
    if (fmt.startsWith('hh', i)) { bits = 8; i += 2; }
    else if (fmt[i] === 'h') { bits = 16; i++; }
    else if (fmt.startsWith('ll', i)) { bits = 64; i += 2; }
    else if (fmt[i] === 'l') { bits = 64; i++; }
    const conv = fmt[i++];
    const arg = args[ai++];

    let sign = '';
    let prefix = '';
    let body = '';
    let canZero = true;

    if (conv === 's' || conv === 'c') {
      body = conv === 's' ? (prec >= 0 ? String(arg).slice(0, prec) : String(arg)) : String(arg)[0];
      canZero = false;
    } else if ('diuxXo'.includes(conv)) {
      const big = BigInt(arg as number | bigint);
      const signed = conv === 'd' || conv === 'i';
      const v = signed ? BigInt.asIntN(bits, big) : BigInt.asUintN(bits, big);
      const neg = v < 0n;
      const mag = neg ? -v : v;
      if (signed) sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
      const base = conv === 'o' ? 8 : conv === 'd' || conv === 'i' || conv === 'u' ? 10 : 16;
      let d = mag.toString(base);
      if (conv === 'X') d = d.toUpperCase();
      if (prec === 0 && mag === 0n) d = '';
      if (prec >= 0 && d.length < prec) d = '0'.repeat(prec - d.length) + d;
      if (alt) {
        if (conv === 'o') {
          if (d[0] !== '0') d = '0' + d;
        } else if ((conv === 'x' || conv === 'X') && mag !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      }
      body = d;
      if (prec >= 0) canZero = false;
    } else {
      const x = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      const neg = x < 0 || Object.is(x, -0);
      if (!Number.isNaN(x)) sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
      if (Number.isNaN(x)) {
        body = upper ? 'NAN' : 'nan';
        canZero = false;
      } else if (!Number.isFinite(x)) {
        body = upper ? 'INF' : 'inf';
        canZero = false;
      } else {
        const ax = Math.abs(x);
        const lc = conv.toLowerCase();
        if (lc === 'f') body = fStyle(ax, prec < 0 ? 6 : prec, alt);
        else if (lc === 'e') body = eStyle(ax, prec < 0 ? 6 : prec, alt, upper);
        else {
          const P = prec < 0 ? 6 : prec === 0 ? 1 : prec;
          const X = eParts(ax, P - 1).exp;
          if (P > X && X >= -4) body = fStyle(ax, P - 1 - X, alt);
          else body = eStyle(ax, P - 1, alt, upper);
          if (!alt) {
            const ei = body.search(/[eE]/);
            let mant = ei >= 0 ? body.slice(0, ei) : body;
            const rest = ei >= 0 ? body.slice(ei) : '';
            if (mant.includes('.')) mant = mant.replace(/0+$/, '').replace(/\.$/, '');
            body = mant + rest;
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
