function decompose(v: number): [bigint, number] {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, Math.abs(v));
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const expField = (hi >>> 20) & 0x7ff;
  const frac = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (expField === 0) return [frac, -1074];
  return [frac | (1n << 52n), expField - 1075];
}

// round-half-even of m * 2^e * 10^k
function roundScaled(m: bigint, e: number, k: number): bigint {
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

// |v| (finite, nonzero or zero) in fixed style with p fraction digits: [intPart, fracPart]
function fixedParts(v: number, p: number): [string, string] {
  const [m, e] = decompose(v);
  let s = roundScaled(m, e, p).toString();
  if (s.length < p + 1) s = '0'.repeat(p + 1 - s.length) + s;
  return [s.slice(0, s.length - p), s.slice(s.length - p)];
}

// |v| in exp style with p fraction digits: [digits (p+1 long), exponent]
function expParts(v: number, p: number): [string, number] {
  if (v === 0) return ['0'.repeat(p + 1), 0];
  const [m, e] = decompose(v);
  let x = Math.floor(Math.log10(Math.abs(v)));
  const lim = 10n ** BigInt(p);
  for (;;) {
    const s = roundScaled(m, e, p - x);
    if (s >= lim * 10n) x++;
    else if (s < lim) x--;
    else return [s.toString(), x];
  }
}

function expText(digits: string, x: number, alt: boolean, upper: boolean): string {
  const p = digits.length - 1;
  let t = digits[0];
  if (p > 0) t += '.' + digits.slice(1);
  else if (alt) t += '.';
  const ax = Math.abs(x);
  t += (upper ? 'E' : 'e') + (x < 0 ? '-' : '+') + (ax < 10 ? '0' + ax : String(ax));
  return t;
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  const re = /%([-+ 0#]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGscb%])/g;
  let ai = 0;
  return fmt.replace(re, (_all, flags: string, w: string, pr: string | undefined, conv: string) => {
    if (conv === '%') return '%';
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
    let canZero = false;

    if (conv === 's' || conv === 'c') {
      body = String(arg);
      if (conv === 's' && hasPrec) body = body.slice(0, prec);
    } else if ('diouxX'.includes(conv)) {
      let n = typeof arg === 'bigint' ? arg : BigInt(arg as number);
      if (conv === 'd' || conv === 'i') {
        if (n < 0n) {
          sign = '-';
          n = -n;
        } else sign = plus ? '+' : space ? ' ' : '';
      }
      const radix = conv === 'o' ? 8 : conv === 'd' || conv === 'i' ? 10 : 16;
      let digits = n.toString(radix);
      if (conv === 'X') digits = digits.toUpperCase();
      if (hasPrec) {
        if (prec === 0 && n === 0n) digits = '';
        else if (digits.length < prec) digits = '0'.repeat(prec - digits.length) + digits;
      }
      if (alt) {
        if (conv === 'o') {
          if (digits[0] !== '0') digits = '0' + digits;
        } else if ((conv === 'x' || conv === 'X') && n !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      }
      body = digits;
      canZero = !hasPrec;
    } else {
      const v = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      const neg = v < 0 || Object.is(v, -0);
      if (Number.isNaN(v)) {
        body = upper ? 'NAN' : 'nan';
      } else {
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        if (!Number.isFinite(v)) {
          body = upper ? 'INF' : 'inf';
        } else {
          canZero = true;
          const lc = conv.toLowerCase();
          if (lc === 'f') {
            const p = hasPrec ? prec : 6;
            const [ip, fp] = fixedParts(v, p);
            body = ip + (p > 0 ? '.' + fp : alt ? '.' : '');
          } else if (lc === 'e') {
            const p = hasPrec ? prec : 6;
            const [d, x] = expParts(v, p);
            body = expText(d, x, alt, upper);
          } else {
            let P = hasPrec ? prec : 6;
            if (P === 0) P = 1;
            const [d, x] = expParts(v, P - 1);
            if (P > x && x >= -4) {
              const p = P - 1 - x;
              const [ip, fp0] = fixedParts(v, p);
              let fp = fp0;
              if (!alt) fp = fp.replace(/0+$/, '');
              body = ip + (fp.length > 0 ? '.' + fp : alt ? '.' : '');
            } else {
              let dd = d;
              if (!alt) dd = d[0] + d.slice(1).replace(/0+$/, '');
              body = expText(dd, x, alt, upper);
            }
          }
        }
      }
    }

    const len = sign.length + prefix.length + body.length;
    if (len >= width) return sign + prefix + body + '';
    const pad = width - len;
    if (left) return sign + prefix + body + ' '.repeat(pad);
    if (zero && canZero) return sign + prefix + '0'.repeat(pad) + body;
    return ' '.repeat(pad) + sign + prefix + body;
  });
}
