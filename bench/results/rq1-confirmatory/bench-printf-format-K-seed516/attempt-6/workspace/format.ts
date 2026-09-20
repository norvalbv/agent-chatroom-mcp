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

// round-half-even(|x| * 10^k) as a BigInt
function scaled(m: bigint, e: number, k: number): bigint {
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

function fixedStr(x: number, p: number): string {
  const { m, e } = decompose(Math.abs(x));
  let s = scaled(m, e, p).toString();
  if (s.length < p + 1) s = '0'.repeat(p + 1 - s.length) + s;
  return s; // last p digits are fraction
}

function expParts(x: number, p: number): { digits: string; E: number } {
  const ax = Math.abs(x);
  if (ax === 0) return { digits: '0'.repeat(p + 1), E: 0 };
  const { m, e } = decompose(ax);
  let E = Math.floor(Math.log10(ax));
  if (!isFinite(E)) E = ax < 1 ? -324 : 308;
  const lo = 10n ** BigInt(p);
  const hi = lo * 10n;
  for (let i = 0; i < 20; i++) {
    const n = scaled(m, e, p - E);
    if (n >= hi) E++;
    else if (n < lo) E--;
    else return { digits: n.toString(), E };
  }
  throw new Error('exp failure');
}

function expStyle(x: number, p: number, alt: boolean, upper: boolean): string {
  const { digits, E } = expParts(x, p);
  const ae = Math.abs(E);
  return (
    digits[0] +
    (p > 0 || alt ? '.' : '') +
    digits.slice(1) +
    (upper ? 'E' : 'e') +
    (E < 0 ? '-' : '+') +
    (ae < 10 ? '0' : '') +
    ae
  );
}

function fixedStyle(x: number, p: number, alt: boolean): string {
  const s = fixedStr(x, p);
  const ip = s.slice(0, s.length - p);
  const fp = s.slice(s.length - p);
  return ip + (p > 0 || alt ? '.' : '') + fp;
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let ai = 0;
  const re = /%([-+ 0#]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc%])/g;
  return fmt.replace(re, (_all, flags: string, w: string, pr: string | undefined, conv: string) => {
    if (conv === '%') return '%';
    const left = flags.includes('-');
    const plus = flags.includes('+');
    const space = flags.includes(' ');
    const zero = flags.includes('0') && !left;
    const alt = flags.includes('#');
    const width = w ? parseInt(w, 10) : 0;
    const hasPrec = pr !== undefined;
    const prec = hasPrec ? (pr === '' ? 0 : parseInt(pr, 10)) : -1;
    const arg = args[ai++];

    let sign = '';
    let prefix = '';
    let body = '';
    let zeroOk = zero;

    const signFor = (neg: boolean) => (neg ? '-' : plus ? '+' : space ? ' ' : '');

    if (conv === 's' || conv === 'c') {
      body = String(arg);
      if (conv === 's' && hasPrec) body = body.slice(0, prec);
      zeroOk = false;
    } else if ('dioxX'.includes(conv)) {
      const v = BigInt(arg as number | bigint);
      const neg = v < 0n;
      const mag = neg ? -v : v;
      let digits = mag.toString(conv === 'o' ? 8 : conv === 'd' || conv === 'i' ? 10 : 16);
      if (conv === 'X') digits = digits.toUpperCase();
      if (hasPrec) {
        if (prec === 0 && mag === 0n) digits = '';
        else if (digits.length < prec) digits = '0'.repeat(prec - digits.length) + digits;
        zeroOk = false;
      }
      if (conv === 'd' || conv === 'i') sign = signFor(neg);
      else if (alt) {
        if (conv === 'o') {
          if (digits[0] !== '0') digits = '0' + digits;
        } else if (mag !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      }
      body = digits;
    } else {
      const x = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      if (Number.isNaN(x)) {
        body = upper ? 'NAN' : 'nan';
        zeroOk = false;
      } else {
        const neg = x < 0 || Object.is(x, -0);
        sign = signFor(neg);
        if (!isFinite(x)) {
          body = upper ? 'INF' : 'inf';
          zeroOk = false;
        } else {
          const p = hasPrec ? prec : 6;
          const lc = conv.toLowerCase();
          if (lc === 'e') body = expStyle(x, p, alt, upper);
          else if (lc === 'f') body = fixedStyle(x, p, alt);
          else {
            const P = p === 0 ? 1 : p;
            const X = expParts(x, P - 1).E;
            if (P > X && X >= -4) body = fixedStyle(x, P - 1 - X, alt);
            else body = expStyle(x, P - 1, alt, upper);
            if (!alt) {
              const ei = body.search(/[eE]/);
              let mant = ei < 0 ? body : body.slice(0, ei);
              const tail = ei < 0 ? '' : body.slice(ei);
              if (mant.includes('.')) mant = mant.replace(/0+$/, '').replace(/\.$/, '');
              body = mant + tail;
            }
          }
        }
      }
    }

    const len = sign.length + prefix.length + body.length;
    if (len >= width) return sign + prefix + body;
    const padN = width - len;
    if (left) return sign + prefix + body + ' '.repeat(padN);
    if (zeroOk) return sign + prefix + '0'.repeat(padN) + body;
    return ' '.repeat(padN) + sign + prefix + body;
  });
}
