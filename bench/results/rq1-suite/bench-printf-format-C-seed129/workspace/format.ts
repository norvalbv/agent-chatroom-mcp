// round(|v| * 10^k) half-even, exactly, for finite v != 0 given as m * 2^e
function scaled(m: bigint, e: number, k: number): bigint {
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

function decompose(v: number): { m: bigint; e: number } {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, Math.abs(v));
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const bexp = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (bexp === 0) return { m, e: -1074 };
  m |= 1n << 52n;
  return { m, e: bexp - 1075 };
}

// e-style digits: returns digit string of length p+1 and decimal exponent
function eDigits(v: number, p: number): { digits: string; x: number } {
  if (v === 0) return { digits: '0'.repeat(p + 1), x: 0 };
  const { m, e } = decompose(v);
  let x = Math.floor(Math.log10(Math.abs(v)));
  if (!isFinite(x)) x = -324;
  for (;;) {
    const n = scaled(m, e, p - x);
    const s = n.toString();
    if (s.length > p + 1) x++;
    else if (s.length < p + 1) x--;
    else return { digits: s, x };
  }
}

function fDigits(v: number, p: number): string {
  // digits string of round(|v|*10^p), at least p+1 long
  let s = '0';
  if (v !== 0) {
    const { m, e } = decompose(v);
    s = scaled(m, e, p).toString();
  }
  return s.padStart(p + 1, '0');
}

function fixed(v: number, p: number, alt: boolean): string {
  const s = fDigits(v, p);
  const ip = s.slice(0, s.length - p);
  const fp = s.slice(s.length - p);
  return ip + (p > 0 || alt ? '.' : '') + fp;
}

function expo(v: number, p: number, alt: boolean, up: boolean): string {
  const { digits, x } = eDigits(v, p);
  const ax = Math.abs(x);
  return (
    digits[0] +
    (p > 0 || alt ? '.' : '') +
    digits.slice(1) +
    (up ? 'E' : 'e') +
    (x < 0 ? '-' : '+') +
    (ax < 10 ? '0' : '') +
    ax
  );
}

function stripZeros(s: string): string {
  // s has a '.'; remove trailing zeros in fractional part (before any exponent)
  let mant = s;
  let suffix = '';
  const ei = s.search(/[eE]/);
  if (ei >= 0) {
    mant = s.slice(0, ei);
    suffix = s.slice(ei);
  }
  if (mant.indexOf('.') >= 0) {
    mant = mant.replace(/0+$/, '');
    if (mant.endsWith('.')) mant = mant.slice(0, -1);
  }
  return mant + suffix;
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
    let ws = '';
    while (fmt[i] >= '0' && fmt[i] <= '9') ws += fmt[i++];
    const width = ws ? parseInt(ws, 10) : 0;
    let prec = -1;
    if (fmt[i] === '.') {
      i++;
      let ps = '';
      while (fmt[i] >= '0' && fmt[i] <= '9') ps += fmt[i++];
      prec = ps ? parseInt(ps, 10) : 0;
    }
    const conv = fmt[i++];
    const arg = args[ai++];

    let sign = '';
    let prefix = '';
    let body = '';
    let canZero = false;

    if (conv === 's' || conv === 'c') {
      body = String(arg);
      if (conv === 's' && prec >= 0) body = body.slice(0, prec);
    } else if (conv === 'd' || conv === 'i') {
      const v = BigInt(arg as number | bigint);
      const neg = v < 0n;
      body = (neg ? -v : v).toString();
      if (prec >= 0) {
        if (prec === 0 && v === 0n) body = '';
        body = body.padStart(prec, '0');
      }
      sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
      canZero = prec < 0;
    } else if (conv === 'x' || conv === 'X' || conv === 'o') {
      const v = BigInt(arg as number | bigint);
      body = v.toString(conv === 'o' ? 8 : 16);
      if (conv === 'X') body = body.toUpperCase();
      if (prec >= 0) {
        if (prec === 0 && v === 0n) body = '';
        body = body.padStart(prec, '0');
      }
      if (alt) {
        if (conv === 'o') {
          if (body[0] !== '0') body = '0' + body;
        } else if (v !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      }
      canZero = prec < 0;
    } else {
      const v = arg as number;
      const up = conv === 'E' || conv === 'F' || conv === 'G';
      const neg = v < 0 || Object.is(v, -0);
      sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
      if (Number.isNaN(v)) {
        sign = '';
        body = up ? 'NAN' : 'nan';
      } else if (!isFinite(v)) {
        body = up ? 'INF' : 'inf';
      } else {
        canZero = true;
        if (conv === 'e' || conv === 'E') {
          body = expo(v, prec < 0 ? 6 : prec, alt, up);
        } else if (conv === 'f' || conv === 'F') {
          body = fixed(v, prec < 0 ? 6 : prec, alt);
        } else {
          let P = prec < 0 ? 6 : prec;
          if (P === 0) P = 1;
          const { x } = eDigits(v, P - 1);
          if (P > x && x >= -4) body = fixed(v, P - 1 - x, alt);
          else body = expo(v, P - 1, alt, up);
          if (!alt) body = stripZeros(body);
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
