function decompose(x: number): [bigint, number] {
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

// round(|x| * 10^k) half-even, exact
function scaledRound(m: bigint, e: number, k: number): bigint {
  let num = m;
  let den = 1n;
  if (e >= 0) num <<= BigInt(e);
  else den <<= BigInt(-e);
  if (k >= 0) num *= 10n ** BigInt(k);
  else den *= 10n ** BigInt(-k);
  const q = num / den;
  const r = num % den;
  const c = r * 2n;
  if (c > den || (c === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

function fixedStr(ax: number, p: number, alt: boolean): string {
  let s: string;
  if (ax === 0) s = '0'.repeat(p + 1);
  else {
    const [m, e] = decompose(ax);
    s = scaledRound(m, e, p).toString();
    if (s.length < p + 1) s = '0'.repeat(p + 1 - s.length) + s;
  }
  const ip = s.slice(0, s.length - p);
  const fp = s.slice(s.length - p);
  return ip + (p > 0 || alt ? '.' : '') + fp;
}

// returns digits (p+1 of them) and exponent
function expParts(ax: number, p: number): [string, number] {
  if (ax === 0) return ['0'.repeat(p + 1), 0];
  const [m, e] = decompose(ax);
  let E = Math.floor(Math.log10(ax));
  if (!isFinite(E)) E = -324;
  const lo = 10n ** BigInt(p);
  const hi = lo * 10n;
  for (let i = 0; i < 20; i++) {
    const N = scaledRound(m, e, p - E);
    if (N >= hi) E++;
    else if (N < lo) E--;
    else return [N.toString(), E];
  }
  throw new Error('exp');
}

function expStr(digits: string, E: number, p: number, alt: boolean, upper: boolean): string {
  const ae = Math.abs(E);
  return (
    digits[0] +
    (p > 0 || alt ? '.' : '') +
    digits.slice(1) +
    (upper ? 'E' : 'e') +
    (E < 0 ? '-' : '+') +
    (ae < 10 ? '0' : '') +
    ae
  );
}

function stripZeros(s: string): string {
  // s has form int[.frac] before any exponent
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
    let minus = false, plus = false, space = false, zero = false, alt = false;
    for (; i < fmt.length; i++) {
      const f = fmt[i];
      if (f === '-') minus = true;
      else if (f === '+') plus = true;
      else if (f === ' ') space = true;
      else if (f === '0') zero = true;
      else if (f === '#') alt = true;
      else break;
    }
    let width = 0;
    while (i < fmt.length && fmt[i] >= '0' && fmt[i] <= '9') width = width * 10 + Number(fmt[i++]);
    let prec = -1;
    if (fmt[i] === '.') {
      i++;
      prec = 0;
      while (i < fmt.length && fmt[i] >= '0' && fmt[i] <= '9') prec = prec * 10 + Number(fmt[i++]);
    }
    const conv = fmt[i++];
    const arg = args[ai++];

    let prefix = '';
    let body = '';
    let numeric = true;
    let canZero = true;
    const lc = conv.toLowerCase();

    if (conv === 's' || conv === 'c') {
      numeric = false;
      body = String(arg);
      if (conv === 's' && prec >= 0) body = body.slice(0, prec);
    } else if (conv === 'd' || conv === 'i' || lc === 'x' || conv === 'o') {
      let v = typeof arg === 'bigint' ? arg : BigInt(arg as number);
      const neg = v < 0n;
      if (neg) v = -v;
      let digits =
        conv === 'd' || conv === 'i' ? v.toString() : lc === 'x' ? v.toString(16) : v.toString(8);
      if (conv === 'X') digits = digits.toUpperCase();
      if (prec >= 0) {
        if (prec === 0 && v === 0n) digits = '';
        else if (digits.length < prec) digits = '0'.repeat(prec - digits.length) + digits;
        canZero = false;
      }
      if (conv === 'd' || conv === 'i') {
        prefix = neg ? '-' : plus ? '+' : space ? ' ' : '';
      } else if (alt) {
        if (conv === 'o') {
          if (!digits.startsWith('0')) digits = '0' + digits;
        } else if (v !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      }
      body = digits;
    } else {
      const x = arg as number;
      const upper = conv === conv.toUpperCase();
      const neg = x < 0 || Object.is(x, -0);
      prefix = Number.isNaN(x) ? '' : neg ? '-' : plus ? '+' : space ? ' ' : '';
      if (!isFinite(x)) {
        body = Number.isNaN(x) ? 'nan' : 'inf';
        if (upper) body = body.toUpperCase();
        canZero = false;
      } else {
        const ax = Math.abs(x);
        if (lc === 'f') {
          body = fixedStr(ax, prec < 0 ? 6 : prec, alt);
        } else if (lc === 'e') {
          const p = prec < 0 ? 6 : prec;
          const [d, E] = expParts(ax, p);
          body = expStr(d, E, p, alt, upper);
        } else {
          let P = prec < 0 ? 6 : prec;
          if (P === 0) P = 1;
          const [d, X] = expParts(ax, P - 1);
          if (P > X && X >= -4) {
            body = fixedStr(ax, P - 1 - X, alt);
            if (!alt) body = stripZeros(body);
          } else {
            let mant = d[0] + (P > 1 || alt ? '.' : '') + d.slice(1);
            if (!alt) mant = stripZeros(mant);
            const ae = Math.abs(X);
            body =
              mant + (upper ? 'E' : 'e') + (X < 0 ? '-' : '+') + (ae < 10 ? '0' : '') + ae;
          }
        }
      }
    }

    let len = prefix.length + body.length;
    if (len < width) {
      const n = width - len;
      if (minus) body = body + ' '.repeat(n);
      else if (numeric && zero && canZero) body = '0'.repeat(n) + body;
      else prefix = ' '.repeat(n) + prefix;
    }
    out += prefix + body;
  }
  return out;
}
