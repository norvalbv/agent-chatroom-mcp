function decompose(x: number): { m: bigint; e: number } {
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
  return { m, e };
}

// round(|x| * 10^k), half to even, exactly
function scaled(x: number, k: number): bigint {
  const { m, e } = decompose(x);
  let num = m;
  let den = 1n;
  if (e >= 0) num <<= BigInt(e);
  else den <<= BigInt(-e);
  if (k >= 0) num *= 10n ** BigInt(k);
  else den *= 10n ** BigInt(-k);
  let q = num / den;
  const r = num % den;
  const twice = r * 2n;
  if (twice > den || (twice === den && (q & 1n) === 1n)) q += 1n;
  return q;
}

// digits (p+1 of them) and decimal exponent in e style
function eParts(x: number, p: number): { digits: string; exp: number } {
  if (x === 0) return { digits: '0'.repeat(p + 1), exp: 0 };
  let e10 = Math.floor(Math.log10(x));
  const lowB = 10n ** BigInt(p);
  const highB = lowB * 10n;
  for (let i = 0; i < 20; i++) {
    const q = scaled(x, p - e10);
    if (q >= highB) e10++;
    else if (q < lowB) e10--;
    else return { digits: q.toString(), exp: e10 };
  }
  throw new Error('unreachable');
}

function fixedStr(x: number, p: number, alt: boolean): string {
  let s = scaled(x, p).toString();
  if (s.length < p + 1) s = '0'.repeat(p + 1 - s.length) + s;
  const ip = s.slice(0, s.length - p);
  const fp = s.slice(s.length - p);
  return ip + (p > 0 || alt ? '.' : '') + fp;
}

function expStr(x: number, p: number, alt: boolean, upper: boolean): string {
  const { digits, exp } = eParts(x, p);
  const ae = Math.abs(exp);
  return (
    digits[0] + (p > 0 || alt ? '.' : '') + digits.slice(1) +
    (upper ? 'E' : 'e') + (exp < 0 ? '-' : '+') + (ae < 10 ? '0' + ae : String(ae))
  );
}

function stripZeros(s: string): string {
  // s is like "1.500" or "1.500e+05"
  const idx = s.search(/[eE]/);
  let mant = idx >= 0 ? s.slice(0, idx) : s;
  const tail = idx >= 0 ? s.slice(idx) : '';
  if (mant.includes('.')) {
    mant = mant.replace(/0+$/, '').replace(/\.$/, '');
  }
  return mant + tail;
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let ai = 0;
  const re = /%(?:%|([-+ 0#]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc]))/g;
  return fmt.replace(re, (whole, flags?: string, w?: string, pr?: string, conv?: string) => {
    if (conv === undefined) return '%';
    const fl = flags ?? '';
    const left = fl.includes('-');
    const plus = fl.includes('+');
    const space = fl.includes(' ');
    const zero = fl.includes('0');
    const alt = fl.includes('#');
    const width = w ? parseInt(w, 10) : 0;
    const hasPrec = pr !== undefined;
    const prec = hasPrec ? (pr === '' ? 0 : parseInt(pr, 10)) : 0;
    const arg = args[ai++];

    let sign = '';
    let prefix = '';
    let body = '';
    let zeroOk = zero && !left;

    const signFor = (neg: boolean) => (neg ? '-' : plus ? '+' : space ? ' ' : '');

    if (conv === 's' || conv === 'c') {
      let s = String(arg);
      if (conv === 's' && hasPrec) s = s.slice(0, prec);
      body = s;
      zeroOk = false;
    } else if ('diuxXo'.includes(conv)) {
      const v = BigInt(arg as number | bigint);
      const neg = v < 0n;
      const mag = neg ? -v : v;
      if (conv === 'd' || conv === 'i') sign = signFor(neg);
      let digits =
        conv === 'x' ? mag.toString(16) :
        conv === 'X' ? mag.toString(16).toUpperCase() :
        conv === 'o' ? mag.toString(8) : mag.toString(10);
      if (hasPrec && prec === 0 && mag === 0n) digits = '';
      if (hasPrec && digits.length < prec) digits = '0'.repeat(prec - digits.length) + digits;
      if (alt) {
        if ((conv === 'x' || conv === 'X') && mag !== 0n) prefix = conv === 'x' ? '0x' : '0X';
        if (conv === 'o' && !digits.startsWith('0')) digits = '0' + digits;
      }
      body = digits;
      if (hasPrec) zeroOk = false;
    } else {
      const x = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      if (Number.isNaN(x)) {
        body = upper ? 'NAN' : 'nan';
        zeroOk = false;
      } else {
        const neg = x < 0 || Object.is(x, -0);
        sign = signFor(neg);
        const ax = Math.abs(x);
        if (!Number.isFinite(x)) {
          body = upper ? 'INF' : 'inf';
          zeroOk = false;
        } else if (conv === 'f' || conv === 'F') {
          body = fixedStr(ax, hasPrec ? prec : 6, alt);
        } else if (conv === 'e' || conv === 'E') {
          body = expStr(ax, hasPrec ? prec : 6, alt, upper);
        } else {
          let P = hasPrec ? prec : 6;
          if (P === 0) P = 1;
          const X = eParts(ax, P - 1).exp;
          if (P > X && X >= -4) body = fixedStr(ax, P - 1 - X, alt);
          else body = expStr(ax, P - 1, alt, upper);
          if (!alt) body = stripZeros(body);
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
