// Decompose a finite non-negative double into m * 2^e exactly.
function decompose(v: number): [bigint, number] {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, v);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const expField = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (expField === 0) return [m, -1074];
  m |= 1n << 52n;
  return [m, expField - 1075];
}

// round-half-even(m * 2^e * 10^k) as a bigint
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

function fixed(v: number, prec: number, alt: boolean): string {
  const [m, e] = decompose(v);
  let s = roundScaled(m, e, prec).toString();
  if (s.length < prec + 1) s = '0'.repeat(prec + 1 - s.length) + s;
  const ip = s.slice(0, s.length - prec);
  const fp = s.slice(s.length - prec);
  return ip + (prec > 0 || alt ? '.' : '') + fp;
}

// digits (prec+1 significant) and decimal exponent
function expParts(v: number, prec: number): [string, number] {
  if (v === 0) return ['0'.repeat(prec + 1), 0];
  const [m, e] = decompose(v);
  let x = Math.floor(Math.log10(v));
  if (!isFinite(x)) x = -324;
  const lim = 10n ** BigInt(prec + 1);
  const low = 10n ** BigInt(prec);
  for (let i = 0; i < 20; i++) {
    const n = roundScaled(m, e, prec - x);
    if (n >= lim) x++;
    else if (n < low) x--;
    else return [n.toString(), x];
  }
  throw new Error('exp failed');
}

function expStr(v: number, prec: number, alt: boolean, upper: boolean): string {
  const [d, x] = expParts(v, prec);
  const ax = Math.abs(x);
  return (
    d[0] + (prec > 0 || alt ? '.' : '') + d.slice(1) +
    (upper ? 'E' : 'e') + (x < 0 ? '-' : '+') + (ax < 10 ? '0' + ax : String(ax))
  );
}

function stripZeros(s: string): string {
  // s has form int[.frac][e...]
  const ei = s.search(/[eE]/);
  let mant = ei < 0 ? s : s.slice(0, ei);
  const tail = ei < 0 ? '' : s.slice(ei);
  if (mant.includes('.')) mant = mant.replace(/0+$/, '').replace(/\.$/, '');
  return mant + tail;
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let ai = 0;
  return fmt.replace(/%(?:%|([-+ 0#]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc]))/g,
    (whole: string, flags?: string, w?: string, p?: string, conv?: string) => {
      if (whole === '%%') return '%';
      const arg = args[ai++];
      const fl = flags || '';
      const left = fl.includes('-');
      const plus = fl.includes('+');
      const space = fl.includes(' ');
      const zero = fl.includes('0') && !left;
      const alt = fl.includes('#');
      const width = w ? parseInt(w, 10) : 0;
      const hasPrec = p !== undefined;
      const prec = hasPrec ? (p === '' ? 0 : parseInt(p, 10)) : -1;
      const c = conv as string;

      let sign = '';
      let prefix = '';
      let body = '';
      let canZero = zero;

      if (c === 's' || c === 'c') {
        body = String(arg);
        if (c === 's' && hasPrec) body = body.slice(0, prec);
        canZero = false;
      } else if ('diouxX'.includes(c)) {
        let n = BigInt(arg as number | bigint);
        if (c === 'd' || c === 'i') {
          if (n < 0n) { sign = '-'; n = -n; }
          else sign = plus ? '+' : space ? ' ' : '';
        }
        let digits = n === 0n && hasPrec && prec === 0 ? '' :
          n.toString(c === 'o' ? 8 : c === 'd' || c === 'i' ? 10 : 16);
        if (c === 'X') digits = digits.toUpperCase();
        if (hasPrec && digits.length < prec) digits = '0'.repeat(prec - digits.length) + digits;
        if (alt) {
          if (c === 'o') { if (digits[0] !== '0') digits = '0' + digits; }
          else if ((c === 'x' || c === 'X') && n !== 0n) prefix = c === 'x' ? '0x' : '0X';
        }
        body = digits;
        if (hasPrec) canZero = false;
      } else {
        const v = arg as number;
        const upper = c === 'E' || c === 'F' || c === 'G';
        const neg = v < 0 || Object.is(v, -0);
        if (Number.isNaN(v)) sign = '';
        else sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        if (!Number.isFinite(v)) {
          body = Number.isNaN(v) ? 'nan' : 'inf';
          if (upper) body = body.toUpperCase();
          canZero = false;
        } else {
          const a = Math.abs(v);
          const lc = c.toLowerCase();
          if (lc === 'f') body = fixed(a, hasPrec ? prec : 6, alt);
          else if (lc === 'e') body = expStr(a, hasPrec ? prec : 6, alt, upper);
          else {
            let P = hasPrec ? prec : 6;
            if (P === 0) P = 1;
            const X = expParts(a, P - 1)[1];
            if (P > X && X >= -4) body = fixed(a, P - 1 - X, alt);
            else body = expStr(a, P - 1, alt, upper);
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
