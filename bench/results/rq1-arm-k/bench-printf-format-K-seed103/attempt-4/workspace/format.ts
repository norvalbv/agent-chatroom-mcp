// Decompose a finite non-negative double into m * 2^e exactly.
function decompose(v: number): [bigint, number] {
  if (v === 0) return [0n, 0];
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, v);
  const hi = buf.getUint32(0);
  const lo = buf.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (expBits === 0) return [m, -1074];
  m |= 1n << 52n;
  return [m, expBits - 1075];
}

// round-half-even(m * 2^e * 10^k)
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

function fixedStr(v: number, p: number, alt: boolean): string {
  const [m, e] = decompose(v);
  const s = roundScaled(m, e, p).toString().padStart(p + 1, '0');
  const ip = s.slice(0, s.length - p);
  const fp = s.slice(s.length - p);
  return p > 0 ? ip + '.' + fp : ip + (alt ? '.' : '');
}

function expDigits(v: number, p: number): [string, number] {
  if (v === 0) return ['0'.repeat(p + 1), 0];
  const [m, e] = decompose(v);
  let X = Math.floor(Math.log10(v));
  if (!Number.isFinite(X)) X = -324;
  const lo = 10n ** BigInt(p);
  const hi = lo * 10n;
  for (let i = 0; i < 10; i++) {
    const N = roundScaled(m, e, p - X);
    if (N < lo) X--;
    else if (N >= hi) X++;
    else return [N.toString(), X];
  }
  // Rounded up to exactly a power of ten at the boundary.
  return [lo.toString(), X];
}

function expStr(v: number, p: number, alt: boolean, upper: boolean): string {
  const [d, X] = expDigits(v, p);
  let s = d[0];
  if (p > 0) s += '.' + d.slice(1);
  else if (alt) s += '.';
  const ax = Math.abs(X);
  s += (upper ? 'E' : 'e') + (X < 0 ? '-' : '+') + (ax < 10 ? '0' : '') + ax;
  return s;
}

function stripZeros(s: string): string {
  const ei = s.search(/[eE]/);
  let mant = ei >= 0 ? s.slice(0, ei) : s;
  const rest = ei >= 0 ? s.slice(ei) : '';
  if (mant.includes('.')) mant = mant.replace(/0+$/, '').replace(/\.$/, '');
  return mant + rest;
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let ai = 0;
  const re = /%(?:(%)|([-+ 0#]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc]))/g;
  return fmt.replace(re, (_all, pct, flags, widthS, precS, conv) => {
    if (pct) return '%';
    const arg = args[ai++];
    const left = flags.includes('-');
    const plus = flags.includes('+');
    const space = flags.includes(' ');
    const zero = flags.includes('0');
    const alt = flags.includes('#');
    const width = widthS ? parseInt(widthS, 10) : 0;
    const hasPrec = precS !== undefined;
    const prec = hasPrec ? (precS === '' ? 0 : parseInt(precS, 10)) : -1;

    let sign = '';
    let prefix = '';
    let body = '';
    let canZero = false;

    if (conv === 's' || conv === 'c') {
      let s = String(arg);
      if (conv === 's' && hasPrec) s = s.slice(0, prec);
      body = s;
    } else if ('diouxX'.includes(conv)) {
      const v = BigInt(arg as number | bigint);
      const neg = v < 0n;
      const mag = neg ? -v : v;
      if (conv === 'd' || conv === 'i') {
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
      }
      let digits = conv === 'o' ? mag.toString(8) : conv === 'x' ? mag.toString(16)
        : conv === 'X' ? mag.toString(16).toUpperCase() : mag.toString(10);
      if (hasPrec && prec === 0 && mag === 0n) digits = '';
      if (hasPrec && digits.length < prec) digits = digits.padStart(prec, '0');
      if (alt) {
        if ((conv === 'x' || conv === 'X') && mag !== 0n) prefix = conv === 'x' ? '0x' : '0X';
        if (conv === 'o' && digits[0] !== '0') digits = '0' + digits;
      }
      body = digits;
      canZero = !hasPrec;
    } else {
      const v = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      const neg = v < 0 || Object.is(v, -0);
      if (Number.isNaN(v)) {
        body = upper ? 'NAN' : 'nan';
      } else {
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        const a = Math.abs(v);
        if (a === Infinity) {
          body = upper ? 'INF' : 'inf';
        } else {
          canZero = true;
          const lc = conv.toLowerCase();
          if (lc === 'f') {
            body = fixedStr(a, hasPrec ? prec : 6, alt);
          } else if (lc === 'e') {
            body = expStr(a, hasPrec ? prec : 6, alt, upper);
          } else {
            let P = hasPrec ? prec : 6;
            if (P === 0) P = 1;
            const X = expDigits(a, P - 1)[1];
            if (P > X && X >= -4) body = fixedStr(a, P - 1 - X, alt);
            else body = expStr(a, P - 1, alt, upper);
            if (!alt) body = stripZeros(body);
          }
        }
      }
      if (!Number.isFinite(v)) canZero = false;
    }

    const len = sign.length + prefix.length + body.length;
    if (len >= width) return sign + prefix + body;
    const pad = width - len;
    if (left) return sign + prefix + body + ' '.repeat(pad);
    if (zero && canZero) return sign + prefix + '0'.repeat(pad) + body;
    return ' '.repeat(pad) + sign + prefix + body;
  });
}
