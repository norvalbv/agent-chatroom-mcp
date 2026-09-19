function decompose(x: number): [bigint, number] {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const expField = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (expField === 0) return [m, -1074];
  m |= 1n << 52n;
  return [m, expField - 1075];
}

// round_half_even(m * 2^e2 * 10^k)
function roundScaled(m: bigint, e2: number, k: number): bigint {
  let num = m;
  let den = 1n;
  if (k >= 0) num *= 10n ** BigInt(k);
  else den *= 10n ** BigInt(-k);
  if (e2 >= 0) num <<= BigInt(e2);
  else den <<= BigInt(-e2);
  const q = num / den;
  const r2 = (num % den) * 2n;
  if (r2 > den || (r2 === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

function stripZeros(frac: string): string {
  return frac.replace(/0+$/, '');
}

// returns digits (p+1 of them) and exponent
function eDigits(x: number, p: number): [string, number] {
  if (x === 0) return ['0'.repeat(p + 1), 0];
  const [m, e2] = decompose(x);
  let E = Math.floor(Math.log10(x));
  const lowB = 10n ** BigInt(p);
  const highB = lowB * 10n;
  for (let i = 0; i < 10; i++) {
    const s = roundScaled(m, e2, p - E);
    if (s >= highB) E++;
    else if (s < lowB) E--;
    else return [s.toString(), E];
  }
  throw new Error('exponent search failed');
}

function fmtE(x: number, p: number, alt: boolean, strip: boolean, upper: boolean): string {
  const [d, E] = eDigits(x, p);
  let frac = d.slice(1);
  if (strip) frac = stripZeros(frac);
  const mant = d[0] + (frac.length > 0 || alt ? '.' : '') + frac;
  const ae = Math.abs(E);
  const es = (E < 0 ? '-' : '+') + (ae < 10 ? '0' : '') + ae;
  return mant + (upper ? 'E' : 'e') + es;
}

function fmtF(x: number, p: number, alt: boolean, strip: boolean): string {
  let digits: string;
  if (x === 0) digits = '0';
  else {
    const [m, e2] = decompose(x);
    digits = roundScaled(m, e2, p).toString();
  }
  if (digits.length < p + 1) digits = '0'.repeat(p + 1 - digits.length) + digits;
  const ip = digits.slice(0, digits.length - p);
  let frac = digits.slice(digits.length - p);
  if (strip) frac = stripZeros(frac);
  return ip + (frac.length > 0 || alt ? '.' : '') + frac;
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
      const v = BigInt(arg as number | bigint);
      const neg = v < 0n;
      const mag = neg ? -v : v;
      if (conv === 'd' || conv === 'i') {
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
      }
      let digits = conv === 'o' ? mag.toString(8) : conv === 'x' ? mag.toString(16) : conv === 'X' ? mag.toString(16).toUpperCase() : mag.toString(10);
      if (hasPrec) {
        if (prec === 0 && mag === 0n) digits = '';
        else if (digits.length < prec) digits = '0'.repeat(prec - digits.length) + digits;
        canZero = false;
      }
      if (alt) {
        if (conv === 'o') {
          if (!digits.startsWith('0')) digits = '0' + digits;
        } else if (conv === 'x' && mag !== 0n) prefix = '0x';
        else if (conv === 'X' && mag !== 0n) prefix = '0X';
      }
      body = digits;
    } else {
      const x = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      if (Number.isNaN(x)) {
        body = upper ? 'NAN' : 'nan';
        canZero = false;
      } else {
        const neg = x < 0 || Object.is(x, -0);
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        const ax = Math.abs(x);
        if (ax === Infinity) {
          body = upper ? 'INF' : 'inf';
          canZero = false;
        } else {
          const lc = conv.toLowerCase();
          if (lc === 'e') body = fmtE(ax, hasPrec ? prec : 6, alt, false, upper);
          else if (lc === 'f') body = fmtF(ax, hasPrec ? prec : 6, alt, false);
          else {
            let P = hasPrec ? prec : 6;
            if (P === 0) P = 1;
            const X = eDigits(ax, P - 1)[1];
            if (P > X && X >= -4) body = fmtF(ax, P - 1 - X, alt, !alt);
            else body = fmtE(ax, P - 1, alt, !alt, upper);
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
