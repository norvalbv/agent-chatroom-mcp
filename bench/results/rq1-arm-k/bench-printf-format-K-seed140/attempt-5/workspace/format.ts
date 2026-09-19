function decompose(v: number): [bigint, number] {
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

// round(m * 2^e2 * 10^k), half to even, exact
function roundScaled(m: bigint, e2: number, k: number): bigint {
  let num = m;
  let den = 1n;
  if (k >= 0) num *= 10n ** BigInt(k);
  else den *= 10n ** BigInt(-k);
  if (e2 >= 0) num <<= BigInt(e2);
  else den <<= BigInt(-e2);
  const q = num / den;
  const r = num % den;
  const twice = r * 2n;
  if (twice > den || (twice === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// digits (p+1 of them) and decimal exponent for e style
function sci(v: number, p: number): [string, number] {
  if (v === 0) return ['0'.repeat(p + 1), 0];
  const [m, e2] = decompose(v);
  let X = Math.floor(Math.log10(v));
  if (!isFinite(X)) X = 0;
  const lo = 10n ** BigInt(p);
  const hi = lo * 10n;
  for (;;) {
    const n = roundScaled(m, e2, p - X);
    if (n >= hi) X++;
    else if (n < lo) X--;
    else return [n.toString(), X];
  }
}

function fixed(v: number, p: number): string {
  const [m, e2] = decompose(v);
  let s = roundScaled(m, e2, p).toString();
  if (p === 0) return s;
  if (s.length < p + 1) s = '0'.repeat(p + 1 - s.length) + s;
  return s.slice(0, s.length - p) + '.' + s.slice(s.length - p);
}

function expStr(digits: string, X: number, p: number, alt: boolean, upper: boolean): string {
  let s = digits[0];
  if (p > 0 || alt) s += '.';
  s += digits.slice(1);
  const ax = Math.abs(X);
  return s + (upper ? 'E' : 'e') + (X < 0 ? '-' : '+') + (ax < 10 ? '0' + ax : String(ax));
}

function stripZeros(s: string): string {
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
    const width = w ? parseInt(w, 10) : 0;
    const hasPrec = pr !== undefined;
    const prec = hasPrec ? (pr === '' ? 0 : parseInt(pr, 10)) : -1;

    let prefix = '';
    let body: string;
    let canZero = zero;

    if (conv === 's' || conv === 'c') {
      body = String(arg);
      if (conv === 's' && hasPrec) body = body.slice(0, prec);
      canZero = false;
    } else if ('dioxX'.includes(conv)) {
      let n = typeof arg === 'bigint' ? arg : BigInt(arg as number);
      const neg = n < 0n;
      if (neg) n = -n;
      if (conv === 'd' || conv === 'i') {
        prefix = neg ? '-' : plus ? '+' : space ? ' ' : '';
        body = n.toString();
      } else if (conv === 'o') body = n.toString(8);
      else if (conv === 'x') body = n.toString(16);
      else body = n.toString(16).toUpperCase();
      if (hasPrec) {
        canZero = false;
        if (prec === 0 && n === 0n) body = '';
        else if (body.length < prec) body = '0'.repeat(prec - body.length) + body;
      }
      if (alt) {
        if (conv === 'o') {
          if (body[0] !== '0') body = '0' + body;
        } else if ((conv === 'x' || conv === 'X') && n !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      }
    } else {
      const x = arg as number;
      const neg = x < 0 || Object.is(x, -0);
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      if (Number.isNaN(x)) {
        body = upper ? 'NAN' : 'nan';
        canZero = false;
      } else {
        prefix = neg ? '-' : plus ? '+' : space ? ' ' : '';
        const v = Math.abs(x);
        if (v === Infinity) {
          body = upper ? 'INF' : 'inf';
          canZero = false;
        } else if (conv === 'e' || conv === 'E') {
          const p = hasPrec ? prec : 6;
          const [d, X] = sci(v, p);
          body = expStr(d, X, p, alt, upper);
        } else if (conv === 'f' || conv === 'F') {
          const p = hasPrec ? prec : 6;
          body = fixed(v, p);
          if (p === 0 && alt) body += '.';
        } else {
          let P = hasPrec ? prec : 6;
          if (P === 0) P = 1;
          const [d, X] = sci(v, P - 1);
          if (P > X && X >= -4) {
            const p = P - 1 - X;
            body = fixed(v, p);
            if (p === 0 && alt) body += '.';
            if (!alt) body = stripZeros(body);
          } else {
            let mant = d[0];
            if (P - 1 > 0 || alt) mant += '.';
            mant += d.slice(1);
            if (!alt) mant = stripZeros(mant);
            const ax = Math.abs(X);
            body = mant + (upper ? 'E' : 'e') + (X < 0 ? '-' : '+') + (ax < 10 ? '0' + ax : String(ax));
          }
        }
      }
    }

    const len = prefix.length + body.length;
    if (len >= width) return prefix + body;
    const pad = width - len;
    if (left) return prefix + body + ' '.repeat(pad);
    if (canZero) return prefix + '0'.repeat(pad) + body;
    return ' '.repeat(pad) + prefix + body;
  });
}
