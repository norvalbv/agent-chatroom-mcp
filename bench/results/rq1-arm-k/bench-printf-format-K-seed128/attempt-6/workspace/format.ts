function decompose(x: number): { m: bigint; e: number } {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, Math.abs(x));
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const ex = (hi >>> 20) & 0x7ff;
  const frac = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (ex === 0) return { m: frac, e: -1074 };
  return { m: frac | (1n << 52n), e: ex - 1075 };
}

// round-half-even(|x| * 10^k), exact
function roundScaled(m: bigint, e: number, k: number): bigint {
  let num = m;
  let den = 1n;
  if (e > 0) num <<= BigInt(e);
  else den <<= BigInt(-e);
  if (k >= 0) num *= 10n ** BigInt(k);
  else den *= 10n ** BigInt(-k);
  const q = num / den;
  const r2 = (num % den) * 2n;
  if (r2 > den || (r2 === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

function fixedParts(x: number, p: number): [string, string] {
  const { m, e } = decompose(x);
  let s = roundScaled(m, e, p).toString();
  if (s.length < p + 1) s = '0'.repeat(p + 1 - s.length) + s;
  return [s.slice(0, s.length - p), s.slice(s.length - p)];
}

function expDigits(x: number, p: number): { ds: string; X: number } {
  if (x === 0) return { ds: '0'.repeat(p + 1), X: 0 };
  const { m, e } = decompose(x);
  let X = Math.floor(Math.log10(Math.abs(x)));
  if (!isFinite(X)) X = 0;
  const lowB = 10n ** BigInt(p);
  for (let i = 0; i < 20; i++) {
    const d = roundScaled(m, e, p - X);
    if (d < lowB) X--;
    else if (d >= lowB * 10n) X++;
    else return { ds: d.toString(), X };
  }
  throw new Error('exp');
}

function expStr(ds: string, X: number, p: number, alt: boolean, upper: boolean, strip: boolean): string {
  let frac = ds.slice(1);
  if (strip) frac = frac.replace(/0+$/, '');
  let s = ds[0] + (frac.length > 0 || alt ? '.' : '') + frac;
  const ax = Math.abs(X);
  s += (upper ? 'E' : 'e') + (X < 0 ? '-' : '+') + (ax < 10 ? '0' : '') + ax;
  return s;
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
    let body = '';
    let zeroOk = zero && !left;

    const signFor = (neg: boolean) => (neg ? '-' : plus ? '+' : space ? ' ' : '');

    if (conv === 's' || conv === 'c') {
      body = String(arg);
      if (conv === 's' && hasPrec) body = body.slice(0, prec);
      zeroOk = false;
    } else if ('diouxX'.includes(conv)) {
      const v = BigInt(arg as number | bigint);
      const neg = v < 0n;
      const mag = neg ? -v : v;
      if (conv === 'd' || conv === 'i') {
        sign = signFor(neg);
        body = mag.toString();
      } else if (conv === 'o') {
        body = mag.toString(8);
      } else {
        body = mag.toString(16);
        if (conv === 'X') body = body.toUpperCase();
      }
      if (hasPrec) {
        if (prec === 0 && mag === 0n) body = '';
        else if (body.length < prec) body = '0'.repeat(prec - body.length) + body;
        zeroOk = false;
      }
      if (alt) {
        if (conv === 'o') {
          if (body[0] !== '0') body = '0' + body;
        } else if ((conv === 'x' || conv === 'X') && mag !== 0n) {
          prefix = conv === 'x' ? '0x' : '0X';
        }
      }
    } else {
      const x = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      const neg = x < 0 || Object.is(x, -0);
      if (Number.isNaN(x)) {
        body = upper ? 'NAN' : 'nan';
        zeroOk = false;
      } else if (!Number.isFinite(x)) {
        sign = signFor(neg);
        body = upper ? 'INF' : 'inf';
        zeroOk = false;
      } else {
        sign = signFor(neg);
        const lc = conv.toLowerCase();
        const p = hasPrec ? prec : 6;
        if (lc === 'f') {
          const [ip, fp] = fixedParts(x, p);
          body = ip + (p > 0 || alt ? '.' : '') + fp;
        } else if (lc === 'e') {
          const { ds, X } = expDigits(x, p);
          body = expStr(ds, X, p, alt, upper, false);
        } else {
          const P = p === 0 ? 1 : p;
          const { ds, X } = expDigits(x, P - 1);
          if (P > X && X >= -4) {
            const fp = P - 1 - X;
            const [ip, fr0] = fixedParts(x, fp);
            const fr = alt ? fr0 : fr0.replace(/0+$/, '');
            body = ip + (fr.length > 0 || alt ? '.' : '') + fr;
          } else {
            body = expStr(ds, X, P - 1, alt, upper, !alt);
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
