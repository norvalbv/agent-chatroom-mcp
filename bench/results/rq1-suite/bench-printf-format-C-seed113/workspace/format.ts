// Decompose a finite non-negative double into m * 2^e exactly.
function decompose(x: number): [bigint, number] {
  if (x === 0) return [0n, 0];
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

// round_half_even(m * 2^e * 10^s), s may be negative.
function roundScaled(m: bigint, e: number, s: number): bigint {
  let num = m;
  let den = 1n;
  if (e >= 0) num <<= BigInt(e);
  else den <<= BigInt(-e);
  if (s >= 0) num *= 10n ** BigInt(s);
  else den *= 10n ** BigInt(-s);
  const q = num / den;
  const r = num - q * den;
  const twice = r * 2n;
  if (twice > den || (twice === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

function fixedDigits(x: number, p: number): string {
  const [m, e] = decompose(x);
  let s = roundScaled(m, e, p).toString();
  if (p > 0) {
    if (s.length < p + 1) s = '0'.repeat(p + 1 - s.length) + s;
    return s.slice(0, s.length - p) + '.' + s.slice(s.length - p);
  }
  return s;
}

// Returns [digits (p+1 digits), exponent]
function expDigits(x: number, p: number): [string, number] {
  if (x === 0) return ['0'.repeat(p + 1), 0];
  const [m, e] = decompose(x);
  let x10 = Math.floor(Math.log10(x));
  if (!isFinite(x10)) x10 = -324;
  const lo = 10n ** BigInt(p);
  const hi = lo * 10n;
  for (;;) {
    const n = roundScaled(m, e, p - x10);
    if (n >= hi) x10++;
    else if (n < lo) x10--;
    else return [n.toString(), x10];
  }
}

function expStr(digits: string, x10: number, p: number, alt: boolean, upper: boolean): string {
  let s = digits[0];
  if (p > 0) s += '.' + digits.slice(1);
  else if (alt) s += '.';
  const ax = Math.abs(x10);
  s += (upper ? 'E' : 'e') + (x10 < 0 ? '-' : '+') + (ax < 10 ? '0' : '') + ax;
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
    for (; i < n; i++) {
      const f = fmt[i];
      if (f === '-') minus = true;
      else if (f === '+') plus = true;
      else if (f === ' ') space = true;
      else if (f === '0') zero = true;
      else if (f === '#') alt = true;
      else break;
    }
    let width = 0;
    while (i < n && fmt[i] >= '0' && fmt[i] <= '9') width = width * 10 + (fmt.charCodeAt(i++) - 48);
    let prec = -1;
    if (fmt[i] === '.') {
      i++;
      prec = 0;
      while (i < n && fmt[i] >= '0' && fmt[i] <= '9') prec = prec * 10 + (fmt.charCodeAt(i++) - 48);
    }
    const conv = fmt[i++];
    const arg = args[ai++];

    let sign = '';
    let prefix = '';
    let body = '';
    let canZero = false;

    const signFor = (neg: boolean) => (neg ? '-' : plus ? '+' : space ? ' ' : '');

    if (conv === 'd' || conv === 'i') {
      const v = BigInt(arg as number | bigint);
      sign = signFor(v < 0n);
      body = (v < 0n ? -v : v).toString();
      if (prec === 0 && v === 0n) body = '';
      if (prec >= 0 && body.length < prec) body = '0'.repeat(prec - body.length) + body;
      canZero = prec < 0;
    } else if (conv === 'x' || conv === 'X' || conv === 'o') {
      const v = BigInt(arg as number | bigint);
      body = v.toString(conv === 'o' ? 8 : 16);
      if (conv === 'X') body = body.toUpperCase();
      if (prec === 0 && v === 0n) body = '';
      if (prec >= 0 && body.length < prec) body = '0'.repeat(prec - body.length) + body;
      if (alt) {
        if (conv === 'o') {
          if (body[0] !== '0') body = '0' + body;
        } else if (v !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      }
      canZero = prec < 0;
    } else if ('eEfFgG'.includes(conv)) {
      const x = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      const neg = x < 0 || Object.is(x, -0);
      if (Number.isNaN(x)) {
        body = upper ? 'NAN' : 'nan';
      } else {
        sign = signFor(neg);
        if (!isFinite(x)) {
          body = upper ? 'INF' : 'inf';
        } else {
          const ax = Math.abs(x);
          const lc = conv.toLowerCase();
          canZero = true;
          if (lc === 'f') {
            const p = prec < 0 ? 6 : prec;
            body = fixedDigits(ax, p);
            if (p === 0 && alt) body += '.';
          } else if (lc === 'e') {
            const p = prec < 0 ? 6 : prec;
            const [d, x10] = expDigits(ax, p);
            body = expStr(d, x10, p, alt, upper);
          } else {
            let P = prec < 0 ? 6 : prec;
            if (P === 0) P = 1;
            const [d, X] = expDigits(ax, P - 1);
            if (P > X && X >= -4) {
              body = fixedDigits(ax, P - 1 - X);
              if (alt) {
                if (!body.includes('.')) body += '.';
              } else if (body.includes('.')) {
                body = body.replace(/0+$/, '').replace(/\.$/, '');
              }
            } else {
              let mant = d[0];
              let frac = d.slice(1);
              if (!alt) frac = frac.replace(/0+$/, '');
              if (frac.length > 0 || alt) mant += '.' + frac;
              const aX = Math.abs(X);
              body = mant + (upper ? 'E' : 'e') + (X < 0 ? '-' : '+') + (aX < 10 ? '0' : '') + aX;
            }
          }
        }
      }
    } else if (conv === 's') {
      body = String(arg);
      if (prec >= 0) body = body.slice(0, prec);
    } else {
      body = String(arg);
    }

    let len = sign.length + prefix.length + body.length;
    if (len < width) {
      if (minus) {
        out += sign + prefix + body + ' '.repeat(width - len);
      } else if (zero && canZero) {
        out += sign + prefix + '0'.repeat(width - len) + body;
      } else {
        out += ' '.repeat(width - len) + sign + prefix + body;
      }
    } else {
      out += sign + prefix + body;
    }
  }
  return out;
}
