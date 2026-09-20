function decompose(x: number): [bigint, number] {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const ex = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (ex === 0) return [m, -1074];
  m |= 1n << 52n;
  return [m, ex - 1075];
}

// round-half-even of x * 10^k
function roundScaled(x: number, k: number): bigint {
  const [m, e] = decompose(x);
  const num = m * (e > 0 ? 1n << BigInt(e) : 1n) * (k > 0 ? 10n ** BigInt(k) : 1n);
  const den = (e < 0 ? 1n << BigInt(-e) : 1n) * (k < 0 ? 10n ** BigInt(-k) : 1n);
  let q = num / den;
  const r2 = (num % den) * 2n;
  if (r2 > den || (r2 === den && (q & 1n) === 1n)) q += 1n;
  return q;
}

// digits string (p+1 digits) and decimal exponent
function sci(x: number, p: number): [string, number] {
  if (x === 0) return ['0'.repeat(p + 1), 0];
  let X = Math.floor(Math.log10(x));
  if (!isFinite(X)) X = -324;
  for (;;) {
    const N = roundScaled(x, p - X);
    const lim = 10n ** BigInt(p);
    if (N >= lim * 10n) X++;
    else if (N < lim) X--;
    else return [N.toString(), X];
  }
}

function expStr(X: number, upper: boolean): string {
  const a = Math.abs(X);
  return (upper ? 'E' : 'e') + (X < 0 ? '-' : '+') + (a < 10 ? '0' : '') + a;
}

function fixed(x: number, p: number, alt: boolean): string {
  let s = roundScaled(x, p).toString();
  if (p > 0) {
    s = s.padStart(p + 1, '0');
    s = s.slice(0, s.length - p) + '.' + s.slice(s.length - p);
  } else if (alt) s += '.';
  return s;
}

function expo(x: number, p: number, alt: boolean, upper: boolean): string {
  const [d, X] = sci(x, p);
  let s = d[0];
  if (p > 0) s += '.' + d.slice(1);
  else if (alt) s += '.';
  return s + expStr(X, upper);
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let out = '';
  let ai = 0;
  let i = 0;
  while (i < fmt.length) {
    const ch = fmt[i++];
    if (ch !== '%') {
      out += ch;
      continue;
    }
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
    let prec = -1;
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
    const signOf = (neg: boolean) => (neg ? '-' : plus ? '+' : space ? ' ' : '');
    switch (conv) {
      case 'd':
      case 'i': {
        const v = BigInt(arg as number | bigint);
        sign = signOf(v < 0n);
        body = (v < 0n ? -v : v).toString();
        if (prec >= 0) {
          if (prec === 0 && v === 0n) body = '';
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
        if (prec >= 0) {
          if (prec === 0 && v === 0n) body = '';
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
      case 'e': case 'E': case 'f': case 'F': case 'g': case 'G': {
        const x = arg as number;
        const upper = conv === 'E' || conv === 'F' || conv === 'G';
        if (Number.isNaN(x)) {
          body = upper ? 'NAN' : 'nan';
          canZero = false;
          break;
        }
        sign = signOf(x < 0 || Object.is(x, -0));
        if (!isFinite(x)) {
          body = upper ? 'INF' : 'inf';
          canZero = false;
          break;
        }
        const a = Math.abs(x);
        const lc = conv.toLowerCase();
        if (lc === 'f') body = fixed(a, prec < 0 ? 6 : prec, alt);
        else if (lc === 'e') body = expo(a, prec < 0 ? 6 : prec, alt, upper);
        else {
          const P = prec < 0 ? 6 : prec === 0 ? 1 : prec;
          const X = sci(a, P - 1)[1];
          if (P > X && X >= -4) body = fixed(a, P - 1 - X, alt);
          else body = expo(a, P - 1, alt, upper);
          if (!alt) {
            const m = /^([^eE]*)(.*)$/.exec(body)!;
            let mant = m[1];
            if (mant.includes('.')) mant = mant.replace(/0+$/, '').replace(/\.$/, '');
            body = mant + m[2];
          }
        }
        break;
      }
      case 's':
        body = String(arg);
        if (prec >= 0) body = body.slice(0, prec);
        canZero = false;
        break;
      case 'c':
        body = String(arg);
        canZero = false;
        break;
    }
    const len = sign.length + prefix.length + body.length;
    if (len >= width) out += sign + prefix + body;
    else if (minus) out += sign + prefix + body + ' '.repeat(width - len);
    else if (zero && canZero) out += sign + prefix + '0'.repeat(width - len) + body;
    else out += ' '.repeat(width - len) + sign + prefix + body;
  }
  return out;
}
