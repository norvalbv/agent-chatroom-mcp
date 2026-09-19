function decompose(x: number): [bigint, number] {
  // x >= 0 finite; returns [m, e] with x = m * 2^e
  if (x === 0) return [0n, 0];
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, x);
  const hi = buf.getUint32(0);
  const lo = buf.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  let mant = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (expBits === 0) return [mant, -1074];
  mant |= 1n << 52n;
  return [mant, expBits - 1075];
}

// round(x * 10^s) with half-to-even, exact
function scaled(x: number, s: number): bigint {
  const [m, e] = decompose(x);
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

function fixedDigits(x: number, p: number): string {
  let d = scaled(x, p).toString();
  if (d.length < p + 1) d = '0'.repeat(p + 1 - d.length) + d;
  return d; // integer part + p fraction digits
}

function expDigits(x: number, p: number): [string, number] {
  if (x === 0) return ['0'.repeat(p + 1), 0];
  let E = Math.floor(Math.log10(x));
  const lo = 10n ** BigInt(p);
  const hi = lo * 10n;
  for (let i = 0; i < 10; i++) {
    const d = scaled(x, p - E);
    if (d >= hi) E++;
    else if (d < lo) E--;
    else return [d.toString(), E];
  }
  throw new Error('exp');
}

function fmtExp(digits: string, E: number, alt: boolean, upper: boolean): string {
  let s = digits[0];
  if (digits.length > 1) s += '.' + digits.slice(1);
  else if (alt) s += '.';
  const a = Math.abs(E);
  s += (upper ? 'E' : 'e') + (E < 0 ? '-' : '+') + (a < 10 ? '0' + a : String(a));
  return s;
}

function fmtFixed(x: number, p: number, alt: boolean): string {
  const d = fixedDigits(x, p);
  const ip = d.slice(0, d.length - p);
  if (p > 0) return ip + '.' + d.slice(d.length - p);
  return alt ? ip + '.' : ip;
}

function stripZeros(s: string): string {
  if (!s.includes('.')) return s;
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
    while (i < fmt.length && fmt[i] >= '0' && fmt[i] <= '9') {
      width = width * 10 + (fmt.charCodeAt(i) - 48);
      i++;
    }
    let prec = -1;
    if (fmt[i] === '.') {
      i++;
      prec = 0;
      while (i < fmt.length && fmt[i] >= '0' && fmt[i] <= '9') {
        prec = prec * 10 + (fmt.charCodeAt(i) - 48);
        i++;
      }
    }
    const conv = fmt[i++];
    const arg = args[ai++];
    let sign = '';
    let prefix = '';
    let body = '';
    let zeroOk = zero && !minus;

    if (conv === 's' || conv === 'c') {
      body = String(arg);
      if (conv === 's' && prec >= 0) body = body.slice(0, prec);
      zeroOk = false;
    } else if (conv === 'd' || conv === 'i' || conv === 'x' || conv === 'X' || conv === 'o') {
      const v = typeof arg === 'bigint' ? arg : BigInt(arg as number);
      const neg = v < 0n;
      const mag = neg ? -v : v;
      if (conv === 'd' || conv === 'i') {
        body = mag.toString();
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
      } else if (conv === 'o') {
        body = mag.toString(8);
      } else {
        body = mag.toString(16);
        if (conv === 'X') body = body.toUpperCase();
      }
      if (prec >= 0) {
        if (prec === 0 && mag === 0n) body = '';
        if (body.length < prec) body = '0'.repeat(prec - body.length) + body;
        zeroOk = false;
      }
      if (alt) {
        if (conv === 'o') {
          if (body[0] !== '0') body = '0' + body;
        } else if ((conv === 'x' || conv === 'X') && mag !== 0n) {
          prefix = conv === 'x' ? '0x' : '0X';
        }
      }
    } else {
      const x = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      const neg = x < 0 || Object.is(x, -0);
      const isNaNv = Number.isNaN(x);
      if (!isNaNv) sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
      if (isNaNv || !Number.isFinite(x)) {
        body = isNaNv ? 'nan' : 'inf';
        if (upper) body = body.toUpperCase();
        zeroOk = false;
      } else {
        const a = Math.abs(x);
        const lc = conv.toLowerCase();
        if (lc === 'f') {
          body = fmtFixed(a, prec < 0 ? 6 : prec, alt);
        } else if (lc === 'e') {
          const p = prec < 0 ? 6 : prec;
          const [d, E] = expDigits(a, p);
          body = fmtExp(d, E, alt, upper);
        } else {
          let P = prec < 0 ? 6 : prec;
          if (P === 0) P = 1;
          const [d, X] = expDigits(a, P - 1);
          if (P > X && X >= -4) {
            body = fmtFixed(a, P - 1 - X, alt);
            if (!alt) body = stripZeros(body);
          } else {
            let mant = d[0] + (d.length > 1 ? '.' + d.slice(1) : alt ? '.' : '');
            if (!alt) mant = stripZeros(mant);
            const ab = Math.abs(X);
            body = mant + (upper ? 'E' : 'e') + (X < 0 ? '-' : '+') + (ab < 10 ? '0' + ab : String(ab));
          }
        }
      }
    }

    const len = sign.length + prefix.length + body.length;
    if (len >= width) out += sign + prefix + body;
    else if (minus) out += sign + prefix + body + ' '.repeat(width - len);
    else if (zeroOk) out += sign + prefix + '0'.repeat(width - len) + body;
    else out += ' '.repeat(width - len) + sign + prefix + body;
  }
  return out;
}
