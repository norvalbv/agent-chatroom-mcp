function exact(x: number): [bigint, bigint] {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const be = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let e: number;
  if (be === 0) {
    e = -1074;
  } else {
    m |= 1n << 52n;
    e = be - 1075;
  }
  return e >= 0 ? [m << BigInt(e), 1n] : [m, 1n << BigInt(-e)];
}

const pow10 = (k: number): bigint => 10n ** BigInt(k);

// round(value * 10^k), half to even, using the exact value num/den
function roundScaled(num: bigint, den: bigint, k: number): bigint {
  let n = num;
  let d = den;
  if (k >= 0) n *= pow10(k);
  else d *= pow10(-k);
  const q = n / d;
  const r = n % d;
  const t = 2n * r;
  if (t > d || (t === d && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// digits (p+1 of them) and decimal exponent for |x| in e style
function sci(x: number, p: number): { digits: string; exp: number } {
  if (x === 0) return { digits: '0'.repeat(p + 1), exp: 0 };
  const [num, den] = exact(x);
  let E = Math.floor(Math.log10(x));
  if (!Number.isFinite(E)) E = 0;
  const ge = (k: number) => (k >= 0 ? num >= den * pow10(k) : num * pow10(-k) >= den);
  while (!ge(E)) E--;
  while (ge(E + 1)) E++;
  let q = roundScaled(num, den, p - E);
  if (q >= pow10(p + 1)) {
    E++;
    q = roundScaled(num, den, p - E);
  }
  return { digits: q.toString(), exp: E };
}

function fixed(x: number, p: number, alt: boolean): string {
  let s: string;
  if (x === 0) s = '0'.repeat(p + 1);
  else {
    const [num, den] = exact(x);
    s = roundScaled(num, den, p).toString().padStart(p + 1, '0');
  }
  const ip = s.slice(0, s.length - p);
  const fp = s.slice(s.length - p);
  return ip + (p > 0 || alt ? '.' : '') + fp;
}

function expStyle(x: number, p: number, alt: boolean, upper: boolean): string {
  const { digits, exp } = sci(x, p);
  const ea = Math.abs(exp);
  return (
    digits[0] + (p > 0 || alt ? '.' : '') + digits.slice(1) +
    (upper ? 'E' : 'e') + (exp < 0 ? '-' : '+') + (ea < 10 ? '0' : '') + ea
  );
}

function stripZeros(s: string): string {
  if (!s.includes('.')) return s;
  return s.replace(/0+$/, '').replace(/\.$/, '');
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let ai = 0;
  const re = /%(?:(%)|([-+ 0#]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc]))/g;
  return fmt.replace(re, (_m, pct, flags: string, w: string, pr: string | undefined, conv: string) => {
    if (pct) return '%';
    const arg = args[ai++];
    const minus = flags.includes('-');
    const plus = flags.includes('+');
    const space = flags.includes(' ');
    const zero = flags.includes('0');
    const alt = flags.includes('#');
    const width = w ? parseInt(w, 10) : 0;
    const hasPrec = pr !== undefined;
    const prec = hasPrec ? (pr === '' ? 0 : parseInt(pr!, 10)) : -1;

    let prefix = '';
    let body: string;
    let canZero = zero && !minus;

    if (conv === 's' || conv === 'c') {
      let s = String(arg);
      if (conv === 's' && hasPrec) s = s.slice(0, prec);
      prefix = '';
      body = s;
      canZero = false;
    } else if ('dixXo'.includes(conv)) {
      const v = BigInt(arg as number | bigint);
      const neg = v < 0n;
      const mag = neg ? -v : v;
      let digits = conv === 'x' ? mag.toString(16) : conv === 'X' ? mag.toString(16).toUpperCase() : conv === 'o' ? mag.toString(8) : mag.toString();
      if (hasPrec) {
        if (prec === 0 && mag === 0n) digits = '';
        digits = digits.padStart(prec, '0');
      }
      if (conv === 'd' || conv === 'i') {
        prefix = neg ? '-' : plus ? '+' : space ? ' ' : '';
      } else if (conv === 'o') {
        if (alt && !digits.startsWith('0')) digits = '0' + digits;
      } else if (alt && mag !== 0n) {
        prefix = conv === 'x' ? '0x' : '0X';
      }
      body = digits;
      if (hasPrec) canZero = false;
    } else {
      const x = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      const neg = x < 0 || Object.is(x, -0);
      const isNaNv = Number.isNaN(x);
      prefix = isNaNv ? '' : neg ? '-' : plus ? '+' : space ? ' ' : '';
      const ax = Math.abs(x);
      if (isNaNv || !Number.isFinite(x)) {
        body = isNaNv ? 'nan' : 'inf';
        if (upper) body = body.toUpperCase();
        canZero = false;
      } else {
        const p = hasPrec ? prec : 6;
        const lc = conv.toLowerCase();
        if (lc === 'f') body = fixed(ax, p, alt);
        else if (lc === 'e') body = expStyle(ax, p, alt, upper);
        else {
          const P = p === 0 ? 1 : p;
          const X = sci(ax, P - 1).exp;
          if (P > X && X >= -4) {
            body = fixed(ax, P - 1 - X, alt);
            if (!alt) body = stripZeros(body);
          } else {
            body = expStyle(ax, P - 1, alt, upper);
            if (!alt) {
              const ei = body.search(/[eE]/);
              body = stripZeros(body.slice(0, ei)) + body.slice(ei);
            }
          }
        }
      }
    }

    const len = prefix.length + body.length;
    if (len >= width) return prefix + body;
    const pad = width - len;
    if (minus) return prefix + body + ' '.repeat(pad);
    if (canZero) return prefix + '0'.repeat(pad) + body;
    return ' '.repeat(pad) + prefix + body;
  });
}
