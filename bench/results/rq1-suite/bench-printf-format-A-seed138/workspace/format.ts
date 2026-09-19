function decompose(v: number): [bigint, number] {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, Math.abs(v));
  const bits = dv.getBigUint64(0);
  const ex = Number((bits >> 52n) & 0x7ffn);
  const frac = bits & ((1n << 52n) - 1n);
  if (ex === 0) return [frac, -1074];
  return [frac | (1n << 52n), ex - 1075];
}

// round(m * 2^e * 10^k), ties to even
function ratRound(m: bigint, e: number, k: number): bigint {
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

// significant digits: returns [digit string of length p+1, exponent]
function sci(v: number, p: number): [string, number] {
  if (v === 0) return ['0'.repeat(p + 1), 0];
  const [m, e] = decompose(v);
  let x = Math.floor(Math.log10(Math.abs(v)));
  const lo = 10n ** BigInt(p);
  const hi = lo * 10n;
  for (let i = 0; i < 20; i++) {
    const r = ratRound(m, e, p - x);
    if (r >= hi) x++;
    else if (r < lo) x--;
    else return [r.toString(), x];
  }
  throw new Error('sci failed');
}

function fixed(v: number, p: number, alt: boolean): string {
  const [m, e] = decompose(v);
  let s = ratRound(m, e, p).toString();
  if (s.length < p + 1) s = '0'.repeat(p + 1 - s.length) + s;
  const ip = s.slice(0, s.length - p);
  const fp = s.slice(s.length - p);
  return p > 0 ? ip + '.' + fp : alt ? ip + '.' : ip;
}

function expo(digits: string, x: number, alt: boolean, upper: boolean): string {
  const p = digits.length - 1;
  let s = digits[0];
  if (p > 0) s += '.' + digits.slice(1);
  else if (alt) s += '.';
  const ax = Math.abs(x);
  s += (upper ? 'E' : 'e') + (x < 0 ? '-' : '+') + (ax < 10 ? '0' : '') + ax;
  return s;
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let out = '';
  let ai = 0;
  const re = /%(?:(%)|([-+ 0#]*)(\d*)(?:\.(\d*))?([dixXoeEfFgGsc]))/y;
  let i = 0;
  while (i < fmt.length) {
    const c = fmt[i];
    if (c !== '%') {
      out += c;
      i++;
      continue;
    }
    re.lastIndex = i;
    const mt = re.exec(fmt);
    if (!mt) {
      out += c;
      i++;
      continue;
    }
    i = re.lastIndex;
    if (mt[1]) {
      out += '%';
      continue;
    }
    const flags = mt[2];
    const left = flags.includes('-');
    const plus = flags.includes('+');
    const space = flags.includes(' ');
    let zero = flags.includes('0') && !left;
    const alt = flags.includes('#');
    const width = mt[3] ? parseInt(mt[3], 10) : 0;
    const hasPrec = mt[4] !== undefined;
    const prec = hasPrec ? (mt[4] === '' ? 0 : parseInt(mt[4], 10)) : -1;
    const conv = mt[5];
    const arg = args[ai++];
    let sign = '';
    let prefix = '';
    let body = '';
    const signFor = (neg: boolean) => (neg ? '-' : plus ? '+' : space ? ' ' : '');

    if (conv === 's' || conv === 'c') {
      body = String(arg);
      if (conv === 's' && hasPrec) body = body.slice(0, prec);
      zero = false;
    } else if (conv === 'd' || conv === 'i') {
      const b = BigInt(arg as number | bigint);
      sign = signFor(b < 0n);
      let d = (b < 0n ? -b : b).toString();
      if (hasPrec) {
        if (prec === 0 && b === 0n) d = '';
        else if (d.length < prec) d = '0'.repeat(prec - d.length) + d;
        zero = false;
      }
      body = d;
    } else if (conv === 'x' || conv === 'X' || conv === 'o') {
      const b = BigInt(arg as number | bigint);
      let d = b.toString(conv === 'o' ? 8 : 16);
      if (conv === 'X') d = d.toUpperCase();
      if (hasPrec) {
        if (prec === 0 && b === 0n) d = '';
        else if (d.length < prec) d = '0'.repeat(prec - d.length) + d;
        zero = false;
      }
      if (alt) {
        if (conv === 'o') {
          if (d[0] !== '0') d = '0' + d;
        } else if (b !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      }
      body = d;
    } else {
      const v = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      if (Number.isNaN(v)) {
        body = upper ? 'NAN' : 'nan';
        zero = false;
      } else {
        sign = signFor(v < 0 || Object.is(v, -0));
        if (!Number.isFinite(v)) {
          body = upper ? 'INF' : 'inf';
          zero = false;
        } else {
          const a = Math.abs(v);
          const lower = conv.toLowerCase();
          if (lower === 'f') {
            body = fixed(a, hasPrec ? prec : 6, alt);
          } else if (lower === 'e') {
            const [d, x] = sci(a, hasPrec ? prec : 6);
            body = expo(d, x, alt, upper);
          } else {
            let P = hasPrec ? prec : 6;
            if (P === 0) P = 1;
            const [d, x] = sci(a, P - 1);
            if (P > x && x >= -4) {
              body = fixed(a, P - 1 - x, alt);
              if (!alt && body.includes('.')) body = body.replace(/\.?0+$/, '');
            } else {
              let dd = d;
              if (!alt) dd = d[0] + d.slice(1).replace(/0+$/, '');
              body = expo(dd, x, alt, upper);
            }
          }
        }
      }
    }
    const len = sign.length + prefix.length + body.length;
    if (len < width) {
      const pad = width - len;
      if (left) body = sign + prefix + body + ' '.repeat(pad);
      else if (zero) body = sign + prefix + '0'.repeat(pad) + body;
      else body = ' '.repeat(pad) + sign + prefix + body;
      out += body;
    } else out += sign + prefix + body;
  }
  return out;
}
