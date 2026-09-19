function decompose(x: number): { m: bigint; e: number } {
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, x);
  const hi = buf.getUint32(0);
  const lo = buf.getUint32(4);
  const be = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (be === 0) return { m, e: -1074 };
  m |= 1n << 52n;
  return { m, e: be - 1075 };
}

// round(|x| * 10^k) to integer, half-even, exact
function scaled(x: number, k: number): bigint {
  const { m, e } = decompose(x);
  let num = m;
  let den = 1n;
  if (e >= 0) num <<= BigInt(e);
  else den <<= BigInt(-e);
  if (k >= 0) num *= 10n ** BigInt(k);
  else den *= 10n ** BigInt(-k);
  let q = num / den;
  const r2 = (num % den) * 2n;
  if (r2 > den || (r2 === den && (q & 1n) === 1n)) q += 1n;
  return q;
}

function fixedStr(x: number, p: number, alt: boolean): string {
  let s = scaled(x, p).toString();
  if (p > 0) {
    s = s.padStart(p + 1, '0');
    return s.slice(0, s.length - p) + '.' + s.slice(s.length - p);
  }
  return alt ? s + '.' : s;
}

function expParts(x: number, p: number): { digits: string; X: number } {
  if (x === 0) return { digits: '0'.repeat(p + 1), X: 0 };
  let X = Math.floor(Math.log10(x));
  if (!Number.isFinite(X)) X = -324;
  for (let i = 0; i < 10; i++) {
    const s = scaled(x, p - X).toString();
    if (s.length > p + 1) X++;
    else if (s.length < p + 1) X--;
    else return { digits: s, X };
  }
  throw new Error('exp');
}

function expStr(x: number, p: number, alt: boolean, upper: boolean): string {
  const { digits, X } = expParts(x, p);
  let s = digits[0];
  if (p > 0) s += '.' + digits.slice(1);
  else if (alt) s += '.';
  const ax = Math.abs(X);
  s += (upper ? 'E' : 'e') + (X < 0 ? '-' : '+') + (ax < 10 ? '0' : '') + ax;
  return s;
}

function stripZeros(s: string): string {
  if (!s.includes('.')) return s;
  return s.replace(/0+$/, '').replace(/\.$/, '');
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let ai = 0;
  const re = /%(?:(%)|([-+ 0#]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc]))/g;
  return fmt.replace(re, (_m, pct, flags: string, w: string, prec: string | undefined, conv: string) => {
    if (pct) return '%';
    const left = flags.includes('-');
    const plus = flags.includes('+');
    const space = flags.includes(' ');
    const zero = flags.includes('0') && !left;
    const alt = flags.includes('#');
    const width = w ? parseInt(w, 10) : 0;
    const hasPrec = prec !== undefined;
    const precN = hasPrec ? (prec === '' ? 0 : parseInt(prec, 10)) : 0;
    const arg = args[ai++];

    let sign = '';
    let body: string;
    let canZero = zero;

    if (conv === 's' || conv === 'c') {
      body = String(arg);
      if (conv === 's' && hasPrec) body = body.slice(0, precN);
      canZero = false;
    } else if ('dioxX'.includes(conv)) {
      let v = BigInt(arg as number | bigint);
      if (conv === 'd' || conv === 'i') {
        if (v < 0n) {
          sign = '-';
          v = -v;
        } else sign = plus ? '+' : space ? ' ' : '';
      }
      const base = conv === 'o' ? 8 : conv === 'd' || conv === 'i' ? 10 : 16;
      let digits = v.toString(base);
      if (conv === 'X') digits = digits.toUpperCase();
      if (hasPrec) {
        if (precN === 0 && v === 0n) digits = '';
        digits = digits.padStart(precN, '0');
        canZero = false;
      }
      if (alt) {
        if (conv === 'o') {
          if (!digits.startsWith('0')) digits = '0' + digits;
        } else if ((conv === 'x' || conv === 'X') && v !== 0n) {
          sign = conv === 'x' ? '0x' : '0X';
        }
      }
      body = digits;
    } else {
      const x = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      const neg = Object.is(x, -0) || x < 0;
      if (Number.isNaN(x)) sign = '';
      else sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
      const ax = Math.abs(x);
      if (Number.isNaN(x) || ax === Infinity) {
        body = Number.isNaN(x) ? 'nan' : 'inf';
        if (upper) body = body.toUpperCase();
        canZero = false;
      } else {
        const lc = conv.toLowerCase();
        const p = hasPrec ? precN : 6;
        if (lc === 'f') body = fixedStr(ax, p, alt);
        else if (lc === 'e') body = expStr(ax, p, alt, upper);
        else {
          const P = p === 0 ? 1 : p;
          const { X } = expParts(ax, P - 1);
          if (P > X && X >= -4) {
            body = fixedStr(ax, P - 1 - X, alt);
            if (!alt) body = stripZeros(body);
          } else {
            body = expStr(ax, P - 1, alt, upper);
            if (!alt) {
              const idx = body.search(/[eE]/);
              body = stripZeros(body.slice(0, idx)) + body.slice(idx);
            }
          }
        }
      }
    }

    const len = sign.length + body.length;
    if (len >= width) return sign + body;
    const pad = width - len;
    if (left) return sign + body + ' '.repeat(pad);
    if (canZero) return sign + '0'.repeat(pad) + body;
    return ' '.repeat(pad) + sign + body;
  });
}
