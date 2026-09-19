function decompose(x: number): [bigint, bigint] {
  // x >= 0 finite; returns [num, den] exactly
  if (x === 0) return [0n, 1n];
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, x);
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

function roundDiv(n: bigint, d: bigint): bigint {
  const q = n / d;
  const r2 = (n % d) * 2n;
  if (r2 > d || (r2 === d && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// round(v * 10^k) half-even
function scaled(num: bigint, den: bigint, k: number): bigint {
  return k >= 0 ? roundDiv(num * 10n ** BigInt(k), den) : roundDiv(num, den * 10n ** BigInt(-k));
}

function fixedStr(x: number, p: number, alt: boolean): string {
  const [n, d] = decompose(x);
  let s = scaled(n, d, p).toString();
  if (p > 0) {
    s = s.padStart(p + 1, '0');
    return s.slice(0, s.length - p) + '.' + s.slice(s.length - p);
  }
  return alt ? s + '.' : s;
}

// returns digits (p+1 digits) and exponent
function expParts(x: number, p: number): [string, number] {
  if (x === 0) return ['0'.repeat(p + 1), 0];
  const [n, d] = decompose(x);
  let X = Math.floor(Math.log10(x));
  if (!isFinite(X)) X = -324;
  const ge = (k: number) => (k >= 0 ? n >= d * 10n ** BigInt(k) : n * 10n ** BigInt(-k) >= d); // v >= 10^k
  while (!ge(X)) X--;
  while (ge(X + 1)) X++;
  let q = scaled(n, d, p - X);
  if (q >= 10n ** BigInt(p + 1)) {
    X++;
    q = scaled(n, d, p - X);
  }
  return [q.toString(), X];
}

function expStr(digits: string, X: number, upper: boolean, alt: boolean): string {
  const p = digits.length - 1;
  let s = digits[0] + (p > 0 ? '.' + digits.slice(1) : alt ? '.' : '');
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
    while (i < fmt.length && fmt[i] >= '0' && fmt[i] <= '9') width = width * 10 + +fmt[i++];
    let prec = -1;
    if (fmt[i] === '.') {
      i++;
      prec = 0;
      while (i < fmt.length && fmt[i] >= '0' && fmt[i] <= '9') prec = prec * 10 + +fmt[i++];
    }
    const conv = fmt[i++];
    const arg = args[ai++];
    let sign = '';
    let prefix = '';
    let body = '';
    let canZero = true;
    const signFor = (neg: boolean) => (neg ? '-' : plus ? '+' : space ? ' ' : '');
    switch (conv) {
      case 'd':
      case 'i': {
        const b = BigInt(arg as number | bigint);
        sign = signFor(b < 0n);
        body = (b < 0n ? -b : b).toString();
        if (prec >= 0) {
          if (prec === 0 && b === 0n) body = '';
          body = body.padStart(prec, '0');
          canZero = false;
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
          if (prec === 0 && b === 0n) body = '';
          body = body.padStart(prec, '0');
          canZero = false;
        }
        if (alt) {
          if (conv === 'o') {
            if (body[0] !== '0') body = '0' + body;
          } else if (b !== 0n) prefix = conv === 'x' ? '0x' : '0X';
        }
        break;
      }
      case 'e': case 'E': case 'f': case 'F': case 'g': case 'G': {
        const x = arg as number;
        const upper = conv === 'E' || conv === 'F' || conv === 'G';
        const neg = x < 0 || Object.is(x, -0);
        if (Number.isNaN(x)) {
          body = upper ? 'NAN' : 'nan';
          canZero = false;
        } else {
          sign = signFor(neg);
          const ax = Math.abs(x);
          if (!isFinite(ax)) {
            body = upper ? 'INF' : 'inf';
            canZero = false;
          } else if (conv === 'f' || conv === 'F') {
            body = fixedStr(ax, prec < 0 ? 6 : prec, alt);
          } else if (conv === 'e' || conv === 'E') {
            const [dg, X] = expParts(ax, prec < 0 ? 6 : prec);
            body = expStr(dg, X, upper, alt);
          } else {
            let P = prec < 0 ? 6 : prec;
            if (P === 0) P = 1;
            const [dg, X] = expParts(ax, P - 1);
            if (P > X && X >= -4) {
              body = fixedStr(ax, P - 1 - X, alt);
              if (!alt && body.includes('.')) body = body.replace(/0+$/, '').replace(/\.$/, '');
            } else {
              let d2 = dg;
              if (!alt) d2 = d2[0] + d2.slice(1).replace(/0+$/, '');
              body = expStr(d2, X, upper, alt);
            }
          }
        }
        break;
      }
      case 's':
        body = String(arg);
        if (prec >= 0) body = body.slice(0, prec);
        canZero = false;
        break;
      case 'c':
        body = String(arg);
        canZero = false;
        break;
    }
    const len = sign.length + prefix.length + body.length;
    if (len < width) {
      const pad = width - len;
      if (minus) body = sign + prefix + body + ' '.repeat(pad);
      else if (zero && canZero) body = sign + prefix + '0'.repeat(pad) + body;
      else body = ' '.repeat(pad) + sign + prefix + body;
    } else body = sign + prefix + body;
    out += body;
  }
  return out;
}
