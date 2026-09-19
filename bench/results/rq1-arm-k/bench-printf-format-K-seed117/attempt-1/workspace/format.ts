function decompose(x: number): [bigint, number] {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const ex = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (ex === 0) return [m, -1074];
  m |= 1n << 52n;
  return [m, ex - 1075];
}

// round(m * 2^e * 10^k), half to even
function roundScaled(m: bigint, e: number, k: number): bigint {
  let num = m;
  let den = 1n;
  if (e >= 0) num <<= BigInt(e);
  else den <<= BigInt(-e);
  if (k >= 0) num *= 10n ** BigInt(k);
  else den *= 10n ** BigInt(-k);
  let q = num / den;
  const r = num % den;
  const t = 2n * r;
  if (t > den || (t === den && (q & 1n) === 1n)) q++;
  return q;
}

function fixed(x: number, prec: number, alt: boolean): string {
  const [m, e] = decompose(x);
  let s = roundScaled(m, e, prec).toString();
  if (prec > 0) {
    s = s.padStart(prec + 1, '0');
    return s.slice(0, s.length - prec) + '.' + s.slice(s.length - prec);
  }
  return alt ? s + '.' : s;
}

// returns [digit string of length p+1, exponent]
function sci(x: number, p: number): [string, number] {
  if (x === 0) return ['0'.repeat(p + 1), 0];
  const [m, e] = decompose(x);
  let X = Math.floor(Math.log10(x));
  if (!isFinite(X)) X = -324;
  const lo = 10n ** BigInt(p);
  const hi = lo * 10n;
  for (;;) {
    const n = roundScaled(m, e, p - X);
    if (n >= hi) X++;
    else if (n < lo) X--;
    else return [n.toString(), X];
  }
}

function expStr(X: number, upper: boolean): string {
  const a = Math.abs(X).toString().padStart(2, '0');
  return (upper ? 'E' : 'e') + (X < 0 ? '-' : '+') + a;
}

function sciStr(x: number, p: number, alt: boolean, upper: boolean): string {
  const [d, X] = sci(x, p);
  let s = d[0];
  if (p > 0) s += '.' + d.slice(1);
  else if (alt) s += '.';
  return s + expStr(X, upper);
}

function stripZeros(s: string): string {
  if (!s.includes('.')) return s;
  return s.replace(/0+$/, '').replace(/\.$/, '');
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let ai = 0;
  return fmt.replace(
    /%([-+ 0#]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc%])/g,
    (_all, flags: string, w: string, pr: string | undefined, conv: string) => {
      if (conv === '%') return '%';
      const arg = args[ai++];
      const left = flags.includes('-');
      const plus = flags.includes('+');
      const space = flags.includes(' ');
      const zero = flags.includes('0') && !left;
      const alt = flags.includes('#');
      const width = w ? parseInt(w, 10) : 0;
      const hasPrec = pr !== undefined;
      const prec = hasPrec ? (pr === '' ? 0 : parseInt(pr, 10)) : -1;

      let sign = '';
      let prefix = '';
      let body = '';
      let zeroOk = zero;

      if (conv === 's' || conv === 'c') {
        body = String(arg);
        if (conv === 's' && hasPrec) body = body.slice(0, prec);
        zeroOk = false;
      } else if ('dixXo'.includes(conv)) {
        const v = BigInt(arg as number | bigint);
        const neg = v < 0n;
        const mag = neg ? -v : v;
        let digits = mag.toString(conv === 'x' || conv === 'X' ? 16 : conv === 'o' ? 8 : 10);
        if (conv === 'X') digits = digits.toUpperCase();
        if (hasPrec) {
          if (prec === 0 && mag === 0n) digits = '';
          digits = digits.padStart(prec, '0');
          zeroOk = false;
        }
        if (conv === 'd' || conv === 'i') {
          sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        } else if (alt) {
          if (conv === 'o') {
            if (!digits.startsWith('0')) digits = '0' + digits;
          } else if (mag !== 0n) prefix = conv === 'x' ? '0x' : '0X';
        }
        body = digits;
      } else {
        const x = arg as number;
        const upper = conv === 'E' || conv === 'F' || conv === 'G';
        const neg = x < 0 || Object.is(x, -0);
        if (Number.isNaN(x)) {
          body = upper ? 'NAN' : 'nan';
          zeroOk = false;
        } else {
          sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
          if (!isFinite(x)) {
            body = upper ? 'INF' : 'inf';
            zeroOk = false;
          } else {
            const a = Math.abs(x);
            const p = hasPrec ? prec : 6;
            const lc = conv.toLowerCase();
            if (lc === 'f') body = fixed(a, p, alt);
            else if (lc === 'e') body = sciStr(a, p, alt, upper);
            else {
              const P = p === 0 ? 1 : p;
              const X = sci(a, P - 1)[1];
              if (P > X && X >= -4) {
                body = fixed(a, P - 1 - X, alt);
                if (!alt) body = stripZeros(body);
              } else {
                const [d, XX] = sci(a, P - 1);
                let mant = d[0];
                if (P > 1) mant += '.' + d.slice(1);
                else if (alt) mant += '.';
                if (!alt) mant = stripZeros(mant);
                body = mant + expStr(XX, upper);
              }
            }
          }
        }
      }

      const len = sign.length + prefix.length + body.length;
      if (len >= width) return sign + prefix + body;
      const pad = width - len;
      if (left) return sign + prefix + body + ' '.repeat(pad);
      if (zeroOk) return sign + prefix + '0'.repeat(pad) + body;
      return ' '.repeat(pad) + sign + prefix + body;
    },
  );
}
