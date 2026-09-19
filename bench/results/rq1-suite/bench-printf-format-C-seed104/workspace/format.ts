function decompose(x: number): [bigint, number] {
  // x finite, >= 0 ; returns [m, e] with x = m * 2^e
  if (x === 0) return [0n, 0];
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, x);
  const hi = buf.getUint32(0);
  const lo = buf.getUint32(4);
  const bexp = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (bexp === 0) return [m, -1074];
  m |= 1n << 52n;
  return [m, bexp - 1075];
}

// round-half-even of x * 10^k, exactly
function roundScaled(m: bigint, e: number, k: number): bigint {
  let num = m;
  let den = 1n;
  if (k >= 0) num *= 10n ** BigInt(k);
  else den *= 10n ** BigInt(-k);
  if (e >= 0) num <<= BigInt(e);
  else den <<= BigInt(-e);
  const q = num / den;
  const r = num - q * den;
  const twice = r * 2n;
  if (twice > den || (twice === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// digits (prec+1 of them) and decimal exponent, e-style
function expDigits(x: number, prec: number): [string, number] {
  if (x === 0) return ['0'.repeat(prec + 1), 0];
  const [m, e] = decompose(x);
  let X = Math.floor(Math.log10(x));
  if (!isFinite(X)) X = -324;
  const lowB = 10n ** BigInt(prec);
  const highB = lowB * 10n;
  for (;;) {
    const d = roundScaled(m, e, prec - X);
    if (d >= highB) X++;
    else if (d < lowB) X--;
    else return [d.toString(), X];
  }
}

function fixedDigits(x: number, prec: number): string {
  const [m, e] = decompose(x);
  let s = roundScaled(m, e, prec).toString();
  if (s.length < prec + 1) s = '0'.repeat(prec + 1 - s.length) + s;
  if (prec === 0) return s;
  return s.slice(0, s.length - prec) + '.' + s.slice(s.length - prec);
}

function fmtExp(digits: string, X: number, prec: number, alt: boolean, upper: boolean): string {
  let s = digits[0];
  if (prec > 0 || alt) s += '.';
  s += digits.slice(1);
  const ax = Math.abs(X);
  s += (upper ? 'E' : 'e') + (X < 0 ? '-' : '+') + (ax < 10 ? '0' : '') + ax;
  return s;
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let out = '';
  let ai = 0;
  let i = 0;
  while (i < fmt.length) {
    const ch = fmt[i];
    if (ch !== '%') {
      out += ch;
      i++;
      continue;
    }
    i++;
    if (fmt[i] === '%') {
      out += '%';
      i++;
      continue;
    }
    let minus = false, plus = false, space = false, zero = false, alt = false;
    for (;; i++) {
      const c = fmt[i];
      if (c === '-') minus = true;
      else if (c === '+') plus = true;
      else if (c === ' ') space = true;
      else if (c === '0') zero = true;
      else if (c === '#') alt = true;
      else break;
    }
    let width = 0;
    while (fmt[i] >= '0' && fmt[i] <= '9') width = width * 10 + (fmt.charCodeAt(i++) - 48);
    let prec = -1;
    if (fmt[i] === '.') {
      i++;
      prec = 0;
      while (fmt[i] >= '0' && fmt[i] <= '9') prec = prec * 10 + (fmt.charCodeAt(i++) - 48);
    }
    const conv = fmt[i++];
    const arg = args[ai++];
    let sign = '';
    let prefix = '';
    let body: string;
    let numeric = true;
    let allowZero = true;

    if (conv === 'd' || conv === 'i' || conv === 'x' || conv === 'X' || conv === 'o') {
      let v = typeof arg === 'bigint' ? arg : BigInt(arg as number);
      if (v < 0n) {
        sign = '-';
        v = -v;
      } else if (conv === 'd' || conv === 'i') sign = plus ? '+' : space ? ' ' : '';
      if (conv === 'x') body = v.toString(16);
      else if (conv === 'X') body = v.toString(16).toUpperCase();
      else if (conv === 'o') body = v.toString(8);
      else body = v.toString();
      if (prec >= 0) {
        allowZero = false;
        if (prec === 0 && v === 0n) body = '';
        if (body.length < prec) body = '0'.repeat(prec - body.length) + body;
      }
      if (alt) {
        if ((conv === 'x' || conv === 'X') && v !== 0n) prefix = conv === 'x' ? '0x' : '0X';
        else if (conv === 'o' && body[0] !== '0') body = '0' + body;
      }
    } else if ('eEfFgG'.includes(conv)) {
      const x = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      const neg = x < 0 || Object.is(x, -0);
      if (!Number.isNaN(x)) sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
      if (!isFinite(x)) {
        body = Number.isNaN(x) ? 'nan' : 'inf';
        if (upper) body = body.toUpperCase();
        allowZero = false;
      } else {
        const ax = Math.abs(x);
        const lc = conv.toLowerCase();
        if (lc === 'f') {
          body = fixedDigits(ax, prec < 0 ? 6 : prec);
          if (alt && !body.includes('.')) body += '.';
        } else if (lc === 'e') {
          const p = prec < 0 ? 6 : prec;
          const [d, X] = expDigits(ax, p);
          body = fmtExp(d, X, p, alt, upper);
        } else {
          let P = prec < 0 ? 6 : prec;
          if (P === 0) P = 1;
          const [d, X] = expDigits(ax, P - 1);
          if (P > X && X >= -4) {
            body = fixedDigits(ax, P - 1 - X);
            if (alt && !body.includes('.')) body += '.';
            if (!alt && body.includes('.')) body = body.replace(/\.?0+$/, '');
          } else {
            let mant = d[0] + (P > 1 ? '.' + d.slice(1) : alt ? '.' : '');
            if (!alt && mant.includes('.')) mant = mant.replace(/\.?0+$/, '');
            const ax2 = Math.abs(X);
            body = mant + (upper ? 'E' : 'e') + (X < 0 ? '-' : '+') + (ax2 < 10 ? '0' : '') + ax2;
          }
        }
      }
    } else if (conv === 's') {
      numeric = false;
      body = String(arg);
      if (prec >= 0) body = body.slice(0, prec);
    } else {
      numeric = false;
      body = String(arg);
    }

    const len = sign.length + prefix.length + body.length;
    if (len >= width) out += sign + prefix + body;
    else if (minus) out += sign + prefix + body + ' '.repeat(width - len);
    else if (numeric && zero && allowZero) out += sign + prefix + '0'.repeat(width - len) + body;
    else out += ' '.repeat(width - len) + sign + prefix + body;
  }
  return out;
}
