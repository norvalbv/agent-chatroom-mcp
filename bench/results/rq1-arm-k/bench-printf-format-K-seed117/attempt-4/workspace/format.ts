function decompose(x: number): { m: bigint; e: number } {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (expBits === 0) return { m, e: -1074 };
  m |= 1n << 52n;
  return { m, e: expBits - 1075 };
}

// round-half-even of m * 2^e * 10^k
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

// digits (p+1 of them) and decimal exponent, x >= 0 finite
function eDigits(x: number, p: number): { digits: string; exp: number } {
  if (x === 0) return { digits: '0'.repeat(p + 1), exp: 0 };
  const { m, e } = decompose(x);
  let E = Math.floor(Math.log10(x));
  if (!isFinite(E)) E = -324;
  for (;;) {
    const s = roundScaled(m, e, p - E).toString();
    if (s.length > p + 1) E++;
    else if (s.length < p + 1) E--;
    else return { digits: s, exp: E };
  }
}

function fStyle(x: number, p: number, alt: boolean): string {
  let s: string;
  if (x === 0) s = '0'.repeat(p + 1);
  else {
    const { m, e } = decompose(x);
    s = roundScaled(m, e, p).toString();
    if (s.length < p + 1) s = '0'.repeat(p + 1 - s.length) + s;
  }
  const ip = s.slice(0, s.length - p);
  const fp = s.slice(s.length - p);
  return ip + (p > 0 || alt ? '.' : '') + fp;
}

function eStyle(x: number, p: number, alt: boolean, upper: boolean): string {
  const { digits, exp } = eDigits(x, p);
  const ax = Math.abs(exp);
  const es = (ax < 10 ? '0' : '') + ax;
  return (
    digits[0] + (p > 0 || alt ? '.' : '') + digits.slice(1) +
    (upper ? 'E' : 'e') + (exp < 0 ? '-' : '+') + es
  );
}

function stripZeros(s: string): string {
  // s has form int[.frac] optionally followed by exponent part
  const ei = s.search(/[eE]/);
  const mant = ei >= 0 ? s.slice(0, ei) : s;
  const rest = ei >= 0 ? s.slice(ei) : '';
  if (mant.indexOf('.') < 0) return s;
  return mant.replace(/0+$/, '').replace(/\.$/, '') + rest;
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
    let prefix = '';
    let body = '';
    let canZero = false;
    const signOf = (neg: boolean) => (neg ? '-' : plus ? '+' : space ? ' ' : '');

    switch (conv) {
      case 'd':
      case 'i': {
        const v = BigInt(arg as number | bigint);
        prefix = signOf(v < 0n);
        body = (v < 0n ? -v : v).toString();
        if (prec === 0 && v === 0n) body = '';
        if (prec > body.length) body = '0'.repeat(prec - body.length) + body;
        canZero = prec < 0;
        break;
      }
      case 'x':
      case 'X':
      case 'o': {
        const v = BigInt(arg as number | bigint);
        body = v.toString(conv === 'o' ? 8 : 16);
        if (conv === 'X') body = body.toUpperCase();
        if (prec === 0 && v === 0n) body = '';
        if (prec > body.length) body = '0'.repeat(prec - body.length) + body;
        if (alt) {
          if (conv === 'o') {
            if (body[0] !== '0') body = '0' + body;
          } else if (v !== 0n) prefix = conv === 'x' ? '0x' : '0X';
        }
        canZero = prec < 0;
        break;
      }
      case 'e':
      case 'E':
      case 'f':
      case 'F':
      case 'g':
      case 'G': {
        const x = arg as number;
        const upper = conv === 'E' || conv === 'F' || conv === 'G';
        if (Number.isNaN(x)) {
          body = upper ? 'NAN' : 'nan';
          break;
        }
        const neg = x < 0 || Object.is(x, -0);
        prefix = signOf(neg);
        const ax = Math.abs(x);
        if (ax === Infinity) {
          body = upper ? 'INF' : 'inf';
          break;
        }
        canZero = true;
        const lc = conv.toLowerCase();
        if (lc === 'f') body = fStyle(ax, prec < 0 ? 6 : prec, alt);
        else if (lc === 'e') body = eStyle(ax, prec < 0 ? 6 : prec, alt, conv === 'E');
        else {
          let P = prec < 0 ? 6 : prec;
          if (P === 0) P = 1;
          const X = eDigits(ax, P - 1).exp;
          if (P > X && X >= -4) body = fStyle(ax, P - 1 - X, alt);
          else body = eStyle(ax, P - 1, alt, conv === 'G');
          if (!alt) body = stripZeros(body);
        }
        break;
      }
      case 's': {
        body = String(arg);
        if (prec >= 0) body = body.slice(0, prec);
        break;
      }
      case 'c':
        body = String(arg);
        break;
    }

    const len = prefix.length + body.length;
    if (len >= width) out += prefix + body;
    else if (minus) out += prefix + body + ' '.repeat(width - len);
    else if (zero && canZero) out += prefix + '0'.repeat(width - len) + body;
    else out += ' '.repeat(width - len) + prefix + body;
  }
  return out;
}
