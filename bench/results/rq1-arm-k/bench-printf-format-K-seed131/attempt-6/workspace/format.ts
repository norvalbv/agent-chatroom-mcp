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

// round(|x| * 10^s) to integer, half-even, exactly
function scaledRound(m: bigint, e: number, s: number): bigint {
  let num = m;
  let den = 1n;
  if (e >= 0) num <<= BigInt(e);
  else den <<= BigInt(-e);
  if (s >= 0) num *= 10n ** BigInt(s);
  else den *= 10n ** BigInt(-s);
  const q = num / den;
  const r2 = (num - q * den) * 2n;
  if (r2 > den || (r2 === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

function fixedDigits(a: number, prec: number): { int: string; frac: string } {
  if (a === 0) return { int: '0', frac: '0'.repeat(prec) };
  const { m, e } = decompose(a);
  let s = scaledRound(m, e, prec).toString();
  if (s.length <= prec) s = '0'.repeat(prec - s.length + 1) + s;
  return { int: s.slice(0, s.length - prec), frac: s.slice(s.length - prec) };
}

function expDigits(a: number, prec: number): { digits: string; X: number } {
  if (a === 0) return { digits: '0'.repeat(prec + 1), X: 0 };
  const { m, e } = decompose(a);
  let X = Math.floor(Math.log10(a));
  if (!isFinite(X)) X = -324;
  for (let i = 0; i < 6; i++) {
    const s = scaledRound(m, e, prec - X).toString();
    if (s.length > prec + 1) X++;
    else if (s.length < prec + 1) X--;
    else return { digits: s, X };
  }
  throw new Error('exp');
}

function fmtExp(digits: string, X: number, prec: number, alt: boolean, upper: boolean): string {
  let s = digits[0];
  if (prec > 0 || alt) s += '.';
  s += digits.slice(1);
  const ax = Math.abs(X);
  s += (upper ? 'E' : 'e') + (X < 0 ? '-' : '+') + (ax < 10 ? '0' : '') + ax;
  return s;
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

    const lower = conv.toLowerCase();
    if (conv === 's') {
      body = String(arg);
      if (prec >= 0) body = body.slice(0, prec);
      canZero = false;
    } else if (conv === 'c') {
      body = String(arg);
      canZero = false;
    } else if (conv === 'd' || conv === 'i' || conv === 'x' || conv === 'X' || conv === 'o') {
      const v = BigInt(arg as number | bigint);
      const neg = v < 0n;
      const mag = neg ? -v : v;
      let digits = conv === 'd' || conv === 'i' ? mag.toString() : conv === 'o' ? mag.toString(8) : mag.toString(16);
      if (conv === 'X') digits = digits.toUpperCase();
      if (prec >= 0) {
        if (prec === 0 && mag === 0n) digits = '';
        if (digits.length < prec) digits = '0'.repeat(prec - digits.length) + digits;
        canZero = false;
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
      const v = arg as number;
      const upper = conv === conv.toUpperCase();
      const neg = v < 0 || Object.is(v, -0);
      if (Number.isNaN(v)) {
        body = upper ? 'NAN' : 'nan';
        canZero = false;
      } else {
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        const a = Math.abs(v);
        if (a === Infinity) {
          body = upper ? 'INF' : 'inf';
          canZero = false;
        } else if (lower === 'f') {
          const p = prec < 0 ? 6 : prec;
          const { int, frac } = fixedDigits(a, p);
          body = int + (p > 0 || alt ? '.' : '') + frac;
        } else if (lower === 'e') {
          const p = prec < 0 ? 6 : prec;
          const { digits, X } = expDigits(a, p);
          body = fmtExp(digits, X, p, alt, upper);
        } else {
          const P = prec < 0 ? 6 : prec === 0 ? 1 : prec;
          const { digits, X } = expDigits(a, P - 1);
          if (P > X && X >= -4) {
            const p = P - 1 - X;
            const { int, frac } = fixedDigits(a, p);
            let fr = frac;
            if (!alt) fr = fr.replace(/0+$/, '');
            body = int + (fr.length > 0 || alt ? '.' : '') + fr;
          } else {
            let d = digits;
            if (!alt) d = d[0] + d.slice(1).replace(/0+$/, '');
            body = fmtExp(d, X, d.length - 1, alt, upper);
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
