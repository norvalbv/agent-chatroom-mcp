function roundDiv(n: bigint, d: bigint): bigint {
  const q = n / d;
  const r2 = (n % d) * 2n;
  if (r2 > d || (r2 === d && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// |x| = m * 2^e exactly
function decompose(x: number): { m: bigint; e: number } {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, Math.abs(x));
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const ex = (hi >>> 20) & 0x7ff;
  const frac = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (ex === 0) return { m: frac, e: -1074 };
  return { m: frac | (1n << 52n), e: ex - 1075 };
}

// round(|x| * 10^k) half-even
function scaled(v: { m: bigint; e: number }, k: number): bigint {
  let n = v.m;
  let d = 1n;
  if (v.e >= 0) n <<= BigInt(v.e);
  else d <<= BigInt(-v.e);
  if (k >= 0) n *= 10n ** BigInt(k);
  else d *= 10n ** BigInt(-k);
  return roundDiv(n, d);
}

function fixedStr(v: { m: bigint; e: number }, p: number, alt: boolean): string {
  let s = scaled(v, p).toString();
  if (p > 0) {
    s = s.padStart(p + 1, '0');
    return s.slice(0, s.length - p) + '.' + s.slice(s.length - p);
  }
  return alt ? s + '.' : s;
}

function sciParts(x: number, v: { m: bigint; e: number }, p: number): { digits: string; X: number } {
  if (v.m === 0n) return { digits: '0'.repeat(p + 1), X: 0 };
  let X = Math.floor(Math.log10(Math.abs(x)));
  if (!isFinite(X)) X = -324;
  const hi = 10n ** BigInt(p + 1);
  const lo = 10n ** BigInt(p);
  for (;;) {
    const q = scaled(v, p - X);
    if (q >= hi) X++;
    else if (q < lo) X--;
    else return { digits: q.toString(), X };
  }
}

function sciStr(x: number, v: { m: bigint; e: number }, p: number, alt: boolean): string {
  const { digits, X } = sciParts(x, v, p);
  let s = digits[0];
  if (p > 0) s += '.' + digits.slice(1);
  else if (alt) s += '.';
  const ax = Math.abs(X);
  return s + 'e' + (X < 0 ? '-' : '+') + (ax < 10 ? '0' : '') + ax;
}

function stripZeros(s: string): string {
  const ei = s.indexOf('e');
  let mant = ei >= 0 ? s.slice(0, ei) : s;
  const rest = ei >= 0 ? s.slice(ei) : '';
  if (mant.includes('.')) mant = mant.replace(/0+$/, '').replace(/\.$/, '');
  return mant + rest;
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let ai = 0;
  const re = /%([-+ 0#]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc%])/g;
  return fmt.replace(re, (_m, flags: string, w: string, pr: string | undefined, conv: string) => {
    if (conv === '%') return '%';
    const left = flags.includes('-');
    const plus = flags.includes('+');
    const space = flags.includes(' ');
    const zero = flags.includes('0');
    const alt = flags.includes('#');
    const width = w ? parseInt(w, 10) : 0;
    const hasPrec = pr !== undefined;
    const prec = hasPrec ? (pr === '' ? 0 : parseInt(pr as string, 10)) : -1;
    const arg = args[ai++];

    let sign = '';
    let prefix = '';
    let body: string;
    let canZero = zero && !left;

    if (conv === 's' || conv === 'c') {
      body = String(arg);
      if (conv === 's' && hasPrec) body = body.slice(0, prec);
      canZero = false;
    } else if ('dixXo'.includes(conv)) {
      let n = typeof arg === 'bigint' ? arg : BigInt(arg as number);
      if (n < 0n) {
        sign = '-';
        n = -n;
      } else sign = plus ? '+' : space ? ' ' : '';
      const nonzero = n !== 0n;
      let digits = conv === 'x' ? n.toString(16) : conv === 'X' ? n.toString(16).toUpperCase() : conv === 'o' ? n.toString(8) : n.toString();
      if (hasPrec) {
        if (prec === 0 && !nonzero) digits = '';
        digits = digits.padStart(prec, '0');
        canZero = false;
      }
      if (alt) {
        if (conv === 'o') {
          if (digits[0] !== '0') digits = '0' + digits;
        } else if ((conv === 'x' || conv === 'X') && nonzero) prefix = conv === 'x' ? '0x' : '0X';
      }
      body = digits;
    } else {
      const x = arg as number;
      const neg = x < 0 || Object.is(x, -0);
      const lower = conv.toLowerCase();
      if (Number.isNaN(x)) {
        sign = '';
        body = 'nan';
        canZero = false;
      } else {
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        if (!isFinite(x)) {
          body = 'inf';
          canZero = false;
        } else {
          const v = decompose(x);
          const p = hasPrec ? prec : 6;
          if (lower === 'f') body = fixedStr(v, p, alt);
          else if (lower === 'e') body = sciStr(x, v, p, alt);
          else {
            const P = p === 0 ? 1 : p;
            const { X } = sciParts(x, v, P - 1);
            if (P > X && X >= -4) body = fixedStr(v, P - 1 - X, alt);
            else body = sciStr(x, v, P - 1, alt);
            if (!alt) body = stripZeros(body);
          }
        }
      }
      if (conv === conv.toUpperCase()) body = body.toUpperCase();
    }

    const len = sign.length + prefix.length + body.length;
    if (len >= width) return sign + prefix + body;
    const pad = width - len;
    if (left) return sign + prefix + body + ' '.repeat(pad);
    if (canZero) return sign + prefix + '0'.repeat(pad) + body;
    return ' '.repeat(pad) + sign + prefix + body;
  });
}
