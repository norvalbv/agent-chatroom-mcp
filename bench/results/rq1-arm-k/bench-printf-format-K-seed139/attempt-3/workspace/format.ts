function decompose(x: number): [bigint, number] {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  const frac = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (expBits === 0) return [frac, -1074];
  return [frac | (1n << 52n), expBits - 1075];
}

// round-half-even(|x| * 10^s), exact
function scaledRound(m: bigint, e: number, s: number, floor = false): bigint {
  let n = m;
  let d = 1n;
  if (s >= 0) n *= 10n ** BigInt(s);
  else d *= 10n ** BigInt(-s);
  if (e >= 0) n <<= BigInt(e);
  else d <<= BigInt(-e);
  const q = n / d;
  if (floor) return q;
  const r = n - q * d;
  const twice = r * 2n;
  if (twice > d || (twice === d && (q & 1n) === 1n)) return q + 1n;
  return q;
}

function decExp(m: bigint, e: number): number {
  let k = Math.floor(Math.log10(Number(m) * Math.pow(2, e))) || 0;
  if (!isFinite(k)) k = 0;
  while (scaledRound(m, e, -k, true) >= 10n) k++;
  while (scaledRound(m, e, -k, true) < 1n) k--;
  return k;
}

// digits (p+1 of them) and exponent for e-style
function eDigits(x: number, p: number): [string, number] {
  if (x === 0) return ['0'.repeat(p + 1), 0];
  const [m, e] = decompose(x);
  let k = decExp(m, e);
  let n = scaledRound(m, e, p - k);
  if (n >= 10n ** BigInt(p + 1)) {
    k++;
    n = scaledRound(m, e, p - k);
  }
  return [n.toString(), k];
}

function fStr(x: number, p: number, alt: boolean): string {
  const [m, e] = x === 0 ? [0n, 0] : decompose(x);
  let s = scaledRound(m, e, p).toString();
  if (s.length < p + 1) s = '0'.repeat(p + 1 - s.length) + s;
  const ip = s.slice(0, s.length - p);
  const fp = s.slice(s.length - p);
  return p > 0 ? ip + '.' + fp : alt ? ip + '.' : ip;
}

function eStr(digits: string, k: number, p: number, alt: boolean, upper: boolean): string {
  let mant = digits[0];
  if (p > 0) mant += '.' + digits.slice(1);
  else if (alt) mant += '.';
  return mant + expStr(k, upper);
}

function expStr(k: number, upper: boolean): string {
  const a = Math.abs(k);
  return (upper ? 'E' : 'e') + (k < 0 ? '-' : '+') + (a < 10 ? '0' + a : String(a));
}

function stripZeros(s: string): string {
  if (s.indexOf('.') < 0) return s;
  return s.replace(/0+$/, '').replace(/\.$/, '');
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
    for (; i < fmt.length; i++) {
      const f = fmt[i];
      if (f === '-') minus = true;
      else if (f === '+') plus = true;
      else if (f === ' ') space = true;
      else if (f === '0') zero = true;
      else if (f === '#') alt = true;
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
    const signFor = (neg: boolean) => (neg ? '-' : plus ? '+' : space ? ' ' : '');

    switch (conv) {
      case 'd':
      case 'i':
      case 'x':
      case 'X':
      case 'o': {
        const v = BigInt(arg as number | bigint);
        const neg = v < 0n;
        const mag = neg ? -v : v;
        let digits = conv === 'd' || conv === 'i' ? mag.toString() : conv === 'o' ? mag.toString(8) : mag.toString(16);
        if (conv === 'X') digits = digits.toUpperCase();
        if (prec === 0 && mag === 0n) digits = '';
        if (prec > digits.length) digits = '0'.repeat(prec - digits.length) + digits;
        if (conv === 'd' || conv === 'i') sign = signFor(neg);
        else if (alt) {
          if (conv === 'o') {
            if (digits[0] !== '0') digits = '0' + digits;
          } else if (mag !== 0n) prefix = conv === 'x' ? '0x' : '0X';
        }
        if (prec >= 0) canZero = false;
        body = digits;
        break;
      }
      case 'e':
      case 'E':
      case 'f':
      case 'F':
      case 'g':
      case 'G': {
        const x = arg as number;
        const upper = conv === 'E' || conv === 'F' || conv === 'G';
        if (Number.isNaN(x)) {
          body = upper ? 'NAN' : 'nan';
          canZero = false;
          break;
        }
        sign = signFor(x < 0 || Object.is(x, -0));
        if (!isFinite(x)) {
          body = upper ? 'INF' : 'inf';
          canZero = false;
          break;
        }
        const ax = Math.abs(x);
        const lc = conv.toLowerCase();
        if (lc === 'f') {
          body = fStr(ax, prec < 0 ? 6 : prec, alt);
        } else if (lc === 'e') {
          const p = prec < 0 ? 6 : prec;
          const [d, k] = eDigits(ax, p);
          body = eStr(d, k, p, alt, upper);
        } else {
          let P = prec < 0 ? 6 : prec;
          if (P === 0) P = 1;
          const [d, X] = eDigits(ax, P - 1);
          if (P > X && X >= -4) {
            body = fStr(ax, P - 1 - X, alt);
            if (!alt) body = stripZeros(body);
          } else {
            let mant = d[0];
            if (P > 1) mant += '.' + d.slice(1);
            else if (alt) mant += '.';
            if (!alt) mant = stripZeros(mant);
            body = mant + expStr(X, upper);
          }
        }
        break;
      }
      case 's': {
        body = String(arg);
        if (prec >= 0) body = body.slice(0, prec);
        canZero = false;
        break;
      }
      case 'c': {
        body = String(arg);
        canZero = false;
        break;
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
