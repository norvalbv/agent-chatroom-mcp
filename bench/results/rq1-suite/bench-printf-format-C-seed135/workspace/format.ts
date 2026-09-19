// Decompose a finite non-negative double into m * 2^e exactly.
function decompose(x: number): [bigint, number] {
  if (x === 0) return [0n, 0];
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (expBits === 0) return [m, -1074];
  m |= 1n << 52n;
  return [m, expBits - 1075];
}

// round-half-even of m * 2^e * 10^k as a BigInt
function roundScaled(m: bigint, e: number, k: number): bigint {
  let num = m;
  let den = 1n;
  if (e >= 0) num <<= BigInt(e);
  else den <<= BigInt(-e);
  if (k >= 0) num *= 10n ** BigInt(k);
  else den *= 10n ** BigInt(-k);
  const q = num / den;
  const r = num % den;
  const twice = r * 2n;
  if (twice > den || (twice === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// digits (p+1 of them) and decimal exponent of x in e-style
function expDigits(x: number, p: number): [string, number] {
  if (x === 0) return ['0'.repeat(p + 1), 0];
  const [m, e] = decompose(x);
  let X = Math.floor(Math.log10(x));
  if (!isFinite(X)) X = 0;
  const lo = 10n ** BigInt(p);
  const hi = lo * 10n;
  for (let i = 0; i < 8; i++) {
    const n = roundScaled(m, e, p - X);
    if (n >= hi) X++;
    else if (n < lo) X--;
    else return [n.toString(), X];
  }
  throw new Error('exp');
}

function fixedDigits(x: number, p: number): string {
  const [m, e] = decompose(x);
  let s = roundScaled(m, e, p).toString();
  if (p > 0) {
    s = s.padStart(p + 1, '0');
    return s.slice(0, s.length - p) + '.' + s.slice(s.length - p);
  }
  return s;
}

function expStr(digits: string, X: number, p: number, alt: boolean, upper: boolean): string {
  let s = digits[0];
  if (p > 0) s += '.' + digits.slice(1);
  else if (alt) s += '.';
  const ax = Math.abs(X);
  s += (upper ? 'E' : 'e') + (X < 0 ? '-' : '+') + (ax < 10 ? '0' : '') + ax;
  return s;
}

function stripZeros(s: string): string {
  if (!s.includes('.')) return s;
  return s.replace(/0+$/, '').replace(/\.$/, '');
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let ai = 0;
  const re = /%(?:(%)|([-+ 0#]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc]))/g;
  return fmt.replace(re, (_m, pct, flags: string, w: string, prec: string | undefined, conv: string) => {
    if (pct) return '%';
    const left = flags.includes('-');
    const plus = flags.includes('+');
    const space = flags.includes(' ');
    const zero = flags.includes('0');
    const alt = flags.includes('#');
    const width = w ? parseInt(w, 10) : 0;
    const hasPrec = prec !== undefined;
    const precN = hasPrec ? (prec === '' ? 0 : parseInt(prec, 10)) : -1;
    const arg = args[ai++];

    let sign = '';
    let prefix = '';
    let body: string;
    let zeroOk = zero && !left;

    const signFor = (neg: boolean) => (neg ? '-' : plus ? '+' : space ? ' ' : '');

    if (conv === 's' || conv === 'c') {
      let str = String(arg);
      if (conv === 's' && hasPrec) str = str.slice(0, precN);
      body = str;
      zeroOk = false;
    } else if ('dixXo'.includes(conv)) {
      let v = typeof arg === 'bigint' ? arg : BigInt(arg as number);
      const neg = v < 0n;
      if (neg) v = -v;
      if (conv === 'd' || conv === 'i') sign = signFor(neg);
      let digits = conv === 'o' ? v.toString(8) : conv === 'x' ? v.toString(16) : conv === 'X' ? v.toString(16).toUpperCase() : v.toString(10);
      if (hasPrec) {
        if (precN === 0 && v === 0n) digits = '';
        digits = digits.padStart(precN, '0');
        zeroOk = false;
      }
      if (alt) {
        if (conv === 'o') {
          if (digits[0] !== '0') digits = '0' + digits;
        } else if ((conv === 'x' || conv === 'X') && v !== 0n) {
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
        zeroOk = false;
      } else {
        sign = signFor(neg);
        if (!isFinite(x)) {
          body = upper ? 'INF' : 'inf';
          zeroOk = false;
        } else {
          const ax = Math.abs(x);
          const lc = conv.toLowerCase();
          const p = hasPrec ? precN : 6;
          if (lc === 'f') {
            body = fixedDigits(ax, p);
            if (p === 0 && alt) body += '.';
          } else if (lc === 'e') {
            const [d, X] = expDigits(ax, p);
            body = expStr(d, X, p, alt, upper);
          } else {
            const P = p === 0 ? 1 : p;
            const [d, X] = expDigits(ax, P - 1);
            if (P > X && X >= -4) {
              body = fixedDigits(ax, P - 1 - X);
              if (P - 1 - X === 0 && alt) body += '.';
              if (!alt) body = stripZeros(body);
            } else {
              let s = expStr(d, X, P - 1, alt, upper);
              if (!alt) {
                const ei = s.search(/[eE]/);
                s = stripZeros(s.slice(0, ei)) + s.slice(ei);
              }
              body = s;
            }
          }
        }
      }
    }

    const len = sign.length + prefix.length + body.length;
    if (len >= width) return sign + prefix + body;
    const pad = width - len;
    if (left) return sign + prefix + body + ' '.repeat(pad);
    if (zeroOk) return sign + prefix + '0'.repeat(pad) + body;
    return ' '.repeat(pad) + sign + prefix + body;
  });
}
