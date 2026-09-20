function roundDiv(n: bigint, d: bigint): bigint {
  const q = n / d;
  const r2 = (n - q * d) * 2n;
  if (r2 > d || (r2 === d && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// abs finite x = m * 2^e
function decompose(x: number): [bigint, number] {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const be = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (be === 0) return [m, -1074];
  m |= 1n << 52n;
  return [m, be - 1075];
}

function scaled(x: number, p: number): bigint {
  // round(x * 10^p)
  const [m, e] = decompose(x);
  let num = m;
  let den = 1n;
  if (e >= 0) num <<= BigInt(e);
  else den <<= BigInt(-e);
  if (p >= 0) num *= 10n ** BigInt(p);
  else den *= 10n ** BigInt(-p);
  return roundDiv(num, den);
}

function fixed(x: number, p: number): [string, string] {
  let s = scaled(x, p).toString();
  if (s.length < p + 1) s = '0'.repeat(p + 1 - s.length) + s;
  return [s.slice(0, s.length - p), s.slice(s.length - p)];
}

function sci(x: number, p: number): [string, number] {
  if (x === 0) return ['0'.repeat(p + 1), 0];
  let X = Math.floor(Math.log10(x));
  const lo = 10n ** BigInt(p);
  const hi = lo * 10n;
  for (let i = 0; i < 10; i++) {
    const q = scaled(x, p - X);
    if (q === hi) return [lo.toString(), X + 1];
    if (q > hi) X++;
    else if (q < lo) X--;
    else return [q.toString(), X];
  }
  throw new Error('unreachable');
}

function expStr(X: number, upper: boolean): string {
  const a = Math.abs(X);
  return (upper ? 'E' : 'e') + (X < 0 ? '-' : '+') + (a < 10 ? '0' : '') + a;
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

    let sign = '';
    let prefix = '';
    let body = '';
    let canZero = true;
    const lc = conv.toLowerCase();

    if (conv === 's' || conv === 'c') {
      body = String(arg);
      if (conv === 's' && prec >= 0) body = body.slice(0, prec);
      canZero = false;
    } else if (conv === 'd' || conv === 'i' || lc === 'x' || conv === 'o') {
      const v = BigInt(arg as number | bigint);
      const neg = v < 0n;
      const a = neg ? -v : v;
      let digits = conv === 'd' || conv === 'i' ? a.toString()
        : conv === 'o' ? a.toString(8)
        : conv === 'x' ? a.toString(16) : a.toString(16).toUpperCase();
      if (prec >= 0) {
        canZero = false;
        if (prec === 0 && a === 0n) digits = '';
        else if (digits.length < prec) digits = '0'.repeat(prec - digits.length) + digits;
      }
      if (conv === 'd' || conv === 'i') {
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
      } else if (alt) {
        if (conv === 'o') {
          if (digits[0] !== '0') digits = '0' + digits;
        } else if (a !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      }
      body = digits;
    } else {
      const v = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      const neg = v < 0 || Object.is(v, -0);
      if (Number.isNaN(v)) {
        body = upper ? 'NAN' : 'nan';
        canZero = false;
      } else {
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        if (!Number.isFinite(v)) {
          body = upper ? 'INF' : 'inf';
          canZero = false;
        } else {
          const x = Math.abs(v);
          const p = prec < 0 ? 6 : prec;
          const asF = (pp: number) => {
            const [ip, fp] = fixed(x, pp);
            return ip + (pp > 0 || alt ? '.' : '') + fp;
          };
          const asE = (pp: number) => {
            const [d, X] = sci(x, pp);
            return d[0] + (pp > 0 || alt ? '.' : '') + d.slice(1) + expStr(X, upper);
          };
          if (lc === 'f') body = asF(p);
          else if (lc === 'e') body = asE(p);
          else {
            const P = p === 0 ? 1 : p;
            const X = sci(x, P - 1)[1];
            let s: string;
            if (P > X && X >= -4) s = asF(P - 1 - X);
            else s = asE(P - 1);
            if (!alt) {
              const m = s.match(/^([^eE]*)([eE].*)?$/)!;
              let mant = m[1];
              if (mant.includes('.')) mant = mant.replace(/0+$/, '').replace(/\.$/, '');
              s = mant + (m[2] ?? '');
            }
            body = s;
          }
        }
      }
    }

    const len = sign.length + prefix.length + body.length;
    if (len >= width) out += sign + prefix + body;
    else if (minus) out += sign + prefix + body + ' '.repeat(width - len);
    else if (zero && canZero) out += sign + prefix + '0'.repeat(width - len) + body;
    else out += ' '.repeat(width - len) + sign + prefix + body;
  }
  return out;
}
