function scaledRound(x: number, s: number): bigint {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, Math.abs(x));
  const bits = dv.getBigUint64(0);
  const be = Number((bits >> 52n) & 0x7ffn);
  let m = bits & 0xfffffffffffffn;
  let e: number;
  if (be === 0) {
    e = -1074;
  } else {
    m |= 1n << 52n;
    e = be - 1075;
  }
  let num = m;
  let den = 1n;
  if (e >= 0) num <<= BigInt(e);
  else den <<= BigInt(-e);
  if (s >= 0) num *= 10n ** BigInt(s);
  else den *= 10n ** BigInt(-s);
  let q = num / den;
  const r = num % den;
  const twice = r * 2n;
  if (twice > den || (twice === den && (q & 1n) === 1n)) q += 1n;
  return q;
}

function fixed(x: number, p: number): { int: string; frac: string } {
  const str = scaledRound(x, p).toString().padStart(p + 1, '0');
  const cut = str.length - p;
  return { int: str.slice(0, cut), frac: str.slice(cut) };
}

function expo(x: number, p: number): { digits: string; X: number } {
  if (x === 0) return { digits: '0'.repeat(p + 1), X: 0 };
  let X = Math.floor(Math.log10(Math.abs(x)));
  const hi = 10n ** BigInt(p + 1);
  const lo = 10n ** BigInt(p);
  for (let i = 0; i < 10; i++) {
    const n = scaledRound(x, p - X);
    if (n >= hi) X++;
    else if (n < lo) X--;
    else return { digits: n.toString(), X };
  }
  throw new Error('exponent search failed');
}

function expStr(X: number, upper: boolean): string {
  const a = Math.abs(X).toString().padStart(2, '0');
  return (upper ? 'E' : 'e') + (X < 0 ? '-' : '+') + a;
}

function stripZeros(frac: string): string {
  return frac.replace(/0+$/, '');
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
    while (i < fmt.length && fmt[i] >= '0' && fmt[i] <= '9') width = width * 10 + Number(fmt[i++]);
    let prec: number | undefined;
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
    let numeric = true;
    let canZero = true;

    const signFor = (neg: boolean) => (neg ? '-' : plus ? '+' : space ? ' ' : '');

    if (conv === 's' || conv === 'c') {
      numeric = false;
      body = String(arg);
      if (conv === 's' && prec !== undefined) body = body.slice(0, prec);
    } else if (conv === 'd' || conv === 'i') {
      const v = BigInt(arg as number | bigint);
      sign = signFor(v < 0n);
      body = (v < 0n ? -v : v).toString();
      if (prec !== undefined) {
        if (prec === 0 && v === 0n) body = '';
        body = body.padStart(prec, '0');
        canZero = false;
      }
    } else if (conv === 'x' || conv === 'X' || conv === 'o') {
      const v = BigInt(arg as number | bigint);
      body = v.toString(conv === 'o' ? 8 : 16);
      if (conv === 'X') body = body.toUpperCase();
      if (prec !== undefined) {
        if (prec === 0 && v === 0n) body = '';
        body = body.padStart(prec, '0');
        canZero = false;
      }
      if (alt) {
        if (conv === 'o') {
          if (!body.startsWith('0')) body = '0' + body;
        } else if (v !== 0n) {
          prefix = conv === 'x' ? '0x' : '0X';
        }
      }
    } else {
      const x = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      const neg = x < 0 || Object.is(x, -0);
      if (Number.isNaN(x)) {
        body = upper ? 'NAN' : 'nan';
        canZero = false;
      } else if (!Number.isFinite(x)) {
        sign = signFor(neg);
        body = upper ? 'INF' : 'inf';
        canZero = false;
      } else {
        sign = signFor(neg);
        const lc = conv.toLowerCase();
        if (lc === 'f') {
          const p = prec ?? 6;
          const { int, frac } = fixed(x, p);
          body = int + (p > 0 || alt ? '.' : '') + frac;
        } else if (lc === 'e') {
          const p = prec ?? 6;
          const { digits, X } = expo(x, p);
          body = digits[0] + (p > 0 || alt ? '.' : '') + digits.slice(1) + expStr(X, upper);
        } else {
          let P = prec ?? 6;
          if (P === 0) P = 1;
          const { digits, X } = expo(x, P - 1);
          if (P > X && X >= -4) {
            const p = P - 1 - X;
            const { int, frac } = fixed(x, p);
            const fr = alt ? frac : stripZeros(frac);
            body = int + (fr.length > 0 || alt ? '.' : '') + fr;
          } else {
            const frac = digits.slice(1);
            const fr = alt ? frac : stripZeros(frac);
            body = digits[0] + (fr.length > 0 || alt ? '.' : '') + fr + expStr(X, upper);
          }
        }
      }
    }

    const len = sign.length + prefix.length + body.length;
    if (len < width) {
      const pad = width - len;
      if (minus) {
        body = sign + prefix + body + ' '.repeat(pad);
        sign = '';
        prefix = '';
      } else if (numeric && zero && canZero) {
        body = '0'.repeat(pad) + body;
      } else {
        sign = ' '.repeat(pad) + sign;
      }
    }
    out += sign + prefix + body;
  }
  return out;
}
