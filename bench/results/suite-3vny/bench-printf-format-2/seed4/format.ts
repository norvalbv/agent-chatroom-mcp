// Decompose a finite non-negative double into num/den (BigInts).
function toRational(v: number): [bigint, bigint] {
  if (v === 0) return [0n, 1n];
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, v);
  const hi = buf.getUint32(0);
  const lo = buf.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  let mant = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let e: number;
  if (expBits === 0) {
    e = -1074;
  } else {
    mant |= 1n << 52n;
    e = expBits - 1075;
  }
  return e >= 0 ? [mant << BigInt(e), 1n] : [mant, 1n << BigInt(-e)];
}

// round-half-even of (num/den) * 10^k
function roundScaled(num: bigint, den: bigint, k: number): bigint {
  if (k >= 0) num *= 10n ** BigInt(k);
  else den *= 10n ** BigInt(-k);
  const q = num / den;
  const r = num - q * den;
  const t = r * 2n;
  if (t > den || (t === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// Fixed style digits: integer part and fraction string.
function fixedParts(v: number, prec: number): [string, string] {
  const [n, d] = toRational(v);
  let s = roundScaled(n, d, prec).toString();
  if (prec === 0) return [s, ''];
  if (s.length <= prec) s = '0'.repeat(prec - s.length + 1) + s;
  return [s.slice(0, s.length - prec), s.slice(s.length - prec)];
}

// Exponent-style: digit string of length p+1 and decimal exponent.
function expParts(v: number, p: number): [string, number] {
  if (v === 0) return ['0'.repeat(p + 1), 0];
  const [num, den] = toRational(v);
  let est = Math.floor(Math.log10(v));
  const lo = 10n ** BigInt(p);
  const hi = lo * 10n;
  for (let i = 0; i < 20; i++) {
    const n = roundScaled(num, den, p - est);
    if (n < lo) est--;
    else if (n >= hi) est++;
    else return [n.toString(), est];
  }
  throw new Error('exp estimation failed');
}

function fmtExp(v: number, p: number, alt: boolean, upper: boolean): string {
  const [ds, x] = expParts(v, p);
  let s = ds[0];
  if (p > 0) s += '.' + ds.slice(1);
  else if (alt) s += '.';
  const ax = Math.abs(x);
  s += (upper ? 'E' : 'e') + (x < 0 ? '-' : '+') + (ax < 10 ? '0' + ax : String(ax));
  return s;
}

function fmtFixed(v: number, p: number, alt: boolean): string {
  const [i, f] = fixedParts(v, p);
  if (p > 0) return i + '.' + f;
  return alt ? i + '.' : i;
}

function stripZeros(s: string): string {
  // s has a '.' in the mantissa (before optional exponent)
  const m = /^([^eE]*)([eE].*)?$/.exec(s)!;
  let a = m[1];
  if (a.includes('.')) a = a.replace(/0+$/, '').replace(/\.$/, '');
  return a + (m[2] ?? '');
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
    if (fmt[i] === '*') {
      width = Number(args[ai++]);
      if (width < 0) {
        left = true;
        width = -width;
      }
      i++;
    } else {
      let w = '';
      while (fmt[i] >= '0' && fmt[i] <= '9') w += fmt[i++];
      if (w) width = parseInt(w, 10);
    }
    let prec = -1;
    if (fmt[i] === '.') {
      i++;
      if (fmt[i] === '*') {
        prec = Number(args[ai++]);
        if (prec < 0) prec = -1;
        i++;
      } else {
        let p = '';
        while (fmt[i] >= '0' && fmt[i] <= '9') p += fmt[i++];
        prec = p ? parseInt(p, 10) : 0;
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
    let zeroOk = true;

    switch (conv) {
      case 'd': case 'i': case 'u': case 'x': case 'X': case 'o': {
        const big = BigInt(arg as number | bigint);
        let val: bigint;
        if (conv === 'd' || conv === 'i') val = BigInt.asIntN(bits, big);
        else val = BigInt.asUintN(bits, big);
        if (conv === 'd' || conv === 'i') {
          if (val < 0n) sign = '-';
          else if (plus) sign = '+';
          else if (space) sign = ' ';
          if (val < 0n) val = -val;
        }
        let digits: string;
        if (conv === 'x') digits = val.toString(16);
        else if (conv === 'X') digits = val.toString(16).toUpperCase();
        else if (conv === 'o') digits = val.toString(8);
        else digits = val.toString(10);
        if (prec === 0 && val === 0n) digits = '';
        if (prec >= 0 && digits.length < prec) digits = '0'.repeat(prec - digits.length) + digits;
        if (alt) {
          if ((conv === 'x' || conv === 'X') && val !== 0n) prefix = conv === 'x' ? '0x' : '0X';
          if (conv === 'o' && digits[0] !== '0') digits = '0' + digits;
        }
        body = digits;
        if (prec >= 0) zeroOk = false;
        break;
      }
      case 'e': case 'E': case 'f': case 'F': case 'g': case 'G': {
        const v = arg as number;
        const upper = conv === 'E' || conv === 'F' || conv === 'G';
        if (Number.isNaN(v)) {
          body = upper ? 'NAN' : 'nan';
          zeroOk = false;
          break;
        }
        const neg = v < 0 || Object.is(v, -0);
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        if (!Number.isFinite(v)) {
          body = upper ? 'INF' : 'inf';
          zeroOk = false;
          break;
        }
        const a = Math.abs(v);
        const lc = conv.toLowerCase();
        if (lc === 'e') {
          body = fmtExp(a, prec < 0 ? 6 : prec, alt, upper);
        } else if (lc === 'f') {
          body = fmtFixed(a, prec < 0 ? 6 : prec, alt);
        } else {
          let P = prec < 0 ? 6 : prec;
          if (P === 0) P = 1;
          const x = expParts(a, P - 1)[1];
          if (P > x && x >= -4) body = fmtFixed(a, P - 1 - x, alt);
          else body = fmtExp(a, P - 1, alt, upper);
          if (!alt) body = stripZeros(body);
        }
        break;
      }
      case 's': {
        body = String(arg);
        if (prec >= 0) body = body.slice(0, prec);
        zeroOk = false;
        break;
      }
      case 'c': {
        body = String(arg);
        zeroOk = false;
        break;
      }
    }

    const len = sign.length + prefix.length + body.length;
    if (len >= width) {
      out += sign + prefix + body;
    } else if (left) {
      out += sign + prefix + body + ' '.repeat(width - len);
    } else if (zero && zeroOk) {
      out += sign + prefix + '0'.repeat(width - len) + body;
    } else {
      out += ' '.repeat(width - len) + sign + prefix + body;
    }
  }
  return out;
}
