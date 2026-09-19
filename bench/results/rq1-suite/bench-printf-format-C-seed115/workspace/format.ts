// Decompose a finite non-negative double into m * 2^e (m, e integers).
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

// round_half_even(m * 2^e * 10^k), k may be negative.
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

// Fixed notation of |v| with p fractional digits.
function fixedDigits(v: number, p: number, alt: boolean): string {
  const [m, e] = decompose(v);
  let s = roundScaled(m, e, p).toString();
  if (p > 0) {
    s = s.padStart(p + 1, '0');
    return s.slice(0, s.length - p) + '.' + s.slice(s.length - p);
  }
  return alt ? s + '.' : s;
}

// Scientific decomposition: digits (p+1 of them) and decimal exponent.
function sciParts(v: number, p: number): [string, number] {
  if (v === 0) return ['0'.repeat(p + 1), 0];
  const [m, e] = decompose(v);
  let x = Math.floor(Math.log10(v));
  if (!isFinite(x)) x = -324;
  const lo = 10n ** BigInt(p);
  const hi = lo * 10n;
  for (;;) {
    const n = roundScaled(m, e, p - x);
    if (n >= hi) x++;
    else if (n < lo) x--;
    else return [n.toString(), x];
  }
}

function expText(x: number, upper: boolean): string {
  const a = Math.abs(x).toString().padStart(2, '0');
  return (upper ? 'E' : 'e') + (x < 0 ? '-' : '+') + a;
}

function sciString(digits: string, x: number, p: number, alt: boolean, upper: boolean): string {
  let s = digits[0];
  if (p > 0) s += '.' + digits.slice(1);
  else if (alt) s += '.';
  return s + expText(x, upper);
}

function stripZeros(s: string): string {
  if (!s.includes('.')) return s;
  s = s.replace(/0+$/, '');
  if (s.endsWith('.')) s = s.slice(0, -1);
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
    let left = false, plus = false, space = false, zero = false, alt = false;
    for (;; i++) {
      const f = fmt[i];
      if (f === '-') left = true;
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

    switch (conv) {
      case 'd':
      case 'i': {
        const n = BigInt(arg as number | bigint);
        const neg = n < 0n;
        let digits = (neg ? -n : n).toString();
        if (prec === 0 && n === 0n) digits = '';
        if (prec > digits.length) digits = digits.padStart(prec, '0');
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        body = digits;
        canZero = prec < 0;
        break;
      }
      case 'x':
      case 'X':
      case 'o': {
        const n = BigInt(arg as number | bigint);
        let digits = n.toString(conv === 'o' ? 8 : 16);
        if (conv === 'X') digits = digits.toUpperCase();
        if (prec === 0 && n === 0n) digits = '';
        if (prec > digits.length) digits = digits.padStart(prec, '0');
        if (alt) {
          if (conv === 'o') {
            if (digits[0] !== '0') digits = '0' + digits;
          } else if (n !== 0n) prefix = conv === 'x' ? '0x' : '0X';
        }
        body = digits;
        canZero = prec < 0;
        break;
      }
      case 'e':
      case 'E':
      case 'f':
      case 'F':
      case 'g':
      case 'G': {
        const v = arg as number;
        const upper = conv === 'E' || conv === 'F' || conv === 'G';
        const neg = v < 0 || Object.is(v, -0);
        if (Number.isNaN(v)) {
          body = upper ? 'NAN' : 'nan';
        } else {
          sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
          const a = Math.abs(v);
          if (a === Infinity) {
            body = upper ? 'INF' : 'inf';
          } else {
            canZero = true;
            const lc = conv.toLowerCase();
            if (lc === 'f') {
              body = fixedDigits(a, prec < 0 ? 6 : prec, alt);
            } else if (lc === 'e') {
              const p = prec < 0 ? 6 : prec;
              const [d, x] = sciParts(a, p);
              body = sciString(d, x, p, alt, upper);
            } else {
              let P = prec < 0 ? 6 : prec;
              if (P === 0) P = 1;
              const [d, x] = sciParts(a, P - 1);
              if (P > x && x >= -4) {
                body = fixedDigits(a, P - 1 - x, alt);
                if (!alt) body = stripZeros(body);
              } else {
                let mant = d[0];
                if (P - 1 > 0) mant += '.' + d.slice(1);
                else if (alt) mant += '.';
                if (!alt) mant = stripZeros(mant);
                body = mant + expText(x, upper);
              }
            }
          }
        }
        if (!canZero) { /* inf/nan: spaces */ }
        break;
      }
      case 's': {
        body = String(arg);
        if (prec >= 0) body = body.slice(0, prec);
        break;
      }
      case 'c': {
        body = String(arg);
        break;
      }
    }

    const len = sign.length + prefix.length + body.length;
    if (len >= width) {
      out += sign + prefix + body;
    } else if (left) {
      out += sign + prefix + body + ' '.repeat(width - len);
    } else if (zero && canZero) {
      out += sign + prefix + '0'.repeat(width - len) + body;
    } else {
      out += ' '.repeat(width - len) + sign + prefix + body;
    }
  }
  return out;
}
