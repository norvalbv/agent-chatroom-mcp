// Decompose a positive finite double into m * 2^e exactly.
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

// round_half_even(v * 10^k) as a BigInt, where v = m * 2^e
function roundScaled(m: bigint, e: number, k: number): bigint {
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

// digits (p+1 of them) and decimal exponent for e-style
function expDigits(v: number, p: number): [string, number] {
  if (v === 0) return ['0'.repeat(p + 1), 0];
  const [m, e] = decompose(v);
  let X = Math.floor(Math.log10(v));
  if (!isFinite(X)) X = -324;
  for (;;) {
    const n = roundScaled(m, e, p - X);
    const s = n.toString();
    if (s.length > p + 1) X++;
    else if (s.length < p + 1) X--;
    else return [s, X];
  }
}

function fixedStr(v: number, p: number, alt: boolean): string {
  let s: string;
  if (v === 0) s = '0'.repeat(p + 1);
  else {
    const [m, e] = decompose(v);
    s = roundScaled(m, e, p).toString();
    if (s.length < p + 1) s = '0'.repeat(p + 1 - s.length) + s;
  }
  const ip = s.slice(0, s.length - p);
  const fp = s.slice(s.length - p);
  return ip + (p > 0 || alt ? '.' : '') + fp;
}

function expStr(v: number, p: number, alt: boolean, upper: boolean): string {
  const [d, X] = expDigits(v, p);
  const ax = Math.abs(X);
  return (
    d[0] + (p > 0 || alt ? '.' : '') + d.slice(1) +
    (upper ? 'E' : 'e') + (X < 0 ? '-' : '+') + (ax < 10 ? '0' : '') + ax
  );
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
    if (fmt[i] === '*') {
      width = Number(args[ai++]);
      i++;
      if (width < 0) {
        left = true;
        width = -width;
      }
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
        i++;
        if (prec < 0) prec = -1;
      } else {
        let p = '';
        while (fmt[i] >= '0' && fmt[i] <= '9') p += fmt[i++];
        prec = p ? parseInt(p, 10) : 0;
      }
    }
    let bits = 32;
    if (fmt.startsWith('hh', i)) {
      bits = 8;
      i += 2;
    } else if (fmt.startsWith('ll', i)) {
      bits = 64;
      i += 2;
    } else if (fmt[i] === 'h') {
      bits = 16;
      i++;
    } else if (fmt[i] === 'l') {
      bits = 64;
      i++;
    }
    const conv = fmt[i++];
    const arg = args[ai++];

    let prefix = ''; // sign / 0x
    let body = '';
    let canZero = true;
    switch (conv) {
      case 'd': case 'i': case 'u': case 'x': case 'X': case 'o': {
        const big = BigInt(arg as number | bigint);
        const signed = conv === 'd' || conv === 'i';
        const val = signed ? BigInt.asIntN(bits, big) : BigInt.asUintN(bits, big);
        const neg = val < 0n;
        const mag = neg ? -val : val;
        let digits =
          conv === 'x' ? mag.toString(16)
          : conv === 'X' ? mag.toString(16).toUpperCase()
          : conv === 'o' ? mag.toString(8)
          : mag.toString(10);
        if (prec === 0 && mag === 0n) digits = '';
        if (prec > digits.length) digits = '0'.repeat(prec - digits.length) + digits;
        if (signed) prefix = neg ? '-' : plus ? '+' : space ? ' ' : '';
        if (alt) {
          if ((conv === 'x' || conv === 'X') && mag !== 0n) prefix = conv === 'x' ? '0x' : '0X';
          else if (conv === 'o' && digits[0] !== '0') digits = '0' + digits;
        }
        body = digits;
        if (prec >= 0) canZero = false;
        break;
      }
      case 'e': case 'E': case 'f': case 'F': case 'g': case 'G': {
        const v = arg as number;
        const upper = conv === 'E' || conv === 'F' || conv === 'G';
        if (Number.isNaN(v)) {
          body = upper ? 'NAN' : 'nan';
          canZero = false;
          break;
        }
        const neg = v < 0 || Object.is(v, -0);
        prefix = neg ? '-' : plus ? '+' : space ? ' ' : '';
        const a = Math.abs(v);
        if (a === Infinity) {
          body = upper ? 'INF' : 'inf';
          canZero = false;
          break;
        }
        const lc = conv.toLowerCase();
        if (lc === 'f') body = fixedStr(a, prec < 0 ? 6 : prec, alt);
        else if (lc === 'e') body = expStr(a, prec < 0 ? 6 : prec, alt, upper);
        else {
          let P = prec < 0 ? 6 : prec;
          if (P === 0) P = 1;
          const X = expDigits(a, P - 1)[1];
          if (P > X && X >= -4) {
            body = fixedStr(a, P - 1 - X, alt);
            if (!alt) body = stripZeros(body);
          } else {
            body = expStr(a, P - 1, alt, upper);
            if (!alt) {
              const idx = body.search(/[eE]/);
              body = stripZeros(body.slice(0, idx)) + body.slice(idx);
            }
          }
        }
        break;
      }
      case 's': {
        body = arg as string;
        if (prec >= 0) body = body.slice(0, prec);
        canZero = false;
        break;
      }
      case 'c':
        body = arg as string;
        canZero = false;
        break;
    }
    const len = prefix.length + body.length;
    if (len >= width) out += prefix + body;
    else if (left) out += prefix + body + ' '.repeat(width - len);
    else if (zero && canZero) out += prefix + '0'.repeat(width - len) + body;
    else out += ' '.repeat(width - len) + prefix + body;
  }
  return out;
}
