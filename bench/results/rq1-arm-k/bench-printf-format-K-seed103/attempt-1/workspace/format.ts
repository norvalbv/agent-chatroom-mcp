const buf = new DataView(new ArrayBuffer(8));

// |x| as num/den exactly (den is a power of two); x finite, nonzero or zero.
function toRatio(x: number): [bigint, bigint] {
  buf.setFloat64(0, Math.abs(x));
  const hi = buf.getUint32(0);
  const lo = buf.getUint32(4);
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

function roundDiv(n: bigint, d: bigint): bigint {
  const q = n / d;
  const r2 = (n % d) * 2n;
  if (r2 > d || (r2 === d && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// round(v * 10^s) half-even
function scaled(r: [bigint, bigint], s: number): bigint {
  let [n, d] = r;
  if (s >= 0) n *= 10n ** BigInt(s);
  else d *= 10n ** BigInt(-s);
  return roundDiv(n, d);
}

// e-style digits: p+1 digits and exponent
function expDigits(x: number, p: number): [string, number] {
  if (x === 0) return ['0'.repeat(p + 1), 0];
  const r = toRatio(x);
  let X = Math.floor(Math.log10(Math.abs(x)));
  if (!Number.isFinite(X)) X = -324;
  const lo = 10n ** BigInt(p);
  const hi = lo * 10n;
  for (;;) {
    const q = scaled(r, p - X);
    if (q < lo) X--;
    else if (q >= hi) X++;
    else return [q.toString(), X];
  }
}

function fixedDigits(x: number, p: number): string {
  const q = scaled(toRatio(x), p).toString();
  return q.padStart(p + 1, '0');
}

function fmtExp(digits: string, X: number, alt: boolean, upper: boolean): string {
  let s = digits[0];
  if (digits.length > 1 || alt) s += '.' + digits.slice(1);
  const ax = Math.abs(X);
  return s + (upper ? 'E' : 'e') + (X < 0 ? '-' : '+') + (ax < 10 ? '0' : '') + ax;
}

function fmtFixed(x: number, p: number, alt: boolean): string {
  const d = fixedDigits(x, p);
  const ip = d.slice(0, d.length - p);
  return p > 0 ? ip + '.' + d.slice(d.length - p) : ip + (alt ? '.' : '');
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
    let zeroOk = true;
    let text: string | null = null;

    if (conv === 's' || conv === 'c') {
      let s = String(arg);
      if (conv === 's' && prec >= 0) s = s.slice(0, prec);
      text = s;
    } else if ('dixXo'.includes(conv)) {
      const v = BigInt(arg as number | bigint);
      const neg = v < 0n;
      const mag = neg ? -v : v;
      let digits = conv === 'd' || conv === 'i' ? mag.toString()
        : conv === 'o' ? mag.toString(8)
        : mag.toString(16);
      if (conv === 'X') digits = digits.toUpperCase();
      if (prec >= 0) {
        zeroOk = false;
        if (prec === 0 && mag === 0n) digits = '';
        digits = digits.padStart(prec, '0');
      }
      if (conv === 'd' || conv === 'i') {
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
      } else if (alt) {
        if (conv === 'o') {
          if (digits[0] !== '0') digits = '0' + digits;
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
        if (!Number.isFinite(x)) {
          body = upper ? 'INF' : 'inf';
          zeroOk = false;
        } else {
          const lc = conv.toLowerCase();
          if (lc === 'f') {
            body = fmtFixed(x, prec < 0 ? 6 : prec, alt);
          } else if (lc === 'e') {
            const p = prec < 0 ? 6 : prec;
            const [d, X] = expDigits(x, p);
            body = fmtExp(d, X, alt, upper);
          } else {
            let P = prec < 0 ? 6 : prec;
            if (P === 0) P = 1;
            const [d, X] = expDigits(x, P - 1);
            if (P > X && X >= -4) {
              body = fmtFixed(x, P - 1 - X, alt);
              if (!alt) body = stripZeros(body);
            } else {
              let m = d[0] + (P > 1 || alt ? '.' + d.slice(1) : '');
              if (!alt) m = stripZeros(m);
              const ax = Math.abs(X);
              body = m + (upper ? 'E' : 'e') + (X < 0 ? '-' : '+') + (ax < 10 ? '0' : '') + ax;
            }
          }
        }
      }
    }

    if (text === null) {
      const len = sign.length + prefix.length + body.length;
      if (len < width) {
        if (minus) text = sign + prefix + body + ' '.repeat(width - len);
        else if (zero && zeroOk) text = sign + prefix + '0'.repeat(width - len) + body;
        else text = ' '.repeat(width - len) + sign + prefix + body;
      } else text = sign + prefix + body;
    } else if (text.length < width) {
      text = minus ? text + ' '.repeat(width - text.length) : ' '.repeat(width - text.length) + text;
    }
    out += text;
  }
  return out;
}
