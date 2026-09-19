function roundDiv(num: bigint, den: bigint): bigint {
  const q = num / den;
  const r2 = (num - q * den) * 2n;
  if (r2 > den || (r2 === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// decompose a finite non-negative double into m * 2^e
function decompose(v: number): [bigint, number] {
  if (v === 0) return [0n, 0];
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, v);
  const bits = buf.getBigUint64(0);
  const exp = Number((bits >> 52n) & 0x7ffn);
  const frac = bits & ((1n << 52n) - 1n);
  if (exp === 0) return [frac, -1074];
  return [frac | (1n << 52n), exp - 1075];
}

// round(v * 10^k) half-even, exact
function scaled(v: number, k: number): bigint {
  const [m, e2] = decompose(v);
  let num = m;
  let den = 1n;
  if (e2 > 0) num <<= BigInt(e2);
  else den <<= BigInt(-e2);
  if (k > 0) num *= 10n ** BigInt(k);
  else if (k < 0) den *= 10n ** BigInt(-k);
  return roundDiv(num, den);
}

function fixedStr(v: number, p: number, alt: boolean): string {
  let s = scaled(v, p).toString();
  if (p > 0) {
    s = s.padStart(p + 1, '0');
    return s.slice(0, s.length - p) + '.' + s.slice(s.length - p);
  }
  return alt ? s + '.' : s;
}

// digits (p+1 of them) and decimal exponent
function expParts(v: number, p: number): [string, number] {
  if (v === 0) return ['0'.repeat(p + 1), 0];
  let e = Math.floor(Math.log10(v));
  if (!isFinite(e)) e = -324;
  const lo = 10n ** BigInt(p);
  const hi = lo * 10n;
  for (let i = 0; i < 2000; i++) {
    const d = scaled(v, p - e);
    if (d < lo) e--;
    else if (d >= hi) e++;
    else return [d.toString(), e];
  }
  throw new Error('exp');
}

function expStr(digits: string, e: number, p: number, alt: boolean, upper: boolean): string {
  let s = digits[0];
  if (p > 0) s += '.' + digits.slice(1);
  else if (alt) s += '.';
  const ae = Math.abs(e).toString().padStart(2, '0');
  return s + (upper ? 'E' : 'e') + (e < 0 ? '-' : '+') + ae;
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
    let canZero = false;
    const signFor = (neg: boolean) => (neg ? '-' : plus ? '+' : space ? ' ' : '');

    if (conv === 's' || conv === 'c') {
      body = String(arg);
      if (conv === 's' && prec >= 0) body = body.slice(0, prec);
    } else if ('dixXo'.includes(conv)) {
      const n = typeof arg === 'bigint' ? arg : BigInt(arg as number);
      const neg = n < 0n;
      const mag = neg ? -n : n;
      if (conv === 'd' || conv === 'i') sign = signFor(neg);
      let digits = mag.toString(conv === 'x' || conv === 'X' ? 16 : conv === 'o' ? 8 : 10);
      if (conv === 'X') digits = digits.toUpperCase();
      if (prec === 0 && mag === 0n) digits = '';
      if (prec > 0) digits = digits.padStart(prec, '0');
      if (alt) {
        if (conv === 'o') {
          if (digits[0] !== '0') digits = '0' + digits;
        } else if ((conv === 'x' || conv === 'X') && mag !== 0n) {
          prefix = conv === 'x' ? '0x' : '0X';
        }
      }
      body = digits;
      canZero = prec < 0;
    } else {
      const x = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      if (Number.isNaN(x)) {
        body = upper ? 'NAN' : 'nan';
      } else {
        sign = signFor(x < 0 || Object.is(x, -0));
        const v = Math.abs(x);
        if (v === Infinity) {
          body = upper ? 'INF' : 'inf';
        } else {
          canZero = true;
          const lc = conv.toLowerCase();
          if (lc === 'f') {
            body = fixedStr(v, prec < 0 ? 6 : prec, alt);
          } else if (lc === 'e') {
            const p = prec < 0 ? 6 : prec;
            const [d, e] = expParts(v, p);
            body = expStr(d, e, p, alt, upper);
          } else {
            let P = prec < 0 ? 6 : prec;
            if (P === 0) P = 1;
            const [d, X] = expParts(v, P - 1);
            if (P > X && X >= -4) {
              body = fixedStr(v, P - 1 - X, alt);
              if (!alt) body = stripZeros(body);
            } else {
              let m = d[0] + (P > 1 ? '.' + d.slice(1) : alt ? '.' : '');
              if (!alt) m = stripZeros(m);
              body = m + (upper ? 'E' : 'e') + (X < 0 ? '-' : '+') + Math.abs(X).toString().padStart(2, '0');
            }
          }
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
