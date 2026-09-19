// value = m * 2^e for a finite non-negative double
function decompose(x: number): [bigint, number] {
  if (x === 0) return [0n, 0];
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, x);
  const hi = buf.getUint32(0);
  const lo = buf.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (expBits === 0) return [m, -1074];
  m |= 1n << 52n;
  return [m, expBits - 1075];
}

// round-half-even(value * 10^s)
function scaled(m: bigint, e: number, s: number): bigint {
  let num = m;
  let den = 1n;
  if (e >= 0) num <<= BigInt(e);
  else den <<= BigInt(-e);
  if (s >= 0) num *= 10n ** BigInt(s);
  else den *= 10n ** BigInt(-s);
  const q = num / den;
  const r = num % den;
  const twice = r * 2n;
  if (twice > den || (twice === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// fixed: digits string of integer part and fraction with p fractional digits
function fixedDigits(x: number, p: number): [string, string] {
  const [m, e] = decompose(x);
  let n = scaled(m, e, p).toString();
  if (n.length <= p) n = '0'.repeat(p - n.length + 1) + n;
  return [n.slice(0, n.length - p), n.slice(n.length - p)];
}

// exponent style: returns digit string of length p+1 and decimal exponent
function expDigits(x: number, p: number): [string, number] {
  if (x === 0) return ['0'.repeat(p + 1), 0];
  const [m, e] = decompose(x);
  let x0 = Math.floor(Math.log10(x));
  if (!isFinite(x0)) x0 = -324;
  for (let i = 0; i < 6; i++) {
    const n = scaled(m, e, p - x0);
    const s = n.toString();
    if (s.length > p + 1) x0++;
    else if (s.length < p + 1) x0--;
    else return [s, x0];
  }
  throw new Error('exp');
}

function expStr(exp: number, upper: boolean): string {
  const a = Math.abs(exp);
  return (upper ? 'E' : 'e') + (exp < 0 ? '-' : '+') + (a < 10 ? '0' + a : String(a));
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
      const c = fmt[i];
      if (c === '-') minus = true;
      else if (c === '+') plus = true;
      else if (c === ' ') space = true;
      else if (c === '0') zero = true;
      else if (c === '#') alt = true;
      else break;
    }
    let width = 0;
    while (fmt[i] >= '0' && fmt[i] <= '9') width = width * 10 + Number(fmt[i++]);
    let prec = -1;
    if (fmt[i] === '.') {
      i++;
      prec = 0;
      while (fmt[i] >= '0' && fmt[i] <= '9') prec = prec * 10 + Number(fmt[i++]);
    }
    const conv = fmt[i++];
    const arg = args[ai++];

    let sign = '';
    let prefix = '';
    let body = '';
    let canZero = true;
    const lower = conv.toLowerCase();

    if (conv === 's' || conv === 'c') {
      body = String(arg);
      if (conv === 's' && prec >= 0) body = body.slice(0, prec);
      canZero = false;
    } else if (conv === 'd' || conv === 'i' || lower === 'x' || conv === 'o') {
      let v = BigInt(arg as number | bigint);
      let neg = false;
      if (v < 0n) {
        neg = true;
        v = -v;
      }
      let digits = conv === 'x' ? v.toString(16) : conv === 'X' ? v.toString(16).toUpperCase() : conv === 'o' ? v.toString(8) : v.toString();
      if (prec === 0 && v === 0n) digits = '';
      if (prec > digits.length) digits = '0'.repeat(prec - digits.length) + digits;
      if (conv === 'd' || conv === 'i') {
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
      } else if (alt) {
        if (conv === 'o') {
          if (digits[0] !== '0') digits = '0' + digits;
        } else if (v !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      }
      body = digits;
      if (prec >= 0) canZero = false;
    } else {
      const x = arg as number;
      const upper = conv === conv.toUpperCase();
      const neg = x < 0 || Object.is(x, -0);
      if (Number.isNaN(x)) {
        body = upper ? 'NAN' : 'nan';
        canZero = false;
      } else {
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        const a = Math.abs(x);
        if (a === Infinity) {
          body = upper ? 'INF' : 'inf';
          canZero = false;
        } else if (lower === 'f') {
          const p = prec < 0 ? 6 : prec;
          const [ip, fp] = fixedDigits(a, p);
          body = ip + (p > 0 || alt ? '.' : '') + fp;
        } else if (lower === 'e') {
          const p = prec < 0 ? 6 : prec;
          const [d, ex] = expDigits(a, p);
          body = d[0] + (p > 0 || alt ? '.' : '') + d.slice(1) + expStr(ex, upper);
        } else {
          const P = prec < 0 ? 6 : prec === 0 ? 1 : prec;
          const [d, ex] = expDigits(a, P - 1);
          let useF = P > ex && ex >= -4;
          let ip = '', fp = '';
          if (useF) {
            [ip, fp] = fixedDigits(a, P - 1 - ex);
          } else {
            ip = d[0];
            fp = d.slice(1);
          }
          if (!alt) fp = fp.replace(/0+$/, '');
          body = ip + (fp.length > 0 || alt ? '.' : '') + fp;
          if (!useF) body += expStr(ex, upper);
        }
      }
    }

    const len = sign.length + prefix.length + body.length;
    if (len >= width) out += sign + prefix + body;
    else if (minus) out += sign + prefix + body + ' '.repeat(width - len);
    else if (zero && canZero) out += sign + prefix + '0'.repeat(width - len) + body;
    else out += ' '.repeat(width - len) + sign + prefix + body;
  }
  return out;
}
