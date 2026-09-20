const TEN = 10n;

function pow10(k: number): bigint {
  return TEN ** BigInt(k);
}

// exact rational of a finite non-negative double
function toRational(x: number): [bigint, bigint] {
  if (x === 0) return [0n, 1n];
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, x);
  const hi = buf.getUint32(0);
  const lo = buf.getUint32(4);
  const bexp = (hi >>> 20) & 0x7ff;
  let mant = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let e: number;
  if (bexp === 0) {
    e = -1074;
  } else {
    mant |= 1n << 52n;
    e = bexp - 1075;
  }
  return e >= 0 ? [mant << BigInt(e), 1n] : [mant, 1n << BigInt(-e)];
}

function roundDiv(n: bigint, d: bigint): bigint {
  const q = n / d;
  const r2 = (n - q * d) * 2n;
  if (r2 > d || (r2 === d && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// round(v * 10^k) half-even
function scaled(v: [bigint, bigint], k: number): bigint {
  return k >= 0 ? roundDiv(v[0] * pow10(k), v[1]) : roundDiv(v[0], v[1] * pow10(-k));
}

function fixedParts(v: [bigint, bigint], prec: number): [string, string] {
  let s = scaled(v, prec).toString();
  if (s.length < prec + 1) s = '0'.repeat(prec + 1 - s.length) + s;
  return [s.slice(0, s.length - prec), s.slice(s.length - prec)];
}

// returns digit string (prec+1 digits) and exponent
function expParts(v: [bigint, bigint], prec: number): [string, number] {
  if (v[0] === 0n) return ['0'.repeat(prec + 1), 0];
  let X = Math.floor(Math.log10(Number(v[0]) / Number(v[1])));
  if (!isFinite(X)) X = 0;
  // adjust so 10^X <= v < 10^(X+1)
  const ge = (k: number) => (k >= 0 ? v[0] >= v[1] * pow10(k) : v[0] * pow10(-k) >= v[1]);
  while (!ge(X)) X--;
  while (ge(X + 1)) X++;
  let n = scaled(v, prec - X);
  if (n >= pow10(prec + 1)) {
    X++;
    n = scaled(v, prec - X);
  }
  return [n.toString(), X];
}

function fmtExp(digits: string, X: number, prec: number, alt: boolean, upper: boolean): string {
  let s = digits[0];
  if (prec > 0 || alt) s += '.';
  s += digits.slice(1);
  const ax = Math.abs(X);
  s += (upper ? 'E' : 'e') + (X < 0 ? '-' : '+') + (ax < 10 ? '0' + ax : String(ax));
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
    for (; i < fmt.length; i++) {
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
    let canZero = true;
    const signFor = (neg: boolean) => (neg ? '-' : plus ? '+' : space ? ' ' : '');

    switch (conv) {
      case 'd':
      case 'i': {
        const b = BigInt(arg as number | bigint);
        sign = signFor(b < 0n);
        body = (b < 0n ? -b : b).toString();
        if (prec >= 0) {
          canZero = false;
          if (prec === 0 && b === 0n) body = '';
          if (body.length < prec) body = '0'.repeat(prec - body.length) + body;
        }
        break;
      }
      case 'x':
      case 'X':
      case 'o': {
        const b = BigInt(arg as number | bigint);
        body = b.toString(conv === 'o' ? 8 : 16);
        if (conv === 'X') body = body.toUpperCase();
        if (prec >= 0) {
          canZero = false;
          if (prec === 0 && b === 0n) body = '';
          if (body.length < prec) body = '0'.repeat(prec - body.length) + body;
        }
        if (alt) {
          if (conv === 'o') {
            if (body[0] !== '0') body = '0' + body;
          } else if (b !== 0n) prefix = conv === 'x' ? '0x' : '0X';
        }
        break;
      }
      case 'e':
      case 'E':
      case 'f':
      case 'F':
      case 'g':
      case 'G': {
        const x = arg as number;
        const upper = conv === 'E' || conv === 'F' || conv === 'G';
        if (Number.isNaN(x)) {
          body = upper ? 'NAN' : 'nan';
          canZero = false;
          break;
        }
        const neg = x < 0 || Object.is(x, -0);
        sign = signFor(neg);
        if (!isFinite(x)) {
          body = upper ? 'INF' : 'inf';
          canZero = false;
          break;
        }
        const v = toRational(Math.abs(x));
        const lc = conv.toLowerCase();
        if (lc === 'f') {
          const p = prec < 0 ? 6 : prec;
          const [ip, fp] = fixedParts(v, p);
          body = ip + (p > 0 || alt ? '.' : '') + fp;
        } else if (lc === 'e') {
          const p = prec < 0 ? 6 : prec;
          const [d, X] = expParts(v, p);
          body = fmtExp(d, X, p, alt, upper);
        } else {
          let P = prec < 0 ? 6 : prec === 0 ? 1 : prec;
          const [d, X] = expParts(v, P - 1);
          if (P > X && X >= -4) {
            const p = P - 1 - X;
            const [ip, fp] = fixedParts(v, p);
            body = ip + (p > 0 || alt ? '.' : '') + fp;
            if (!alt) body = stripZeros(body);
          } else {
            let m = fmtExp(d, X, P - 1, alt, upper);
            if (!alt) {
              const idx = m.search(/[eE]/);
              m = stripZeros(m.slice(0, idx)) + m.slice(idx);
            }
            body = m;
          }
        }
        break;
      }
      case 's':
        numeric = false;
        body = String(arg);
        if (prec >= 0) body = body.slice(0, prec);
        break;
      case 'c':
        numeric = false;
        body = String(arg);
        break;
    }

    const len = sign.length + prefix.length + body.length;
    if (len >= width) {
      out += sign + prefix + body;
    } else if (minus) {
      out += sign + prefix + body + ' '.repeat(width - len);
    } else if (numeric && zero && canZero) {
      out += sign + prefix + '0'.repeat(width - len) + body;
    } else {
      out += ' '.repeat(width - len) + sign + prefix + body;
    }
  }
  return out;
}
