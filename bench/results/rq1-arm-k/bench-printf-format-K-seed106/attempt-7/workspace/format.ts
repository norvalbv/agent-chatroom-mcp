function roundDiv(num: bigint, den: bigint): bigint {
  const q = num / den;
  const r = num % den;
  const twice = r * 2n;
  if (twice > den || (twice === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// |x| = num / den exactly
function fraction(x: number): [bigint, bigint] {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, Math.abs(x));
  const bits = dv.getBigUint64(0);
  const expBits = Number((bits >> 52n) & 0x7ffn);
  const frac = bits & ((1n << 52n) - 1n);
  let mant: bigint;
  let e2: number;
  if (expBits === 0) {
    mant = frac;
    e2 = -1074;
  } else {
    mant = frac | (1n << 52n);
    e2 = expBits - 1075;
  }
  return e2 >= 0 ? [mant << BigInt(e2), 1n] : [mant, 1n << BigInt(-e2)];
}

function scaled(x: number, pow10: number): bigint {
  // round(|x| * 10^pow10)
  const [num, den] = fraction(x);
  if (pow10 >= 0) return roundDiv(num * 10n ** BigInt(pow10), den);
  return roundDiv(num, den * 10n ** BigInt(-pow10));
}

function fixedDigits(x: number, p: number, alt: boolean): string {
  let s = scaled(x, p).toString();
  if (p > 0) {
    s = s.padStart(p + 1, '0');
    return s.slice(0, s.length - p) + '.' + s.slice(s.length - p);
  }
  return alt ? s + '.' : s;
}

function sciParts(x: number, p: number): { digits: string; exp: number } {
  if (x === 0) return { digits: '0'.repeat(p + 1), exp: 0 };
  let e = Math.floor(Math.log10(Math.abs(x)));
  if (!Number.isFinite(e)) e = -324;
  const lo = 10n ** BigInt(p);
  const hi = lo * 10n;
  for (;;) {
    const n = scaled(x, p - e);
    if (n >= hi) e++;
    else if (n < lo) e--;
    else return { digits: n.toString(), exp: e };
  }
}

function sciString(parts: { digits: string; exp: number }, p: number, alt: boolean, upper: boolean): string {
  let m = parts.digits[0];
  if (p > 0) m += '.' + parts.digits.slice(1);
  else if (alt) m += '.';
  const ae = Math.abs(parts.exp);
  return m + (upper ? 'E' : 'e') + (parts.exp < 0 ? '-' : '+') + (ae < 10 ? '0' + ae : String(ae));
}

function stripZeros(s: string): string {
  // s is a mantissa (maybe followed by exponent)
  const m = /^([^eE]*)([eE].*)?$/.exec(s)!;
  let mant = m[1];
  if (mant.includes('.')) mant = mant.replace(/0+$/, '').replace(/\.$/, '');
  return mant + (m[2] ?? '');
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
    let canZero = true;

    switch (conv) {
      case 'd':
      case 'i': {
        const v = BigInt(arg as number | bigint);
        const neg = v < 0n;
        let d = (neg ? -v : v).toString();
        if (prec === 0 && v === 0n) d = '';
        if (prec > 0) d = d.padStart(prec, '0');
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        body = d;
        if (prec >= 0) canZero = false;
        break;
      }
      case 'x':
      case 'X':
      case 'o': {
        const v = BigInt(arg as number | bigint);
        let d = v.toString(conv === 'o' ? 8 : 16);
        if (conv === 'X') d = d.toUpperCase();
        if (prec === 0 && v === 0n) d = '';
        if (prec > 0) d = d.padStart(prec, '0');
        if (alt) {
          if (conv === 'o') {
            if (d[0] !== '0') d = '0' + d;
          } else if (v !== 0n) prefix = conv === 'x' ? '0x' : '0X';
        }
        body = d;
        if (prec >= 0) canZero = false;
        break;
      }
      case 'e': case 'E': case 'f': case 'F': case 'g': case 'G': {
        const x = arg as number;
        const upper = conv === 'E' || conv === 'F' || conv === 'G';
        if (Number.isNaN(x)) {
          body = upper ? 'NAN' : 'nan';
          canZero = false;
          break;
        }
        const neg = x < 0 || Object.is(x, -0);
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        if (!Number.isFinite(x)) {
          body = upper ? 'INF' : 'inf';
          canZero = false;
          break;
        }
        const lc = conv.toLowerCase();
        if (lc === 'f') {
          body = fixedDigits(x, prec < 0 ? 6 : prec, alt);
        } else if (lc === 'e') {
          const p = prec < 0 ? 6 : prec;
          body = sciString(sciParts(x, p), p, alt, upper);
        } else {
          let P = prec < 0 ? 6 : prec;
          if (P === 0) P = 1;
          const parts = sciParts(x, P - 1);
          const X = parts.exp;
          if (P > X && X >= -4) body = fixedDigits(x, P - 1 - X, alt);
          else body = sciString(parts, P - 1, alt, upper);
          if (!alt) body = stripZeros(body);
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
