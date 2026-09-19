// Decompose a finite non-negative double into m * 2^e exactly.
function decompose(x: number): [bigint, number] {
  if (x === 0) return [0n, 0];
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, x);
  const hi = buf.getUint32(0);
  const lo = buf.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (expBits === 0) return [m, -1074];
  m |= 1n << 52n;
  return [m, expBits - 1075];
}

// round(m * 2^e * 10^k) to nearest integer, ties to even.
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

// e-style digits: returns [digit string of length p+1, exponent].
function eDigits(x: number, p: number): [string, number] {
  if (x === 0) return ['0'.repeat(p + 1), 0];
  const [m, e] = decompose(x);
  let X = Math.floor(Math.log10(x));
  if (!isFinite(X)) X = x < 1 ? -324 : 308;
  for (;;) {
    const d = roundScaled(m, e, p - X);
    const s = d.toString();
    if (s.length > p + 1) X++;
    else if (s.length < p + 1) X--;
    else return [s, X];
  }
}

function fDigits(x: number, p: number): string {
  const [m, e] = decompose(x);
  let s = roundScaled(m, e, p).toString();
  if (p > 0) {
    s = s.padStart(p + 1, '0');
    return s.slice(0, s.length - p) + '.' + s.slice(s.length - p);
  }
  return s;
}

function expStr(X: number, upper: boolean): string {
  const a = Math.abs(X).toString().padStart(2, '0');
  return (upper ? 'E' : 'e') + (X < 0 ? '-' : '+') + a;
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
      const f = fmt[i];
      if (f === '-') minus = true;
      else if (f === '+') plus = true;
      else if (f === ' ') space = true;
      else if (f === '0') zero = true;
      else if (f === '#') alt = true;
      else break;
    }
    let width = 0;
    while (fmt[i] >= '0' && fmt[i] <= '9') width = width * 10 + Number(fmt[i++]);
    let prec = -1;
    if (fmt[i] === '.') {
      i++;
      prec = 0;
      while (fmt[i] >= '0' && fmt[i] <= '9') prec = prec * 10 + Number(fmt[i++]);
    }
    const conv = fmt[i++];
    const arg = args[ai++];

    let sign = '';
    let prefix = '';
    let body = '';
    let canZero = true;

    const signOf = (neg: boolean) => (neg ? '-' : plus ? '+' : space ? ' ' : '');

    if (conv === 's' || conv === 'c') {
      body = String(arg);
      if (conv === 's' && prec >= 0) body = body.slice(0, prec);
      canZero = false;
    } else if (conv === 'd' || conv === 'i' || conv === 'x' || conv === 'X' || conv === 'o') {
      const big = typeof arg === 'bigint' ? arg : BigInt(arg as number);
      const neg = big < 0n;
      const mag = neg ? -big : big;
      let digits: string;
      if (conv === 'x') digits = mag.toString(16);
      else if (conv === 'X') digits = mag.toString(16).toUpperCase();
      else if (conv === 'o') digits = mag.toString(8);
      else digits = mag.toString(10);
      if (prec === 0 && mag === 0n) digits = '';
      if (prec >= 0) {
        digits = digits.padStart(prec, '0');
        canZero = false;
      }
      if (conv === 'd' || conv === 'i') sign = signOf(neg);
      if (alt) {
        if ((conv === 'x' || conv === 'X') && mag !== 0n) prefix = conv === 'x' ? '0x' : '0X';
        else if (conv === 'o' && digits[0] !== '0') digits = '0' + digits;
      }
      body = digits;
    } else {
      const v = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      if (Number.isNaN(v)) {
        body = upper ? 'NAN' : 'nan';
        canZero = false;
      } else {
        const neg = v < 0 || Object.is(v, -0);
        sign = signOf(neg);
        const x = Math.abs(v);
        if (x === Infinity) {
          body = upper ? 'INF' : 'inf';
          canZero = false;
        } else {
          const lc = conv.toLowerCase();
          if (lc === 'f') {
            const p = prec < 0 ? 6 : prec;
            body = fDigits(x, p);
            if (p === 0 && alt) body += '.';
          } else if (lc === 'e') {
            const p = prec < 0 ? 6 : prec;
            const [ds, X] = eDigits(x, p);
            body = ds[0] + (p > 0 ? '.' + ds.slice(1) : alt ? '.' : '') + expStr(X, upper);
          } else {
            let P = prec < 0 ? 6 : prec;
            if (P === 0) P = 1;
            const [ds, X] = eDigits(x, P - 1);
            if (P > X && X >= -4) {
              body = fDigits(x, P - 1 - X);
              if (P - 1 - X === 0 && alt) body += '.';
              if (!alt && body.includes('.')) body = body.replace(/0+$/, '').replace(/\.$/, '');
            } else {
              let mant = ds[0] + (P > 1 ? '.' + ds.slice(1) : alt ? '.' : '');
              if (!alt && mant.includes('.')) mant = mant.replace(/0+$/, '').replace(/\.$/, '');
              body = mant + expStr(X, upper);
            }
          }
        }
      }
    }

    const len = sign.length + prefix.length + body.length;
    if (len >= width) out += sign + prefix + body;
    else if (minus) out += sign + prefix + body + ' '.repeat(width - len);
    else if (zero && canZero) out += sign + prefix + '0'.repeat(width - len) + body;
    else out += ' '.repeat(width - len) + sign + prefix + body;
  }
  return out;
}
