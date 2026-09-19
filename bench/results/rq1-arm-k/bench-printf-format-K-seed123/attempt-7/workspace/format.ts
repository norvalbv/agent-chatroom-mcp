function roundDiv(n: bigint, d: bigint): bigint {
  const q = n / d;
  const r2 = (n % d) * 2n;
  if (r2 > d || (r2 === d && (q & 1n) === 1n)) return q + 1n;
  return q;
}

function toRational(v: number): [bigint, bigint] {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, Math.abs(v));
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const eb = (hi >>> 20) & 0x7ff;
  const frac = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let m: bigint;
  let exp: number;
  if (eb === 0) {
    m = frac;
    exp = -1074;
  } else {
    m = frac | (1n << 52n);
    exp = eb - 1075;
  }
  return exp >= 0 ? [m << BigInt(exp), 1n] : [m, 1n << BigInt(-exp)];
}

const pow10 = (k: number): bigint => 10n ** BigInt(k);

// round(N/D * 10^k) half-even
function scaledRound(N: bigint, D: bigint, k: number): bigint {
  return k >= 0 ? roundDiv(N * pow10(k), D) : roundDiv(N, D * pow10(-k));
}

function fixedStr(N: bigint, D: bigint, p: number, alt: boolean): string {
  let s = scaledRound(N, D, p).toString();
  if (s.length < p + 1) s = '0'.repeat(p + 1 - s.length) + s;
  const ip = s.slice(0, s.length - p);
  const fp = s.slice(s.length - p);
  return p > 0 ? ip + '.' + fp : alt ? ip + '.' : ip;
}

function expParts(N: bigint, D: bigint, p: number): { digits: string; X: number } {
  if (N === 0n) return { digits: '0'.repeat(p + 1), X: 0 };
  let X = Math.floor(Math.log10(Number(N) / Number(D)));
  if (!Number.isFinite(X)) X = 0;
  // exact adjust: want 10^X <= N/D < 10^(X+1)
  const ge = (k: number) => (k >= 0 ? N >= D * pow10(k) : N * pow10(-k) >= D);
  while (!ge(X)) X--;
  while (ge(X + 1)) X++;
  let d = scaledRound(N, D, p - X);
  if (d >= pow10(p + 1)) {
    X++;
    d = scaledRound(N, D, p - X);
  }
  return { digits: d.toString(), X };
}

function expStr(digits: string, X: number, alt: boolean, upper: boolean, strip: boolean): string {
  let frac = digits.slice(1);
  if (strip) frac = frac.replace(/0+$/, '');
  let m = digits[0];
  if (frac.length > 0) m += '.' + frac;
  else if (alt) m += '.';
  const ax = Math.abs(X);
  return m + (upper ? 'E' : 'e') + (X < 0 ? '-' : '+') + (ax < 10 ? '0' : '') + ax;
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let out = '';
  let ai = 0;
  let i = 0;
  while (i < fmt.length) {
    const ch = fmt[i++];
    if (ch !== '%') {
      out += ch;
      continue;
    }
    if (fmt[i] === '%') {
      out += '%';
      i++;
      continue;
    }
    let minus = false, plus = false, space = false, zero = false, alt = false;
    for (; i < fmt.length; i++) {
      const f = fmt[i];
      if (f === '-') minus = true;
      else if (f === '+') plus = true;
      else if (f === ' ') space = true;
      else if (f === '0') zero = true;
      else if (f === '#') alt = true;
      else break;
    }
    let width = 0;
    while (i < fmt.length && fmt[i] >= '0' && fmt[i] <= '9') width = width * 10 + Number(fmt[i++]);
    let prec = -1;
    if (fmt[i] === '.') {
      i++;
      prec = 0;
      while (i < fmt.length && fmt[i] >= '0' && fmt[i] <= '9') prec = prec * 10 + Number(fmt[i++]);
    }
    const conv = fmt[i++];
    const arg = args[ai++];
    let sign = '';
    let prefix = '';
    let body = '';
    let canZero = false;
    if (conv === 's') {
      body = String(arg);
      if (prec >= 0) body = body.slice(0, prec);
    } else if (conv === 'c') {
      body = String(arg);
    } else if (conv === 'd' || conv === 'i' || conv === 'x' || conv === 'X' || conv === 'o') {
      const n = BigInt(arg as number | bigint);
      const neg = n < 0n;
      const mag = neg ? -n : n;
      let digits = mag.toString(conv === 'x' || conv === 'X' ? 16 : conv === 'o' ? 8 : 10);
      if (conv === 'X') digits = digits.toUpperCase();
      if (prec === 0 && mag === 0n) digits = '';
      if (prec > digits.length) digits = '0'.repeat(prec - digits.length) + digits;
      if (conv === 'd' || conv === 'i') {
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
      } else if (alt) {
        if (conv === 'o') {
          if (digits[0] !== '0') digits = '0' + digits;
        } else if (mag !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      }
      body = digits;
      canZero = prec < 0;
    } else {
      const v = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      const neg = v < 0 || Object.is(v, -0);
      if (Number.isNaN(v)) {
        body = upper ? 'NAN' : 'nan';
      } else {
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        if (!Number.isFinite(v)) {
          body = upper ? 'INF' : 'inf';
        } else {
          canZero = true;
          const [N, D] = toRational(v);
          const lc = conv.toLowerCase();
          if (lc === 'f') {
            body = fixedStr(N, D, prec < 0 ? 6 : prec, alt);
          } else if (lc === 'e') {
            const p = prec < 0 ? 6 : prec;
            const { digits, X } = expParts(N, D, p);
            body = expStr(digits, X, alt, upper, false);
          } else {
            const P = prec < 0 ? 6 : prec === 0 ? 1 : prec;
            const { digits, X } = expParts(N, D, P - 1);
            if (P > X && X >= -4) {
              body = fixedStr(N, D, P - 1 - X, alt);
              if (!alt && body.includes('.')) body = body.replace(/0+$/, '').replace(/\.$/, '');
            } else {
              body = expStr(digits, X, alt, upper, !alt);
            }
          }
        }
      }
      if (!Number.isFinite(v)) canZero = false;
    }
    let text = sign + prefix + body;
    if (text.length < width) {
      const padN = width - text.length;
      if (minus) text += ' '.repeat(padN);
      else if (zero && canZero) text = sign + prefix + '0'.repeat(padN) + body;
      else text = ' '.repeat(padN) + text;
    }
    out += text;
  }
  return out;
}
