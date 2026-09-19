function decompose(x: number): [bigint, number] {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let e: number;
  if (expBits === 0) {
    e = -1074;
  } else {
    m |= 1n << 52n;
    e = expBits - 1075;
  }
  return [m, e];
}

// round(m * 2^e * 10^s) to nearest integer, ties to even
function roundScaled(m: bigint, e: number, s: number): bigint {
  let num = m;
  let den = 1n;
  if (e >= 0) num <<= BigInt(e);
  else den <<= BigInt(-e);
  if (s >= 0) num *= 10n ** BigInt(s);
  else den *= 10n ** BigInt(-s);
  const q = num / den;
  const r2 = (num % den) * 2n;
  if (r2 > den || (r2 === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

function fixedDigits(x: number, prec: number): string {
  const [m, e] = decompose(x);
  let s = roundScaled(m, e, prec).toString();
  if (prec === 0) return s;
  if (s.length < prec + 1) s = '0'.repeat(prec + 1 - s.length) + s;
  return s.slice(0, s.length - prec) + '.' + s.slice(s.length - prec);
}

// returns [digit string of length p+1, decimal exponent]
function expDigits(x: number, p: number): [string, number] {
  if (x === 0) return ['0'.repeat(p + 1), 0];
  const [m, e] = decompose(x);
  let E = Math.floor(Math.log10(x));
  if (!isFinite(E)) E = -324;
  const lo = 10n ** BigInt(p);
  const hi = lo * 10n;
  for (;;) {
    const q = roundScaled(m, e, p - E);
    if (q >= hi) E++;
    else if (q < lo) E--;
    else return [q.toString(), E];
  }
}

function expStyle(x: number, prec: number, alt: boolean, upper: boolean): string {
  const [d, E] = expDigits(x, prec);
  let out = d[0];
  if (prec > 0) out += '.' + d.slice(1);
  else if (alt) out += '.';
  const ae = Math.abs(E);
  return out + (upper ? 'E' : 'e') + (E < 0 ? '-' : '+') + (ae < 10 ? '0' + ae : String(ae));
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let ai = 0;
  const re = /%([-+ 0#]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc%])/g;
  return fmt.replace(re, (_all, flags: string, w: string, p: string | undefined, conv: string) => {
    if (conv === '%') return '%';
    const arg = args[ai++];
    const left = flags.includes('-');
    const plus = flags.includes('+');
    const space = flags.includes(' ');
    let zero = flags.includes('0') && !left;
    const alt = flags.includes('#');
    const width = w ? parseInt(w, 10) : 0;
    const hasPrec = p !== undefined;
    const prec = hasPrec ? (p === '' ? 0 : parseInt(p, 10)) : -1;

    let sign = '';
    let prefix = '';
    let body: string;

    if (conv === 's' || conv === 'c') {
      let str = String(arg);
      if (conv === 's' && hasPrec) str = str.slice(0, prec);
      body = str;
      zero = false;
    } else if ('dioxX'.includes(conv)) {
      let v = BigInt(arg as number | bigint);
      if (conv === 'd' || conv === 'i') {
        if (v < 0n) {
          sign = '-';
          v = -v;
        } else sign = plus ? '+' : space ? ' ' : '';
      }
      let digits = conv === 'o' ? v.toString(8) : conv === 'x' ? v.toString(16) : conv === 'X' ? v.toString(16).toUpperCase() : v.toString();
      if (hasPrec) {
        if (prec === 0 && v === 0n) digits = '';
        if (digits.length < prec) digits = '0'.repeat(prec - digits.length) + digits;
        zero = false;
      }
      if (alt) {
        if (conv === 'o') {
          if (digits[0] !== '0') digits = '0' + digits;
        } else if ((conv === 'x' || conv === 'X') && v !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      }
      body = digits;
    } else {
      const x = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      const neg = x < 0 || Object.is(x, -0);
      if (!Number.isNaN(x)) sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
      if (!Number.isFinite(x)) {
        body = Number.isNaN(x) ? 'nan' : 'inf';
        if (upper) body = body.toUpperCase();
        zero = false;
      } else {
        const ax = Math.abs(x);
        const lc = conv.toLowerCase();
        if (lc === 'f') {
          body = fixedDigits(ax, hasPrec ? prec : 6);
          if (alt && !body.includes('.')) body += '.';
        } else if (lc === 'e') {
          body = expStyle(ax, hasPrec ? prec : 6, alt, upper);
        } else {
          const P = hasPrec ? (prec === 0 ? 1 : prec) : 6;
          const X = expDigits(ax, P - 1)[1];
          if (P > X && X >= -4) {
            body = fixedDigits(ax, P - 1 - X);
            if (alt && !body.includes('.')) body += '.';
            if (!alt && body.includes('.')) body = body.replace(/\.?0+$/, '');
          } else {
            body = expStyle(ax, P - 1, alt, upper);
            if (!alt) {
              const k = body.search(/[eE]/);
              let mant = body.slice(0, k);
              if (mant.includes('.')) mant = mant.replace(/\.?0+$/, '');
              body = mant + body.slice(k);
            }
          }
        }
      }
    }

    const len = sign.length + prefix.length + body.length;
    if (len >= width) return sign + prefix + body;
    const pad = width - len;
    if (left) return sign + prefix + body + ' '.repeat(pad);
    if (zero) return sign + prefix + '0'.repeat(pad) + body;
    return ' '.repeat(pad) + sign + prefix + body;
  });
}
