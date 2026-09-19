function roundDiv(n: bigint, d: bigint): bigint {
  const q = n / d;
  const r2 = (n % d) * 2n;
  if (r2 > d || (r2 === d && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// exact rational for a finite non-negative double
function rational(x: number): [bigint, bigint] {
  if (x === 0) return [0n, 1n];
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, x);
  const hi = buf.getUint32(0);
  const lo = buf.getUint32(4);
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

const pow10 = (n: number): bigint => 10n ** BigInt(n);

// round x * 10^p to integer (half-even)
function scaled(x: number, p: number): bigint {
  const [n, d] = rational(x);
  return p >= 0 ? roundDiv(n * pow10(p), d) : roundDiv(n, d * pow10(-p));
}

function fixedStr(x: number, prec: number, alt: boolean): string {
  let s = scaled(x, prec).toString();
  if (prec > 0) {
    s = s.padStart(prec + 1, '0');
    return s.slice(0, s.length - prec) + '.' + s.slice(s.length - prec);
  }
  return alt ? s + '.' : s;
}

// returns [digit string of length prec+1, exponent]
function expParts(x: number, prec: number): [string, number] {
  if (x === 0) return ['0'.repeat(prec + 1), 0];
  const [n, d] = rational(x);
  let e = Math.floor(Math.log10(x));
  if (!isFinite(e)) e = 0;
  const ge = (k: number) => (k >= 0 ? n >= d * pow10(k) : n * pow10(-k) >= d);
  while (!ge(e)) e--;
  while (ge(e + 1)) e++;
  let m = scaled(x, prec - e);
  if (m >= pow10(prec + 1)) {
    e++;
    m = scaled(x, prec - e);
  }
  return [m.toString(), e];
}

function expStr(x: number, prec: number, alt: boolean, upper: boolean): string {
  const [ds, e] = expParts(x, prec);
  let s = ds[0];
  if (prec > 0) s += '.' + ds.slice(1);
  else if (alt) s += '.';
  const ae = Math.abs(e);
  return s + (upper ? 'E' : 'e') + (e < 0 ? '-' : '+') + (ae < 10 ? '0' : '') + ae;
}

function stripZeros(s: string): string {
  if (!s.includes('.')) return s;
  return s.replace(/0+$/, '').replace(/\.$/, '');
}

function genStr(x: number, precIn: number, alt: boolean, upper: boolean): string {
  const P = precIn === 0 ? 1 : precIn;
  const X = expParts(x, P - 1)[1];
  if (P > X && X >= -4) {
    const s = fixedStr(x, P - 1 - X, alt);
    return alt ? s : stripZeros(s);
  }
  const s = expStr(x, P - 1, alt, upper);
  if (alt) return s;
  const idx = s.search(/[eE]/);
  return stripZeros(s.slice(0, idx)) + s.slice(idx);
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let ai = 0;
  const re = /%(?:%|([-+ 0#]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc]))/g;
  return fmt.replace(re, (whole, flags?: string, w?: string, p?: string, conv?: string) => {
    if (conv === undefined) return '%';
    flags = flags ?? '';
    const left = flags.includes('-');
    const plus = flags.includes('+');
    const space = flags.includes(' ');
    const zero = flags.includes('0');
    const alt = flags.includes('#');
    const width = w ? parseInt(w, 10) : 0;
    const hasPrec = p !== undefined;
    const prec = hasPrec ? (p === '' ? 0 : parseInt(p, 10)) : -1;
    const arg = args[ai++];

    let sign = '';
    let prefix = '';
    let body: string;
    let canZero = false;

    if (conv === 's') {
      body = String(arg);
      if (hasPrec) body = body.slice(0, prec);
    } else if (conv === 'c') {
      body = String(arg);
    } else if ('diouxX'.includes(conv)) {
      const v = BigInt(arg as number | bigint);
      const signStr = v < 0n ? '-' : plus ? '+' : space ? ' ' : '';
      const mag = v < 0n ? -v : v;
      let digits = conv === 'd' || conv === 'i' ? mag.toString()
        : conv === 'o' ? mag.toString(8)
        : conv === 'x' ? mag.toString(16) : mag.toString(16).toUpperCase();
      if (hasPrec && prec === 0 && mag === 0n) digits = '';
      if (hasPrec) digits = digits.padStart(prec, '0');
      if (conv === 'd' || conv === 'i') sign = signStr;
      if (alt) {
        if (conv === 'o') {
          if (!digits.startsWith('0')) digits = '0' + digits;
        } else if ((conv === 'x' || conv === 'X') && mag !== 0n) {
          prefix = conv === 'x' ? '0x' : '0X';
        }
      }
      body = digits;
      canZero = !hasPrec;
    } else {
      const x = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      if (Number.isNaN(x)) {
        body = upper ? 'NAN' : 'nan';
      } else {
        const neg = x < 0 || Object.is(x, -0);
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        const ax = Math.abs(x);
        if (!isFinite(ax)) {
          body = upper ? 'INF' : 'inf';
        } else {
          const pr = hasPrec ? prec : 6;
          const lc = conv.toLowerCase();
          body = lc === 'f' ? fixedStr(ax, pr, alt)
            : lc === 'e' ? expStr(ax, pr, alt, upper)
            : genStr(ax, pr, alt, upper);
          canZero = true;
        }
      }
    }

    const len = sign.length + prefix.length + body.length;
    if (len >= width) return sign + prefix + body;
    const pad = width - len;
    if (left) return sign + prefix + body + ' '.repeat(pad);
    if (zero && canZero) return sign + prefix + '0'.repeat(pad) + body;
    return ' '.repeat(pad) + sign + prefix + body;
  });
}
