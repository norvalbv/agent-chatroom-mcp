// Decompose a finite positive double into m * 2^e exactly.
function decompose(v: number): [bigint, number] {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, v);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  let mant = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (expBits === 0) return [mant, -1074];
  mant |= 1n << 52n;
  return [mant, expBits - 1075];
}

// round-half-even of v * 10^k as a BigInt
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

// digits (no point) and exponent for e-style with p digits after the point
function expDigits(v: number, p: number): [string, number] {
  if (v === 0) return ['0'.repeat(p + 1), 0];
  const [m, e] = decompose(v);
  let x = Math.floor(Math.log10(v));
  if (!isFinite(x)) x = -324;
  const lo = 10n ** BigInt(p);
  const hi = lo * 10n;
  for (let i = 0; i < 20; i++) {
    const d = scaled(m, e, p - x);
    if (d >= hi) x++;
    else if (d < lo) x--;
    else return [d.toString(), x];
  }
  throw new Error('unreachable');
}

function fixedStr(v: number, p: number, alt: boolean): string {
  let s: string;
  if (v === 0) s = '0'.repeat(p + 1);
  else {
    const [m, e] = decompose(v);
    s = scaled(m, e, p).toString();
    if (s.length < p + 1) s = '0'.repeat(p + 1 - s.length) + s;
  }
  const ip = s.slice(0, s.length - p);
  const fp = s.slice(s.length - p);
  return ip + (p > 0 || alt ? '.' : '') + fp;
}

function expStr(v: number, p: number, alt: boolean, upper: boolean): string {
  const [d, x] = expDigits(v, p);
  const ax = Math.abs(x);
  return (
    d[0] + (p > 0 || alt ? '.' : '') + d.slice(1) +
    (upper ? 'E' : 'e') + (x < 0 ? '-' : '+') + (ax < 10 ? '0' : '') + ax
  );
}

function stripZeros(s: string): string {
  if (!s.includes('.')) return s;
  s = s.replace(/0+$/, '');
  return s.endsWith('.') ? s.slice(0, -1) : s;
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

    let prefix = ''; // sign and 0x prefix
    let body = '';
    let canZero = false;
    const signOf = (neg: boolean) => (neg ? '-' : plus ? '+' : space ? ' ' : '');

    if (conv === 's') {
      body = String(arg);
      if (prec >= 0) body = body.slice(0, prec);
    } else if (conv === 'c') {
      body = String(arg);
    } else if (conv === 'd' || conv === 'i') {
      const b = BigInt(arg as number | bigint);
      prefix = signOf(b < 0n);
      body = (b < 0n ? -b : b).toString();
      if (prec === 0 && b === 0n) body = '';
      if (prec > body.length) body = '0'.repeat(prec - body.length) + body;
      canZero = prec < 0;
    } else if (conv === 'x' || conv === 'X' || conv === 'o') {
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
    } else {
      const v = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      const neg = v < 0 || Object.is(v, -0);
      if (Number.isNaN(v)) {
        body = upper ? 'NAN' : 'nan';
      } else {
        prefix = signOf(neg);
        if (!isFinite(v)) {
          body = upper ? 'INF' : 'inf';
        } else {
          const a = Math.abs(v);
          canZero = true;
          const lc = conv.toLowerCase();
          if (lc === 'f') body = fixedStr(a, prec < 0 ? 6 : prec, alt);
          else if (lc === 'e') body = expStr(a, prec < 0 ? 6 : prec, alt, upper);
          else {
            const P = prec < 0 ? 6 : prec === 0 ? 1 : prec;
            const X = expDigits(a, P - 1)[1];
            if (P > X && X >= -4) {
              body = fixedStr(a, P - 1 - X, alt);
              if (!alt) body = stripZeros(body);
            } else {
              body = expStr(a, P - 1, alt, upper);
              if (!alt) {
                const k = body.search(/[eE]/);
                body = stripZeros(body.slice(0, k)) + body.slice(k);
              }
            }
          }
        }
      }
      if (Number.isNaN(v) || !isFinite(v)) canZero = false;
    }

    const len = prefix.length + body.length;
    if (len < width) {
      const pad = width - len;
      if (minus) out += prefix + body + ' '.repeat(pad);
      else if (zero && canZero) out += prefix + '0'.repeat(pad) + body;
      else out += ' '.repeat(pad) + prefix + body;
    } else out += prefix + body;
  }
  return out;
}
