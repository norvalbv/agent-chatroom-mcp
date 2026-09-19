function roundDiv(n: bigint, d: bigint): bigint {
  const q = n / d;
  const r2 = (n % d) * 2n;
  if (r2 > d || (r2 === d && (q & 1n) === 1n)) return q + 1n;
  return q;
}

function decompose(x: number): [bigint, number] {
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, Math.abs(x));
  const bits = buf.getBigUint64(0);
  const exp = Number((bits >> 52n) & 0x7ffn);
  const frac = bits & ((1n << 52n) - 1n);
  if (exp === 0) return [frac, -1074];
  return [frac | (1n << 52n), exp - 1075];
}

// round(|x| * 10^s) exactly, half-even
function scaled(x: number, s: number): bigint {
  const [m, e] = decompose(x);
  let num = m;
  let den = 1n;
  if (e >= 0) num <<= BigInt(e);
  else den <<= BigInt(-e);
  if (s >= 0) num *= 10n ** BigInt(s);
  else den *= 10n ** BigInt(-s);
  return roundDiv(num, den);
}

function fixed(x: number, p: number, alt: boolean): string {
  let d = scaled(x, p).toString();
  if (p > 0) {
    d = d.padStart(p + 1, '0');
    return d.slice(0, d.length - p) + '.' + d.slice(d.length - p);
  }
  return alt ? d + '.' : d;
}

// returns [digits (p+1 chars), exponent]
function sci(x: number, p: number): [string, number] {
  if (x === 0) return ['0'.repeat(p + 1), 0];
  let E = Math.floor(Math.log10(Math.abs(x)));
  if (!isFinite(E)) E = -324;
  const lo = 10n ** BigInt(p);
  for (let i = 0; i < 20; i++) {
    const n = scaled(x, p - E);
    if (n >= lo * 10n) E++;
    else if (n < lo) E--;
    else return [n.toString(), E];
  }
  throw new Error('sci failed');
}

function expStr(E: number, upper: boolean): string {
  const a = Math.abs(E).toString().padStart(2, '0');
  return (upper ? 'E' : 'e') + (E < 0 ? '-' : '+') + a;
}

function sciStr(x: number, p: number, alt: boolean, upper: boolean): string {
  const [d, E] = sci(x, p);
  return d[0] + (p > 0 ? '.' + d.slice(1) : alt ? '.' : '') + expStr(E, upper);
}

function stripZeros(s: string): string {
  const i = s.search(/[eE]|$/);
  let mant = s.slice(0, i);
  if (mant.includes('.')) mant = mant.replace(/0+$/, '').replace(/\.$/, '');
  return mant + s.slice(i);
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let ai = 0;
  const re = /%(?:(%)|([-+ 0#]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc]))/g;
  return fmt.replace(re, (_m, pct, flags: string, w: string, prec: string | undefined, conv: string) => {
    if (pct) return '%';
    const arg = args[ai++];
    const left = flags.includes('-');
    const plus = flags.includes('+');
    const space = flags.includes(' ');
    const zero = flags.includes('0') && !left;
    const alt = flags.includes('#');
    const width = w ? parseInt(w, 10) : 0;
    const hasPrec = prec !== undefined;
    const precN = hasPrec ? (prec === '' ? 0 : parseInt(prec, 10)) : -1;

    let sign = '';
    let prefix = '';
    let body: string;
    let canZero = zero;

    if (conv === 's' || conv === 'c') {
      body = String(arg);
      if (conv === 's' && hasPrec) body = body.slice(0, precN);
      canZero = false;
    } else if ('dixXo'.includes(conv)) {
      let v = BigInt(arg as number | bigint);
      if (conv === 'd' || conv === 'i') {
        if (v < 0n) {
          sign = '-';
          v = -v;
        } else sign = plus ? '+' : space ? ' ' : '';
      }
      const radix = conv === 'o' ? 8 : conv === 'd' || conv === 'i' ? 10 : 16;
      let digits = v.toString(radix);
      if (conv === 'X') digits = digits.toUpperCase();
      if (hasPrec) {
        if (precN === 0 && v === 0n) digits = '';
        digits = digits.padStart(precN, '0');
        canZero = false;
      }
      if (alt && conv === 'o' && !digits.startsWith('0')) digits = '0' + digits;
      if (alt && (conv === 'x' || conv === 'X') && v !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      body = digits;
    } else {
      const x = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      const neg = x < 0 || Object.is(x, -0);
      if (Number.isNaN(x)) sign = '';
      else sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
      if (!Number.isFinite(x)) {
        body = Number.isNaN(x) ? 'nan' : 'inf';
        if (upper) body = body.toUpperCase();
        canZero = false;
      } else {
        const p = hasPrec ? precN : 6;
        const lc = conv.toLowerCase();
        if (lc === 'f') body = fixed(x, p, alt);
        else if (lc === 'e') body = sciStr(x, p, alt, upper);
        else {
          const P = p === 0 ? 1 : p;
          const X = sci(x, P - 1)[1];
          if (P > X && X >= -4) body = fixed(x, P - 1 - X, alt);
          else body = sciStr(x, P - 1, alt, upper);
          if (!alt) body = stripZeros(body);
        }
      }
    }
    const len = sign.length + prefix.length + body.length;
    if (len >= width) return sign + prefix + body;
    const pad = width - len;
    if (left) return sign + prefix + body + ' '.repeat(pad);
    if (canZero) return sign + prefix + '0'.repeat(pad) + body;
    return ' '.repeat(pad) + sign + prefix + body;
  });
}
