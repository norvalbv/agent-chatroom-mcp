function decompose(x: number): { m: bigint; e: number } {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const exp = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (exp === 0) return { m, e: -1074 };
  m |= 1n << 52n;
  return { m, e: exp - 1075 };
}

// round(m*2^e*10^s) half-even, as bigint
function scaled(m: bigint, e: number, s: number): bigint {
  let num = m;
  let den = 1n;
  if (e >= 0) num <<= BigInt(e);
  else den <<= BigInt(-e);
  if (s >= 0) num *= 10n ** BigInt(s);
  else den *= 10n ** BigInt(-s);
  let q = num / den;
  const r2 = (num % den) * 2n;
  if (r2 > den || (r2 === den && (q & 1n) === 1n)) q += 1n;
  return q;
}

// abs finite x: fixed style
function fixed(x: number, prec: number): { int: string; frac: string } {
  const { m, e } = decompose(x);
  let s = scaled(m, e, prec).toString();
  if (s.length < prec + 1) s = '0'.repeat(prec + 1 - s.length) + s;
  return { int: s.slice(0, s.length - prec), frac: s.slice(s.length - prec) };
}

// abs finite x: exponent style with p fraction digits
function expo(x: number, p: number): { digits: string; X: number } {
  if (x === 0) return { digits: '0'.repeat(p + 1), X: 0 };
  const { m, e } = decompose(x);
  let X = Math.floor(Math.log10(x));
  if (!isFinite(X)) X = -324;
  for (let i = 0; i < 10; i++) {
    const R = scaled(m, e, p - X);
    const s = R.toString();
    if (s.length > p + 1) X++;
    else if (s.length < p + 1) X--;
    else return { digits: s, X };
  }
  throw new Error('exp');
}

function expStr(digits: string, X: number, alt: boolean, upper: boolean): string {
  const p = digits.length - 1;
  let s = digits[0] + (p > 0 || alt ? '.' : '') + digits.slice(1);
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

    if (conv === 's' || conv === 'c') {
      body = String(arg);
      if (conv === 's' && prec >= 0) body = body.slice(0, prec);
      canZero = false;
    } else if ('dixXo'.includes(conv)) {
      let v = typeof arg === 'bigint' ? arg : BigInt(arg as number);
      const neg = v < 0n;
      if (neg) v = -v;
      sign = neg ? '-' : plus && 'di'.includes(conv) ? '+' : space && 'di'.includes(conv) ? ' ' : '';
      let digits = conv === 'x' ? v.toString(16) : conv === 'X' ? v.toString(16).toUpperCase() : conv === 'o' ? v.toString(8) : v.toString();
      if (prec === 0 && v === 0n) digits = '';
      if (prec > digits.length) digits = '0'.repeat(prec - digits.length) + digits;
      if (alt) {
        if (conv === 'o') {
          if (digits[0] !== '0') digits = '0' + digits;
        } else if ((conv === 'x' || conv === 'X') && v !== 0n) {
          prefix = conv === 'x' ? '0x' : '0X';
        }
      }
      body = digits;
      if (prec >= 0) canZero = false;
    } else {
      const x = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      const neg = x < 0 || Object.is(x, -0);
      if (Number.isNaN(x)) {
        body = upper ? 'NAN' : 'nan';
        canZero = false;
      } else {
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        const ax = Math.abs(x);
        if (ax === Infinity) {
          body = upper ? 'INF' : 'inf';
          canZero = false;
        } else if (conv === 'f' || conv === 'F') {
          const p = prec < 0 ? 6 : prec;
          const { int, frac } = fixed(ax, p);
          body = int + (p > 0 || alt ? '.' : '') + frac;
        } else if (conv === 'e' || conv === 'E') {
          const p = prec < 0 ? 6 : prec;
          const { digits, X } = expo(ax, p);
          body = expStr(digits, X, alt, upper);
        } else {
          const P = prec < 0 ? 6 : prec === 0 ? 1 : prec;
          const { digits, X } = expo(ax, P - 1);
          if (P > X && X >= -4) {
            const p = P - 1 - X;
            const { int, frac } = fixed(ax, p);
            body = int + (p > 0 || alt ? '.' : '') + frac;
            if (!alt) body = stripZeros(body);
          } else {
            let d = digits;
            if (!alt) d = stripZeros(d[0] + '.' + d.slice(1)).replace('.', '');
            body = expStr(d, X, alt, upper);
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
