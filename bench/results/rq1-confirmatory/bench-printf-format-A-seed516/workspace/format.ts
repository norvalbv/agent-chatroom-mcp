const P10 = (n: number): bigint => 10n ** BigInt(n);

function decompose(v: number): [bigint, number] {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, v);
  const bits = dv.getBigUint64(0);
  const ex = Number((bits >> 52n) & 0x7ffn);
  const frac = bits & ((1n << 52n) - 1n);
  return ex === 0 ? [frac, -1074] : [frac | (1n << 52n), ex - 1075];
}

// round(|v| * 10^k) to nearest, ties to even, using the exact value
function roundScaled(m: bigint, e2: number, k: number): bigint {
  let N = m * P10(Math.max(k, 0));
  let D = P10(Math.max(-k, 0));
  if (e2 >= 0) N <<= BigInt(e2);
  else D <<= BigInt(-e2);
  let q = N / D;
  const r2 = (N % D) * 2n;
  if (r2 > D || (r2 === D && (q & 1n) === 1n)) q += 1n;
  return q;
}

function expDigits(a: number, p: number): [string, number] {
  if (a === 0) return ['0'.repeat(p + 1), 0];
  const [m, e2] = decompose(a);
  let x = Math.floor(Math.log10(a));
  if (!isFinite(x)) x = -324;
  const lo = P10(p);
  const hi = P10(p + 1);
  for (;;) {
    const q = roundScaled(m, e2, p - x);
    if (q >= hi) x++;
    else if (q < lo) x--;
    else return [q.toString(), x];
  }
}

function fmtE(a: number, p: number, alt: boolean, upper: boolean): string {
  const [d, x] = expDigits(a, p);
  let s = d[0] + (p > 0 || alt ? '.' : '') + d.slice(1);
  const ax = Math.abs(x);
  s += (upper ? 'E' : 'e') + (x < 0 ? '-' : '+') + (ax < 10 ? '0' : '') + ax;
  return s;
}

function fmtF(a: number, p: number, alt: boolean): string {
  const [m, e2] = decompose(a);
  let d = roundScaled(m, e2, p).toString();
  if (d.length < p + 1) d = '0'.repeat(p + 1 - d.length) + d;
  const ip = d.slice(0, d.length - p);
  const fp = d.slice(d.length - p);
  return ip + (p > 0 || alt ? '.' : '') + fp;
}

function stripZeros(s: string): string {
  const ei = s.search(/[eE]/);
  let mant = ei < 0 ? s : s.slice(0, ei);
  const rest = ei < 0 ? '' : s.slice(ei);
  if (mant.includes('.')) mant = mant.replace(/0+$/, '').replace(/\.$/, '');
  return mant + rest;
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
      const f = fmt[i];
      if (f === '-') minus = true;
      else if (f === '+') plus = true;
      else if (f === ' ') space = true;
      else if (f === '0') zero = true;
      else if (f === '#') alt = true;
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
        const b = BigInt(arg as number | bigint);
        sign = signFor(b < 0n);
        body = (b < 0n ? -b : b).toString();
        if (prec === 0 && b === 0n) body = '';
        if (prec >= 0) {
          body = body.padStart(prec, '0');
          canZero = false;
        }
        break;
      }
      case 'x':
      case 'X':
      case 'o': {
        const b = BigInt(arg as number | bigint);
        body = b.toString(conv === 'o' ? 8 : 16);
        if (conv === 'X') body = body.toUpperCase();
        if (prec === 0 && b === 0n) body = '';
        if (prec >= 0) {
          body = body.padStart(prec, '0');
          canZero = false;
        }
        if (alt) {
          if (conv === 'o') {
            if (body[0] !== '0') body = '0' + body;
          } else if (b !== 0n) prefix = conv === 'x' ? '0x' : '0X';
        }
        break;
      }
      case 'e': case 'E': case 'f': case 'F': case 'g': case 'G': {
        const v = arg as number;
        const upper = conv === 'E' || conv === 'F' || conv === 'G';
        if (Number.isNaN(v)) {
          body = upper ? 'NAN' : 'nan';
          canZero = false;
          break;
        }
        sign = signFor(v < 0 || Object.is(v, -0));
        const a = Math.abs(v);
        if (a === Infinity) {
          body = upper ? 'INF' : 'inf';
          canZero = false;
          break;
        }
        const lc = conv.toLowerCase();
        if (lc === 'e') body = fmtE(a, prec < 0 ? 6 : prec, alt, upper);
        else if (lc === 'f') body = fmtF(a, prec < 0 ? 6 : prec, alt);
        else {
          const P = prec < 0 ? 6 : prec === 0 ? 1 : prec;
          const X = expDigits(a, P - 1)[1];
          if (P > X && X >= -4) body = fmtF(a, P - 1 - X, alt);
          else body = fmtE(a, P - 1, alt, upper);
          if (!alt) body = stripZeros(body);
        }
        break;
      }
      case 's': {
        body = String(arg);
        if (prec >= 0) body = body.slice(0, prec);
        canZero = false;
        break;
      }
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
