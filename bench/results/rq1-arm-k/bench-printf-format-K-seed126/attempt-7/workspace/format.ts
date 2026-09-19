function decompose(x: number): [bigint, number] {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, Math.abs(x));
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const exp = (hi >>> 20) & 0x7ff;
  const frac = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (exp === 0) return [frac, -1074];
  return [frac | (1n << 52n), exp - 1075];
}

// round-half-even of m * 2^e2 * 10^k; also returns floor
function scaled(m: bigint, e2: number, k: number): { q: bigint; rounded: bigint } {
  let num = m;
  let den = 1n;
  if (e2 >= 0) num <<= BigInt(e2);
  else den <<= BigInt(-e2);
  if (k >= 0) num *= 10n ** BigInt(k);
  else den *= 10n ** BigInt(-k);
  const q = num / den;
  const r = num % den;
  let rounded = q;
  const twice = r * 2n;
  if (twice > den || (twice === den && (q & 1n) === 1n)) rounded = q + 1n;
  return { q, rounded };
}

function fixedDigits(m: bigint, e2: number, p: number, alt: boolean): string {
  let s = scaled(m, e2, p).rounded.toString();
  if (s.length < p + 1) s = '0'.repeat(p + 1 - s.length) + s;
  if (p === 0) return alt ? s + '.' : s;
  return s.slice(0, s.length - p) + '.' + s.slice(s.length - p);
}

function expParts(m: bigint, e2: number, p: number): { digits: string; X: number } {
  if (m === 0n) return { digits: '0'.repeat(p + 1), X: 0 };
  let X = Math.floor(Math.log10(Number(m) * Math.pow(2, e2)));
  if (!isFinite(X)) X = 0;
  for (;;) {
    const q = scaled(m, e2, -X).q;
    if (q === 0n) X--;
    else if (q >= 10n) X++;
    else break;
  }
  let r = scaled(m, e2, p - X).rounded;
  if (r >= 10n ** BigInt(p + 1)) {
    X++;
    r = scaled(m, e2, p - X).rounded;
  }
  return { digits: r.toString(), X };
}

function expStr(digits: string, X: number, p: number, alt: boolean, upper: boolean): string {
  let s = digits[0];
  if (p > 0) s += '.' + digits.slice(1);
  else if (alt) s += '.';
  const ax = Math.abs(X);
  s += (upper ? 'E' : 'e') + (X < 0 ? '-' : '+') + (ax < 10 ? '0' : '') + ax;
  return s;
}

function stripZeros(s: string): string {
  if (!s.includes('.')) return s;
  return s.replace(/0+$/, '').replace(/\.$/, '');
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
    let canZero = false;
    const signFor = (neg: boolean) => (neg ? '-' : plus ? '+' : space ? ' ' : '');

    if (conv === 's') {
      body = String(arg);
      if (prec >= 0) body = body.slice(0, prec);
    } else if (conv === 'c') {
      body = String(arg);
    } else if (conv === 'd' || conv === 'i' || conv === 'x' || conv === 'X' || conv === 'o') {
      const v = BigInt(arg as number | bigint);
      const neg = v < 0n;
      const abs = neg ? -v : v;
      if (conv === 'd' || conv === 'i') sign = signFor(neg);
      let digits = conv === 'x' ? abs.toString(16) : conv === 'X' ? abs.toString(16).toUpperCase() : conv === 'o' ? abs.toString(8) : abs.toString();
      if (prec === 0 && abs === 0n) digits = '';
      if (prec > digits.length) digits = '0'.repeat(prec - digits.length) + digits;
      if (alt) {
        if (conv === 'o') {
          if (digits[0] !== '0') digits = '0' + digits;
        } else if ((conv === 'x' || conv === 'X') && abs !== 0n) {
          prefix = conv === 'x' ? '0x' : '0X';
        }
      }
      body = digits;
      canZero = prec < 0;
    } else {
      const x = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      const lc = conv.toLowerCase();
      if (Number.isNaN(x)) {
        body = upper ? 'NAN' : 'nan';
      } else {
        const neg = x < 0 || Object.is(x, -0);
        sign = signFor(neg);
        if (!isFinite(x)) {
          body = upper ? 'INF' : 'inf';
        } else {
          canZero = true;
          const [m, e2] = decompose(x);
          const p = prec < 0 ? 6 : prec;
          if (lc === 'f') {
            body = fixedDigits(m, e2, p, alt);
          } else if (lc === 'e') {
            const { digits, X } = expParts(m, e2, p);
            body = expStr(digits, X, p, alt, upper);
          } else {
            const P = prec < 0 ? 6 : prec === 0 ? 1 : prec;
            const { digits, X } = expParts(m, e2, P - 1);
            if (P > X && X >= -4) {
              body = fixedDigits(m, e2, P - 1 - X, alt);
              if (!alt) body = stripZeros(body);
            } else {
              let mant = digits[0] + (P > 1 ? '.' + digits.slice(1) : alt ? '.' : '');
              if (!alt) mant = stripZeros(mant);
              const ax = Math.abs(X);
              body = mant + (upper ? 'E' : 'e') + (X < 0 ? '-' : '+') + (ax < 10 ? '0' : '') + ax;
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
