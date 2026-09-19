function roundDiv(n: bigint, d: bigint): bigint {
  const q = n / d;
  const r2 = (n % d) * 2n;
  if (r2 > d) return q + 1n;
  if (r2 === d) return q % 2n === 1n ? q + 1n : q;
  return q;
}

// exact |x| = num/den for finite x
function toRatio(x: number): [bigint, bigint] {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, Math.abs(x));
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const be = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let e: number;
  if (be === 0) e = -1074;
  else {
    m |= 1n << 52n;
    e = be - 1075;
  }
  return e >= 0 ? [m << BigInt(e), 1n] : [m, 1n << BigInt(-e)];
}

// round(num/den * 10^k)
function scaled(num: bigint, den: bigint, k: number): bigint {
  return k >= 0 ? roundDiv(num * 10n ** BigInt(k), den) : roundDiv(num, den * 10n ** BigInt(-k));
}

// e-style digits: returns [digit string of length p+1, exponent]
function eDigits(num: bigint, den: bigint, p: number): [string, number] {
  if (num === 0n) return ['0'.repeat(p + 1), 0];
  // find X with 10^X <= num/den < 10^(X+1)
  let X = Math.floor(Math.log10(Number(num) / Number(den)));
  if (!Number.isFinite(X)) X = 0;
  const ge = (k: number) => (k >= 0 ? num >= den * 10n ** BigInt(k) : num * 10n ** BigInt(-k) >= den);
  while (!ge(X)) X--;
  while (ge(X + 1)) X++;
  let d = scaled(num, den, p - X);
  if (d >= 10n ** BigInt(p + 1)) {
    X++;
    d = scaled(num, den, p - X);
  }
  return [d.toString(), X];
}

function fStyle(num: bigint, den: bigint, p: number, alt: boolean): string {
  let s = scaled(num, den, p).toString();
  if (s.length < p + 1) s = '0'.repeat(p + 1 - s.length) + s;
  const ip = s.slice(0, s.length - p);
  const fp = s.slice(s.length - p);
  return ip + (p > 0 || alt ? '.' : '') + fp;
}

function eStyle(num: bigint, den: bigint, p: number, alt: boolean, upper: boolean): string {
  const [ds, X] = eDigits(num, den, p);
  const ax = Math.abs(X);
  return (
    ds[0] + (p > 0 || alt ? '.' : '') + ds.slice(1) + (upper ? 'E' : 'e') + (X < 0 ? '-' : '+') + (ax < 10 ? '0' : '') + ax
  );
}

function stripZeros(s: string): string {
  // s is mantissa possibly with exponent suffix
  const m = /^([^eE]*)([eE].*)?$/.exec(s)!;
  let a = m[1];
  if (a.includes('.')) a = a.replace(/0+$/, '').replace(/\.$/, '');
  return a + (m[2] ?? '');
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

    let prefix = ''; // sign and 0x
    let body = '';
    let canZero = false;

    const signOf = (neg: boolean) => (neg ? '-' : plus ? '+' : space ? ' ' : '');

    if (conv === 's') {
      body = String(arg);
      if (prec >= 0) body = body.slice(0, prec);
    } else if (conv === 'c') {
      body = String(arg);
    } else if ('dixXo'.includes(conv)) {
      const v = BigInt(arg as number | bigint);
      const neg = v < 0n;
      const mag = neg ? -v : v;
      let digits = conv === 'd' || conv === 'i' ? mag.toString() : conv === 'o' ? mag.toString(8) : mag.toString(16);
      if (conv === 'X') digits = digits.toUpperCase();
      if (prec === 0 && mag === 0n) digits = '';
      if (prec >= 0 && digits.length < prec) digits = '0'.repeat(prec - digits.length) + digits;
      if (conv === 'o' && alt && !digits.startsWith('0')) digits = '0' + digits;
      prefix = conv === 'd' || conv === 'i' ? signOf(neg) : '';
      if ((conv === 'x' || conv === 'X') && alt && mag !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      body = digits;
      canZero = prec < 0;
    } else {
      const x = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      const neg = x < 0 || Object.is(x, -0);
      if (Number.isNaN(x)) {
        body = upper ? 'NAN' : 'nan';
      } else if (!Number.isFinite(x)) {
        prefix = signOf(neg);
        body = upper ? 'INF' : 'inf';
      } else {
        prefix = signOf(neg);
        canZero = true;
        const [num, den] = toRatio(x);
        const lc = conv.toLowerCase();
        if (lc === 'f') {
          body = fStyle(num, den, prec < 0 ? 6 : prec, alt);
        } else if (lc === 'e') {
          body = eStyle(num, den, prec < 0 ? 6 : prec, alt, upper);
        } else {
          let P = prec < 0 ? 6 : prec;
          if (P === 0) P = 1;
          const X = eDigits(num, den, P - 1)[1];
          if (P > X && X >= -4) body = fStyle(num, den, P - 1 - X, alt);
          else body = eStyle(num, den, P - 1, alt, upper);
          if (!alt) body = stripZeros(body);
        }
      }
    }

    const len = prefix.length + body.length;
    if (len < width) {
      const pad = width - len;
      if (minus) body = prefix + body + ' '.repeat(pad);
      else if (zero && canZero) body = prefix + '0'.repeat(pad) + body;
      else body = ' '.repeat(pad) + prefix + body;
    } else body = prefix + body;
    out += body;
  }
  return out;
}
