// Round num/den to nearest integer, ties to even.
function roundDiv(num: bigint, den: bigint): bigint {
  const q = num / den;
  const r = num % den;
  const t = r * 2n;
  if (t > den || (t === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// Decompose finite non-negative double into m * 2^e.
function decompose(v: number): [bigint, number] {
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

// round(v * 10^k) as bigint, k may be negative.
function scaled(v: number, k: number): bigint {
  const [m, e] = decompose(v);
  let num = m;
  let den = 1n;
  if (e >= 0) num <<= BigInt(e);
  else den <<= BigInt(-e);
  if (k >= 0) num *= 10n ** BigInt(k);
  else den *= 10n ** BigInt(-k);
  return roundDiv(num, den);
}

function fixedDigits(v: number, p: number): string {
  let s = scaled(v, p).toString();
  if (p === 0) return s;
  if (s.length <= p) s = '0'.repeat(p - s.length + 1) + s;
  return s.slice(0, s.length - p) + '.' + s.slice(s.length - p);
}

// Returns p+1 digits and decimal exponent.
function expDigits(v: number, p: number): [string, number] {
  if (v === 0) return ['0'.repeat(p + 1), 0];
  let x = Math.floor(Math.log10(v));
  if (!isFinite(x)) x = -324;
  const lo = 10n ** BigInt(p);
  const hi = lo * 10n;
  for (;;) {
    const d = scaled(v, p - x);
    if (d >= hi) x++;
    else if (d < lo) x--;
    else return [d.toString(), x];
  }
}

function expStr(digits: string, x: number, p: number, alt: boolean, upper: boolean): string {
  let s = digits[0];
  if (p > 0 || alt) s += '.';
  s += digits.slice(1);
  const ax = Math.abs(x);
  s += (upper ? 'E' : 'e') + (x < 0 ? '-' : '+') + (ax < 10 ? '0' : '') + ax;
  return s;
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
    let canZero = true;
    const signFor = (neg: boolean) => (neg ? '-' : plus ? '+' : space ? ' ' : '');

    switch (conv) {
      case 'd':
      case 'i': {
        const n = BigInt(arg as number | bigint);
        sign = signFor(n < 0n);
        body = (n < 0n ? -n : n).toString();
        if (prec === 0 && n === 0n) body = '';
        if (prec > body.length) body = '0'.repeat(prec - body.length) + body;
        if (prec >= 0) canZero = false;
        break;
      }
      case 'x':
      case 'X':
      case 'o': {
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
        if (prec >= 0) canZero = false;
        break;
      }
      case 'e': case 'E': case 'f': case 'F': case 'g': case 'G': {
        const v = arg as number;
        const upper = conv === 'E' || conv === 'F' || conv === 'G';
        if (isNaN(v)) {
          body = upper ? 'NAN' : 'nan';
          canZero = false;
          break;
        }
        sign = signFor(v < 0 || Object.is(v, -0));
        if (!isFinite(v)) {
          body = upper ? 'INF' : 'inf';
          canZero = false;
          break;
        }
        const a = Math.abs(v);
        const lower = conv.toLowerCase();
        if (lower === 'f') {
          const p = prec < 0 ? 6 : prec;
          body = fixedDigits(a, p);
          if (p === 0 && alt) body += '.';
        } else if (lower === 'e') {
          const p = prec < 0 ? 6 : prec;
          const [d, x] = expDigits(a, p);
          body = expStr(d, x, p, alt, upper);
        } else {
          const P = prec < 0 ? 6 : prec === 0 ? 1 : prec;
          const [d, x] = expDigits(a, P - 1);
          if (P > x && x >= -4) {
            body = fixedDigits(a, P - 1 - x);
            if (P - 1 - x === 0 && alt) body += '.';
            if (!alt) body = stripZeros(body);
          } else {
            let mant = d[0] + (P > 1 || alt ? '.' : '') + d.slice(1);
            if (!alt) mant = stripZeros(mant);
            const ax = Math.abs(x);
            body = mant + (upper ? 'E' : 'e') + (x < 0 ? '-' : '+') + (ax < 10 ? '0' : '') + ax;
          }
        }
        break;
      }
      case 's': {
        body = String(arg);
        if (prec >= 0) body = body.slice(0, prec);
        canZero = false;
        break;
      }
      case 'c': {
        body = String(arg);
        canZero = false;
        break;
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
