function decompose(v: number): [bigint, number] {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, v);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (expBits === 0) return [m, -1074];
  m |= 1n << 52n;
  return [m, expBits - 1075];
}

// round(m * 2^e * 10^k) half-even, exact
function scaledRound(m: bigint, e: number, k: number): bigint {
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

// v finite, >= 0. Returns digits (n significant) and decimal exponent.
function sig(v: number, n: number): [string, number] {
  if (v === 0) return ['0'.repeat(n), 0];
  const [m, e] = decompose(v);
  let X = Math.floor(Math.log10(v));
  const lo = 10n ** BigInt(n - 1);
  const hi = lo * 10n;
  for (let i = 0; i < 10; i++) {
    const q = scaledRound(m, e, n - 1 - X);
    if (q >= hi) X++;
    else if (q < lo) X--;
    else return [q.toString(), X];
  }
  throw new Error('unreachable');
}

function fixed(v: number, prec: number, alt: boolean): string {
  let s: string;
  if (v === 0) s = '0'.repeat(prec + 1);
  else {
    const [m, e] = decompose(v);
    s = scaledRound(m, e, prec).toString().padStart(prec + 1, '0');
  }
  const ip = s.slice(0, s.length - prec);
  const fp = s.slice(s.length - prec);
  return ip + (prec > 0 || alt ? '.' : '') + fp;
}

function expo(digits: string, X: number, alt: boolean, upper: boolean): string {
  const prec = digits.length - 1;
  const ax = Math.abs(X).toString().padStart(2, '0');
  const r = digits[0] + (prec > 0 || alt ? '.' : '') + digits.slice(1);
  return r + (upper ? 'E' : 'e') + (X < 0 ? '-' : '+') + ax;
}

function stripZeros(s: string): string {
  if (!s.includes('.')) return s;
  return s.replace(/0+$/, '').replace(/\.$/, '');
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let ai = 0;
  const re = /%(?:(%)|([-+ 0#]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc]))/g;
  return fmt.replace(re, (_m, pct, flags: string, w: string, p: string | undefined, conv: string) => {
    if (pct) return '%';
    const arg = args[ai++];
    const left = flags.includes('-');
    const plus = flags.includes('+');
    const space = flags.includes(' ');
    const zero = flags.includes('0') && !left;
    const alt = flags.includes('#');
    const width = w ? parseInt(w, 10) : 0;
    const hasPrec = p !== undefined;
    const prec = hasPrec ? (p === '' ? 0 : parseInt(p, 10)) : -1;

    let sign = '';
    let prefix = '';
    let body: string;
    let canZero = zero;

    if (conv === 's' || conv === 'c') {
      let s = String(arg);
      if (conv === 's' && hasPrec) s = s.slice(0, prec);
      body = s;
      canZero = false;
    } else if ('dioxX'.includes(conv)) {
      let n = typeof arg === 'bigint' ? arg : BigInt(arg as number);
      if (conv === 'd' || conv === 'i') {
        if (n < 0n) {
          sign = '-';
          n = -n;
        } else sign = plus ? '+' : space ? ' ' : '';
      }
      let digits = conv === 'o' ? n.toString(8) : conv === 'd' || conv === 'i' ? n.toString() : n.toString(16);
      if (conv === 'X') digits = digits.toUpperCase();
      if (hasPrec) {
        if (prec === 0 && n === 0n) digits = '';
        digits = digits.padStart(prec, '0');
        canZero = false;
      }
      if (conv === 'o' && alt && !digits.startsWith('0')) digits = '0' + digits;
      if ((conv === 'x' || conv === 'X') && alt && n !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      body = digits;
    } else if ('eEfFgG'.includes(conv)) {
      const v = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      const neg = v < 0 || Object.is(v, -0);
      sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
      if (Number.isNaN(v)) {
        sign = '';
        body = upper ? 'NAN' : 'nan';
        canZero = false;
      } else if (!Number.isFinite(v)) {
        body = upper ? 'INF' : 'inf';
        canZero = false;
      } else {
        const a = Math.abs(v);
        const lc = conv.toLowerCase();
        if (lc === 'f') body = fixed(a, hasPrec ? prec : 6, alt);
        else if (lc === 'e') {
          const [d, X] = sig(a, (hasPrec ? prec : 6) + 1);
          body = expo(d, X, alt, upper);
        } else {
          const P = hasPrec ? Math.max(prec, 1) : 6;
          const [d, X] = sig(a, P);
          if (P > X && X >= -4) {
            body = fixed(a, P - 1 - X, alt);
            if (!alt) body = stripZeros(body);
          } else {
            let dd = d;
            if (!alt) dd = d[0] + d.slice(1).replace(/0+$/, '');
            body = expo(dd, X, alt, upper);
          }
        }
      }
    } else body = '';

    const len = sign.length + prefix.length + body.length;
    if (len >= width) return sign + prefix + body;
    const pad = width - len;
    if (left) return sign + prefix + body + ' '.repeat(pad);
    if (canZero) return sign + prefix + '0'.repeat(pad) + body;
    return ' '.repeat(pad) + sign + prefix + body;
  });
}
