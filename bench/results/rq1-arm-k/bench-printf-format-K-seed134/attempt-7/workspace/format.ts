function decompose(v: number): [bigint, number] {
  // v finite, >= 0; returns [m, e2] with v = m * 2^e2
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, v);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (expBits === 0) return [m, -1074];
  m |= 1n << 52n;
  return [m, expBits - 1075];
}

// round(v * 10^s), half to even, exact
function roundScaled(m: bigint, e2: number, s: number): bigint {
  let num = m;
  let den = 1n;
  if (e2 >= 0) num <<= BigInt(e2);
  else den <<= BigInt(-e2);
  if (s >= 0) num *= 10n ** BigInt(s);
  else den *= 10n ** BigInt(-s);
  const q = num / den;
  const r = num % den;
  const twice = r * 2n;
  if (twice > den || (twice === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

function fixed(v: number, p: number, alt: boolean): string {
  const [m, e2] = decompose(v);
  let s = roundScaled(m, e2, p).toString();
  if (s.length < p + 1) s = '0'.repeat(p + 1 - s.length) + s;
  const ip = s.slice(0, s.length - p);
  const fp = s.slice(s.length - p);
  return p > 0 ? ip + '.' + fp : alt ? ip + '.' : ip;
}

// returns [digits (P chars), exponent]
function sci(v: number, P: number): [string, number] {
  if (v === 0) return ['0'.repeat(P), 0];
  const [m, e2] = decompose(v);
  let k = Math.floor(Math.log10(v));
  const lo = 10n ** BigInt(P - 1);
  const hi = 10n ** BigInt(P);
  for (;;) {
    const n = roundScaled(m, e2, P - 1 - k);
    if (n >= hi) k++;
    else if (n < lo) k--;
    else return [n.toString(), k];
  }
}

function expStr(x: number, upper: boolean): string {
  const a = Math.abs(x).toString().padStart(2, '0');
  return (upper ? 'E' : 'e') + (x < 0 ? '-' : '+') + a;
}

function sciStr(v: number, p: number, alt: boolean, upper: boolean, strip: boolean): string {
  const [d, x] = sci(v, p + 1);
  let frac = d.slice(1);
  if (strip && !alt) frac = frac.replace(/0+$/, '');
  const mant = frac.length > 0 ? d[0] + '.' + frac : alt ? d[0] + '.' : d[0];
  return mant + expStr(x, upper);
}

function stripFixed(s: string): string {
  if (!s.includes('.')) return s;
  return s.replace(/0+$/, '').replace(/\.$/, '');
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let ai = 0;
  const re = /%([-+ 0#]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc%])/g;
  return fmt.replace(re, (_all, flags: string, w: string, pr: string | undefined, conv: string) => {
    if (conv === '%') return '%';
    const arg = args[ai++];
    const left = flags.includes('-');
    const plus = flags.includes('+');
    const space = flags.includes(' ');
    const zero = flags.includes('0') && !left;
    const alt = flags.includes('#');
    const width = w === '' ? 0 : parseInt(w, 10);
    const hasPrec = pr !== undefined;
    const prec = hasPrec ? (pr === '' ? 0 : parseInt(pr as string, 10)) : -1;

    let sign = '';
    let prefix = '';
    let body: string;
    let canZero = true;

    if (conv === 's' || conv === 'c') {
      body = String(arg);
      if (conv === 's' && hasPrec) body = body.slice(0, prec);
      canZero = false;
    } else if ('diouxX'.includes(conv)) {
      let n = typeof arg === 'bigint' ? arg : BigInt(arg as number);
      if (conv === 'd' || conv === 'i') {
        if (n < 0n) {
          sign = '-';
          n = -n;
        } else sign = plus ? '+' : space ? ' ' : '';
      }
      const radix = conv === 'o' ? 8 : conv === 'd' || conv === 'i' ? 10 : 16;
      let digits = n.toString(radix);
      if (conv === 'X') digits = digits.toUpperCase();
      if (hasPrec) {
        if (prec === 0 && n === 0n) digits = '';
        else if (digits.length < prec) digits = '0'.repeat(prec - digits.length) + digits;
      }
      if (alt) {
        if (conv === 'o') {
          if (!digits.startsWith('0')) digits = '0' + digits;
        } else if ((conv === 'x' || conv === 'X') && n !== 0n) {
          prefix = conv === 'x' ? '0x' : '0X';
        }
      }
      body = digits;
      if (hasPrec) canZero = false;
    } else {
      const v = arg as number;
      const neg = v < 0 || Object.is(v, -0);
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      if (Number.isNaN(v)) {
        body = upper ? 'NAN' : 'nan';
        canZero = false;
      } else {
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        const a = Math.abs(v);
        if (!Number.isFinite(a)) {
          body = upper ? 'INF' : 'inf';
          canZero = false;
        } else {
          const p = hasPrec ? prec : 6;
          const lc = conv.toLowerCase();
          if (lc === 'f') body = fixed(a, p, alt);
          else if (lc === 'e') body = sciStr(a, p, alt, upper, false);
          else {
            const P = p === 0 ? 1 : p;
            const [, X] = sci(a, P);
            if (P > X && X >= -4) {
              body = fixed(a, P - 1 - X, alt);
              if (!alt) body = stripFixed(body);
            } else {
              body = sciStr(a, P - 1, alt, upper, true);
            }
          }
        }
      }
    }

    const len = sign.length + prefix.length + body.length;
    if (len >= width) return sign + prefix + body;
    const pad = width - len;
    if (left) return sign + prefix + body + ' '.repeat(pad);
    if (zero && canZero) return sign + prefix + '0'.repeat(pad) + body;
    return ' '.repeat(pad) + sign + prefix + body;
  });
}
