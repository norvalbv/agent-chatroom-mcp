function roundDiv(num: bigint, den: bigint): bigint {
  const q = num / den;
  const r2 = (num % den) * 2n;
  if (r2 > den || (r2 === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// exact decomposition of a positive finite double: m * 2^k
function decompose(x: number): [bigint, number] {
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

// round(x * 10^s) half-even, exactly
function scaled(x: number, s: number): bigint {
  if (x === 0) return 0n;
  const [m, k] = decompose(x);
  let num = m;
  let den = 1n;
  if (k >= 0) num <<= BigInt(k);
  else den <<= BigInt(-k);
  if (s >= 0) num *= 10n ** BigInt(s);
  else den *= 10n ** BigInt(-s);
  return roundDiv(num, den);
}

// digits string N (p+1 digits) and decimal exponent for e-style
function eParts(x: number, p: number): [string, number] {
  if (x === 0) return ['0'.repeat(p + 1), 0];
  let e10 = Math.floor(Math.log10(x));
  const lo = 10n ** BigInt(p);
  const hi = lo * 10n;
  for (;;) {
    const n = scaled(x, p - e10);
    if (n >= hi) e10++;
    else if (n < lo) e10--;
    else return [n.toString(), e10];
  }
}

function fStr(x: number, p: number, alt: boolean): string {
  let d = scaled(x, p).toString();
  if (p > 0) {
    d = d.padStart(p + 1, '0');
    return d.slice(0, d.length - p) + '.' + d.slice(d.length - p);
  }
  return alt ? d + '.' : d;
}

function eStr(x: number, p: number, alt: boolean, upper: boolean): string {
  const [d, e] = eParts(x, p);
  let s = d[0];
  if (p > 0) s += '.' + d.slice(1);
  else if (alt) s += '.';
  const ae = Math.abs(e);
  return s + (upper ? 'E' : 'e') + (e < 0 ? '-' : '+') + (ae < 10 ? '0' : '') + ae;
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let ai = 0;
  const re = /%([-+ 0#]*)(\d*)(?:\.(\d*))?([a-zA-Z%])/g;
  return fmt.replace(re, (_m, flags: string, w: string, pr: string | undefined, conv: string) => {
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

    let sign = '';
    let body: string;
    let zeroOk = zero;
    const lc = conv.toLowerCase();

    if (conv === 's') {
      body = String(arg);
      if (hasPrec) body = body.slice(0, prec);
      zeroOk = false;
    } else if (conv === 'c') {
      body = String(arg);
      zeroOk = false;
    } else if (conv === 'd' || conv === 'i' || lc === 'x' || conv === 'o') {
      let v = BigInt(arg as number | bigint);
      if (v < 0n) {
        sign = '-';
        v = -v;
      } else if (conv === 'd' || conv === 'i') {
        sign = plus ? '+' : space ? ' ' : '';
      }
      const radix = conv === 'o' ? 8 : conv === 'd' || conv === 'i' ? 10 : 16;
      let digits = v.toString(radix);
      if (conv === 'X') digits = digits.toUpperCase();
      if (hasPrec) {
        if (prec === 0 && v === 0n) digits = '';
        digits = digits.padStart(prec, '0');
        zeroOk = false;
      }
      if (alt) {
        if (conv === 'o') {
          if (digits[0] !== '0') digits = '0' + digits;
        } else if (lc === 'x' && v !== 0n) {
          sign += conv === 'x' ? '0x' : '0X';
        }
      }
      body = digits;
    } else {
      const x = arg as number;
      const upper = conv === conv.toUpperCase();
      const neg = x < 0 || Object.is(x, -0);
      if (!Number.isNaN(x)) sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
      const ax = Math.abs(x);
      if (Number.isNaN(x) || !Number.isFinite(x)) {
        body = Number.isNaN(x) ? 'nan' : 'inf';
        if (upper) body = body.toUpperCase();
        zeroOk = false;
      } else if (lc === 'f') {
        body = fStr(ax, hasPrec ? prec : 6, alt);
      } else if (lc === 'e') {
        body = eStr(ax, hasPrec ? prec : 6, alt, upper);
      } else {
        const P = hasPrec ? Math.max(prec, 1) : 6;
        const X = eParts(ax, P - 1)[1];
        if (P > X && X >= -4) {
          body = fStr(ax, P - 1 - X, alt);
          if (!alt && body.includes('.')) body = body.replace(/\.?0+$/, '');
        } else {
          body = eStr(ax, P - 1, alt, upper);
          if (!alt) {
            body = body.replace(/^(\d)(\.\d*?)0*([eE])/, (_a, d1: string, fr: string, e: string) =>
              d1 + (fr === '.' ? '' : fr) + e,
            );
          }
        }
      }
    }

    let out = sign + body;
    if (out.length < width) {
      const pad = width - out.length;
      if (left) out += ' '.repeat(pad);
      else if (zeroOk) out = sign + '0'.repeat(pad) + body;
      else out = ' '.repeat(pad) + out;
    }
    return out;
  });
}
