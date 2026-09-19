function decompose(x: number): [bigint, number] {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const bexp = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (bexp === 0) return [m, -1074];
  m |= 1n << 52n;
  return [m, bexp - 1075];
}

// round-half-even of |x| * 10^k, exact
function scaled(x: number, k: number): bigint {
  if (x === 0) return 0n;
  const [m, e] = decompose(x);
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

// digits (p+1 of them) and exponent for e-style
function expStyle(x: number, p: number): [string, number] {
  if (x === 0) return ['0'.repeat(p + 1), 0];
  let X = Math.floor(Math.log10(x));
  const hiB = 10n ** BigInt(p + 1);
  const loB = 10n ** BigInt(p);
  for (let i = 0; i < 20; i++) {
    const d = scaled(x, p - X);
    if (d >= hiB) X++;
    else if (d < loB) X--;
    else return [d.toString(), X];
  }
  return [scaled(x, p - X).toString(), X];
}

function fixedStyle(x: number, p: number, alt: boolean): string {
  let s = scaled(x, p).toString();
  if (p > 0) {
    s = s.padStart(p + 1, '0');
    s = s.slice(0, s.length - p) + '.' + s.slice(s.length - p);
  } else if (alt) s += '.';
  return s;
}

function expFmt(x: number, p: number, alt: boolean, upper: boolean): string {
  const [d, X] = expStyle(x, p);
  let s = d[0];
  if (p > 0) s += '.' + d.slice(1);
  else if (alt) s += '.';
  const ax = Math.abs(X);
  return s + (upper ? 'E' : 'e') + (X < 0 ? '-' : '+') + (ax < 10 ? '0' : '') + ax;
}

function stripZeros(s: string): string {
  const ei = s.search(/[eE]/);
  let mant = ei >= 0 ? s.slice(0, ei) : s;
  const rest = ei >= 0 ? s.slice(ei) : '';
  if (mant.includes('.')) mant = mant.replace(/0+$/, '').replace(/\.$/, '');
  return mant + rest;
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let ai = 0;
  const re = /%(?:(%)|([-+ 0#]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc]))/g;
  return fmt.replace(re, (_all, pct, flags: string, w: string, pr: string | undefined, conv: string) => {
    if (pct) return '%';
    const left = flags.includes('-');
    const plus = flags.includes('+');
    const space = flags.includes(' ');
    const zero = flags.includes('0');
    const alt = flags.includes('#');
    const width = w ? parseInt(w, 10) : 0;
    const hasPrec = pr !== undefined;
    const prec = hasPrec ? (pr === '' ? 0 : parseInt(pr, 10)) : -1;
    const arg = args[ai++];
    let sign = '';
    let prefix = '';
    let body: string;
    let zeroOk = zero && !left;

    if (conv === 's' || conv === 'c') {
      body = String(arg);
      if (conv === 's' && hasPrec) body = body.slice(0, prec);
      zeroOk = false;
    } else if ('diouxX'.includes(conv)) {
      let v = typeof arg === 'bigint' ? arg : BigInt(arg as number);
      if (v < 0n) {
        sign = '-';
        v = -v;
      } else if (conv === 'd' || conv === 'i') sign = plus ? '+' : space ? ' ' : '';
      const radix = conv === 'o' ? 8 : conv === 'd' || conv === 'i' ? 10 : 16;
      body = v.toString(radix);
      if (conv === 'X') body = body.toUpperCase();
      if (hasPrec) {
        if (v === 0n && prec === 0) body = '';
        body = body.padStart(prec, '0');
        zeroOk = false;
      }
      if (alt) {
        if (conv === 'o') {
          if (body[0] !== '0') body = '0' + body;
        } else if ((conv === 'x' || conv === 'X') && v !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      }
    } else {
      const x = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      const neg = x < 0 || Object.is(x, -0);
      if (Number.isNaN(x)) {
        body = upper ? 'NAN' : 'nan';
        zeroOk = false;
      } else {
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        if (!Number.isFinite(x)) {
          body = upper ? 'INF' : 'inf';
          zeroOk = false;
        } else {
          const ax = Math.abs(x);
          const p = hasPrec ? prec : 6;
          const lc = conv.toLowerCase();
          if (lc === 'f') body = fixedStyle(ax, p, alt);
          else if (lc === 'e') body = expFmt(ax, p, alt, upper);
          else {
            const P = p === 0 ? 1 : p;
            const X = expStyle(ax, P - 1)[1];
            if (P > X && X >= -4) body = fixedStyle(ax, P - 1 - X, alt);
            else body = expFmt(ax, P - 1, alt, upper);
            if (!alt) body = stripZeros(body);
          }
        }
      }
    }
    const len = sign.length + prefix.length + body.length;
    if (len >= width) return sign + prefix + body;
    const pad = width - len;
    if (left) return sign + prefix + body + ' '.repeat(pad);
    if (zeroOk) return sign + prefix + '0'.repeat(pad) + body;
    return ' '.repeat(pad) + sign + prefix + body;
  });
}
