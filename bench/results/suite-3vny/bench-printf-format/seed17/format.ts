function decompose(v: number): [bigint, number] {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, Math.abs(v));
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const ex = (hi >>> 20) & 0x7ff;
  const frac = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (ex === 0) return [frac, -1074];
  return [frac | (1n << 52n), ex - 1075];
}

// round(m * 2^e * 10^k), ties to even
function roundScaled(m: bigint, e: number, k: number): bigint {
  let num = m;
  let den = 1n;
  if (e > 0) num <<= BigInt(e);
  else den <<= BigInt(-e);
  if (k > 0) num *= 10n ** BigInt(k);
  else if (k < 0) den *= 10n ** BigInt(-k);
  const q = num / den;
  const r = num % den;
  const twice = r * 2n;
  if (twice > den || (twice === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

function fixedDigits(v: number, prec: number): string {
  const [m, e] = decompose(v);
  let s = roundScaled(m, e, prec).toString();
  if (s.length < prec + 1) s = '0'.repeat(prec + 1 - s.length) + s;
  return s;
}

// returns [digit string of length prec+1, exponent]
function expDigits(v: number, prec: number): [string, number] {
  if (v === 0) return ['0'.repeat(prec + 1), 0];
  const [m, e] = decompose(v);
  let est = Math.floor(Math.log10(Math.abs(v)));
  if (!isFinite(est)) est = -324;
  const lowB = 10n ** BigInt(prec);
  const highB = lowB * 10n;
  for (;;) {
    const s = roundScaled(m, e, prec - est);
    if (s >= highB) est++;
    else if (s < lowB) est--;
    else return [s.toString(), est];
  }
}

function fmtExp(digits: string, x: number, alt: boolean, upper: boolean): string {
  let s = digits[0];
  if (digits.length > 1) s += '.' + digits.slice(1);
  else if (alt) s += '.';
  const ax = Math.abs(x);
  return s + (upper ? 'E' : 'e') + (x < 0 ? '-' : '+') + (ax < 10 ? '0' : '') + ax;
}

function fmtFixed(v: number, prec: number, alt: boolean): string {
  const d = fixedDigits(v, prec);
  const ip = d.slice(0, d.length - prec);
  const fp = d.slice(d.length - prec);
  return ip + (prec > 0 ? '.' + fp : alt ? '.' : '');
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let ai = 0;
  const re = /%(?:%|([-+ 0#]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc]))/g;
  return fmt.replace(re, (whole, flags: string | undefined, w: string, p: string | undefined, conv: string) => {
    if (conv === undefined) return '%';
    flags = flags || '';
    const left = flags.includes('-');
    const plus = flags.includes('+');
    const space = flags.includes(' ');
    const zero = flags.includes('0') && !left;
    const alt = flags.includes('#');
    const width = w ? parseInt(w, 10) : 0;
    const hasPrec = p !== undefined;
    const prec = hasPrec ? (p === '' ? 0 : parseInt(p, 10)) : -1;
    const arg = args[ai++];

    let sign = '';
    let prefix = '';
    let body = '';
    let canZero = false;

    const signFor = (neg: boolean) => (neg ? '-' : plus ? '+' : space ? ' ' : '');

    if (conv === 's') {
      body = String(arg);
      if (hasPrec) body = body.slice(0, prec);
    } else if (conv === 'c') {
      body = String(arg);
    } else if ('dixXo'.includes(conv)) {
      let n = typeof arg === 'bigint' ? arg : BigInt(arg as number);
      const neg = n < 0n;
      if (neg) n = -n;
      sign = conv === 'd' || conv === 'i' ? signFor(neg) : '';
      let digits = n === 0n && hasPrec && prec === 0 ? '' : n.toString(conv === 'o' ? 8 : conv === 'd' || conv === 'i' ? 10 : 16);
      if (conv === 'X') digits = digits.toUpperCase();
      if (hasPrec && digits.length < prec) digits = '0'.repeat(prec - digits.length) + digits;
      if (alt) {
        if (conv === 'o') {
          if (!digits.startsWith('0')) digits = '0' + digits;
        } else if ((conv === 'x' || conv === 'X') && n !== 0n) {
          prefix = conv === 'x' ? '0x' : '0X';
        }
      }
      body = digits;
      canZero = !hasPrec;
    } else {
      const v = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      const lc = conv.toLowerCase();
      if (Number.isNaN(v)) {
        body = upper ? 'NAN' : 'nan';
      } else {
        sign = signFor(v < 0 || Object.is(v, -0));
        if (!isFinite(v)) {
          body = upper ? 'INF' : 'inf';
        } else {
          canZero = true;
          const P = hasPrec ? prec : 6;
          if (lc === 'f') {
            body = fmtFixed(v, P, alt);
          } else if (lc === 'e') {
            const [d, x] = expDigits(v, P);
            body = fmtExp(d, x, alt, upper);
          } else {
            const PP = P === 0 ? 1 : P;
            const [d, x] = expDigits(v, PP - 1);
            const strip = (s: string) => (alt || !s.includes('.') ? s : s.replace(/0+$/, '').replace(/\.$/, ''));
            if (PP > x && x >= -4) {
              body = strip(fmtFixed(v, PP - 1 - x, alt));
            } else {
              let mant = d[0] + (d.length > 1 ? '.' + d.slice(1) : alt ? '.' : '');
              mant = strip(mant);
              const ax = Math.abs(x);
              body = mant + (upper ? 'E' : 'e') + (x < 0 ? '-' : '+') + (ax < 10 ? '0' : '') + ax;
            }
          }
        }
      }
      if (Number.isNaN(v) || !isFinite(v)) canZero = false;
    }

    const len = sign.length + prefix.length + body.length;
    if (len >= width) return sign + prefix + body;
    const pad = width - len;
    if (left) return sign + prefix + body + ' '.repeat(pad);
    if (zero && canZero) return sign + prefix + '0'.repeat(pad) + body;
    return ' '.repeat(pad) + sign + prefix + body;
  });
}
