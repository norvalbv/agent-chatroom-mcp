// Decompose a finite non-negative double into m * 2^e exactly.
function decompose(v: number): [bigint, number] {
  if (v === 0) return [0n, 0];
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, v);
  const hi = buf.getUint32(0);
  const lo = buf.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (expBits === 0) return [m, -1074];
  m |= 1n << 52n;
  return [m, expBits - 1075];
}

// round-half-even(v * 10^k)
function roundScaled(m: bigint, e: number, k: number): bigint {
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

// f-style digits of |v| with p fractional digits
function fixedBody(v: number, p: number, alt: boolean): string {
  const [m, e] = decompose(v);
  let s = roundScaled(m, e, p).toString();
  if (p > 0) {
    s = s.padStart(p + 1, '0');
    s = s.slice(0, s.length - p) + '.' + s.slice(s.length - p);
  } else if (alt) s += '.';
  return s;
}

// e-style: digit string of p+1 digits and decimal exponent
function expParts(v: number, p: number): [string, number] {
  if (v === 0) return ['0'.repeat(p + 1), 0];
  const [m, e] = decompose(v);
  let X = Math.floor(Math.log10(v));
  if (!isFinite(X)) X = -324;
  const lim = 10n ** BigInt(p);
  for (;;) {
    const N = roundScaled(m, e, p - X);
    if (N >= lim * 10n) X++;
    else if (N < lim) X--;
    else return [N.toString(), X];
  }
}

function expBody(digits: string, X: number, p: number, alt: boolean, upper: boolean): string {
  let s = digits[0];
  if (p > 0) s += '.' + digits.slice(1);
  else if (alt) s += '.';
  const ax = Math.abs(X);
  s += (upper ? 'E' : 'e') + (X < 0 ? '-' : '+') + (ax < 10 ? '0' : '') + ax;
  return s;
}

function stripZeros(s: string): string {
  // s has form int[.frac][e...]; strip trailing zeros of frac
  const idx = s.search(/[eE]/);
  const mant = idx < 0 ? s : s.slice(0, idx);
  const tail = idx < 0 ? '' : s.slice(idx);
  if (mant.indexOf('.') < 0) return s;
  return mant.replace(/0+$/, '').replace(/\.$/, '') + tail;
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
    let zeroOk = false;

    if (conv === 's' || conv === 'c') {
      body = String(arg);
      if (conv === 's' && prec >= 0) body = body.slice(0, prec);
    } else if (conv === 'd' || conv === 'i' || conv === 'x' || conv === 'X' || conv === 'o') {
      let n = BigInt(arg as number | bigint);
      if (conv === 'd' || conv === 'i') {
        if (n < 0n) {
          sign = '-';
          n = -n;
        } else sign = plus ? '+' : space ? ' ' : '';
        body = n.toString();
      } else {
        body = n.toString(conv === 'o' ? 8 : 16);
        if (conv === 'X') body = body.toUpperCase();
      }
      if (prec >= 0) {
        if (prec === 0 && n === 0n) body = '';
        body = body.padStart(prec, '0');
      }
      if (conv === 'o') {
        if (alt && body[0] !== '0') body = '0' + body;
      } else if (conv !== 'd' && conv !== 'i' && alt && n !== 0n) {
        prefix = conv === 'x' ? '0x' : '0X';
      }
      zeroOk = prec < 0;
    } else {
      const v = arg as number;
      const upperC = conv === 'E' || conv === 'F' || conv === 'G';
      if (Number.isNaN(v)) {
        body = upperC ? 'NAN' : 'nan';
      } else {
        const neg = v < 0 || Object.is(v, -0);
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        const a = Math.abs(v);
        if (a === Infinity) body = upperC ? 'INF' : 'inf';
        else {
          zeroOk = true;
          const lc = conv.toLowerCase();
          if (lc === 'f') body = fixedBody(a, prec < 0 ? 6 : prec, alt);
          else if (lc === 'e') {
            const p = prec < 0 ? 6 : prec;
            const [d, X] = expParts(a, p);
            body = expBody(d, X, p, alt, upperC);
          } else {
            let P = prec < 0 ? 6 : prec;
            if (P === 0) P = 1;
            const [d, X] = expParts(a, P - 1);
            if (P > X && X >= -4) body = fixedBody(a, P - 1 - X, alt);
            else body = expBody(d, X, P - 1, alt, upperC);
            if (!alt) body = stripZeros(body);
          }
        }
      }
    }

    const len = sign.length + prefix.length + body.length;
    if (len < width) {
      const pad = width - len;
      if (minus) body = sign + prefix + body + ' '.repeat(pad);
      else if (zero && zeroOk && conv !== 's' && conv !== 'c') body = sign + prefix + '0'.repeat(pad) + body;
      else body = ' '.repeat(pad) + sign + prefix + body;
    } else body = sign + prefix + body;
    out += body;
  }
  return out;
}
