function decompose(v: number): { m: bigint; e: number } {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, v);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const expField = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (expField === 0) return { m, e: -1074 };
  m |= 1n << 52n;
  return { m, e: expField - 1075 };
}

function ratio(d: { m: bigint; e: number }, k: number): [bigint, bigint] {
  let num = d.m;
  let den = 1n;
  if (d.e >= 0) num <<= BigInt(d.e);
  else den <<= BigInt(-d.e);
  if (k >= 0) num *= 10n ** BigInt(k);
  else den *= 10n ** BigInt(-k);
  return [num, den];
}

// round-half-even of |v| * 10^k
function scaledRound(d: { m: bigint; e: number }, k: number): bigint {
  const [num, den] = ratio(d, k);
  const q = num / den;
  const r2 = (num % den) * 2n;
  if (r2 > den || (r2 === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

function gePow10(d: { m: bigint; e: number }, x: number): boolean {
  const [num, den] = ratio(d, -x);
  return num >= den;
}

function decExp(d: { m: bigint; e: number }): number {
  const v = Number(d.m) * Math.pow(2, d.e);
  let x = Number.isFinite(v) && v > 0 ? Math.floor(Math.log10(v)) : 0;
  if (!Number.isFinite(x)) x = 0;
  while (!gePow10(d, x)) x--;
  while (gePow10(d, x + 1)) x++;
  return x;
}

function fixedStr(d: { m: bigint; e: number }, prec: number, alt: boolean): string {
  let s = scaledRound(d, prec).toString();
  if (prec > 0) {
    s = s.padStart(prec + 1, '0');
    return s.slice(0, s.length - prec) + '.' + s.slice(s.length - prec);
  }
  return alt ? s + '.' : s;
}

function expParts(d: { m: bigint; e: number }, isZero: boolean, prec: number): { digits: string; x: number } {
  if (isZero) return { digits: '0'.repeat(prec + 1), x: 0 };
  let x = decExp(d);
  let n = scaledRound(d, prec - x);
  if (n >= 10n ** BigInt(prec + 1)) {
    x++;
    n = scaledRound(d, prec - x);
  }
  return { digits: n.toString(), x };
}

function expStr(digits: string, x: number, prec: number, alt: boolean, upper: boolean): string {
  let s = digits[0];
  if (prec > 0) s += '.' + digits.slice(1);
  else if (alt) s += '.';
  const ax = Math.abs(x);
  s += (upper ? 'E' : 'e') + (x < 0 ? '-' : '+') + (ax < 10 ? '0' : '') + ax;
  return s;
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

    let prefix = '';
    let body = '';
    let numeric = true;
    let allowZero = true;

    if (conv === 's' || conv === 'c') {
      numeric = false;
      body = String(arg);
      if (conv === 's' && prec >= 0) body = body.slice(0, prec);
    } else if (conv === 'd' || conv === 'i' || conv === 'x' || conv === 'X' || conv === 'o') {
      let v = typeof arg === 'bigint' ? arg : BigInt(arg as number);
      const neg = v < 0n;
      if (neg) v = -v;
      let digits: string;
      if (conv === 'x') digits = v.toString(16);
      else if (conv === 'X') digits = v.toString(16).toUpperCase();
      else if (conv === 'o') digits = v.toString(8);
      else digits = v.toString();
      if (prec === 0 && v === 0n) digits = '';
      if (prec >= 0) {
        digits = digits.padStart(prec, '0');
        allowZero = false;
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
      const v = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      if (Number.isNaN(v)) {
        body = upper ? 'NAN' : 'nan';
        allowZero = false;
      } else {
        const neg = v < 0 || Object.is(v, -0);
        prefix = neg ? '-' : plus ? '+' : space ? ' ' : '';
        if (!Number.isFinite(v)) {
          body = upper ? 'INF' : 'inf';
          allowZero = false;
        } else {
          const d = decompose(Math.abs(v));
          const isZero = v === 0;
          const lc = conv.toLowerCase();
          if (lc === 'f') {
            body = fixedStr(d, prec < 0 ? 6 : prec, alt);
          } else if (lc === 'e') {
            const p = prec < 0 ? 6 : prec;
            const { digits, x } = expParts(d, isZero, p);
            body = expStr(digits, x, p, alt, upper);
          } else {
            let p = prec < 0 ? 6 : prec;
            if (p === 0) p = 1;
            const { digits, x } = expParts(d, isZero, p - 1);
            if (p > x && x >= -4) {
              body = fixedStr(d, p - 1 - x, alt);
              if (!alt) body = stripZeros(body);
            } else {
              let m = digits[0];
              let frac = digits.slice(1);
              if (!alt) frac = frac.replace(/0+$/, '');
              if (frac.length > 0) m += '.' + frac;
              else if (alt) m += '.';
              const ax = Math.abs(x);
              body = m + (upper ? 'E' : 'e') + (x < 0 ? '-' : '+') + (ax < 10 ? '0' : '') + ax;
            }
          }
        }
      }
    }

    const len = prefix.length + body.length;
    if (len >= width) out += prefix + body;
    else if (minus) out += prefix + body + ' '.repeat(width - len);
    else if (numeric && zero && allowZero) out += prefix + '0'.repeat(width - len) + body;
    else out += ' '.repeat(width - len) + prefix + body;
  }
  return out;
}
