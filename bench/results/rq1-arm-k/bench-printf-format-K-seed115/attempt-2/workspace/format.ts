function decompose(v: number): { m: bigint; e: number } {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, v);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const exp = (hi >>> 20) & 0x7ff;
  const frac = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (exp === 0) return { m: frac, e: -1074 };
  return { m: frac | (1n << 52n), e: exp - 1075 };
}

// round(m * 2^e * 10^k), ties to even
function roundScaled(m: bigint, e: number, k: number): bigint {
  let num = m;
  let den = 1n;
  if (e >= 0) num <<= BigInt(e);
  else den <<= BigInt(-e);
  if (k >= 0) num *= 10n ** BigInt(k);
  else den *= 10n ** BigInt(-k);
  const q = num / den;
  const r = num - q * den;
  const twice = r * 2n;
  if (twice > den || (twice === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// v >= 0 finite
function fixedStr(v: number, p: number, alt: boolean): string {
  let s = '0'.repeat(0);
  if (v === 0) s = '0'.repeat(p + 1);
  else {
    const { m, e } = decompose(v);
    s = roundScaled(m, e, p).toString();
    if (s.length < p + 1) s = '0'.repeat(p + 1 - s.length) + s;
  }
  const ip = s.slice(0, s.length - p);
  const fp = s.slice(s.length - p);
  return ip + (p > 0 || alt ? '.' : '') + fp;
}

function expParts(v: number, p: number): { digits: string; x: number } {
  if (v === 0) return { digits: '0'.repeat(p + 1), x: 0 };
  const { m, e } = decompose(v);
  let x = Math.floor(Math.log10(v));
  if (!Number.isFinite(x)) x = -324;
  const lim = 10n ** BigInt(p);
  for (;;) {
    const n = roundScaled(m, e, p - x);
    if (n >= lim * 10n) x++;
    else if (n < lim) x--;
    else return { digits: n.toString(), x };
  }
}

function expStr(digits: string, x: number, alt: boolean, upper: boolean): string {
  const p = digits.length - 1;
  const ax = Math.abs(x);
  return (
    digits[0] +
    (p > 0 || alt ? '.' : '') +
    digits.slice(1) +
    (upper ? 'E' : 'e') +
    (x < 0 ? '-' : '+') +
    (ax < 10 ? '0' : '') +
    ax
  );
}

function stripZeros(s: string): string {
  // s has a '.' possibly, before an optional exponent
  const ei = s.search(/[eE]/);
  let mant = ei >= 0 ? s.slice(0, ei) : s;
  const rest = ei >= 0 ? s.slice(ei) : '';
  if (mant.includes('.')) {
    mant = mant.replace(/0+$/, '');
    if (mant.endsWith('.')) mant = mant.slice(0, -1);
  }
  return mant + rest;
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
    let minus = false,
      plus = false,
      space = false,
      zero = false,
      alt = false;
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
    let canZero = false;
    const signFor = (neg: boolean) => (neg ? '-' : plus ? '+' : space ? ' ' : '');

    switch (conv) {
      case 'd':
      case 'i': {
        const b = BigInt(arg as number | bigint);
        sign = signFor(b < 0n);
        body = (b < 0n ? -b : b).toString();
        if (prec === 0 && b === 0n) body = '';
        if (prec > body.length) body = '0'.repeat(prec - body.length) + body;
        canZero = prec < 0;
        break;
      }
      case 'x':
      case 'X':
      case 'o': {
        const b = BigInt(arg as number | bigint);
        body = b.toString(conv === 'o' ? 8 : 16);
        if (conv === 'X') body = body.toUpperCase();
        if (prec === 0 && b === 0n) body = '';
        if (prec > body.length) body = '0'.repeat(prec - body.length) + body;
        if (alt) {
          if (conv === 'o') {
            if (body[0] !== '0') body = '0' + body;
          } else if (b !== 0n) prefix = conv === 'x' ? '0x' : '0X';
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
        const n = arg as number;
        const upper = conv === 'E' || conv === 'F' || conv === 'G';
        if (Number.isNaN(n)) {
          body = upper ? 'NAN' : 'nan';
          break;
        }
        const neg = n < 0 || Object.is(n, -0);
        sign = signFor(neg);
        const v = Math.abs(n);
        if (v === Infinity) {
          body = upper ? 'INF' : 'inf';
          break;
        }
        canZero = true;
        const lc = conv.toLowerCase();
        if (lc === 'f') body = fixedStr(v, prec < 0 ? 6 : prec, alt);
        else if (lc === 'e') {
          const { digits, x } = expParts(v, prec < 0 ? 6 : prec);
          body = expStr(digits, x, alt, upper);
        } else {
          let P = prec < 0 ? 6 : prec;
          if (P === 0) P = 1;
          const { digits, x } = expParts(v, P - 1);
          if (P > x && x >= -4) body = fixedStr(v, P - 1 - x, alt);
          else body = expStr(digits, x, alt, upper);
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

    const len = sign.length + prefix.length + body.length;
    if (len < width) {
      const pad = width - len;
      if (minus) body = body + ' '.repeat(pad);
      else if (zero && canZero) body = '0'.repeat(pad) + body;
      else sign = ' '.repeat(pad) + sign;
    }
    out += sign + prefix + body;
  }
  return out;
}
