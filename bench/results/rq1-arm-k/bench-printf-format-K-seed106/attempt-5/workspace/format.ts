const T = (n: number): bigint => 10n ** BigInt(n);

// Exact rational of a finite non-negative double: [num, den].
function ratio(x: number): [bigint, bigint] {
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, x);
  const bits = buf.getBigUint64(0);
  const expBits = Number((bits >> 52n) & 0x7ffn);
  const frac = bits & ((1n << 52n) - 1n);
  let m: bigint;
  let k: number;
  if (expBits === 0) {
    m = frac;
    k = -1074;
  } else {
    m = frac | (1n << 52n);
    k = expBits - 1075;
  }
  return k >= 0 ? [m << BigInt(k), 1n] : [m, 1n << BigInt(-k)];
}

// round(x * 10^s), ties to even
function scaled(x: number, s: number): bigint {
  let [num, den] = ratio(x);
  if (s >= 0) num *= T(s);
  else den *= T(-s);
  const q = num / den;
  const r = num % den;
  const c = 2n * r;
  if (c > den || (c === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

function fixed(x: number, prec: number, alt: boolean): string {
  const s = scaled(x, prec).toString().padStart(prec + 1, '0');
  const ip = s.slice(0, s.length - prec);
  const fp = s.slice(s.length - prec);
  return prec > 0 ? ip + '.' + fp : alt ? ip + '.' : ip;
}

// returns [digits (prec+1 chars), exponent]
function sciParts(x: number, prec: number): [string, number] {
  if (x === 0) return ['0'.repeat(prec + 1), 0];
  const [num, den] = ratio(x);
  // find e with 10^e <= x < 10^(e+1)
  let e = Math.floor(Math.log10(x));
  if (!isFinite(e)) e = -324;
  const ge = (p: number): boolean => (p >= 0 ? num >= den * T(p) : num * T(-p) >= den);
  while (!ge(e)) e--;
  while (ge(e + 1)) e++;
  let n = scaled(x, prec - e);
  if (n >= T(prec + 1)) {
    e++;
    n = scaled(x, prec - e);
  }
  return [n.toString(), e];
}

function sci(x: number, prec: number, alt: boolean, upper: boolean, strip: boolean): string {
  const [d, e] = sciParts(x, prec);
  let fp = d.slice(1);
  if (strip) fp = fp.replace(/0+$/, '');
  let m = d[0];
  if (fp.length > 0) m += '.' + fp;
  else if (alt) m += '.';
  const ae = Math.abs(e);
  return m + (upper ? 'E' : 'e') + (e < 0 ? '-' : '+') + (ae < 10 ? '0' + ae : String(ae));
}

function stripFixed(s: string): string {
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
    let sign = '';
    let prefix = '';
    let body = '';
    let canZero = false;
    const signFor = (neg: boolean): string => (neg ? '-' : plus ? '+' : space ? ' ' : '');

    if (conv === 'd' || conv === 'i') {
      const v = BigInt(arg as number | bigint);
      sign = signFor(v < 0n);
      body = (v < 0n ? -v : v).toString();
      if (prec !== undefined) {
        if (prec === 0 && v === 0n) body = '';
        body = body.padStart(prec, '0');
      }
      canZero = prec === undefined;
    } else if (conv === 'x' || conv === 'X' || conv === 'o') {
      const v = BigInt(arg as number | bigint);
      body = v.toString(conv === 'o' ? 8 : 16);
      if (conv === 'X') body = body.toUpperCase();
      if (prec !== undefined) {
        if (prec === 0 && v === 0n) body = '';
        body = body.padStart(prec, '0');
      }
      if (alt) {
        if (conv === 'o') {
          if (body[0] !== '0') body = '0' + body;
        } else if (v !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      }
      canZero = prec === undefined;
    } else if ('eEfFgG'.includes(conv)) {
      const x = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      const neg = x < 0 || Object.is(x, -0);
      if (Number.isNaN(x)) {
        body = upper ? 'NAN' : 'nan';
      } else if (!isFinite(x)) {
        sign = signFor(neg);
        body = upper ? 'INF' : 'inf';
      } else {
        sign = signFor(neg);
        const a = Math.abs(x);
        canZero = true;
        const lc = conv.toLowerCase();
        if (lc === 'f') body = fixed(a, prec ?? 6, alt);
        else if (lc === 'e') body = sci(a, prec ?? 6, alt, upper, false);
        else {
          const P = prec === undefined ? 6 : prec === 0 ? 1 : prec;
          const X = sciParts(a, P - 1)[1];
          if (P > X && X >= -4) {
            body = fixed(a, P - 1 - X, alt);
            if (!alt) body = stripFixed(body);
          } else {
            body = sci(a, P - 1, alt, upper, !alt);
          }
        }
      }
    } else if (conv === 's') {
      body = String(arg);
      if (prec !== undefined) body = body.slice(0, prec);
    } else if (conv === 'c') {
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
