// Exact decimal representation of a finite positive double: value = n / 10^k.
function decompose(x: number): { n: bigint; k: number } {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let e: number;
  if (expBits === 0) {
    e = -1074;
  } else {
    m |= 1n << 52n;
    e = expBits - 1075;
  }
  if (e >= 0) return { n: m << BigInt(e), k: 0 };
  const k = -e;
  return { n: m * 5n ** BigInt(k), k };
}

// Divide by 10^d (d > 0) rounding half to even.
function divRound(n: bigint, d: number): bigint {
  const p = 10n ** BigInt(d);
  const q = n / p;
  const r = n % p;
  const twice = r * 2n;
  if (twice > p || (twice === p && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// Digits of |x| rounded to p fractional digits, as {int, frac}.
function fixedParts(x: number, p: number): { int: string; frac: string } {
  let scaled: bigint;
  if (x === 0) {
    scaled = 0n;
  } else {
    const { n, k } = decompose(x);
    scaled = p >= k ? n * 10n ** BigInt(p - k) : divRound(n, k - p);
  }
  let s = scaled.toString();
  if (p > 0) {
    if (s.length <= p) s = '0'.repeat(p - s.length + 1) + s;
    return { int: s.slice(0, s.length - p), frac: s.slice(s.length - p) };
  }
  return { int: s, frac: '' };
}

// p+1 significant digits of |x| and decimal exponent.
function sciParts(x: number, p: number): { digits: string; exp: number } {
  if (x === 0) return { digits: '0'.repeat(p + 1), exp: 0 };
  const { n, k } = decompose(x);
  let s = n.toString();
  let exp = s.length - 1 - k;
  if (s.length > p + 1) {
    const r = divRound(n, s.length - p - 1);
    s = r.toString();
    if (s.length > p + 1) {
      s = s.slice(0, p + 1);
      exp++;
    }
  } else {
    s = s + '0'.repeat(p + 1 - s.length);
  }
  return { digits: s, exp };
}

function expText(exp: number, upper: boolean): string {
  const a = Math.abs(exp);
  return (upper ? 'E' : 'e') + (exp < 0 ? '-' : '+') + (a < 10 ? '0' + a : String(a));
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let ai = 0;
  const re = /%(?:(%)|([-+ 0#]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc]))/g;
  return fmt.replace(re, (_m, pct, flags: string, w: string, pr: string | undefined, conv: string) => {
    if (pct) return '%';
    const left = flags.includes('-');
    const plus = flags.includes('+');
    const space = flags.includes(' ');
    const zero = flags.includes('0') && !left;
    const alt = flags.includes('#');
    const width = w ? parseInt(w, 10) : 0;
    const prec: number | undefined = pr === undefined ? undefined : pr === '' ? 0 : parseInt(pr, 10);
    const arg = args[ai++];

    const pad = (sign: string, digits: string, allowZero: boolean): string => {
      const len = sign.length + digits.length;
      if (len >= width) return sign + digits;
      if (left) return sign + digits + ' '.repeat(width - len);
      if (zero && allowZero) return sign + '0'.repeat(width - len) + digits;
      return ' '.repeat(width - len) + sign + digits;
    };

    if (conv === 's' || conv === 'c') {
      let s = String(arg);
      if (conv === 's' && prec !== undefined) s = s.slice(0, prec);
      return pad('', s, false);
    }

    if ('diouxX'.includes(conv)) {
      const v = BigInt(arg as number | bigint);
      const neg = v < 0n;
      const mag = neg ? -v : v;
      let sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
      if (conv === 'x' || conv === 'X' || conv === 'o') sign = '';
      let digits: string;
      if (conv === 'o') digits = mag.toString(8);
      else if (conv === 'x') digits = mag.toString(16);
      else if (conv === 'X') digits = mag.toString(16).toUpperCase();
      else digits = mag.toString();
      if (prec !== undefined) {
        if (prec === 0 && mag === 0n) digits = '';
        else if (digits.length < prec) digits = '0'.repeat(prec - digits.length) + digits;
      }
      let prefix = '';
      if (alt) {
        if (conv === 'o') {
          if (!digits.startsWith('0')) digits = '0' + digits;
        } else if ((conv === 'x' || conv === 'X') && mag !== 0n) {
          prefix = conv === 'x' ? '0x' : '0X';
        }
      }
      return pad(sign + prefix, digits, prec === undefined);
    }

    // floating point
    const x = arg as number;
    const upper = conv === 'E' || conv === 'F' || conv === 'G';
    if (Number.isNaN(x)) return pad('', upper ? 'NAN' : 'nan', false);
    const negative = x < 0 || Object.is(x, -0);
    const sign = negative ? '-' : plus ? '+' : space ? ' ' : '';
    if (!Number.isFinite(x)) return pad(sign, upper ? 'INF' : 'inf', false);
    const ax = Math.abs(x);
    const lc = conv.toLowerCase();

    const fixedText = (p: number, strip: boolean): string => {
      const { int, frac } = fixedParts(ax, p);
      let f = frac;
      if (strip) f = f.replace(/0+$/, '');
      return int + (f.length > 0 || (alt && !strip) || (alt && p === 0) ? '.' + f : '');
    };
    const sciText = (p: number, strip: boolean): string => {
      const { digits, exp } = sciParts(ax, p);
      let f = digits.slice(1);
      if (strip) f = f.replace(/0+$/, '');
      return digits[0] + (f.length > 0 || alt ? '.' + f : '') + expText(exp, upper);
    };

    let body: string;
    if (lc === 'f') {
      body = fixedText(prec ?? 6, false);
    } else if (lc === 'e') {
      body = sciText(prec ?? 6, false);
    } else {
      let P = prec ?? 6;
      if (P === 0) P = 1;
      const X = sciParts(ax, P - 1).exp;
      if (P > X && X >= -4) body = fixedText(P - 1 - X, !alt);
      else body = sciText(P - 1, !alt);
    }
    return pad(sign, body, true);
  });
}
