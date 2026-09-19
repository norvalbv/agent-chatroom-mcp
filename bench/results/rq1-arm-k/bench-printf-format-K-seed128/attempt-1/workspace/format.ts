function decompose(v: number): [bigint, number] {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, v);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (expBits === 0) return [m, -1074];
  m |= 1n << 52n;
  return [m, expBits - 1075];
}

// round(|v| * 10^k) to nearest, ties to even, using the exact binary value
function roundScaled(v: number, k: number): bigint {
  const [m, e] = decompose(v);
  let num = m;
  let den = 1n;
  if (e > 0) num <<= BigInt(e);
  else den <<= BigInt(-e);
  if (k > 0) num *= 10n ** BigInt(k);
  else if (k < 0) den *= 10n ** BigInt(-k);
  const q = num / den;
  const r = num - q * den;
  const twice = r * 2n;
  if (twice > den || (twice === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// digits (prec+1 of them) and decimal exponent of |v| in e style
function eDigits(v: number, prec: number): [string, number] {
  if (v === 0) return ['0'.repeat(prec + 1), 0];
  let x = Math.floor(Math.log10(v));
  if (!Number.isFinite(x)) x = 0;
  const lowB = 10n ** BigInt(prec);
  const highB = lowB * 10n;
  for (;;) {
    const s = roundScaled(v, prec - x);
    if (s >= highB) x++;
    else if (s < lowB) x--;
    else return [s.toString(), x];
  }
}

function expStr(x: number, upper: boolean): string {
  const a = Math.abs(x);
  return (upper ? 'E' : 'e') + (x < 0 ? '-' : '+') + (a < 10 ? '0' : '') + a;
}

function fmtE(v: number, prec: number, upper: boolean, alt: boolean): string {
  const [d, x] = eDigits(v, prec);
  const mant = d[0] + (prec > 0 || alt ? '.' : '') + d.slice(1);
  return mant + expStr(x, upper);
}

function fmtF(v: number, prec: number, alt: boolean): string {
  let s = roundScaled(v, prec).toString();
  if (s.length <= prec) s = '0'.repeat(prec - s.length + 1) + s;
  const ip = s.slice(0, s.length - prec);
  const fp = s.slice(s.length - prec);
  return ip + (prec > 0 || alt ? '.' : '') + fp;
}

function stripZeros(s: string): string {
  if (!s.includes('.')) return s;
  s = s.replace(/0+$/, '');
  return s.replace(/\.$/, '');
}

function fmtG(v: number, prec: number, upper: boolean, alt: boolean): string {
  const p = prec === 0 ? 1 : prec;
  const [d, x] = eDigits(v, p - 1);
  if (p > x && x >= -4) {
    const s = fmtF(v, p - 1 - x, alt);
    return alt ? s : stripZeros(s);
  }
  let mant = d[0] + (p - 1 > 0 || alt ? '.' : '') + d.slice(1);
  if (!alt) mant = stripZeros(mant);
  return mant + expStr(x, upper);
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
    let canZero = true;

    if (conv === 's' || conv === 'c') {
      body = String(arg);
      if (conv === 's' && prec >= 0) body = body.slice(0, prec);
      canZero = false;
    } else if (conv === 'd' || conv === 'i' || conv === 'x' || conv === 'X' || conv === 'o') {
      const n = BigInt(arg as number | bigint);
      const neg = n < 0n;
      const mag = neg ? -n : n;
      if (conv === 'd' || conv === 'i') {
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
      }
      let digits = conv === 'o' ? mag.toString(8) : conv === 'd' || conv === 'i' ? mag.toString(10) : mag.toString(16);
      if (conv === 'X') digits = digits.toUpperCase();
      if (prec === 0 && mag === 0n) digits = '';
      if (prec >= 0) {
        if (digits.length < prec) digits = '0'.repeat(prec - digits.length) + digits;
        canZero = false;
      }
      if (alt) {
        if (conv === 'o') {
          if (digits[0] !== '0') digits = '0' + digits;
        } else if ((conv === 'x' || conv === 'X') && mag !== 0n) {
          prefix = conv === 'x' ? '0x' : '0X';
        }
      }
      body = digits;
    } else {
      const v = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      const neg = v < 0 || Object.is(v, -0);
      if (Number.isNaN(v)) {
        body = upper ? 'NAN' : 'nan';
        canZero = false;
      } else {
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        const a = Math.abs(v);
        if (a === Infinity) {
          body = upper ? 'INF' : 'inf';
          canZero = false;
        } else {
          const p = prec < 0 ? 6 : prec;
          const lc = conv.toLowerCase();
          if (lc === 'e') body = fmtE(a, p, upper, alt);
          else if (lc === 'f') body = fmtF(a, p, alt);
          else body = fmtG(a, p, upper, alt);
        }
      }
    }

    const len = sign.length + prefix.length + body.length;
    if (len >= width) {
      out += sign + prefix + body;
    } else if (minus) {
      out += sign + prefix + body + ' '.repeat(width - len);
    } else if (zero && canZero) {
      out += sign + prefix + '0'.repeat(width - len) + body;
    } else {
      out += ' '.repeat(width - len) + sign + prefix + body;
    }
  }
  return out;
}
