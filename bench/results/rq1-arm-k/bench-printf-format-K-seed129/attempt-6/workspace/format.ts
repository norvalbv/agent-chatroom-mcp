// Exact rational |v| = num / den for a finite double.
function toRational(v: number): [bigint, bigint] {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, Math.abs(v));
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  let mant = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let e: number;
  if (expBits === 0) {
    e = -1074;
  } else {
    mant |= 1n << 52n;
    e = expBits - 1075;
  }
  return e >= 0 ? [mant << BigInt(e), 1n] : [mant, 1n << BigInt(-e)];
}

function scale(r: [bigint, bigint], k: number): [bigint, bigint] {
  return k >= 0 ? [r[0] * 10n ** BigInt(k), r[1]] : [r[0], r[1] * 10n ** BigInt(-k)];
}

// round half to even of num/den
function roundDiv(num: bigint, den: bigint): bigint {
  let q = num / den;
  const rem2 = (num - q * den) * 2n;
  if (rem2 > den || (rem2 === den && (q & 1n) === 1n)) q += 1n;
  return q;
}

// round(|v| * 10^p)
function fixedInt(r: [bigint, bigint], p: number): bigint {
  const [n, d] = scale(r, p);
  return roundDiv(n, d);
}

// digits and exponent for e style with p digits after the point
function expDigits(v: number, p: number): [string, number] {
  if (v === 0) return ['0'.repeat(p + 1), 0];
  const r = toRational(v);
  let x = Math.floor(Math.log10(Math.abs(v)));
  if (!Number.isFinite(x)) x = -324;
  const lt = (k: number) => {
    const [n, d] = scale(r, -k);
    return n < d; // value < 10^k
  };
  while (lt(x)) x--;
  while (!lt(x + 1)) x++;
  let N = fixedInt(r, p - x);
  if (N >= 10n ** BigInt(p + 1)) {
    x++;
    N = fixedInt(r, p - x);
  }
  return [N.toString(), x];
}

function fmtE(v: number, p: number, alt: boolean, upper: boolean): string {
  const [ds, x] = expDigits(v, p);
  let s = ds[0] + (p > 0 || alt ? '.' : '') + ds.slice(1);
  const ax = Math.abs(x);
  s += (upper ? 'E' : 'e') + (x < 0 ? '-' : '+') + (ax < 10 ? '0' : '') + ax;
  return s;
}

function fmtF(v: number, p: number, alt: boolean): string {
  let s = fixedInt(toRational(v), p).toString();
  if (p > 0) {
    s = s.padStart(p + 1, '0');
    s = s.slice(0, s.length - p) + '.' + s.slice(s.length - p);
  } else if (alt) s += '.';
  return s;
}

function stripZeros(s: string): string {
  const ei = s.search(/[eE]/);
  let mant = ei >= 0 ? s.slice(0, ei) : s;
  const tail = ei >= 0 ? s.slice(ei) : '';
  if (mant.includes('.')) mant = mant.replace(/0+$/, '').replace(/\.$/, '');
  return mant + tail;
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let ai = 0;
  return fmt.replace(
    /%([-+ 0#]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc%])/g,
    (_m, flags: string, w: string, pr: string | undefined, conv: string) => {
      if (conv === '%') return '%';
      const arg = args[ai++];
      const left = flags.includes('-');
      const plus = flags.includes('+');
      const space = flags.includes(' ');
      const zero = flags.includes('0') && !left;
      const alt = flags.includes('#');
      const width = w ? parseInt(w, 10) : 0;
      const hasPrec = pr !== undefined;
      const prec = hasPrec ? (pr === '' ? 0 : parseInt(pr, 10)) : -1;

      const pad = (sign: string, body: string, zeroOk: boolean): string => {
        const len = sign.length + body.length;
        if (len >= width) return sign + body;
        const fill = width - len;
        if (left) return sign + body + ' '.repeat(fill);
        if (zero && zeroOk) return sign + '0'.repeat(fill) + body;
        return ' '.repeat(fill) + sign + body;
      };

      if (conv === 's' || conv === 'c') {
        let s = String(arg);
        if (conv === 's' && hasPrec) s = s.slice(0, prec);
        return pad('', s, false);
      }

      if (conv === 'd' || conv === 'i') {
        const b = BigInt(arg as number | bigint);
        const neg = b < 0n;
        let digits = (neg ? -b : b).toString();
        if (hasPrec) {
          if (prec === 0 && b === 0n) digits = '';
          digits = digits.padStart(prec, '0');
        }
        const sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        return pad(sign, digits, !hasPrec);
      }

      if (conv === 'x' || conv === 'X' || conv === 'o') {
        const b = BigInt(arg as number | bigint);
        let digits = b.toString(conv === 'o' ? 8 : 16);
        if (conv === 'X') digits = digits.toUpperCase();
        if (hasPrec) {
          if (prec === 0 && b === 0n) digits = '';
          digits = digits.padStart(prec, '0');
        }
        let prefix = '';
        if (alt) {
          if (conv === 'o') {
            if (!digits.startsWith('0')) digits = '0' + digits;
          } else if (b !== 0n) prefix = conv === 'x' ? '0x' : '0X';
        }
        return pad(prefix, digits, !hasPrec);
      }

      // floating point
      const v = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      if (Number.isNaN(v)) return pad('', upper ? 'NAN' : 'nan', false);
      const neg = v < 0 || Object.is(v, -0);
      const sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
      if (!Number.isFinite(v)) return pad(sign, upper ? 'INF' : 'inf', false);
      const p = hasPrec ? prec : 6;
      let body: string;
      const lc = conv.toLowerCase();
      if (lc === 'e') body = fmtE(v, p, alt, upper);
      else if (lc === 'f') body = fmtF(v, p, alt);
      else {
        const P = p === 0 ? 1 : p;
        const [, X] = expDigits(v, P - 1);
        body =
          P > X && X >= -4 ? fmtF(v, P - 1 - X, alt) : fmtE(v, P - 1, alt, upper);
        if (!alt) body = stripZeros(body);
      }
      return pad(sign, body, true);
    },
  );
}
