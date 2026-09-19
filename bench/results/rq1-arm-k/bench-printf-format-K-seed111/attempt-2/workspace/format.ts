// round(N * 10^k / D), half to even, exact
function roundScaled(N: bigint, D: bigint, k: number): bigint {
  if (k >= 0) N *= 10n ** BigInt(k);
  else D *= 10n ** BigInt(-k);
  let q = N / D;
  const r = N - q * D;
  const twice = r * 2n;
  if (twice > D || (twice === D && (q & 1n) === 1n)) q += 1n;
  return q;
}

// x finite, >= 0 -> [N, D] exact rational
function toRational(x: number): [bigint, bigint] {
  if (x === 0) return [0n, 1n];
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, x);
  const bits = dv.getBigUint64(0);
  const expBits = Number((bits >> 52n) & 0x7ffn);
  let m = bits & ((1n << 52n) - 1n);
  let e: number;
  if (expBits === 0) {
    e = -1074;
  } else {
    m |= 1n << 52n;
    e = expBits - 1075;
  }
  return e >= 0 ? [m << BigInt(e), 1n] : [m, 1n << BigInt(-e)];
}

// fixed: returns [intPart, fracPart]
function fixedParts(x: number, prec: number): [string, string] {
  const [N, D] = toRational(x);
  let s = roundScaled(N, D, prec).toString();
  if (s.length < prec + 1) s = '0'.repeat(prec + 1 - s.length) + s;
  return [s.slice(0, s.length - prec), s.slice(s.length - prec)];
}

// exp style: returns [digits (prec+1 chars), exponent]
function expParts(x: number, prec: number): [string, number] {
  if (x === 0) return ['0'.repeat(prec + 1), 0];
  const [N, D] = toRational(x);
  let e10 = Math.floor(Math.log10(x));
  if (!Number.isFinite(e10)) e10 = 0;
  const ge = (n: number) => (n >= 0 ? N >= D * 10n ** BigInt(n) : N * 10n ** BigInt(-n) >= D);
  while (!ge(e10)) e10--;
  while (ge(e10 + 1)) e10++;
  let q = roundScaled(N, D, prec - e10);
  if (q.toString().length > prec + 1) {
    e10++;
    q = roundScaled(N, D, prec - e10);
  }
  return [q.toString(), e10];
}

function expStr(digits: string, e: number, hash: boolean, upper: boolean): string {
  let s = digits[0];
  if (digits.length > 1) s += '.' + digits.slice(1);
  else if (hash) s += '.';
  const ae = Math.abs(e);
  s += (upper ? 'E' : 'e') + (e < 0 ? '-' : '+') + (ae < 10 ? '0' : '') + ae;
  return s;
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
    let minus = false, plus = false, space = false, zero = false, hash = false;
    for (;; i++) {
      const c = fmt[i];
      if (c === '-') minus = true;
      else if (c === '+') plus = true;
      else if (c === ' ') space = true;
      else if (c === '0') zero = true;
      else if (c === '#') hash = true;
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
    let canZero = false;
    const signOf = (neg: boolean) => (neg ? '-' : plus ? '+' : space ? ' ' : '');

    switch (conv) {
      case 'd':
      case 'i': {
        const v = BigInt(arg as number | bigint);
        prefix = signOf(v < 0n);
        body = (v < 0n ? -v : v).toString();
        if (prec === 0 && v === 0n) body = '';
        if (prec > body.length) body = '0'.repeat(prec - body.length) + body;
        canZero = prec < 0;
        break;
      }
      case 'x':
      case 'X':
      case 'o': {
        const v = BigInt(arg as number | bigint);
        body = v.toString(conv === 'o' ? 8 : 16);
        if (conv === 'X') body = body.toUpperCase();
        if (prec === 0 && v === 0n) body = '';
        if (prec > body.length) body = '0'.repeat(prec - body.length) + body;
        if (hash) {
          if (conv === 'o') {
            if (body[0] !== '0') body = '0' + body;
          } else if (v !== 0n) prefix = conv === 'x' ? '0x' : '0X';
        }
        canZero = prec < 0;
        break;
      }
      case 'e': case 'E': case 'f': case 'F': case 'g': case 'G': {
        const x = arg as number;
        const upper = conv === 'E' || conv === 'F' || conv === 'G';
        if (Number.isNaN(x)) {
          body = upper ? 'NAN' : 'nan';
          break;
        }
        const neg = x < 0 || Object.is(x, -0);
        prefix = signOf(neg);
        const ax = Math.abs(x);
        if (ax === Infinity) {
          body = upper ? 'INF' : 'inf';
          break;
        }
        canZero = true;
        const lc = conv.toLowerCase();
        if (lc === 'f') {
          const p = prec < 0 ? 6 : prec;
          const [ip, fp] = fixedParts(ax, p);
          body = ip + (p > 0 ? '.' + fp : hash ? '.' : '');
        } else if (lc === 'e') {
          const p = prec < 0 ? 6 : prec;
          const [d, e] = expParts(ax, p);
          body = expStr(d, e, hash, upper);
        } else {
          const P = prec < 0 ? 6 : prec === 0 ? 1 : prec;
          const [d, X] = expParts(ax, P - 1);
          const strip = (s: string) => {
            if (hash || !s.includes('.')) return s;
            return s.replace(/0+$/, '').replace(/\.$/, '');
          };
          if (P > X && X >= -4) {
            const p = P - 1 - X;
            const [ip, fp] = fixedParts(ax, p);
            body = strip(ip + (p > 0 ? '.' + fp : hash ? '.' : ''));
          } else {
            let s = d[0];
            if (d.length > 1) s += '.' + d.slice(1);
            else if (hash) s += '.';
            body = strip(s) + (upper ? 'E' : 'e') + (X < 0 ? '-' : '+') + (Math.abs(X) < 10 ? '0' : '') + Math.abs(X);
          }
        }
        break;
      }
      case 's': {
        body = arg as string;
        if (prec >= 0) body = body.slice(0, prec);
        break;
      }
      case 'c':
        body = arg as string;
        break;
    }

    const len = prefix.length + body.length;
    if (len >= width) out += prefix + body;
    else if (minus) out += prefix + body + ' '.repeat(width - len);
    else if (zero && canZero) out += prefix + '0'.repeat(width - len) + body;
    else out += ' '.repeat(width - len) + prefix + body;
  }
  return out;
}
