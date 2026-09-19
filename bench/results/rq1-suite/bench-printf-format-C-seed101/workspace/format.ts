function roundDiv(n: bigint, d: bigint): bigint {
  const q = n / d;
  const r = n % d;
  const twice = r * 2n;
  if (twice > d || (twice === d && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// Exact positive finite double as N / 10^k.
function exactDecimal(x: number): { n: bigint; k: number } {
  if (x === 0) return { n: 0n, k: 0 };
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, x);
  const hi = buf.getUint32(0);
  const lo = buf.getUint32(4);
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
  return { n: m * 5n ** BigInt(-e), k: -e };
}

// round(value * 10^s) as an integer, half-even
function scaled(v: { n: bigint; k: number }, s: number): bigint {
  const sh = s - v.k;
  if (sh >= 0) return v.n * 10n ** BigInt(sh);
  return roundDiv(v.n, 10n ** BigInt(-sh));
}

function fixedStr(x: number, prec: number, alt: boolean): string {
  let r = scaled(exactDecimal(x), prec).toString();
  if (prec > 0) {
    r = r.padStart(prec + 1, '0');
    return r.slice(0, r.length - prec) + '.' + r.slice(r.length - prec);
  }
  return alt ? r + '.' : r;
}

function expParts(x: number, prec: number): { digits: string; exp: number } {
  const v = exactDecimal(x);
  if (v.n === 0n) return { digits: '0'.repeat(prec + 1), exp: 0 };
  let x0 = v.n.toString().length - 1 - v.k;
  let r = scaled(v, prec - x0);
  if (r >= 10n ** BigInt(prec + 1)) {
    x0++;
    r = scaled(v, prec - x0);
  }
  return { digits: r.toString(), exp: x0 };
}

function expStr(x: number, prec: number, alt: boolean, upper: boolean): string {
  const { digits, exp } = expParts(x, prec);
  let s = digits[0];
  if (prec > 0) s += '.' + digits.slice(1);
  else if (alt) s += '.';
  const a = Math.abs(exp);
  s += (upper ? 'E' : 'e') + (exp < 0 ? '-' : '+') + (a < 10 ? '0' + a : String(a));
  return s;
}

function stripZeros(s: string): string {
  if (s.indexOf('.') < 0) return s;
  return s.replace(/0+$/, '').replace(/\.$/, '');
}

function genStr(x: number, prec: number, alt: boolean, upper: boolean): string {
  const P = prec === 0 ? 1 : prec;
  const X = expParts(x, P - 1).exp;
  if (P > X && X >= -4) {
    const s = fixedStr(x, P - 1 - X, alt);
    return alt ? s : stripZeros(s);
  }
  const s = expStr(x, P - 1, alt, upper);
  if (alt) return s;
  const i = s.search(/[eE]/);
  return stripZeros(s.slice(0, i)) + s.slice(i);
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let ai = 0;
  const re = /%(?:(%)|([-+ 0#]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc]))/g;
  return fmt.replace(re, (_m, pct, flags: string, w: string, p: string | undefined, conv: string) => {
    if (pct) return '%';
    const arg = args[ai++];
    const left = flags.includes('-');
    const plus = flags.includes('+');
    const space = flags.includes(' ');
    const zero = flags.includes('0') && !left;
    const alt = flags.includes('#');
    const width = w ? parseInt(w, 10) : 0;
    const hasPrec = p !== undefined;
    const prec = hasPrec ? (p === '' ? 0 : parseInt(p, 10)) : -1;

    let sign = '';
    let prefix = '';
    let body: string;
    let zeroOk = zero;

    if (conv === 's' || conv === 'c') {
      let s = String(arg);
      if (conv === 's' && hasPrec) s = s.slice(0, prec);
      body = s;
      zeroOk = false;
    } else if (conv === 'd' || conv === 'i' || conv === 'x' || conv === 'X' || conv === 'o') {
      let v = BigInt(arg as number | bigint);
      if (conv === 'd' || conv === 'i') {
        if (v < 0n) {
          sign = '-';
          v = -v;
        } else sign = plus ? '+' : space ? ' ' : '';
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
        } else if ((conv === 'x' || conv === 'X') && v !== 0n) {
          prefix = conv === 'x' ? '0x' : '0X';
        }
      }
      body = digits;
    } else {
      const x = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      if (Number.isNaN(x)) {
        body = upper ? 'NAN' : 'nan';
        zeroOk = false;
      } else {
        const neg = x < 0 || Object.is(x, -0);
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        const ax = Math.abs(x);
        if (ax === Infinity) {
          body = upper ? 'INF' : 'inf';
          zeroOk = false;
        } else {
          const pr = hasPrec ? prec : 6;
          const lc = conv.toLowerCase();
          body = lc === 'f' ? fixedStr(ax, pr, alt) : lc === 'e' ? expStr(ax, pr, alt, upper) : genStr(ax, pr, alt, upper);
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
