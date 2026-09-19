function decompose(v: number): [bigint, number] {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, Math.abs(v));
  const bits = dv.getBigUint64(0);
  const exp = Number((bits >> 52n) & 0x7ffn);
  const frac = bits & ((1n << 52n) - 1n);
  return exp === 0 ? [frac, -1074] : [frac | (1n << 52n), exp - 1075];
}

// round-half-even(|v| * 10^k), exact
function scaledRound(v: number, k: number): bigint {
  const [m, e2] = decompose(v);
  let num = m;
  let den = 1n;
  if (e2 >= 0) num <<= BigInt(e2);
  else den <<= BigInt(-e2);
  if (k >= 0) num *= 10n ** BigInt(k);
  else den *= 10n ** BigInt(-k);
  const q = num / den;
  const r = num % den;
  const twice = r * 2n;
  if (twice > den || (twice === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

function fixed(v: number, p: number, alt: boolean): string {
  const s = scaledRound(v, p).toString().padStart(p + 1, '0');
  const ip = s.slice(0, s.length - p);
  const fp = s.slice(s.length - p);
  return ip + (p > 0 || alt ? '.' : '') + fp;
}

// digits: p+1 digit string, x: decimal exponent
function expDigits(v: number, p: number): [string, number] {
  if (v === 0) return ['0'.repeat(p + 1), 0];
  let x = Math.floor(Math.log10(v));
  if (!Number.isFinite(x)) x = 0;
  for (;;) {
    const n = scaledRound(v, p - x);
    const lo = 10n ** BigInt(p);
    if (n >= lo * 10n) x++;
    else if (n < lo) x--;
    else return [n.toString(), x];
  }
}

function expStr(x: number, upper: boolean): string {
  const a = Math.abs(x).toString().padStart(2, '0');
  return (upper ? 'E' : 'e') + (x < 0 ? '-' : '+') + a;
}

function mant(d: string, alt: boolean, p: number): string {
  return d[0] + (p > 0 || alt ? '.' : '') + d.slice(1);
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
      const c = fmt[i];
      if (c === '-') minus = true;
      else if (c === '+') plus = true;
      else if (c === ' ') space = true;
      else if (c === '0') zero = true;
      else if (c === '#') alt = true;
      else break;
    }
    let width = 0;
    while (fmt[i] >= '0' && fmt[i] <= '9') width = width * 10 + Number(fmt[i++]);
    let prec: number | null = null;
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

    const lc = conv.toLowerCase();
    if (conv === 'd' || conv === 'i' || conv === 'x' || conv === 'X' || conv === 'o') {
      const n = BigInt(arg as number | bigint);
      const neg = n < 0n;
      const mag = neg ? -n : n;
      let digits: string;
      if (conv === 'd' || conv === 'i') digits = mag.toString();
      else if (conv === 'o') digits = mag.toString(8);
      else digits = conv === 'x' ? mag.toString(16) : mag.toString(16).toUpperCase();
      if (prec !== null) {
        if (prec === 0 && mag === 0n) digits = '';
        digits = digits.padStart(prec, '0');
      }
      if (conv === 'd' || conv === 'i') {
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
      } else if (conv === 'o') {
        if (alt && !digits.startsWith('0')) digits = '0' + digits;
      } else if (alt && mag !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      body = digits;
      canZero = prec === null;
    } else if ('efg'.includes(lc)) {
      const v = arg as number;
      const upper = conv !== lc;
      const isNeg = v < 0 || Object.is(v, -0);
      if (Number.isNaN(v)) {
        body = upper ? 'NAN' : 'nan';
      } else {
        sign = isNeg ? '-' : plus ? '+' : space ? ' ' : '';
        if (!Number.isFinite(v)) {
          body = upper ? 'INF' : 'inf';
        } else {
          canZero = true;
          const a = Math.abs(v);
          if (lc === 'f') {
            body = fixed(a, prec ?? 6, alt);
          } else if (lc === 'e') {
            const p = prec ?? 6;
            const [d, x] = expDigits(a, p);
            body = mant(d, alt, p) + expStr(x, upper);
          } else {
            const P = prec === null ? 6 : prec === 0 ? 1 : prec;
            const [d, x] = expDigits(a, P - 1);
            if (P > x && x >= -4) {
              body = fixed(a, P - 1 - x, alt);
              if (!alt) body = stripZeros(body);
            } else {
              let m = mant(d, alt, P - 1);
              if (!alt) m = stripZeros(m);
              body = m + expStr(x, upper);
            }
          }
        }
      }
    } else if (conv === 's') {
      body = String(arg);
      if (prec !== null) body = body.slice(0, prec);
    } else {
      body = String(arg);
    }

    const len = sign.length + prefix.length + body.length;
    if (len >= width) out += sign + prefix + body;
    else if (minus) out += sign + prefix + body + ' '.repeat(width - len);
    else if (zero && canZero) out += sign + prefix + '0'.repeat(width - len) + body;
    else out += ' '.repeat(width - len) + sign + prefix + body;
  }
  return out;
}
