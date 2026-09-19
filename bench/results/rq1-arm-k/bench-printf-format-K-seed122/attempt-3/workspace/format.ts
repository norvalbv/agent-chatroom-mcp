function roundDiv(n: bigint, d: bigint): bigint {
  const q = n / d;
  const r2 = (n % d) * 2n;
  if (r2 > d || (r2 === d && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// |v| as num/den (exact)
function ratio(v: number): [bigint, bigint] {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, Math.abs(v));
  const bits = dv.getBigUint64(0);
  const expBits = Number((bits >> 52n) & 0x7ffn);
  const frac = bits & ((1n << 52n) - 1n);
  let m: bigint;
  let e: number;
  if (expBits === 0) {
    m = frac;
    e = -1074;
  } else {
    m = frac | (1n << 52n);
    e = expBits - 1075;
  }
  return e >= 0 ? [m << BigInt(e), 1n] : [m, 1n << BigInt(-e)];
}

function fixed(v: number, prec: number, alt: boolean): string {
  const [n, d] = ratio(v);
  const D = roundDiv(n * 10n ** BigInt(prec), d);
  const s = D.toString().padStart(prec + 1, '0');
  if (prec === 0) return alt ? s + '.' : s;
  return s.slice(0, -prec) + '.' + s.slice(-prec);
}

function expDigits(v: number, prec: number): [string, number] {
  if (v === 0) return ['0'.repeat(prec + 1), 0];
  const [n, d] = ratio(v);
  let e10 = Math.floor(Math.log10(Math.abs(v)));
  if (!isFinite(e10)) e10 = -324;
  const lo = 10n ** BigInt(prec);
  const hi = lo * 10n;
  for (let i = 0; i < 20; i++) {
    const s = e10 - prec;
    const D = s >= 0 ? roundDiv(n, d * 10n ** BigInt(s)) : roundDiv(n * 10n ** BigInt(-s), d);
    if (D >= hi) e10++;
    else if (D < lo) e10--;
    else return [D.toString(), e10];
  }
  throw new Error('exp');
}

function expStyle(v: number, prec: number, alt: boolean, upper: boolean, strip: boolean): string {
  const [ds, x] = expDigits(v, prec);
  let frac = ds.slice(1);
  if (strip) frac = frac.replace(/0+$/, '');
  let m = ds[0] + (frac.length > 0 || alt ? '.' + frac : '');
  const ax = Math.abs(x);
  return m + (upper ? 'E' : 'e') + (x < 0 ? '-' : '+') + (ax < 10 ? '0' : '') + ax;
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
    let prec: number | undefined;
    if (fmt[i] === '.') {
      i++;
      prec = 0;
      while (i < fmt.length && fmt[i] >= '0' && fmt[i] <= '9') prec = prec * 10 + Number(fmt[i++]);
    }
    const conv = fmt[i++];
    const arg = args[ai++];
    let sign = '';
    let prefix = '';
    let body = '';
    let canZero = false;

    if (conv === 's' || conv === 'c') {
      body = String(arg);
      if (conv === 's' && prec !== undefined) body = body.slice(0, prec);
    } else if (conv === 'd' || conv === 'i' || conv === 'x' || conv === 'X' || conv === 'o') {
      const b = BigInt(arg as number | bigint);
      const neg = b < 0n;
      const mag = neg ? -b : b;
      let digits = mag.toString(conv === 'x' || conv === 'X' ? 16 : conv === 'o' ? 8 : 10);
      if (conv === 'X') digits = digits.toUpperCase();
      if (prec !== undefined) {
        if (prec === 0 && mag === 0n) digits = '';
        digits = digits.padStart(prec, '0');
      }
      if (conv === 'd' || conv === 'i') {
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
      } else if (alt) {
        if (conv === 'o') {
          if (digits[0] !== '0') digits = '0' + digits;
        } else if (mag !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      }
      body = digits;
      canZero = prec === undefined;
    } else {
      const v = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      const neg = v < 0 || Object.is(v, -0);
      if (Number.isNaN(v)) {
        body = upper ? 'NAN' : 'nan';
      } else {
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        if (!isFinite(v)) {
          body = upper ? 'INF' : 'inf';
        } else {
          canZero = true;
          const p = prec === undefined ? 6 : prec;
          const lc = conv.toLowerCase();
          if (lc === 'f') body = fixed(v, p, alt);
          else if (lc === 'e') body = expStyle(v, p, alt, upper, false);
          else {
            const P = p === 0 ? 1 : p;
            const X = expDigits(v, P - 1)[1];
            if (P > X && X >= -4) {
              body = fixed(v, P - 1 - X, alt);
              if (!alt && body.includes('.')) body = body.replace(/0+$/, '').replace(/\.$/, '');
            } else body = expStyle(v, P - 1, alt, upper, !alt);
          }
        }
      }
      if (Number.isNaN(v) || !isFinite(v)) canZero = false;
    }

    const len = sign.length + prefix.length + body.length;
    if (len >= width) out += sign + prefix + body;
    else if (minus) out += sign + prefix + body + ' '.repeat(width - len);
    else if (zero && canZero) out += sign + prefix + '0'.repeat(width - len) + body;
    else out += ' '.repeat(width - len) + sign + prefix + body;
  }
  return out;
}
