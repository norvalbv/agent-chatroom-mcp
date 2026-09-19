function roundDiv(n: bigint, d: bigint): bigint {
  const q = n / d;
  const r = n - q * d;
  const c = 2n * r;
  if (c > d || (c === d && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// |v| = m * 2^e exactly
function decompose(v: number): [bigint, number] {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, Math.abs(v));
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const be = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (be === 0) return [m, -1074];
  m |= 1n << 52n;
  return [m, be - 1075];
}

// round(|v| * 10^k) half-even, exact
function scaled(v: number, k: number): bigint {
  const [m, e] = decompose(v);
  let n = m;
  let d = 1n;
  if (e >= 0) n <<= BigInt(e);
  else d <<= BigInt(-e);
  if (k >= 0) n *= 10n ** BigInt(k);
  else d *= 10n ** BigInt(-k);
  return roundDiv(n, d);
}

function fixed(v: number, prec: number): string {
  let s = scaled(v, prec).toString();
  if (s.length < prec + 1) s = '0'.repeat(prec + 1 - s.length) + s;
  if (prec === 0) return s;
  return s.slice(0, s.length - prec) + '.' + s.slice(s.length - prec);
}

// p digits after the point; returns digit string of length p+1 and exponent
function sci(v: number, p: number): [string, number] {
  if (v === 0) return ['0'.repeat(p + 1), 0];
  let x = Math.floor(Math.log10(Math.abs(v)));
  if (!isFinite(x)) x = -324;
  for (let i = 0; i < 10; i++) {
    const q = scaled(v, p - x);
    const s = q.toString();
    if (s.length > p + 1) x++;
    else if (s.length < p + 1) x--;
    else return [s, x];
  }
  throw new Error('sci failed');
}

function expStr(x: number, upper: boolean): string {
  const a = Math.abs(x).toString().padStart(2, '0');
  return (upper ? 'E' : 'e') + (x < 0 ? '-' : '+') + a;
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
    let prec: number | undefined;
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
    const lower = conv.toLowerCase();

    if (conv === 's' || conv === 'c') {
      body = String(arg);
      if (conv === 's' && prec !== undefined) body = body.slice(0, prec);
      canZero = false;
    } else if (conv === 'd' || conv === 'i' || conv === 'x' || conv === 'X' || conv === 'o') {
      const b = BigInt(arg as number | bigint);
      const neg = b < 0n;
      const mag = neg ? -b : b;
      let digits: string;
      if (conv === 'd' || conv === 'i') digits = mag.toString();
      else if (conv === 'o') digits = mag.toString(8);
      else digits = mag.toString(16);
      if (conv === 'X') digits = digits.toUpperCase();
      if (prec !== undefined) {
        if (prec === 0 && mag === 0n) digits = '';
        if (digits.length < prec) digits = '0'.repeat(prec - digits.length) + digits;
        canZero = false;
      }
      if (conv === 'd' || conv === 'i') {
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
      } else if (alt) {
        if (conv === 'o') {
          if (digits[0] !== '0') digits = '0' + digits;
        } else if (mag !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      }
      body = digits;
    } else {
      const v = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      const neg = v < 0 || Object.is(v, -0);
      if (Number.isNaN(v)) {
        body = upper ? 'NAN' : 'nan';
        canZero = false;
      } else {
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        if (!isFinite(v)) {
          body = upper ? 'INF' : 'inf';
          canZero = false;
        } else if (lower === 'f') {
          const p = prec ?? 6;
          body = fixed(v, p);
          if (p === 0 && alt) body += '.';
        } else if (lower === 'e') {
          const p = prec ?? 6;
          const [d, x] = sci(v, p);
          body = d[0] + (p > 0 ? '.' + d.slice(1) : alt ? '.' : '') + expStr(x, upper);
        } else {
          let P = prec ?? 6;
          if (P === 0) P = 1;
          const [d, x] = sci(v, P - 1);
          let mant: string;
          let suffix = '';
          if (P > x && x >= -4) {
            mant = fixed(v, P - 1 - x);
          } else {
            mant = d[0] + (P > 1 ? '.' + d.slice(1) : '');
            suffix = expStr(x, upper);
          }
          if (alt) {
            if (!mant.includes('.')) mant += '.';
          } else if (mant.includes('.')) {
            mant = mant.replace(/0+$/, '').replace(/\.$/, '');
          }
          body = mant + suffix;
        }
      }
    }

    const len = sign.length + prefix.length + body.length;
    if (len < width) {
      const pad = width - len;
      if (minus) body = sign + prefix + body + ' '.repeat(pad);
      else if (zero && canZero) body = sign + prefix + '0'.repeat(pad) + body;
      else body = ' '.repeat(pad) + sign + prefix + body;
    } else {
      body = sign + prefix + body;
    }
    out += body;
  }
  return out;
}
