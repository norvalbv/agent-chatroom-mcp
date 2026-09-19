function decompose(x: number): [bigint, number] {
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
  return [m, e];
}

// round-half-even(m * 2^e * 10^k)
function scaled(m: bigint, e: number, k: number): bigint {
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

// fixed digits of |x| with prec fractional digits: [intPart, fracPart]
function fixed(x: number, prec: number): [string, string] {
  const [m, e] = decompose(Math.abs(x));
  let s = scaled(m, e, prec).toString();
  if (prec === 0) return [s, ''];
  if (s.length <= prec) s = '0'.repeat(prec - s.length + 1) + s;
  return [s.slice(0, s.length - prec), s.slice(s.length - prec)];
}

// exponent style: digits string (prec+1 digits) and decimal exponent
function expo(x: number, prec: number): [string, number] {
  const a = Math.abs(x);
  if (a === 0) return ['0'.repeat(prec + 1), 0];
  const [m, e] = decompose(a);
  let X = Math.floor(Math.log10(a));
  if (!isFinite(X)) X = 0;
  const lim = 10n ** BigInt(prec);
  for (let i = 0; i < 10; i++) {
    const d = scaled(m, e, prec - X);
    if (d >= lim * 10n) X++;
    else if (d < lim) X--;
    else return [d.toString(), X];
  }
  throw new Error('exp');
}

function expStr(X: number, upper: boolean): string {
  const ax = Math.abs(X);
  return (upper ? 'E' : 'e') + (X < 0 ? '-' : '+') + (ax < 10 ? '0' : '') + ax;
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let ai = 0;
  const re = /%(?:%|([-+ 0#]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc]))/g;
  return fmt.replace(re, (all, flags: string | undefined, w: string, p: string | undefined, conv: string) => {
    if (conv === undefined) return '%';
    const left = flags!.includes('-');
    const plus = flags!.includes('+');
    const space = flags!.includes(' ');
    const zero = flags!.includes('0');
    const alt = flags!.includes('#');
    const width = w ? parseInt(w, 10) : 0;
    const hasPrec = p !== undefined;
    const precN = hasPrec ? (p === '' ? 0 : parseInt(p, 10)) : -1;
    const arg = args[ai++];

    const pad = (prefix: string, body: string, zeroOk: boolean): string => {
      const len = prefix.length + body.length;
      if (len >= width) return prefix + body;
      const n = width - len;
      if (left) return prefix + body + ' '.repeat(n);
      if (zero && zeroOk) return prefix + '0'.repeat(n) + body;
      return ' '.repeat(n) + prefix + body;
    };

    if (conv === 's') {
      let s = String(arg);
      if (hasPrec) s = s.slice(0, precN);
      return pad('', s, false);
    }
    if (conv === 'c') return pad('', String(arg), false);

    if (conv === 'd' || conv === 'i' || conv === 'x' || conv === 'X' || conv === 'o') {
      const v = BigInt(arg as number | bigint);
      const neg = v < 0n;
      const mag = neg ? -v : v;
      let digits =
        conv === 'd' || conv === 'i' ? mag.toString() : conv === 'o' ? mag.toString(8) : mag.toString(16);
      if (conv === 'X') digits = digits.toUpperCase();
      if (hasPrec) {
        if (precN === 0 && mag === 0n) digits = '';
        else if (digits.length < precN) digits = '0'.repeat(precN - digits.length) + digits;
      }
      let prefix = '';
      if (conv === 'd' || conv === 'i') prefix = neg ? '-' : plus ? '+' : space ? ' ' : '';
      else if (alt) {
        if ((conv === 'x' || conv === 'X') && mag !== 0n) prefix = conv === 'x' ? '0x' : '0X';
        else if (conv === 'o' && !digits.startsWith('0')) digits = '0' + digits;
      }
      return pad(prefix, digits, !hasPrec);
    }

    // floating point
    const x = arg as number;
    const upper = conv === 'E' || conv === 'F' || conv === 'G';
    const neg = x < 0 || Object.is(x, -0);
    const sign = Number.isNaN(x) ? '' : neg ? '-' : plus ? '+' : space ? ' ' : '';
    if (!isFinite(x)) {
      let t = Number.isNaN(x) ? 'nan' : 'inf';
      if (upper) t = t.toUpperCase();
      return pad(sign, t, false);
    }
    const lower = conv.toLowerCase();
    let body: string;
    if (lower === 'f') {
      const [ip, fp] = fixed(x, hasPrec ? precN : 6);
      body = ip + (fp || alt ? '.' : '') + fp;
    } else if (lower === 'e') {
      const pr = hasPrec ? precN : 6;
      const [d, X] = expo(x, pr);
      body = d[0] + (pr > 0 || alt ? '.' : '') + d.slice(1) + expStr(X, upper);
    } else {
      let P = hasPrec ? precN : 6;
      if (P === 0) P = 1;
      const [d, X] = expo(x, P - 1);
      let ip: string;
      let fp: string;
      let suffix = '';
      if (P > X && X >= -4) {
        [ip, fp] = fixed(x, P - 1 - X);
      } else {
        ip = d[0];
        fp = d.slice(1);
        suffix = expStr(X, upper);
      }
      if (!alt) fp = fp.replace(/0+$/, '');
      body = ip + (fp || alt ? '.' : '') + fp + suffix;
    }
    return pad(sign, body, true);
  });
}
