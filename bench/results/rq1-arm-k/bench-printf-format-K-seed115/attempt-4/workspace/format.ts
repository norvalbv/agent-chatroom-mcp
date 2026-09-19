function decompose(x: number): [bigint, number] {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const exp = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (exp === 0) return [m, -1074];
  m |= 1n << 52n;
  return [m, exp - 1075];
}

// round(x * 10^k), ties to even, x >= 0 finite
function scaledRound(x: number, k: number): bigint {
  const [m, e] = decompose(x);
  let num = m;
  let den = 1n;
  if (e >= 0) num <<= BigInt(e);
  else den <<= BigInt(-e);
  if (k >= 0) num *= 10n ** BigInt(k);
  else den *= 10n ** BigInt(-k);
  let q = num / den;
  const r2 = (num % den) * 2n;
  if (r2 > den || (r2 === den && (q & 1n) === 1n)) q += 1n;
  return q;
}

function fixedDigits(x: number, prec: number): [string, string] {
  let s = scaledRound(x, prec).toString();
  if (s.length <= prec) s = '0'.repeat(prec - s.length + 1) + s;
  return [s.slice(0, s.length - prec), s.slice(s.length - prec)];
}

function expDigits(x: number, p: number): [string, number] {
  if (x === 0) return ['0'.repeat(p + 1), 0];
  let X = Math.floor(Math.log10(x));
  if (!isFinite(X)) X = -324;
  for (;;) {
    const q = scaledRound(x, p - X);
    const s = q.toString();
    if (s.length < p + 1) X--;
    else if (s.length > p + 1) X++;
    else return [s, X];
  }
}

function expStr(digits: string, X: number, alt: boolean, upper: boolean): string {
  let r = digits[0];
  if (digits.length > 1) r += '.' + digits.slice(1);
  else if (alt) r += '.';
  const a = Math.abs(X);
  r += (upper ? 'E' : 'e') + (X < 0 ? '-' : '+') + (a < 10 ? '0' + a : String(a));
  return r;
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let out = '';
  let ai = 0;
  let i = 0;
  while (i < fmt.length) {
    const ch = fmt[i];
    if (ch !== '%') {
      out += ch;
      i++;
      continue;
    }
    i++;
    if (fmt[i] === '%') {
      out += '%';
      i++;
      continue;
    }
    let minus = false, plus = false, space = false, zero = false, alt = false;
    for (;; i++) {
      const f = fmt[i];
      if (f === '-') minus = true;
      else if (f === '+') plus = true;
      else if (f === ' ') space = true;
      else if (f === '0') zero = true;
      else if (f === '#') alt = true;
      else break;
    }
    let width = 0;
    while (fmt[i] >= '0' && fmt[i] <= '9') width = width * 10 + (fmt.charCodeAt(i++) - 48);
    let prec = -1;
    if (fmt[i] === '.') {
      i++;
      prec = 0;
      while (fmt[i] >= '0' && fmt[i] <= '9') prec = prec * 10 + (fmt.charCodeAt(i++) - 48);
    }
    const conv = fmt[i++];
    const arg = args[ai++];

    let sign = '';
    let prefix = '';
    let body = '';
    let canZero = true;

    if (conv === 's' || conv === 'c') {
      body = String(arg);
      if (conv === 's' && prec >= 0) body = body.slice(0, prec);
      canZero = false;
    } else if ('dixXo'.includes(conv)) {
      let v = BigInt(arg as number | bigint);
      if (conv === 'd' || conv === 'i') {
        if (v < 0n) {
          sign = '-';
          v = -v;
        } else sign = plus ? '+' : space ? ' ' : '';
      }
      let digits = conv === 'o' ? v.toString(8) : conv === 'd' || conv === 'i' ? v.toString() : v.toString(16);
      if (conv === 'X') digits = digits.toUpperCase();
      if (prec >= 0) {
        if (prec === 0 && v === 0n) digits = '';
        if (digits.length < prec) digits = '0'.repeat(prec - digits.length) + digits;
        canZero = false;
      }
      if (alt) {
        if ((conv === 'x' || conv === 'X') && v !== 0n) prefix = conv === 'x' ? '0x' : '0X';
        if (conv === 'o' && digits[0] !== '0') digits = '0' + digits;
      }
      body = digits;
    } else {
      const x = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      const neg = x < 0 || Object.is(x, -0);
      if (!Number.isNaN(x)) sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
      if (!isFinite(x)) {
        body = Number.isNaN(x) ? 'nan' : 'inf';
        if (upper) body = body.toUpperCase();
        canZero = false;
      } else {
        const a = Math.abs(x);
        const lc = conv.toLowerCase();
        if (lc === 'f') {
          const p = prec < 0 ? 6 : prec;
          const [ip, fp] = fixedDigits(a, p);
          body = ip + (p > 0 ? '.' + fp : alt ? '.' : '');
        } else if (lc === 'e') {
          const p = prec < 0 ? 6 : prec;
          const [d, X] = expDigits(a, p);
          body = expStr(d, X, alt, upper);
        } else {
          const P = prec < 0 ? 6 : prec === 0 ? 1 : prec;
          const [d, X] = expDigits(a, P - 1);
          if (P > X && X >= -4) {
            const p = P - 1 - X;
            const [ip, fp0] = fixedDigits(a, p);
            let fp = fp0;
            if (!alt) fp = fp.replace(/0+$/, '');
            body = ip + (fp.length > 0 ? '.' + fp : alt ? '.' : '');
          } else {
            let dd = d;
            if (!alt) dd = dd[0] + dd.slice(1).replace(/0+$/, '');
            body = expStr(dd, X, alt, upper);
          }
        }
      }
    }

    const len = sign.length + prefix.length + body.length;
    if (len < width) {
      const n = width - len;
      if (minus) body = sign + prefix + body + ' '.repeat(n);
      else if (zero && canZero) body = sign + prefix + '0'.repeat(n) + body;
      else body = ' '.repeat(n) + sign + prefix + body;
    } else body = sign + prefix + body;
    out += body;
  }
  return out;
}
