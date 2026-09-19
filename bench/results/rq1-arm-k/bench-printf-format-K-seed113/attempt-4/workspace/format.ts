function exact(x: number): { num: bigint; den: bigint } {
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
  return e >= 0 ? { num: m << BigInt(e), den: 1n } : { num: m, den: 1n << BigInt(-e) };
}

function roundDiv(a: bigint, b: bigint): bigint {
  const q = a / b;
  const r2 = (a - q * b) * 2n;
  if (r2 > b || (r2 === b && (q & 1n) === 1n)) return q + 1n;
  return q;
}

const pow10 = (n: number): bigint => 10n ** BigInt(n);

// |x| scaled by 10^p, rounded half-even
function scaled(num: bigint, den: bigint, p: number): bigint {
  return p >= 0 ? roundDiv(num * pow10(p), den) : roundDiv(num, den * pow10(-p));
}

function fixedDigits(ax: number, p: number): { int: string; frac: string } {
  const { num, den } = exact(ax);
  let s = scaled(num, den, p).toString();
  if (p > 0) {
    s = s.padStart(p + 1, '0');
    return { int: s.slice(0, s.length - p), frac: s.slice(s.length - p) };
  }
  return { int: s, frac: '' };
}

function expDigits(ax: number, p: number): { digits: string; X: number } {
  if (ax === 0) return { digits: '0'.repeat(p + 1), X: 0 };
  const { num, den } = exact(ax);
  let X = Math.floor(Math.log10(ax));
  if (!isFinite(X)) X = -324;
  // fix up so 10^X <= ax < 10^(X+1)
  const ge = (k: number) => (k >= 0 ? num >= den * pow10(k) : num * pow10(-k) >= den);
  while (!ge(X)) X--;
  while (ge(X + 1)) X++;
  let d = scaled(num, den, p - X);
  if (d >= pow10(p + 1)) {
    X++;
    d = scaled(num, den, p - X);
  }
  return { digits: d.toString(), X };
}

function fmtExp(ax: number, p: number, alt: boolean, upper: boolean): string {
  const { digits, X } = expDigits(ax, p);
  let s = digits[0];
  if (p > 0 || alt) s += '.';
  s += digits.slice(1);
  const ax2 = Math.abs(X);
  return s + (upper ? 'E' : 'e') + (X < 0 ? '-' : '+') + String(ax2).padStart(2, '0');
}

function fmtFixed(ax: number, p: number, alt: boolean): string {
  const { int, frac } = fixedDigits(ax, p);
  return int + (p > 0 || alt ? '.' : '') + frac;
}

function stripZeros(s: string): string {
  // s has a '.' in it only if fractional digits/alt present; handle mantissa only
  if (!s.includes('.')) return s;
  s = s.replace(/0+$/, '');
  return s.replace(/\.$/, '');
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let ai = 0;
  const re = /%([-+ 0#]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc%])/g;
  return fmt.replace(re, (_m, flags: string, w: string, pr: string | undefined, conv: string) => {
    if (conv === '%') return '%';
    const arg = args[ai++];
    const left = flags.includes('-');
    const plus = flags.includes('+');
    const space = flags.includes(' ');
    const zero = flags.includes('0');
    const alt = flags.includes('#');
    const width = w ? parseInt(w, 10) : 0;
    const hasPrec = pr !== undefined;
    const prec = hasPrec ? (pr === '' ? 0 : parseInt(pr, 10)) : -1;

    let sign = '';
    let prefix = '';
    let body: string;
    let canZero = zero && !left;

    if (conv === 's' || conv === 'c') {
      let s = String(arg);
      if (conv === 's' && hasPrec) s = s.slice(0, prec);
      body = s;
      canZero = false;
    } else if ('dioxX'.includes(conv)) {
      const v = BigInt(arg as number | bigint);
      const neg = v < 0n;
      const mag = neg ? -v : v;
      let digits = mag.toString(conv === 'o' ? 8 : conv === 'd' || conv === 'i' ? 10 : 16);
      if (conv === 'X') digits = digits.toUpperCase();
      if (hasPrec) {
        if (prec === 0 && mag === 0n) digits = '';
        digits = digits.padStart(prec, '0');
        canZero = false;
      }
      if (conv === 'd' || conv === 'i') {
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
      } else if (alt) {
        if (conv === 'o') {
          if (!digits.startsWith('0')) digits = '0' + digits;
        } else if (mag !== 0n) {
          prefix = conv === 'x' ? '0x' : '0X';
        }
      }
      body = digits;
    } else {
      const x = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      const neg = x < 0 || Object.is(x, -0);
      if (Number.isNaN(x)) {
        body = upper ? 'NAN' : 'nan';
        canZero = false;
      } else {
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        if (!isFinite(x)) {
          body = upper ? 'INF' : 'inf';
          canZero = false;
        } else {
          const ax = Math.abs(x);
          const lc = conv.toLowerCase();
          if (lc === 'f') {
            body = fmtFixed(ax, hasPrec ? prec : 6, alt);
          } else if (lc === 'e') {
            body = fmtExp(ax, hasPrec ? prec : 6, alt, upper);
          } else {
            const P = hasPrec ? Math.max(prec, 1) : 6;
            const { X } = expDigits(ax, P - 1);
            if (P > X && X >= -4) {
              body = fmtFixed(ax, P - 1 - X, alt);
              if (!alt) body = stripZeros(body);
            } else {
              body = fmtExp(ax, P - 1, alt, upper);
              if (!alt) {
                const i = body.search(/[eE]/);
                body = stripZeros(body.slice(0, i)) + body.slice(i);
              }
            }
          }
        }
      }
    }

    const len = sign.length + prefix.length + body.length;
    if (len >= width) return sign + prefix + body;
    const pad = width - len;
    if (left) return sign + prefix + body + ' '.repeat(pad);
    if (canZero) return sign + prefix + '0'.repeat(pad) + body;
    return ' '.repeat(pad) + sign + prefix + body;
  });
}
