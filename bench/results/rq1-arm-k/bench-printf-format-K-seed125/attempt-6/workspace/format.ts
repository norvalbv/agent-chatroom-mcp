function decompose(x: number): { m: bigint; e: number } {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (expBits === 0) return { m, e: -1074 };
  m |= 1n << 52n;
  return { m, e: expBits - 1075 };
}

// round_half_even(|x| * 10^k) as a BigInt
function scaled(x: number, k: number): bigint {
  const { m, e } = decompose(x);
  let num = m;
  let den = 1n;
  if (e >= 0) num <<= BigInt(e);
  else den <<= BigInt(-e);
  if (k >= 0) num *= 10n ** BigInt(k);
  else den *= 10n ** BigInt(-k);
  const q = num / den;
  const r = num % den;
  const twice = 2n * r;
  if (twice > den || (twice === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// digits (p+1 of them) and decimal exponent of |x| in e style
function eParts(x: number, p: number): { digits: string; exp: number } {
  if (x === 0) return { digits: '0'.repeat(p + 1), exp: 0 };
  let exp = Math.floor(Math.log10(x));
  const lo = 10n ** BigInt(p);
  const hi = lo * 10n;
  for (;;) {
    const q = scaled(x, p - exp);
    if (q >= hi) exp++;
    else if (q < lo) exp--;
    else return { digits: q.toString(), exp };
  }
}

function fixed(x: number, p: number, alt: boolean): string {
  let s = scaled(x, p).toString();
  if (p === 0) return alt ? s + '.' : s;
  s = s.padStart(p + 1, '0');
  return s.slice(0, -p) + '.' + s.slice(-p);
}

function expStyle(x: number, p: number, alt: boolean, upper: boolean): string {
  const { digits, exp } = eParts(x, p);
  let s = digits[0] + (p > 0 || alt ? '.' : '') + digits.slice(1);
  const a = Math.abs(exp);
  s += (upper ? 'E' : 'e') + (exp < 0 ? '-' : '+') + (a < 10 ? '0' : '') + a;
  return s;
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
    const arg = args[ai++];
    const left = flags.includes('-');
    const plus = flags.includes('+');
    const space = flags.includes(' ');
    const zero = flags.includes('0');
    const alt = flags.includes('#');
    const width = w ? parseInt(w, 10) : 0;
    const hasPrec = pr !== undefined;
    const prec = hasPrec ? (pr === '' ? 0 : parseInt(pr, 10)) : -1;

    const pad = (prefix: string, body: string, zeroOk: boolean): string => {
      const len = prefix.length + body.length;
      if (len >= width) return prefix + body;
      const n = width - len;
      if (left) return prefix + body + ' '.repeat(n);
      if (zero && zeroOk) return prefix + '0'.repeat(n) + body;
      return ' '.repeat(n) + prefix + body;
    };

    if (conv === 's' || conv === 'c') {
      let s = String(arg);
      if (conv === 's' && hasPrec) s = s.slice(0, prec);
      return pad('', s, false);
    }

    if ('diouxX'.includes(conv)) {
      const v = BigInt(arg as number | bigint);
      const neg = v < 0n;
      const mag = neg ? -v : v;
      let digits = conv === 'd' || conv === 'i' ? mag.toString()
        : conv === 'o' ? mag.toString(8)
        : conv === 'x' ? mag.toString(16) : mag.toString(16).toUpperCase();
      if (hasPrec) {
        if (prec === 0 && mag === 0n) digits = '';
        digits = digits.padStart(prec, '0');
      }
      let prefix = '';
      if (conv === 'd' || conv === 'i') prefix = neg ? '-' : plus ? '+' : space ? ' ' : '';
      else if (alt) {
        if (conv === 'o') {
          if (!digits.startsWith('0')) digits = '0' + digits;
        } else if (mag !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      }
      return pad(prefix, digits, !hasPrec);
    }

    const x = arg as number;
    const upper = conv === 'E' || conv === 'F' || conv === 'G';
    const neg = x < 0 || Object.is(x, -0);
    let sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
    if (Number.isNaN(x)) return pad('', upper ? 'NAN' : 'nan', false);
    if (!Number.isFinite(x)) return pad(sign, upper ? 'INF' : 'inf', false);
    const ax = Math.abs(x);
    const lc = conv.toLowerCase();
    let body: string;
    if (lc === 'f') body = fixed(ax, hasPrec ? prec : 6, alt);
    else if (lc === 'e') body = expStyle(ax, hasPrec ? prec : 6, alt, upper);
    else {
      const P = hasPrec ? (prec === 0 ? 1 : prec) : 6;
      const X = eParts(ax, P - 1).exp;
      if (P > X && X >= -4) {
        body = fixed(ax, P - 1 - X, alt);
        if (!alt) body = stripZeros(body);
      } else {
        body = expStyle(ax, P - 1, alt, upper);
        if (!alt) {
          const i = body.search(/[eE]/);
          body = stripZeros(body.slice(0, i)) + body.slice(i);
        }
      }
    }
    return pad(sign, body, true);
  });
}
