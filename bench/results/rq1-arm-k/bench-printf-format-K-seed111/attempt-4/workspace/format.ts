function roundDiv(n: bigint, d: bigint): bigint {
  const q = n / d;
  const r2 = (n - q * d) * 2n;
  if (r2 > d || (r2 === d && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// exact positive finite double as num/den
function toFraction(v: number): [bigint, bigint] {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, v);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let k: number;
  if (expBits === 0) k = -1074;
  else {
    m |= 1n << 52n;
    k = expBits - 1075;
  }
  return k >= 0 ? [m << BigInt(k), 1n] : [m, 1n << BigInt(-k)];
}

function scaledRound(f: [bigint, bigint], s: number): bigint {
  let [n, d] = f;
  if (s >= 0) n *= 10n ** BigInt(s);
  else d *= 10n ** BigInt(-s);
  return roundDiv(n, d);
}

// digits of |v| with p decimals
function fixedStr(v: number, p: number): string {
  let q = v === 0 ? 0n : scaledRound(toFraction(v), p);
  let s = q.toString();
  if (p > 0) {
    s = s.padStart(p + 1, '0');
    return s.slice(0, s.length - p) + '.' + s.slice(s.length - p);
  }
  return s;
}

// returns [digit string of p+1 digits, exponent]
function sciParts(v: number, p: number): [string, number] {
  if (v === 0) return ['0'.repeat(p + 1), 0];
  const f = toFraction(v);
  let e = Math.floor(Math.log10(v));
  if (!isFinite(e)) e = 0;
  const [n, d] = f;
  const ge = (x: number) => (x >= 0 ? n >= d * 10n ** BigInt(x) : n * 10n ** BigInt(-x) >= d);
  while (!ge(e)) e--;
  while (ge(e + 1)) e++;
  let q = scaledRound(f, p - e);
  if (q >= 10n ** BigInt(p + 1)) {
    e++;
    q = scaledRound(f, p - e);
  }
  return [q.toString(), e];
}

function expStr(e: number, upper: boolean): string {
  const a = Math.abs(e).toString().padStart(2, '0');
  return (upper ? 'E' : 'e') + (e < 0 ? '-' : '+') + a;
}

function sciStr(v: number, p: number, alt: boolean, upper: boolean): string {
  const [ds, e] = sciParts(v, p);
  return ds[0] + (p > 0 ? '.' + ds.slice(1) : alt ? '.' : '') + expStr(e, upper);
}

function stripZeros(s: string): string {
  if (!s.includes('.')) return s;
  return s.replace(/0+$/, '').replace(/\.$/, '');
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let ai = 0;
  const re = /%([-+ 0#]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc%])/g;
  return fmt.replace(re, (_m, flags: string, w: string, pr: string | undefined, conv: string) => {
    if (conv === '%') return '%';
    const arg = args[ai++];
    const left = flags.includes('-');
    const plus = flags.includes('+');
    const space = flags.includes(' ');
    const zero = flags.includes('0');
    const alt = flags.includes('#');
    const width = w ? parseInt(w, 10) : 0;
    const hasPrec = pr !== undefined;
    const prec = hasPrec ? (pr === '' ? 0 : parseInt(pr, 10)) : -1;

    let sign = '';
    let prefix = '';
    let body: string;
    let canZero = zero && !left;

    if (conv === 's' || conv === 'c') {
      body = String(arg);
      if (conv === 's' && hasPrec) body = body.slice(0, prec);
      canZero = false;
    } else if ('dioxX'.includes(conv)) {
      let big = BigInt(arg as number | bigint);
      if (conv === 'd' || conv === 'i') {
        if (big < 0n) {
          sign = '-';
          big = -big;
        } else sign = plus ? '+' : space ? ' ' : '';
      }
      const radix = conv === 'o' ? 8 : conv === 'd' || conv === 'i' ? 10 : 16;
      let digits = big.toString(radix);
      if (conv === 'X') digits = digits.toUpperCase();
      if (hasPrec) {
        if (prec === 0 && big === 0n) digits = '';
        digits = digits.padStart(prec, '0');
        canZero = false;
      }
      if (alt) {
        if (conv === 'o') {
          if (!digits.startsWith('0')) digits = '0' + digits;
        } else if ((conv === 'x' || conv === 'X') && big !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      }
      body = digits;
    } else {
      const v = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      const neg = v < 0 || Object.is(v, -0);
      if (Number.isNaN(v)) sign = '';
      else sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
      if (!isFinite(v)) {
        body = Number.isNaN(v) ? 'nan' : 'inf';
        if (upper) body = body.toUpperCase();
        canZero = false;
      } else {
        const a = Math.abs(v);
        const lc = conv.toLowerCase();
        const p = hasPrec ? prec : 6;
        if (lc === 'f') {
          body = fixedStr(a, p);
          if (p === 0 && alt) body += '.';
        } else if (lc === 'e') {
          body = sciStr(a, p, alt, upper);
        } else {
          const P = p === 0 ? 1 : p;
          const X = sciParts(a, P - 1)[1];
          if (P > X && X >= -4) {
            body = fixedStr(a, P - 1 - X);
            if (alt) {
              if (!body.includes('.')) body += '.';
            } else body = stripZeros(body);
          } else {
            const [ds, e] = sciParts(a, P - 1);
            let mant = ds[0] + (P > 1 ? '.' + ds.slice(1) : '');
            if (alt) {
              if (!mant.includes('.')) mant += '.';
            } else mant = stripZeros(mant);
            body = mant + expStr(e, upper);
          }
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
