function ratio(v: number): [bigint, bigint] {
  // v > 0 finite; returns exact num/den
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, v);
  const hi = buf.getUint32(0);
  const lo = buf.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  let mant = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let e: number;
  if (expBits === 0) e = -1074;
  else {
    mant |= 1n << 52n;
    e = expBits - 1075;
  }
  return e >= 0 ? [mant << BigInt(e), 1n] : [mant, 1n << BigInt(-e)];
}

function roundDiv(n: bigint, d: bigint): bigint {
  const q = n / d;
  const r = n - q * d;
  const twice = r * 2n;
  if (twice > d || (twice === d && (q & 1n) === 1n)) return q + 1n;
  return q;
}

const pow10 = (k: number): bigint => 10n ** BigInt(k);

// round v * 10^scale to integer
function scaled(v: number, scale: number): bigint {
  if (v === 0) return 0n;
  const [n, d] = ratio(v);
  return scale >= 0 ? roundDiv(n * pow10(scale), d) : roundDiv(n, d * pow10(-scale));
}

// returns digits string (p+1 digits) and exponent
function expDigits(v: number, p: number): [string, number] {
  if (v === 0) return ['0'.repeat(p + 1), 0];
  let x = Math.floor(Math.log10(v));
  if (!isFinite(x)) x = -324;
  for (let i = 0; i < 20; i++) {
    const n = scaled(v, p - x);
    if (n >= pow10(p + 1)) x++;
    else if (n < pow10(p)) x--;
    else return [n.toString(), x];
  }
  throw new Error('exp');
}

function fixed(v: number, p: number, alt: boolean): string {
  let s = scaled(v, p).toString();
  if (p > 0) {
    s = s.padStart(p + 1, '0');
    return s.slice(0, s.length - p) + '.' + s.slice(s.length - p);
  }
  return alt ? s + '.' : s;
}

function expo(v: number, p: number, alt: boolean, upper: boolean): string {
  const [d, x] = expDigits(v, p);
  let s = d[0];
  if (p > 0) s += '.' + d.slice(1);
  else if (alt) s += '.';
  const ax = Math.abs(x);
  return s + (upper ? 'E' : 'e') + (x < 0 ? '-' : '+') + (ax < 10 ? '0' + ax : String(ax));
}

function stripZeros(s: string): string {
  // s may contain exponent part
  const m = /^([^eE]*)([eE].*)?$/.exec(s)!;
  let a = m[1];
  if (a.includes('.')) a = a.replace(/0+$/, '').replace(/\.$/, '');
  return a + (m[2] ?? '');
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
    let zeroOk = zero && !minus;

    if (conv === 's' || conv === 'c') {
      body = String(arg);
      if (conv === 's' && prec >= 0) body = body.slice(0, prec);
      zeroOk = false;
    } else if ('dixXo'.includes(conv)) {
      let v = typeof arg === 'bigint' ? arg : BigInt(arg as number);
      const neg = v < 0n;
      if (neg) v = -v;
      if (conv === 'd' || conv === 'i') {
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        body = v.toString();
      } else if (conv === 'o') body = v.toString(8);
      else body = v.toString(16);
      if (conv === 'X') body = body.toUpperCase();
      if (prec >= 0) {
        if (prec === 0 && v === 0n) body = '';
        body = body.padStart(prec, '0');
        zeroOk = false;
      }
      if (alt) {
        if ((conv === 'x' || conv === 'X') && v !== 0n) prefix = conv === 'x' ? '0x' : '0X';
        if (conv === 'o' && !body.startsWith('0')) body = '0' + body;
      }
    } else {
      const v = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      const neg = v < 0 || Object.is(v, -0);
      if (Number.isNaN(v)) {
        body = upper ? 'NAN' : 'nan';
        zeroOk = false;
      } else {
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        if (!isFinite(v)) {
          body = upper ? 'INF' : 'inf';
          zeroOk = false;
        } else {
          const a = Math.abs(v);
          const lc = conv.toLowerCase();
          if (lc === 'f') body = fixed(a, prec < 0 ? 6 : prec, alt);
          else if (lc === 'e') body = expo(a, prec < 0 ? 6 : prec, alt, upper);
          else {
            let P = prec < 0 ? 6 : prec;
            if (P === 0) P = 1;
            const X = expDigits(a, P - 1)[1];
            if (P > X && X >= -4) body = fixed(a, P - 1 - X, alt);
            else body = expo(a, P - 1, alt, upper);
            if (!alt) body = stripZeros(body);
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
