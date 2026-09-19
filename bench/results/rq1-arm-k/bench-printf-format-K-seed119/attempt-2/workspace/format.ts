function decompose(x: number): { neg: boolean; m: bigint; e: number } {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const neg = (hi >>> 31) === 1;
  const exp = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (exp === 0) return { neg, m, e: -1074 };
  m |= 1n << 52n;
  return { neg, m, e: exp - 1075 };
}

// round(m * 2^e * 10^k), half to even
function roundScaled(m: bigint, e: number, k: number): bigint {
  let num = m;
  let den = 1n;
  if (e >= 0) num <<= BigInt(e);
  else den <<= BigInt(-e);
  if (k >= 0) num *= 10n ** BigInt(k);
  else den *= 10n ** BigInt(-k);
  const q = num / den;
  const r = num % den;
  const twice = r * 2n;
  if (twice > den || (twice === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

function fixed(m: bigint, e: number, prec: number, alt: boolean): string {
  const n = roundScaled(m, e, prec);
  let s = n.toString();
  if (prec > 0) {
    s = s.padStart(prec + 1, '0');
    return s.slice(0, s.length - prec) + '.' + s.slice(s.length - prec);
  }
  return alt ? s + '.' : s;
}

function expDigits(m: bigint, e: number, prec: number): { digits: string; x: number } {
  if (m === 0n) return { digits: '0'.repeat(prec + 1), x: 0 };
  const approx = Number(m) * Math.pow(2, e);
  let x = Number.isFinite(approx) && approx > 0 ? Math.floor(Math.log10(approx)) : 0;
  if (approx === 0 || !Number.isFinite(approx)) x = Math.floor((Math.log10(Number(m)) + e * Math.log10(2)));
  const lim = 10n ** BigInt(prec);
  for (;;) {
    const n = roundScaled(m, e, prec - x);
    if (n >= lim * 10n) x++;
    else if (n < lim) x--;
    else return { digits: n.toString(), x };
  }
}

function expStyle(m: bigint, e: number, prec: number, alt: boolean, upper: boolean): string {
  const { digits, x } = expDigits(m, e, prec);
  let s = digits[0];
  if (prec > 0) s += '.' + digits.slice(1);
  else if (alt) s += '.';
  const ax = Math.abs(x);
  return s + (upper ? 'E' : 'e') + (x < 0 ? '-' : '+') + (ax < 10 ? '0' : '') + ax;
}

function stripZeros(s: string): string {
  if (!s.includes('.')) return s;
  return s.replace(/0+$/, '').replace(/\.$/, '');
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let ai = 0;
  return fmt.replace(/%(?:(%)|([-+ 0#]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc]))/g, (
    _all: string, pct: string | undefined, flags: string, w: string, p: string | undefined, conv: string,
  ) => {
    if (pct) return '%';
    const left = flags.includes('-');
    const plus = flags.includes('+');
    const space = flags.includes(' ');
    const zero = flags.includes('0') && !left;
    const alt = flags.includes('#');
    const width = w ? parseInt(w, 10) : 0;
    const hasPrec = p !== undefined;
    const precN = hasPrec ? (p === '' ? 0 : parseInt(p, 10)) : -1;
    const arg = args[ai++];

    let sign = '';
    let body: string;
    let canZero = false;
    const signFor = (neg: boolean) => (neg ? '-' : plus ? '+' : space ? ' ' : '');

    if (conv === 's' || conv === 'c') {
      let s = String(arg);
      if (conv === 's' && hasPrec) s = s.slice(0, precN);
      body = s;
    } else if (conv === 'd' || conv === 'i') {
      const v = BigInt(arg as number | bigint);
      sign = signFor(v < 0n);
      let d = (v < 0n ? -v : v).toString();
      if (hasPrec) {
        if (precN === 0 && v === 0n) d = '';
        d = d.padStart(precN, '0');
      }
      body = d;
      canZero = !hasPrec;
    } else if (conv === 'x' || conv === 'X' || conv === 'o') {
      const v = BigInt(arg as number | bigint);
      let d = v.toString(conv === 'o' ? 8 : 16);
      if (conv === 'X') d = d.toUpperCase();
      if (hasPrec) {
        if (precN === 0 && v === 0n) d = '';
        d = d.padStart(precN, '0');
      }
      if (alt) {
        if (conv === 'o') {
          if (!d.startsWith('0')) d = '0' + d;
        } else if (v !== 0n) sign = conv === 'x' ? '0x' : '0X';
      }
      body = d;
      canZero = !hasPrec;
    } else {
      const x = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      if (Number.isNaN(x)) {
        body = upper ? 'NAN' : 'nan';
      } else {
        const { neg, m, e } = decompose(x);
        sign = signFor(neg);
        if (!Number.isFinite(x)) {
          body = upper ? 'INF' : 'inf';
        } else {
          canZero = true;
          const lc = conv.toLowerCase();
          if (lc === 'f') {
            body = fixed(m, e, hasPrec ? precN : 6, alt);
          } else if (lc === 'e') {
            body = expStyle(m, e, hasPrec ? precN : 6, alt, upper);
          } else {
            let P = hasPrec ? precN : 6;
            if (P === 0) P = 1;
            const X = expDigits(m, e, P - 1).x;
            if (P > X && X >= -4) {
              body = fixed(m, e, P - 1 - X, alt);
              if (!alt) body = stripZeros(body);
            } else {
              body = expStyle(m, e, P - 1, alt, upper);
              if (!alt) {
                const idx = body.search(/[eE]/);
                body = stripZeros(body.slice(0, idx)) + body.slice(idx);
              }
            }
          }
        }
      }
      if (Number.isNaN(x)) sign = '';
    }

    const len = sign.length + body.length;
    if (len >= width) return sign + body;
    const pad = width - len;
    if (left) return sign + body + ' '.repeat(pad);
    if (zero && canZero) return sign + '0'.repeat(pad) + body;
    return ' '.repeat(pad) + sign + body;
  });
}
