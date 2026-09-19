function decompose(v: number): [bigint, number] {
  // v >= 0 finite; returns [m, e] with v = m * 2^e exactly
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

function pow10(k: number): bigint {
  return 10n ** BigInt(k);
}

// round(v * 10^k), ties to even; mode 'floor' truncates
function scaled(m: bigint, e: number, k: number, floor = false): bigint {
  let num = m;
  let den = 1n;
  if (k > 0) num *= pow10(k);
  else if (k < 0) den *= pow10(-k);
  if (e > 0) num <<= BigInt(e);
  else if (e < 0) den <<= BigInt(-e);
  const q = num / den;
  if (floor) return q;
  const r = num - q * den;
  const twice = r * 2n;
  if (twice > den || (twice === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// e-style digits: returns [digit string of length p+1, exponent]
function eDigits(v: number, p: number): [string, number] {
  if (v === 0) return ['0'.repeat(p + 1), 0];
  const [m, e] = decompose(v);
  let X = Math.floor(Math.log10(v));
  if (!Number.isFinite(X)) X = -324;
  while (scaled(m, e, -X, true) < 1n) X--;
  while (scaled(m, e, -X, true) >= 10n) X++;
  let d = scaled(m, e, p - X);
  if (d >= pow10(p + 1)) {
    X++;
    d = scaled(m, e, p - X);
  }
  return [d.toString(), X];
}

function fDigits(v: number, p: number, alt: boolean): string {
  let d = '0';
  if (v !== 0) {
    const [m, e] = decompose(v);
    d = scaled(m, e, p).toString();
  }
  if (d.length <= p) d = '0'.repeat(p - d.length + 1) + d;
  const ip = d.slice(0, d.length - p);
  const fp = d.slice(d.length - p);
  return ip + (p > 0 || alt ? '.' : '') + fp;
}

function expStr(X: number, upper: boolean): string {
  const a = Math.abs(X).toString().padStart(2, '0');
  return (upper ? 'E' : 'e') + (X < 0 ? '-' : '+') + a;
}

function eStyle(v: number, p: number, alt: boolean, upper: boolean): string {
  const [d, X] = eDigits(v, p);
  return d[0] + (p > 0 || alt ? '.' : '') + d.slice(1) + expStr(X, upper);
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let out = '';
  let ai = 0;
  let i = 0;
  while (i < fmt.length) {
    const ch = fmt[i++];
    if (ch !== '%') {
      out += ch;
      continue;
    }
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
    let body = '';
    let canZero = true;
    const lc = conv.toLowerCase();
    const upper = conv !== lc;
    if (conv === 's' || conv === 'c') {
      canZero = false;
      body = String(arg);
      if (conv === 's' && prec >= 0) body = body.slice(0, prec);
    } else if (conv === 'd' || conv === 'i') {
      const n = BigInt(arg as number | bigint);
      sign = n < 0n ? '-' : plus ? '+' : space ? ' ' : '';
      body = (n < 0n ? -n : n).toString();
      if (prec === 0 && n === 0n) body = '';
      if (prec >= 0) {
        body = body.padStart(prec, '0');
        canZero = false;
      }
    } else if (conv === 'x' || conv === 'X' || conv === 'o') {
      const n = BigInt(arg as number | bigint);
      body = n.toString(conv === 'o' ? 8 : 16);
      if (conv === 'X') body = body.toUpperCase();
      if (prec === 0 && n === 0n) body = '';
      if (prec >= 0) {
        body = body.padStart(prec, '0');
        canZero = false;
      }
      if (alt) {
        if (conv === 'o') {
          if (body[0] !== '0') body = '0' + body;
        } else if (n !== 0n) sign = conv === 'x' ? '0x' : '0X';
      }
    } else {
      const v = arg as number;
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
        } else if (lc === 'f') {
          body = fDigits(a, prec < 0 ? 6 : prec, alt);
        } else if (lc === 'e') {
          body = eStyle(a, prec < 0 ? 6 : prec, alt, upper);
        } else {
          const P = prec < 0 ? 6 : prec === 0 ? 1 : prec;
          const X = eDigits(a, P - 1)[1];
          let expPart = '';
          if (P > X && X >= -4) {
            body = fDigits(a, P - 1 - X, alt);
          } else {
            body = eStyle(a, P - 1, alt, upper);
            const idx = body.search(/[eE]/);
            expPart = body.slice(idx);
            body = body.slice(0, idx);
          }
          if (!alt && body.includes('.')) body = body.replace(/0+$/, '').replace(/\.$/, '');
          body += expPart;
        }
      }
    }
    const len = sign.length + body.length;
    if (len >= width) out += sign + body;
    else if (minus) out += sign + body + ' '.repeat(width - len);
    else if (zero && canZero) out += sign + '0'.repeat(width - len) + body;
    else out += ' '.repeat(width - len) + sign + body;
  }
  return out;
}
