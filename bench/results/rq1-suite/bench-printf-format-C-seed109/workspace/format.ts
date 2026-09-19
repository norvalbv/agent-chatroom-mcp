// round(|x| * 10^k) to an integer, ties to even, using the exact binary value of x.
function roundScaled(x: number, k: number): bigint {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, Math.abs(x));
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
  const r2 = (num % den) * 2n;
  if (r2 > den || (r2 === den && (q & 1n) === 1n)) q += 1n;
  return q;
}

// digits (no point) of |x| rounded to prec fractional digits, as [intPart, fracPart]
function fixedParts(x: number, prec: number): [string, string] {
  let s = roundScaled(x, prec).toString();
  if (prec > 0) {
    s = s.padStart(prec + 1, '0');
    return [s.slice(0, s.length - prec), s.slice(s.length - prec)];
  }
  return [s, ''];
}

// e-style: returns [digits (prec+1 chars), exponent]
function expParts(x: number, prec: number): [string, number] {
  if (x === 0) return ['0'.repeat(prec + 1), 0];
  let X = Math.floor(Math.log10(Math.abs(x)));
  if (!isFinite(X)) X = -324;
  for (let i = 0; i < 5; i++) {
    const n = roundScaled(x, prec - X);
    const s = n.toString();
    if (s.length > prec + 1) X++;
    else if (s.length < prec + 1) X--;
    else return [s, X];
  }
  throw new Error('exponent search failed');
}

function fmtExp(digits: string, X: number, alt: boolean, upper: boolean): string {
  let s = digits[0];
  if (digits.length > 1) s += '.' + digits.slice(1);
  else if (alt) s += '.';
  const ax = Math.abs(X);
  s += (upper ? 'E' : 'e') + (X < 0 ? '-' : '+') + (ax < 10 ? '0' + ax : String(ax));
  return s;
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

    if (conv === 's' || conv === 'c') {
      body = String(arg);
      if (conv === 's' && prec >= 0) body = body.slice(0, prec);
      canZero = false;
    } else if (conv === 'd' || conv === 'i') {
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
        } else if (v !== 0n) {
          prefix = conv === 'x' ? '0x' : '0X';
        }
      }
    } else {
      const x = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      const lc = conv.toLowerCase();
      const isNeg = x < 0 || Object.is(x, -0);
      if (Number.isNaN(x)) {
        body = upper ? 'NAN' : 'nan';
        canZero = false;
      } else {
        sign = isNeg ? '-' : plus ? '+' : space ? ' ' : '';
        if (!isFinite(x)) {
          body = upper ? 'INF' : 'inf';
          canZero = false;
        } else if (lc === 'f') {
          const p = prec < 0 ? 6 : prec;
          const [ip, fp] = fixedParts(x, p);
          body = ip + (p > 0 ? '.' + fp : alt ? '.' : '');
        } else if (lc === 'e') {
          const p = prec < 0 ? 6 : prec;
          const [d, X] = expParts(x, p);
          body = fmtExp(d, X, alt, upper);
        } else {
          const P = prec < 0 ? 6 : prec === 0 ? 1 : prec;
          const [d, X] = expParts(x, P - 1);
          if (P > X && X >= -4) {
            const p = P - 1 - X;
            const [ip, fp0] = fixedParts(x, p);
            let fp = fp0;
            if (!alt) fp = fp.replace(/0+$/, '');
            body = ip + (fp.length > 0 ? '.' + fp : alt ? '.' : '');
          } else {
            let dd = d;
            if (!alt) dd = dd[0] + dd.slice(1).replace(/0+$/, '');
            body = fmtExp(dd, X, alt, upper);
          }
        }
      }
    }

    const len = sign.length + prefix.length + body.length;
    if (len >= width) {
      out += sign + prefix + body;
    } else if (minus) {
      out += sign + prefix + body + ' '.repeat(width - len);
    } else if (zero && canZero) {
      out += sign + prefix + '0'.repeat(width - len) + body;
    } else {
      out += ' '.repeat(width - len) + sign + prefix + body;
    }
  }
  return out;
}
