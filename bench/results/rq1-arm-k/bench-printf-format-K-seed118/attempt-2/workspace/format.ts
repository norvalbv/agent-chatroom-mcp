// Exact |x| as num/den (den a power of two).
function exact(x: number): { num: bigint; den: bigint } {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, Math.abs(x));
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const bexp = (hi >>> 20) & 0x7ff;
  let mant = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let e: number;
  if (bexp === 0) {
    e = -1074;
  } else {
    mant |= 1n << 52n;
    e = bexp - 1075;
  }
  return e >= 0 ? { num: mant << BigInt(e), den: 1n } : { num: mant, den: 1n << BigInt(-e) };
}

function roundDiv(n: bigint, d: bigint): bigint {
  const q = n / d;
  const r = n % d;
  const twice = r * 2n;
  if (twice > d || (twice === d && (q & 1n) === 1n)) return q + 1n;
  return q;
}

const pow10 = (k: number): bigint => 10n ** BigInt(k);

// round(|x| * 10^p) as integer
function scaled(x: number, p: number): bigint {
  const { num, den } = exact(x);
  return p >= 0 ? roundDiv(num * pow10(p), den) : roundDiv(num, den * pow10(-p));
}

function fixedDigits(x: number, p: number, alt: boolean): string {
  let s = scaled(x, p).toString();
  if (p > 0) {
    s = s.padStart(p + 1, '0');
    return s.slice(0, s.length - p) + '.' + s.slice(s.length - p);
  }
  return alt ? s + '.' : s;
}

// returns mantissa digits string (p+1 digits) and decimal exponent
function sciParts(x: number, p: number): { digits: string; exp: number } {
  if (x === 0 || Object.is(x, -0)) return { digits: '0'.repeat(p + 1), exp: 0 };
  const { num, den } = exact(x);
  let e = Math.floor(Math.log10(Math.abs(x)));
  if (!isFinite(e)) e = -324;
  const ge = (k: number) => (k >= 0 ? num >= den * pow10(k) : num * pow10(-k) >= den);
  while (!ge(e)) e--;
  while (ge(e + 1)) e++;
  let d = scaled(x, p - e);
  if (d >= pow10(p + 1)) {
    e++;
    d = scaled(x, p - e);
  }
  return { digits: d.toString(), exp: e };
}

function sciString(digits: string, exp: number, p: number, alt: boolean, upper: boolean): string {
  let m = digits[0];
  if (p > 0) m += '.' + digits.slice(1);
  else if (alt) m += '.';
  const a = Math.abs(exp);
  return m + (upper ? 'E' : 'e') + (exp < 0 ? '-' : '+') + (a < 10 ? '0' + a : String(a));
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let ai = 0;
  const re = /%(?:(%)|([-+ 0#]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc]))/g;
  return fmt.replace(re, (_m, pct, flags: string, w: string, prec: string | undefined, conv: string) => {
    if (pct) return '%';
    const arg = args[ai++];
    const left = flags.includes('-');
    const plus = flags.includes('+');
    const space = flags.includes(' ');
    const zero = flags.includes('0') && !left;
    const alt = flags.includes('#');
    const width = w ? parseInt(w, 10) : 0;
    const hasPrec = prec !== undefined;
    const precN = hasPrec ? (prec === '' ? 0 : parseInt(prec, 10)) : -1;

    let sign = '';
    let prefix = '';
    let body: string;
    let canZero = zero;

    if (conv === 's' || conv === 'c') {
      body = String(arg);
      if (conv === 's' && hasPrec) body = body.slice(0, precN);
      canZero = false;
    } else if ('dioxX'.includes(conv)) {
      const v = typeof arg === 'bigint' ? arg : BigInt(arg as number);
      const neg = v < 0n;
      const mag = neg ? -v : v;
      if (conv === 'd' || conv === 'i') {
        body = mag.toString();
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
      } else if (conv === 'o') {
        body = mag.toString(8);
      } else {
        body = mag.toString(16);
        if (conv === 'X') body = body.toUpperCase();
      }
      if (hasPrec) {
        if (precN === 0 && mag === 0n) body = '';
        body = body.padStart(precN, '0');
        canZero = false;
      }
      if (conv === 'o' && alt && body[0] !== '0') body = '0' + body;
      if ((conv === 'x' || conv === 'X') && alt && mag !== 0n) prefix = conv === 'x' ? '0x' : '0X';
    } else {
      const x = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      const neg = x < 0 || Object.is(x, -0);
      if (Number.isNaN(x)) {
        body = 'NAN';
        canZero = false;
      } else {
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        if (!isFinite(x)) {
          body = 'INF';
          canZero = false;
        } else {
          const lc = conv.toLowerCase();
          const p = hasPrec ? precN : 6;
          if (lc === 'f') {
            body = fixedDigits(x, p, alt);
          } else if (lc === 'e') {
            const { digits, exp } = sciParts(x, p);
            body = sciString(digits, exp, p, alt, upper);
          } else {
            const P = p === 0 ? 1 : p;
            const { digits, exp } = sciParts(x, P - 1);
            const strip = (s: string) => (alt || !s.includes('.') ? s : s.replace(/\.?0+$/, ''));
            if (P > exp && exp >= -4) {
              body = strip(fixedDigits(x, P - 1 - exp, alt));
            } else {
              let m = digits[0];
              if (P > 1) m += '.' + digits.slice(1);
              else if (alt) m += '.';
              m = strip(m);
              const a = Math.abs(exp);
              body = m + (upper ? 'E' : 'e') + (exp < 0 ? '-' : '+') + (a < 10 ? '0' + a : String(a));
            }
          }
        }
      }
      if (!upper) body = body.toLowerCase();
    }

    const len = sign.length + prefix.length + body.length;
    if (len >= width) return sign + prefix + body;
    const pad = width - len;
    if (left) return sign + prefix + body + ' '.repeat(pad);
    if (canZero) return sign + prefix + '0'.repeat(pad) + body;
    return ' '.repeat(pad) + sign + prefix + body;
  });
}
