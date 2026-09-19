function decompose(v: number): [bigint, number] {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, v);
  const bits = dv.getBigUint64(0);
  const ex = Number((bits >> 52n) & 0x7ffn);
  const frac = bits & ((1n << 52n) - 1n);
  if (ex === 0) return [frac, -1074];
  return [frac | (1n << 52n), ex - 1075];
}

// round(|v| * 10^k), ties to even, exact
function roundScaled(v: number, k: number): bigint {
  const [m, e] = decompose(v);
  let num = m;
  let den = 1n;
  if (e >= 0) num <<= BigInt(e);
  else den <<= BigInt(-e);
  if (k >= 0) num *= 10n ** BigInt(k);
  else den *= 10n ** BigInt(-k);
  let q = num / den;
  const r = num % den;
  const r2 = r * 2n;
  if (r2 > den || (r2 === den && (q & 1n) === 1n)) q += 1n;
  return q;
}

function fixedBody(v: number, prec: number, alt: boolean): string {
  let s = v === 0 ? '0'.repeat(prec + 1) : roundScaled(v, prec).toString();
  if (s.length < prec + 1) s = '0'.repeat(prec + 1 - s.length) + s;
  const ip = s.slice(0, s.length - prec);
  const fp = s.slice(s.length - prec);
  return ip + (prec > 0 || alt ? '.' : '') + fp;
}

// digits (prec+1 of them) and decimal exponent
function expDigits(v: number, prec: number): [string, number] {
  if (v === 0) return ['0'.repeat(prec + 1), 0];
  let X = Math.floor(Math.log10(v));
  const lo = 10n ** BigInt(prec);
  for (;;) {
    const q = roundScaled(v, prec - X);
    if (q >= lo * 10n) X++;
    else if (q < lo) X--;
    else return [q.toString(), X];
  }
}

function expBody(digits: string, X: number, alt: boolean, upper: boolean): string {
  const prec = digits.length - 1;
  let s = digits[0] + (prec > 0 || alt ? '.' : '') + digits.slice(1);
  const ax = Math.abs(X);
  s += (upper ? 'E' : 'e') + (X < 0 ? '-' : '+') + (ax < 10 ? '0' : '') + ax;
  return s;
}

function stripZeros(s: string): string {
  if (!s.includes('.')) return s;
  return s.replace(/0+$/, '').replace(/\.$/, '');
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let ai = 0;
  const re = /%(?:(%)|([-+ 0#]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc]))/g;
  return fmt.replace(re, (_m, pct, flags: string, w: string, p: string | undefined, conv: string) => {
    if (pct) return '%';
    const arg = args[ai++];
    const left = flags.includes('-');
    const plus = flags.includes('+');
    const space = flags.includes(' ');
    const zero = flags.includes('0') && !left;
    const alt = flags.includes('#');
    const width = w ? parseInt(w, 10) : 0;
    const hasPrec = p !== undefined;
    const prec = hasPrec ? (p === '' ? 0 : parseInt(p, 10)) : -1;

    let sign = '';
    let prefix = '';
    let body: string;
    let zeroOk = zero;

    if (conv === 's') {
      body = String(arg);
      if (hasPrec) body = body.slice(0, prec);
      zeroOk = false;
    } else if (conv === 'c') {
      body = String(arg);
      zeroOk = false;
    } else if ('dixXo'.includes(conv)) {
      const n = BigInt(arg as number | bigint);
      const neg = n < 0n;
      const mag = neg ? -n : n;
      if (conv === 'd' || conv === 'i') {
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
      }
      let digits = mag === 0n && hasPrec && prec === 0 ? '' : mag.toString(conv === 'o' ? 8 : conv === 'd' || conv === 'i' ? 10 : 16);
      if (conv === 'X') digits = digits.toUpperCase();
      if (hasPrec && digits.length < prec) digits = '0'.repeat(prec - digits.length) + digits;
      if (alt) {
        if (conv === 'o') {
          if (!digits.startsWith('0')) digits = '0' + digits;
        } else if ((conv === 'x' || conv === 'X') && mag !== 0n) {
          prefix = conv === 'x' ? '0x' : '0X';
        }
      }
      body = digits;
      if (hasPrec) zeroOk = false;
    } else {
      const v = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      if (Number.isNaN(v)) {
        body = upper ? 'NAN' : 'nan';
        zeroOk = false;
      } else {
        const negBit = v < 0 || Object.is(v, -0);
        sign = negBit ? '-' : plus ? '+' : space ? ' ' : '';
        const a = Math.abs(v);
        if (a === Infinity) {
          body = upper ? 'INF' : 'inf';
          zeroOk = false;
        } else if (conv === 'f' || conv === 'F') {
          body = fixedBody(a, hasPrec ? prec : 6, alt);
        } else if (conv === 'e' || conv === 'E') {
          const [d, X] = expDigits(a, hasPrec ? prec : 6);
          body = expBody(d, X, alt, upper);
        } else {
          let P = hasPrec ? prec : 6;
          if (P === 0) P = 1;
          const [d, X] = expDigits(a, P - 1);
          if (P > X && X >= -4) {
            body = fixedBody(a, P - 1 - X, alt);
            if (!alt) body = stripZeros(body);
          } else {
            let dd = d;
            let mant = dd[0] + (P - 1 > 0 || alt ? '.' : '') + dd.slice(1);
            if (!alt) mant = stripZeros(mant);
            const ax = Math.abs(X);
            body = mant + (upper ? 'E' : 'e') + (X < 0 ? '-' : '+') + (ax < 10 ? '0' : '') + ax;
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
  });
}
