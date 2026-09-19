function decompose(x: number): { m: bigint; e: number } {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const expField = (hi >>> 20) & 0x7ff;
  const frac = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (expField === 0) return { m: frac, e: -1074 };
  return { m: frac | (1n << 52n), e: expField - 1075 };
}

// round-half-even of |x| * 10^k, exact
function roundScaled(x: number, k: number): bigint {
  const { m, e } = decompose(x);
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

// e-style: digits string of p+1 digits and decimal exponent
function eParts(x: number, p: number): { digits: string; X: number } {
  if (x === 0) return { digits: '0'.repeat(p + 1), X: 0 };
  let X = Math.floor(Math.log10(x));
  if (!isFinite(X)) X = -324;
  const lo = 10n ** BigInt(p);
  const hi = lo * 10n;
  for (let i = 0; i < 20; i++) {
    const n = roundScaled(x, p - X);
    if (n >= hi) X++;
    else if (n < lo) X--;
    else return { digits: n.toString(), X };
  }
  throw new Error('exponent search failed');
}

function fixedStr(x: number, p: number, alt: boolean): string {
  let s = roundScaled(x, p).toString();
  if (p > 0) {
    s = s.padStart(p + 1, '0');
    return s.slice(0, s.length - p) + '.' + s.slice(s.length - p);
  }
  return alt ? s + '.' : s;
}

function expStr(digits: string, X: number, p: number, alt: boolean): string {
  let s = digits[0];
  if (p > 0) s += '.' + digits.slice(1);
  else if (alt) s += '.';
  const ax = Math.abs(X);
  return s + 'e' + (X < 0 ? '-' : '+') + (ax < 10 ? '0' + ax : String(ax));
}

function stripZeros(s: string): string {
  if (!s.includes('.')) return s;
  return s.replace(/0+$/, '').replace(/\.$/, '');
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let ai = 0;
  const re = /%(?:(%)|([-+ 0#]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc]))/g;
  return fmt.replace(re, (_m, pct, flags: string, w: string, pr: string | undefined, conv: string) => {
    if (pct) return '%';
    const minus = flags.includes('-');
    const plus = flags.includes('+');
    const space = flags.includes(' ');
    const zero = flags.includes('0');
    const alt = flags.includes('#');
    const width = w ? parseInt(w, 10) : 0;
    const hasPrec = pr !== undefined;
    const prec = hasPrec ? (pr === '' ? 0 : parseInt(pr, 10)) : -1;
    const arg = args[ai++];

    const pad = (sign: string, body: string, zeroOk: boolean): string => {
      const len = sign.length + body.length;
      if (len >= width) return sign + body;
      const n = width - len;
      if (minus) return sign + body + ' '.repeat(n);
      if (zero && zeroOk) return sign + '0'.repeat(n) + body;
      return ' '.repeat(n) + sign + body;
    };

    if (conv === 's' || conv === 'c') {
      let s = String(arg);
      if (conv === 's' && hasPrec) s = s.slice(0, prec);
      return pad('', s, false);
    }

    if ('diouxX'.includes(conv)) {
      const v = BigInt(arg as number | bigint);
      const neg = v < 0n;
      const abs = neg ? -v : v;
      let sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
      const base = conv === 'o' ? 8 : conv === 'd' || conv === 'i' ? 10 : 16;
      let digits = abs.toString(base);
      if (hasPrec && prec === 0 && abs === 0n) digits = '';
      if (hasPrec) digits = digits.padStart(prec, '0');
      if (conv === 'o' && alt && !digits.startsWith('0')) digits = '0' + digits;
      if (conv === 'x' || conv === 'X') {
        if (alt && abs !== 0n) sign += '0x';
        if (conv === 'X') {
          digits = digits.toUpperCase();
          sign = sign.replace('0x', '0X');
        }
      }
      return pad(sign, digits, !hasPrec);
    }

    const x = arg as number;
    const upper = conv === 'E' || conv === 'F' || conv === 'G';
    const neg = x < 0 || Object.is(x, -0);
    const sign = x !== x ? '' : neg ? '-' : plus ? '+' : space ? ' ' : '';
    if (x !== x || !isFinite(x)) {
      const t = x !== x ? 'nan' : 'inf';
      return pad(sign, upper ? t.toUpperCase() : t, false);
    }
    const ax = Math.abs(x);
    const lc = conv.toLowerCase();
    let body: string;
    if (lc === 'f') {
      body = fixedStr(ax, hasPrec ? prec : 6, alt);
    } else if (lc === 'e') {
      const p = hasPrec ? prec : 6;
      const { digits, X } = eParts(ax, p);
      body = expStr(digits, X, p, alt);
    } else {
      const P = hasPrec ? (prec === 0 ? 1 : prec) : 6;
      const { digits, X } = eParts(ax, P - 1);
      if (P > X && X >= -4) {
        body = fixedStr(ax, P - 1 - X, alt);
        if (!alt) body = stripZeros(body);
      } else {
        body = expStr(digits, X, P - 1, alt);
        if (!alt) {
          const i = body.indexOf('e');
          body = stripZeros(body.slice(0, i)) + body.slice(i);
        }
      }
    }
    if (upper) body = body.toUpperCase();
    return pad(sign, body, true);
  });
}
