function decompose(abs: number): [bigint, number] {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, abs);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const bexp = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (bexp === 0) return [m, -1074];
  m |= 1n << 52n;
  return [m, bexp - 1075];
}

// round(abs * 10^k), half to even, exact
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

function fixedStr(abs: number, p: number, alt: boolean): string {
  const [m, e] = decompose(abs);
  let s = roundScaled(m, e, p).toString();
  if (p > 0) {
    s = s.padStart(p + 1, '0');
    s = s.slice(0, s.length - p) + '.' + s.slice(s.length - p);
  } else if (alt) s += '.';
  return s;
}

// returns digits (p+1 of them) and decimal exponent
function expDigits(abs: number, p: number): [string, number] {
  if (abs === 0) return ['0'.repeat(p + 1), 0];
  const [m, e] = decompose(abs);
  let X = Math.floor(Math.log10(abs));
  if (!isFinite(X)) X = -324;
  const lo = 10n ** BigInt(p);
  const hi = lo * 10n;
  for (;;) {
    const n = roundScaled(m, e, p - X);
    if (n < lo) X--;
    else if (n >= hi) X++;
    else return [n.toString(), X];
  }
}

function expStr(digits: string, X: number, alt: boolean, upper: boolean, strip: boolean): string {
  let frac = digits.slice(1);
  if (strip) frac = frac.replace(/0+$/, '');
  let s = digits[0];
  if (frac.length > 0 || alt) s += '.' + frac;
  const a = Math.abs(X);
  s += (upper ? 'E' : 'e') + (X < 0 ? '-' : '+') + (a < 10 ? '0' + a : String(a));
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
    let numeric = true;
    let zeroOk = zero && !minus;
    const signFor = (neg: boolean) => (neg ? '-' : plus ? '+' : space ? ' ' : '');

    if (conv === 's' || conv === 'c') {
      numeric = false;
      body = String(arg);
      if (conv === 's' && prec >= 0) body = body.slice(0, prec);
    } else if (conv === 'd' || conv === 'i' || conv === 'x' || conv === 'X' || conv === 'o') {
      const v = BigInt(arg as number | bigint);
      const neg = v < 0n;
      const mag = neg ? -v : v;
      let digits = mag.toString(conv === 'o' ? 8 : conv === 'd' || conv === 'i' ? 10 : 16);
      if (conv === 'X') digits = digits.toUpperCase();
      if (prec >= 0) {
        if (prec === 0 && mag === 0n) digits = '';
        digits = digits.padStart(prec, '0');
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
        const abs = Math.abs(x);
        if (abs === Infinity) {
          body = upper ? 'INF' : 'inf';
          zeroOk = false;
        } else {
          const lc = conv.toLowerCase();
          if (lc === 'f') {
            body = fixedStr(abs, prec < 0 ? 6 : prec, alt);
          } else if (lc === 'e') {
            const p = prec < 0 ? 6 : prec;
            const [d, X] = expDigits(abs, p);
            body = expStr(d, X, alt, upper, false);
          } else {
            const P = prec < 0 ? 6 : prec === 0 ? 1 : prec;
            const [d, X] = expDigits(abs, P - 1);
            if (P > X && X >= -4) {
              body = fixedStr(abs, P - 1 - X, alt);
              if (!alt && body.includes('.')) body = body.replace(/0+$/, '').replace(/\.$/, '');
            } else {
              body = expStr(d, X, alt, upper, !alt);
            }
          }
        }
      }
    }

    const len = sign.length + prefix.length + body.length;
    if (len < width) {
      const n = width - len;
      if (minus) body = sign + prefix + body + ' '.repeat(n);
      else if (numeric && zeroOk) body = sign + prefix + '0'.repeat(n) + body;
      else body = ' '.repeat(n) + sign + prefix + body;
    } else body = sign + prefix + body;
    out += body;
  }
  return out;
}
