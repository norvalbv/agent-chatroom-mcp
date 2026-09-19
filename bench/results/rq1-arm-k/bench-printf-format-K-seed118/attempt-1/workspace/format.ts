function roundDiv(n: bigint, d: bigint): bigint {
  const q = n / d;
  const r = n - q * d;
  const twice = r * 2n;
  if (twice > d || (twice === d && (q & 1n) === 1n)) return q + 1n;
  return q;
}

function decompose(x: number): [bigint, bigint] {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, Math.abs(x));
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const ef = (hi >>> 20) & 0x7ff;
  const frac = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let m: bigint;
  let e: number;
  if (ef === 0) {
    m = frac;
    e = -1074;
  } else {
    m = frac | (1n << 52n);
    e = ef - 1075;
  }
  return e >= 0 ? [m << BigInt(e), 1n] : [m, 1n << BigInt(-e)];
}

// round(|x| * 10^k), half-even, exact
function scaled(x: number, k: number): bigint {
  const [num, den] = decompose(x);
  if (k >= 0) return roundDiv(num * 10n ** BigInt(k), den);
  return roundDiv(num, den * 10n ** BigInt(-k));
}

function fixedParts(x: number, p: number): [string, string] {
  const s = scaled(x, p).toString().padStart(p + 1, '0');
  return p === 0 ? [s, ''] : [s.slice(0, s.length - p), s.slice(s.length - p)];
}

// returns digit string (p+1 digits) and decimal exponent
function expParts(x: number, p: number): [string, number] {
  if (x === 0) return ['0'.repeat(p + 1), 0];
  let e10 = Math.floor(Math.log10(Math.abs(x)));
  const lowB = (): bigint => 10n ** BigInt(p);
  for (let i = 0; i < 10; i++) {
    const N = scaled(x, p - e10);
    if (N >= lowB() * 10n) e10++;
    else if (N < lowB()) e10--;
    else return [N.toString(), e10];
  }
  throw new Error('exp');
}

function fmtExp(digits: string, e10: number, alt: boolean, upper: boolean): string {
  let s = digits[0];
  if (digits.length > 1) s += '.' + digits.slice(1);
  else if (alt) s += '.';
  const ae = Math.abs(e10);
  s += (upper ? 'E' : 'e') + (e10 < 0 ? '-' : '+') + (ae < 10 ? '0' + ae : String(ae));
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
    for (; i < fmt.length; i++) {
      const c = fmt[i];
      if (c === '-') minus = true;
      else if (c === '+') plus = true;
      else if (c === ' ') space = true;
      else if (c === '0') zero = true;
      else if (c === '#') alt = true;
      else break;
    }
    let w = '';
    while (fmt[i] >= '0' && fmt[i] <= '9') w += fmt[i++];
    const width = w ? parseInt(w, 10) : 0;
    let prec = -1;
    if (fmt[i] === '.') {
      i++;
      let ps = '';
      while (fmt[i] >= '0' && fmt[i] <= '9') ps += fmt[i++];
      prec = ps ? parseInt(ps, 10) : 0;
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
      const mag = neg ? -v : v;
      let digits: string;
      if (conv === 'd' || conv === 'i') {
        digits = mag.toString();
        sign = signFor(neg);
      } else if (conv === 'o') digits = mag.toString(8);
      else {
        digits = mag.toString(16);
        if (conv === 'X') digits = digits.toUpperCase();
      }
      if (prec === 0 && mag === 0n) digits = '';
      if (prec > digits.length) digits = digits.padStart(prec, '0');
      if (conv === 'o' && alt && digits[0] !== '0') digits = '0' + digits;
      if ((conv === 'x' || conv === 'X') && alt && mag !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      body = digits;
      canZero = prec < 0;
    } else {
      const x = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      if (Number.isNaN(x)) {
        body = upper ? 'NAN' : 'nan';
      } else {
        sign = signFor(x < 0 || Object.is(x, -0));
        if (!Number.isFinite(x)) {
          body = upper ? 'INF' : 'inf';
        } else {
          canZero = true;
          const lc = conv.toLowerCase();
          if (lc === 'f') {
            const p = prec < 0 ? 6 : prec;
            const [ip, fp] = fixedParts(x, p);
            body = ip + (p > 0 || alt ? '.' : '') + fp;
          } else if (lc === 'e') {
            const p = prec < 0 ? 6 : prec;
            const [d, e10] = expParts(x, p);
            body = fmtExp(d, e10, alt, upper);
          } else {
            let P = prec < 0 ? 6 : prec;
            if (P === 0) P = 1;
            const [d, X] = expParts(x, P - 1);
            if (P > X && X >= -4) {
              const p = P - 1 - X;
              const [ip, fp0] = fixedParts(x, p);
              let fp = fp0;
              if (!alt) fp = fp.replace(/0+$/, '');
              body = ip + (fp.length > 0 || alt ? '.' : '') + fp;
            } else {
              let m = d[0];
              let f = d.slice(1);
              if (!alt) f = f.replace(/0+$/, '');
              m += f.length > 0 || alt ? '.' + f : '';
              const ae = Math.abs(X);
              body = m + (upper ? 'E' : 'e') + (X < 0 ? '-' : '+') + (ae < 10 ? '0' + ae : String(ae));
            }
          }
        }
      }
      if (!Number.isFinite(x)) canZero = false;
    }

    const len = sign.length + prefix.length + body.length;
    if (len >= width) out += sign + prefix + body;
    else if (minus) out += sign + prefix + body + ' '.repeat(width - len);
    else if (zero && canZero) out += sign + prefix + '0'.repeat(width - len) + body;
    else out += ' '.repeat(width - len) + sign + prefix + body;
  }
  return out;
}
