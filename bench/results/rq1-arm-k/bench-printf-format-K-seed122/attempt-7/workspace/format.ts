function decompose(ax: number): [bigint, number] {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, ax);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const be = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (be === 0) return [m, -1074];
  m |= 1n << 52n;
  return [m, be - 1075];
}

// round(ax * 10^k), ties to even, exact
function roundScaled(ax: number, k: number): bigint {
  const [m, e] = decompose(ax);
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

function fixedDigits(ax: number, p: number): string {
  let s = roundScaled(ax, p).toString();
  if (p > 0) s = s.padStart(p + 1, '0');
  return s;
}

// returns digit string of length p+1 and decimal exponent
function expDigits(ax: number, p: number): [string, number] {
  if (ax === 0) return ['0'.repeat(p + 1), 0];
  let e10 = Math.floor(Math.log10(ax));
  for (let i = 0; i < 10; i++) {
    const s = roundScaled(ax, p - e10).toString();
    if (s.length > p + 1) e10++;
    else if (s.length < p + 1) e10--;
    else return [s, e10];
  }
  throw new Error('exp');
}

function fmtF(ax: number, p: number, alt: boolean): string {
  const s = fixedDigits(ax, p);
  if (p === 0) return alt ? s + '.' : s;
  return s.slice(0, -p) + '.' + s.slice(-p);
}

function fmtE(ax: number, p: number, alt: boolean, upper: boolean): string {
  const [d, e10] = expDigits(ax, p);
  return expJoin(d, e10, alt, upper);
}

function expJoin(d: string, e10: number, alt: boolean, upper: boolean): string {
  let m = d[0];
  if (p0(d) > 0) m += '.' + d.slice(1);
  else if (alt) m += '.';
  const ae = Math.abs(e10);
  return m + (upper ? 'E' : 'e') + (e10 < 0 ? '-' : '+') + (ae < 10 ? '0' + ae : String(ae));
}

function p0(d: string): number {
  return d.length - 1;
}

function stripZeros(s: string): string {
  if (!s.includes('.')) return s;
  s = s.replace(/0+$/, '');
  return s.endsWith('.') ? s.slice(0, -1) : s;
}

function fmtG(ax: number, prec: number | undefined, alt: boolean, upper: boolean): string {
  const P = prec === undefined ? 6 : prec === 0 ? 1 : prec;
  const [d, X] = expDigits(ax, P - 1);
  if (P > X && X >= -4) {
    const s = fmtF(ax, P - 1 - X, alt);
    return alt ? s : stripZeros(s);
  }
  let m = d[0];
  if (d.length > 1) m += '.' + d.slice(1);
  else if (alt) m += '.';
  if (!alt) m = stripZeros(m);
  const ae = Math.abs(X);
  return m + (upper ? 'E' : 'e') + (X < 0 ? '-' : '+') + (ae < 10 ? '0' + ae : String(ae));
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let out = '';
  let ai = 0;
  let i = 0;
  const n = fmt.length;
  while (i < n) {
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
    for (; i < n; i++) {
      const c = fmt[i];
      if (c === '-') minus = true;
      else if (c === '+') plus = true;
      else if (c === ' ') space = true;
      else if (c === '0') zero = true;
      else if (c === '#') alt = true;
      else break;
    }
    let width = 0;
    while (i < n && fmt[i] >= '0' && fmt[i] <= '9') width = width * 10 + (fmt.charCodeAt(i++) - 48);
    let prec: number | undefined;
    if (fmt[i] === '.') {
      i++;
      prec = 0;
      while (i < n && fmt[i] >= '0' && fmt[i] <= '9') prec = prec * 10 + (fmt.charCodeAt(i++) - 48);
    }
    const conv = fmt[i++];
    const arg = args[ai++];

    let sign = '';
    let prefix = '';
    let body = '';
    let canZero = false;

    if (conv === 's' || conv === 'c') {
      body = String(arg);
      if (conv === 's' && prec !== undefined) body = body.slice(0, prec);
    } else if ('dixXo'.includes(conv)) {
      const v = BigInt(arg as number | bigint);
      const neg = v < 0n;
      const mag = neg ? -v : v;
      let digits = conv === 'x' ? mag.toString(16) : conv === 'X' ? mag.toString(16).toUpperCase() : conv === 'o' ? mag.toString(8) : mag.toString(10);
      if (prec !== undefined) {
        if (prec === 0 && mag === 0n) digits = '';
        digits = digits.padStart(prec, '0');
      }
      if (conv === 'd' || conv === 'i') {
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
      } else if (alt) {
        if (conv === 'o') {
          if (!digits.startsWith('0')) digits = '0' + digits;
        } else if (mag !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      }
      body = digits;
      canZero = prec === undefined;
    } else {
      const x = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      const neg = x < 0 || Object.is(x, -0);
      if (Number.isNaN(x)) {
        body = upper ? 'NAN' : 'nan';
      } else {
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        const ax = Math.abs(x);
        if (ax === Infinity) body = upper ? 'INF' : 'inf';
        else {
          canZero = true;
          const lc = conv.toLowerCase();
          if (lc === 'f') body = fmtF(ax, prec === undefined ? 6 : prec, alt);
          else if (lc === 'e') body = fmtE(ax, prec === undefined ? 6 : prec, alt, upper);
          else body = fmtG(ax, prec, alt, upper);
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
