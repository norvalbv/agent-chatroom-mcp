function decompose(x: number): { neg: boolean; m: bigint; e2: number } {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const neg = (hi >>> 31) === 1;
  const be = (hi >>> 20) & 0x7ff;
  let frac = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (be === 0) return { neg, m: frac, e2: -1074 };
  frac |= 1n << 52n;
  return { neg, m: frac, e2: be - 1075 };
}

// round(m * 2^e2 * 10^k), ties to even
function roundScaled(m: bigint, e2: number, k: number): bigint {
  let num = m;
  let den = 1n;
  if (k >= 0) num *= 10n ** BigInt(k);
  else den *= 10n ** BigInt(-k);
  if (e2 >= 0) num <<= BigInt(e2);
  else den <<= BigInt(-e2);
  const q = num / den;
  const r = num % den;
  const twice = r * 2n;
  if (twice > den || (twice === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

function expStyle(m: bigint, e2: number, p: number): { digits: string; exp: number } {
  if (m === 0n) return { digits: '0'.repeat(p + 1), exp: 0 };
  const v = Number(m) * Math.pow(2, e2);
  let e10 = isFinite(v) && v > 0 ? Math.floor(Math.log10(v)) : Math.floor((Math.log10(Number(m)) + e2 * Math.log10(2)));
  const lower = 10n ** BigInt(p);
  const upper = lower * 10n;
  for (let i = 0; i < 20; i++) {
    const D = roundScaled(m, e2, p - e10);
    if (D >= upper) e10++;
    else if (D < lower) e10--;
    else return { digits: D.toString(), exp: e10 };
  }
  throw new Error('exp estimate failed');
}

function fixedStyle(m: bigint, e2: number, p: number, alt: boolean): string {
  let s = roundScaled(m, e2, p).toString();
  if (p === 0) return alt ? s + '.' : s;
  s = s.padStart(p + 1, '0');
  return s.slice(0, s.length - p) + '.' + s.slice(s.length - p);
}

function fmtExp(digits: string, exp: number, alt: boolean, upper: boolean, strip: boolean): string {
  let frac = digits.slice(1);
  if (strip) frac = frac.replace(/0+$/, '');
  const mant = digits[0] + (frac.length > 0 || alt ? '.' : '') + frac;
  const ae = Math.abs(exp);
  return mant + (upper ? 'E' : 'e') + (exp < 0 ? '-' : '+') + (ae < 10 ? '0' + ae : String(ae));
}

function stripFixed(s: string): string {
  if (!s.includes('.')) return s;
  return s.replace(/0+$/, '').replace(/\.$/, '');
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let ai = 0;
  const re = /%(?:(%)|([-+ 0#]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc]))/g;
  return fmt.replace(re, (_all, pct, flags, widthS, precS, conv) => {
    if (pct) return '%';
    const arg = args[ai++];
    const left = flags.includes('-');
    const plus = flags.includes('+');
    const space = flags.includes(' ');
    const zero = flags.includes('0') && !left;
    const alt = flags.includes('#');
    const width = widthS ? parseInt(widthS, 10) : 0;
    const hasPrec = precS !== undefined;
    const prec = hasPrec ? (precS === '' ? 0 : parseInt(precS, 10)) : undefined;

    let sign = '';
    let prefix = '';
    let body: string;
    let zeroOk = zero;

    if (conv === 's' || conv === 'c') {
      let t = String(arg);
      if (conv === 's' && prec !== undefined) t = t.slice(0, prec);
      body = t;
      zeroOk = false;
    } else if (conv === 'd' || conv === 'i' || conv === 'x' || conv === 'X' || conv === 'o') {
      const n = BigInt(arg as number | bigint);
      const neg = n < 0n;
      const mag = neg ? -n : n;
      if (conv === 'd' || conv === 'i') {
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
      }
      let digits = conv === 'x' ? mag.toString(16) : conv === 'X' ? mag.toString(16).toUpperCase() : conv === 'o' ? mag.toString(8) : mag.toString();
      if (prec !== undefined) {
        if (prec === 0 && mag === 0n) digits = '';
        digits = digits.padStart(prec, '0');
        zeroOk = false;
      }
      if (alt) {
        if (conv === 'x' && mag !== 0n) prefix = '0x';
        else if (conv === 'X' && mag !== 0n) prefix = '0X';
        else if (conv === 'o' && !digits.startsWith('0')) digits = '0' + digits;
      }
      body = digits;
    } else {
      const x = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      if (Number.isNaN(x)) {
        body = upper ? 'NAN' : 'nan';
        zeroOk = false;
      } else {
        const { neg, m, e2 } = decompose(x);
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        if (!Number.isFinite(x)) {
          body = upper ? 'INF' : 'inf';
          zeroOk = false;
        } else {
          const lc = conv.toLowerCase();
          if (lc === 'f') {
            body = fixedStyle(m, e2, prec ?? 6, alt);
          } else if (lc === 'e') {
            const p = prec ?? 6;
            const r = expStyle(m, e2, p);
            body = fmtExp(r.digits, r.exp, alt, upper, false);
          } else {
            const P = prec === undefined ? 6 : prec === 0 ? 1 : prec;
            const r = expStyle(m, e2, P - 1);
            const X = r.exp;
            if (P > X && X >= -4) {
              body = fixedStyle(m, e2, P - 1 - X, alt);
              if (!alt) body = stripFixed(body);
            } else {
              body = fmtExp(r.digits, r.exp, alt, upper, !alt);
            }
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
