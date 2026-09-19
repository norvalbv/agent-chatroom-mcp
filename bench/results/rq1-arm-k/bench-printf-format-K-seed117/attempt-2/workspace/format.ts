// Decompose a finite non-negative double into m * 2^e exactly.
function decompose(v: number): [bigint, number] {
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, v);
  const hi = buf.getUint32(0);
  const lo = buf.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  let mant = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (expBits === 0) return [mant, -1074];
  mant |= 1n << 52n;
  return [mant, expBits - 1075];
}

// round-half-even(v * 10^k) as a BigInt, exact.
function scaled(m: bigint, e: number, k: number): bigint {
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

// Fixed-style digits (no sign) of |v| with prec fractional digits.
function fixedDigits(v: number, prec: number, alt: boolean): string {
  const [m, e] = decompose(v);
  let s = scaled(m, e, prec).toString();
  if (prec > 0) {
    s = s.padStart(prec + 1, '0');
    s = s.slice(0, s.length - prec) + '.' + s.slice(s.length - prec);
  } else if (alt) s += '.';
  return s;
}

// Exponent-style pieces: digit string of length prec+1 and decimal exponent.
function expParts(v: number, prec: number): [string, number] {
  if (v === 0) return ['0'.repeat(prec + 1), 0];
  const [m, e] = decompose(v);
  let x = Math.floor(Math.log10(v));
  if (!isFinite(x)) x = -324;
  for (;;) {
    const d = scaled(m, e, prec - x);
    const s = d.toString();
    if (s.length > prec + 1) x++;
    else if (s.length < prec + 1) x--;
    else return [s, x];
  }
}

function expStyle(v: number, prec: number, alt: boolean, upper: boolean): string {
  const [d, x] = expParts(v, prec);
  let s = d[0];
  if (prec > 0) s += '.' + d.slice(1);
  else if (alt) s += '.';
  const ax = Math.abs(x);
  return s + (upper ? 'E' : 'e') + (x < 0 ? '-' : '+') + (ax < 10 ? '0' + ax : String(ax));
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
    let left = false, plus = false, space = false, zero = false, alt = false;
    for (;; i++) {
      const c = fmt[i];
      if (c === '-') left = true;
      else if (c === '+') plus = true;
      else if (c === ' ') space = true;
      else if (c === '0') zero = true;
      else if (c === '#') alt = true;
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
    let numeric = true;
    let canZero = true;
    const lower = conv.toLowerCase();

    if (conv === 'd' || conv === 'i') {
      const b = BigInt(arg as number | bigint);
      const neg = b < 0n;
      let digits = (neg ? -b : b).toString();
      if (prec === 0 && b === 0n) digits = '';
      if (prec > 0) digits = digits.padStart(prec, '0');
      sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
      body = digits;
      if (prec >= 0) canZero = false;
    } else if (conv === 'x' || conv === 'X' || conv === 'o') {
      const b = BigInt(arg as number | bigint);
      let digits = b.toString(conv === 'o' ? 8 : 16);
      if (conv === 'X') digits = digits.toUpperCase();
      if (prec === 0 && b === 0n) digits = '';
      if (prec > 0) digits = digits.padStart(prec, '0');
      if (alt) {
        if (conv === 'o') {
          if (digits[0] !== '0') digits = '0' + digits;
        } else if (b !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      }
      body = digits;
      if (prec >= 0) canZero = false;
    } else if ('efg'.includes(lower)) {
      const n = arg as number;
      const upper = conv !== lower;
      const neg = n < 0 || Object.is(n, -0);
      if (Number.isNaN(n)) {
        body = upper ? 'NAN' : 'nan';
        canZero = false;
      } else {
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        const v = Math.abs(n);
        if (v === Infinity) {
          body = upper ? 'INF' : 'inf';
          canZero = false;
        } else if (lower === 'f') {
          body = fixedDigits(v, prec < 0 ? 6 : prec, alt);
        } else if (lower === 'e') {
          body = expStyle(v, prec < 0 ? 6 : prec, alt, upper);
        } else {
          let p = prec < 0 ? 6 : prec;
          if (p === 0) p = 1;
          const x = expParts(v, p - 1)[1];
          if (p > x && x >= -4) {
            body = fixedDigits(v, p - 1 - x, alt);
            if (!alt) body = stripZeros(body);
          } else {
            body = expStyle(v, p - 1, alt, upper);
            if (!alt) {
              const k = body.search(/[eE]/);
              body = stripZeros(body.slice(0, k)) + body.slice(k);
            }
          }
        }
      }
    } else if (conv === 's') {
      numeric = false;
      body = String(arg);
      if (prec >= 0) body = body.slice(0, prec);
    } else {
      numeric = false;
      body = String(arg);
    }

    const len = sign.length + prefix.length + body.length;
    if (len < width) {
      const pad = width - len;
      if (left) body = sign + prefix + body + ' '.repeat(pad), sign = prefix = '';
      else if (numeric && zero && canZero) body = '0'.repeat(pad) + body;
      else sign = ' '.repeat(pad) + sign;
    }
    out += sign + prefix + body;
  }
  return out;
}
