function decompose(v: number): { neg: boolean; m: bigint; e: number } {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, v);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const neg = (hi >>> 31) === 1;
  const be = (hi >>> 20) & 0x7ff;
  let frac = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (be === 0) return { neg, m: frac, e: -1074 };
  frac |= 1n << 52n;
  return { neg, m: frac, e: be - 1075 };
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
  const r2 = (num % den) * 2n;
  if (r2 > den || (r2 === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// p+1 significant digits and decimal exponent
function sci(m: bigint, e: number, p: number): { digits: string; x: number } {
  if (m === 0n) return { digits: '0'.repeat(p + 1), x: 0 };
  const v = Number(m) * Math.pow(2, e);
  let x = Number.isFinite(v) && v > 0 ? Math.floor(Math.log10(v)) : 0;
  const lo = 10n ** BigInt(p);
  for (;;) {
    const n = roundScaled(m, e, p - x);
    if (n < lo) x--;
    else if (n >= lo * 10n) x++;
    else return { digits: n.toString(), x };
  }
}

function expStr(x: number, upper: boolean): string {
  const a = Math.abs(x).toString().padStart(2, '0');
  return (upper ? 'E' : 'e') + (x < 0 ? '-' : '+') + a;
}

function fixed(m: bigint, e: number, p: number, alt: boolean): string {
  const s = roundScaled(m, e, p).toString().padStart(p + 1, '0');
  const ip = s.slice(0, s.length - p);
  const fp = s.slice(s.length - p);
  return ip + (p > 0 || alt ? '.' : '') + fp;
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

    let prefix = '';
    let body = '';
    let numeric = true;
    const signFor = (neg: boolean) => (neg ? '-' : plus ? '+' : space ? ' ' : '');

    switch (conv) {
      case 'd':
      case 'i': {
        const b = BigInt(arg as number | bigint);
        prefix = signFor(b < 0n);
        let d = (b < 0n ? -b : b).toString();
        if (prec !== undefined) {
          if (prec === 0 && b === 0n) d = '';
          d = d.padStart(prec, '0');
          zero = false;
        }
        body = d;
        break;
      }
      case 'x':
      case 'X':
      case 'o': {
        const b = BigInt(arg as number | bigint);
        let d = b.toString(conv === 'o' ? 8 : 16);
        if (conv === 'X') d = d.toUpperCase();
        if (prec !== undefined) {
          if (prec === 0 && b === 0n) d = '';
          d = d.padStart(prec, '0');
          zero = false;
        }
        if (alt) {
          if (conv === 'o') {
            if (d[0] !== '0') d = '0' + d;
          } else if (b !== 0n) prefix = conv === 'x' ? '0x' : '0X';
        }
        body = d;
        break;
      }
      case 'e': case 'E': case 'f': case 'F': case 'g': case 'G': {
        const v = arg as number;
        const upper = conv === 'E' || conv === 'F' || conv === 'G';
        if (Number.isNaN(v)) {
          body = upper ? 'NAN' : 'nan';
          zero = false;
          break;
        }
        const { neg, m, e } = decompose(v);
        prefix = signFor(neg);
        if (!Number.isFinite(v)) {
          body = upper ? 'INF' : 'inf';
          zero = false;
          break;
        }
        const lc = conv.toLowerCase();
        if (lc === 'f') {
          body = fixed(m, e, prec ?? 6, alt);
        } else if (lc === 'e') {
          const p = prec ?? 6;
          const { digits, x } = sci(m, e, p);
          body = digits[0] + (p > 0 || alt ? '.' : '') + digits.slice(1) + expStr(x, upper);
        } else {
          const P = prec === undefined ? 6 : prec === 0 ? 1 : prec;
          const { digits, x } = sci(m, e, P - 1);
          if (P > x && x >= -4) {
            body = fixed(m, e, P - 1 - x, alt);
            if (!alt) body = stripZeros(body);
          } else {
            let mant = digits[0] + (P > 1 || alt ? '.' : '') + digits.slice(1);
            if (!alt) mant = stripZeros(mant);
            body = mant + expStr(x, upper);
          }
        }
        break;
      }
      case 's':
        numeric = false;
        body = String(arg);
        if (prec !== undefined) body = body.slice(0, prec);
        break;
      case 'c':
        numeric = false;
        body = String(arg);
        break;
    }

    const len = prefix.length + body.length;
    if (len >= width) out += prefix + body;
    else if (minus) out += prefix + body + ' '.repeat(width - len);
    else if (zero && numeric) out += prefix + '0'.repeat(width - len) + body;
    else out += ' '.repeat(width - len) + prefix + body;
  }
  return out;
}
