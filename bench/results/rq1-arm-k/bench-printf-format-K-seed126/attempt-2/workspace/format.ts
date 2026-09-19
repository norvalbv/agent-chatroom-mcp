// Decompose a finite non-negative double into m * 2^e exactly.
function decompose(v: number): [bigint, number] {
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, v);
  const bits = buf.getBigUint64(0);
  const expBits = Number((bits >> 52n) & 0x7ffn);
  const frac = bits & ((1n << 52n) - 1n);
  if (expBits === 0) return [frac, -1074];
  return [frac | (1n << 52n), expBits - 1075];
}

// round_half_even(v * 10^k) exactly, v finite non-negative.
function scaledRound(v: number, k: number): bigint {
  const [m, e] = decompose(v);
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

function fixedBody(v: number, p: number, alt: boolean): string {
  const n = scaledRound(v, p);
  const s = n.toString().padStart(p + 1, '0');
  const ip = s.slice(0, s.length - p);
  const fp = s.slice(s.length - p);
  return ip + (p > 0 || alt ? '.' : '') + fp;
}

// Returns digit string (p+1 digits) and decimal exponent.
function sciDigits(v: number, p: number): [string, number] {
  if (v === 0) return ['0'.repeat(p + 1), 0];
  let x = Math.floor(Math.log10(v));
  if (!isFinite(x)) x = -324;
  const lo = 10n ** BigInt(p);
  const hi = lo * 10n;
  for (let i = 0; i < 20; i++) {
    const n = scaledRound(v, p - x);
    if (n >= hi) x++;
    else if (n < lo) x--;
    else return [n.toString(), x];
  }
  throw new Error('exponent search failed');
}

function expSuffix(x: number, upper: boolean): string {
  const a = Math.abs(x).toString().padStart(2, '0');
  return (upper ? 'E' : 'e') + (x < 0 ? '-' : '+') + a;
}

function sciBody(v: number, p: number, alt: boolean, upper: boolean, strip: boolean): string {
  const [d, x] = sciDigits(v, p);
  let frac = d.slice(1);
  if (strip) frac = frac.replace(/0+$/, '');
  return d[0] + (frac.length > 0 || alt ? '.' : '') + frac + expSuffix(x, upper);
}

function stripFixed(s: string): string {
  if (!s.includes('.')) return s;
  return s.replace(/0+$/, '').replace(/\.$/, '');
}

function pad(sign: string, body: string, width: number, left: boolean, zero: boolean): string {
  const len = sign.length + body.length;
  if (len >= width) return sign + body;
  const fill = width - len;
  if (left) return sign + body + ' '.repeat(fill);
  if (zero) return sign + '0'.repeat(fill) + body;
  return ' '.repeat(fill) + sign + body;
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
      const c = fmt[i];
      if (c === '-') minus = true;
      else if (c === '+') plus = true;
      else if (c === ' ') space = true;
      else if (c === '0') zero = true;
      else if (c === '#') alt = true;
      else break;
    }
    let w = '';
    while (i < fmt.length && fmt[i] >= '0' && fmt[i] <= '9') w += fmt[i++];
    const width = w ? parseInt(w, 10) : 0;
    let prec = -1;
    if (fmt[i] === '.') {
      i++;
      let ps = '';
      while (i < fmt.length && fmt[i] >= '0' && fmt[i] <= '9') ps += fmt[i++];
      prec = ps ? parseInt(ps, 10) : 0;
    }
    const conv = fmt[i++];
    const arg = args[ai++];
    const posSign = plus ? '+' : space ? ' ' : '';

    if (conv === 's' || conv === 'c') {
      let s = String(arg);
      if (conv === 's' && prec >= 0) s = s.slice(0, prec);
      out += pad('', s, width, minus, false);
    } else if (conv === 'd' || conv === 'i') {
      const b = BigInt(arg as number | bigint);
      const neg = b < 0n;
      let digits = (neg ? -b : b).toString();
      if (prec === 0 && b === 0n) digits = '';
      if (prec > digits.length) digits = digits.padStart(prec, '0');
      const sign = neg ? '-' : posSign;
      out += pad(sign, digits, width, minus, zero && prec < 0);
    } else if (conv === 'x' || conv === 'X' || conv === 'o') {
      const b = BigInt(arg as number | bigint);
      let digits = b.toString(conv === 'o' ? 8 : 16);
      if (conv === 'X') digits = digits.toUpperCase();
      if (prec === 0 && b === 0n) digits = '';
      if (prec > digits.length) digits = digits.padStart(prec, '0');
      let prefix = '';
      if (alt) {
        if (conv === 'o') {
          if (digits[0] !== '0') digits = '0' + digits;
        } else if (b !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      }
      out += pad(prefix, digits, width, minus, zero && prec < 0);
    } else {
      const v = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      if (Number.isNaN(v)) {
        out += pad('', upper ? 'NAN' : 'nan', width, minus, false);
        continue;
      }
      const neg = v < 0 || Object.is(v, -0);
      const sign = neg ? '-' : posSign;
      const a = Math.abs(v);
      if (a === Infinity) {
        out += pad(sign, upper ? 'INF' : 'inf', width, minus, false);
        continue;
      }
      let body: string;
      const lc = conv.toLowerCase();
      if (lc === 'f') {
        body = fixedBody(a, prec < 0 ? 6 : prec, alt);
      } else if (lc === 'e') {
        body = sciBody(a, prec < 0 ? 6 : prec, alt, upper, false);
      } else {
        let P = prec < 0 ? 6 : prec;
        if (P === 0) P = 1;
        const [, x] = sciDigits(a, P - 1);
        if (P > x && x >= -4) {
          body = fixedBody(a, P - 1 - x, alt);
          if (!alt) body = stripFixed(body);
        } else {
          body = sciBody(a, P - 1, alt, upper, !alt);
        }
      }
      out += pad(sign, body, width, minus, zero);
    }
  }
  return out;
}
