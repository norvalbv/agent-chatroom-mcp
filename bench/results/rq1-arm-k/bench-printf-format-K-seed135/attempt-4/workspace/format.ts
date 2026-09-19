function decompose(x: number): [bigint, number] {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const expField = (hi >>> 20) & 0x7ff;
  const frac = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (expField === 0) return [frac, -1074];
  return [frac | (1n << 52n), expField - 1075];
}

// round-half-even of (m * 2^e) * 10^k
function scaled(m: bigint, e: number, k: number): bigint {
  let num = m;
  let den = 1n;
  if (e >= 0) num <<= BigInt(e);
  else den <<= BigInt(-e);
  if (k >= 0) num *= 10n ** BigInt(k);
  else den *= 10n ** BigInt(-k);
  const q = num / den;
  const r = num - q * den;
  const twice = r * 2n;
  if (twice > den || (twice === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// fixed notation of positive-or-zero finite x with p decimals
function fixed(x: number, p: number, alt: boolean): string {
  let n: bigint;
  if (x === 0) n = 0n;
  else {
    const [m, e] = decompose(x);
    n = scaled(m, e, p);
  }
  let s = n.toString();
  if (s.length < p + 1) s = '0'.repeat(p + 1 - s.length) + s;
  const ip = s.slice(0, s.length - p);
  const fp = s.slice(s.length - p);
  return p > 0 ? ip + '.' + fp : alt ? ip + '.' : ip;
}

// digits (p+1 of them) and decimal exponent for x > 0
function sci(x: number, p: number): [string, number] {
  if (x === 0) return ['0'.repeat(p + 1), 0];
  const [m, e] = decompose(x);
  let X = Math.floor(Math.log10(x));
  if (!isFinite(X)) X = -324;
  const ge = (k: number) => {
    // x >= 10^k ?
    let num = m;
    let den = 1n;
    if (e >= 0) num <<= BigInt(e);
    else den <<= BigInt(-e);
    if (k >= 0) den *= 10n ** BigInt(k);
    else num *= 10n ** BigInt(-k);
    return num >= den;
  };
  while (!ge(X)) X--;
  while (ge(X + 1)) X++;
  let d = scaled(m, e, p - X);
  if (d >= 10n ** BigInt(p + 1)) {
    X++;
    d = scaled(m, e, p - X);
  }
  return [d.toString(), X];
}

function expStr(X: number, upper: boolean): string {
  const a = Math.abs(X).toString().padStart(2, '0');
  return (upper ? 'E' : 'e') + (X < 0 ? '-' : '+') + a;
}

function sciStr(x: number, p: number, alt: boolean, upper: boolean): string {
  const [d, X] = sci(x, p);
  const mant = p > 0 ? d[0] + '.' + d.slice(1) : alt ? d + '.' : d;
  return mant + expStr(X, upper);
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
    while (fmt[i] >= '0' && fmt[i] <= '9') width = width * 10 + (fmt.charCodeAt(i++) - 48);
    let prec = -1;
    if (fmt[i] === '.') {
      i++;
      prec = 0;
      while (fmt[i] >= '0' && fmt[i] <= '9') prec = prec * 10 + (fmt.charCodeAt(i++) - 48);
    }
    const conv = fmt[i++];
    const arg = args[ai++];
    let sign = '';
    let prefix = '';
    let body = '';
    let canZero = true;
    const signFor = (neg: boolean) => (neg ? '-' : plus ? '+' : space ? ' ' : '');

    switch (conv) {
      case 'd':
      case 'i': {
        const v = BigInt(arg as number | bigint);
        sign = signFor(v < 0n);
        body = (v < 0n ? -v : v).toString();
        if (prec === 0 && v === 0n) body = '';
        if (prec >= 0) {
          body = body.padStart(prec, '0');
          canZero = false;
        }
        break;
      }
      case 'x':
      case 'X':
      case 'o': {
        const v = BigInt(arg as number | bigint);
        body = v.toString(conv === 'o' ? 8 : 16);
        if (conv === 'X') body = body.toUpperCase();
        if (prec === 0 && v === 0n) body = '';
        if (prec >= 0) {
          body = body.padStart(prec, '0');
          canZero = false;
        }
        if (alt) {
          if (conv === 'o') {
            if (body[0] !== '0') body = '0' + body;
          } else if (v !== 0n) prefix = conv === 'x' ? '0x' : '0X';
        }
        break;
      }
      case 'e':
      case 'E':
      case 'f':
      case 'F':
      case 'g':
      case 'G': {
        const v = arg as number;
        const upper = conv === 'E' || conv === 'F' || conv === 'G';
        if (Number.isNaN(v)) {
          body = upper ? 'NAN' : 'nan';
          canZero = false;
          break;
        }
        const neg = v < 0 || Object.is(v, -0);
        sign = signFor(neg);
        const a = Math.abs(v);
        if (a === Infinity) {
          body = upper ? 'INF' : 'inf';
          canZero = false;
          break;
        }
        const lc = conv.toLowerCase();
        if (lc === 'f') body = fixed(a, prec < 0 ? 6 : prec, alt);
        else if (lc === 'e') body = sciStr(a, prec < 0 ? 6 : prec, alt, upper);
        else {
          let P = prec < 0 ? 6 : prec;
          if (P === 0) P = 1;
          const [, X] = sci(a, P - 1);
          if (P > X && X >= -4) {
            body = fixed(a, P - 1 - X, alt);
            if (!alt) body = stripZeros(body);
          } else {
            const [d] = sci(a, P - 1);
            let mant = P > 1 ? d[0] + '.' + d.slice(1) : alt ? d + '.' : d;
            if (!alt) mant = stripZeros(mant);
            body = mant + expStr(X, upper);
          }
        }
        break;
      }
      case 's': {
        body = String(arg);
        if (prec >= 0) body = body.slice(0, prec);
        canZero = false;
        break;
      }
      case 'c': {
        body = String(arg);
        canZero = false;
        break;
      }
    }
    const len = sign.length + prefix.length + body.length;
    let text: string;
    if (len >= width) text = sign + prefix + body;
    else if (minus) text = sign + prefix + body + ' '.repeat(width - len);
    else if (zero && canZero) text = sign + prefix + '0'.repeat(width - len) + body;
    else text = ' '.repeat(width - len) + sign + prefix + body;
    out += text;
  }
  return out;
}
