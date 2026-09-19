function decompose(x: number): [bigint, number] {
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, x);
  const bits = buf.getBigUint64(0);
  const ex = Number((bits >> 52n) & 0x7ffn);
  const frac = bits & ((1n << 52n) - 1n);
  if (ex === 0) return [frac, -1074];
  return [frac | (1n << 52n), ex - 1075];
}

// round(x * 10^s) to nearest, ties to even; x finite and >= 0
function roundScaled(x: number, s: number): bigint {
  const [m, k] = decompose(x);
  let num = m;
  let den = 1n;
  if (k >= 0) num <<= BigInt(k);
  else den <<= BigInt(-k);
  if (s >= 0) num *= 10n ** BigInt(s);
  else den *= 10n ** BigInt(-s);
  let q = num / den;
  const r2 = (num % den) * 2n;
  if (r2 > den || (r2 === den && (q & 1n) === 1n)) q += 1n;
  return q;
}

function fixed(x: number, prec: number, alt: boolean): string {
  const s = roundScaled(x, prec).toString().padStart(prec + 1, '0');
  const int = s.slice(0, s.length - prec);
  const frac = s.slice(s.length - prec);
  return int + (prec > 0 || alt ? '.' + frac : '');
}

function expDigits(x: number, p: number): { d: string; e: number } {
  if (x === 0) return { d: '0'.repeat(p + 1), e: 0 };
  let e = Math.floor(Math.log10(x));
  if (!isFinite(e)) e = -324;
  const lo = 10n ** BigInt(p);
  for (let i = 0; i < 10; i++) {
    const n = roundScaled(x, p - e);
    if (n >= lo * 10n) e++;
    else if (n < lo) e--;
    else return { d: n.toString(), e };
  }
  throw new Error('exp');
}

function expStr(d: string, e: number, upper: boolean, alt: boolean, strip: boolean): string {
  let frac = d.slice(1);
  if (strip) frac = frac.replace(/0+$/, '');
  const mant = d[0] + (frac.length > 0 || alt ? '.' + frac : '');
  const ae = Math.abs(e);
  return mant + (upper ? 'E' : 'e') + (e < 0 ? '-' : '+') + (ae < 10 ? '0' + ae : String(ae));
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let ai = 0;
  return fmt.replace(/%([-+ 0#]*)(\d*)(\.\d*)?([diouxXeEfFgGsc%])/g, (_m, fl: string, w: string, pr: string | undefined, conv: string) => {
    if (conv === '%') return '%';
    const left = fl.includes('-');
    const plus = fl.includes('+');
    const space = fl.includes(' ');
    const zero = fl.includes('0') && !left;
    const alt = fl.includes('#');
    const width = w ? parseInt(w, 10) : 0;
    const prec = pr === undefined ? -1 : pr.length === 1 ? 0 : parseInt(pr.slice(1), 10);
    const arg = args[ai++];
    let sign = '';
    let prefix = '';
    let body: string;
    let canZero = zero;
    const signOf = (neg: boolean) => (neg ? '-' : plus ? '+' : space ? ' ' : '');

    if (conv === 's' || conv === 'c') {
      body = String(arg);
      if (conv === 's' && prec >= 0) body = body.slice(0, prec);
      canZero = false;
    } else if ('dioxX'.includes(conv)) {
      let v = BigInt(arg as number | bigint);
      let neg = false;
      if (conv === 'd' || conv === 'i') {
        if (v < 0n) {
          neg = true;
          v = -v;
        }
        sign = signOf(neg);
      }
      let digits = v.toString(conv === 'o' ? 8 : conv === 'd' || conv === 'i' ? 10 : 16);
      if (conv === 'X') digits = digits.toUpperCase();
      if (prec === 0 && v === 0n) digits = '';
      if (prec >= 0) {
        digits = digits.padStart(prec, '0');
        canZero = false;
      }
      if (alt) {
        if (conv === 'o') {
          if (digits[0] !== '0') digits = '0' + digits;
        } else if (conv !== 'd' && conv !== 'i' && v !== 0n) prefix = conv === 'x' ? '0x' : '0X';
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
        sign = signOf(neg);
        const a = Math.abs(x);
        if (a === Infinity) {
          body = upper ? 'INF' : 'inf';
          canZero = false;
        } else {
          const lc = conv.toLowerCase();
          const p = prec < 0 ? 6 : prec;
          if (lc === 'f') body = fixed(a, p, alt);
          else if (lc === 'e') {
            const { d, e } = expDigits(a, p);
            body = expStr(d, e, upper, alt, false);
          } else {
            const P = p === 0 ? 1 : p;
            const { d, e: X } = expDigits(a, P - 1);
            if (P > X && X >= -4) {
              body = fixed(a, P - 1 - X, alt);
              if (!alt && body.includes('.')) body = body.replace(/0+$/, '').replace(/\.$/, '');
            } else body = expStr(d, X, upper, alt, !alt);
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
