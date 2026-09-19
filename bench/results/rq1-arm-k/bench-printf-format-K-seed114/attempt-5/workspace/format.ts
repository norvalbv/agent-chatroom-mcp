const pow10 = (n: number): bigint => 10n ** BigInt(n);

function roundDiv(n: bigint, d: bigint): bigint {
  const q = n / d;
  const r2 = (n % d) * 2n;
  if (r2 > d || (r2 === d && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// exact rational of a positive finite double: num/den
function rational(x: number): [bigint, bigint] {
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, x);
  const hi = buf.getUint32(0);
  const lo = buf.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  let mant = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let e: number;
  if (expBits === 0) {
    e = -1074;
  } else {
    mant |= 1n << 52n;
    e = expBits - 1075;
  }
  return e >= 0 ? [mant << BigInt(e), 1n] : [mant, 1n << BigInt(-e)];
}

// round(x * 10^s) exactly, half-even
function scaled(x: number, s: number): bigint {
  if (x === 0) return 0n;
  let [n, d] = rational(x);
  if (s >= 0) n *= pow10(s);
  else d *= pow10(-s);
  return roundDiv(n, d);
}

function fixed(x: number, p: number, alt: boolean): string {
  const s = scaled(x, p).toString().padStart(p + 1, '0');
  const ip = s.slice(0, s.length - p);
  const fp = s.slice(s.length - p);
  return ip + (p > 0 || alt ? '.' + fp : '');
}

// returns digit string (p+1 digits) and decimal exponent
function sci(x: number, p: number): [string, number] {
  if (x === 0) return ['0'.repeat(p + 1), 0];
  let e = Math.floor(Math.log10(x));
  if (!Number.isFinite(e)) e = 0;
  const lo = pow10(p);
  const hi = pow10(p + 1);
  for (let i = 0; i < 2000; i++) {
    const n = scaled(x, p - e);
    if (n < lo) e--;
    else if (n >= hi) e++;
    else return [n.toString(), e];
  }
  throw new Error('sci failed');
}

function expStr(e: number, upper: boolean): string {
  const a = Math.abs(e).toString().padStart(2, '0');
  return (upper ? 'E' : 'e') + (e < 0 ? '-' : '+') + a;
}

function sciStr(x: number, p: number, alt: boolean, upper: boolean): string {
  const [d, e] = sci(x, p);
  return d[0] + (p > 0 || alt ? '.' + d.slice(1) : '') + expStr(e, upper);
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
    let prec: number | undefined;
    if (fmt[i] === '.') {
      i++;
      let p = 0;
      while (fmt[i] >= '0' && fmt[i] <= '9') p = p * 10 + Number(fmt[i++]);
      prec = p;
    }
    const conv = fmt[i++];
    const arg = args[ai++];

    let sign = '';
    let prefix = '';
    let body = '';
    let zeroOk = false;

    if (conv === 's') {
      body = String(arg);
      if (prec !== undefined) body = body.slice(0, prec);
    } else if (conv === 'c') {
      body = String(arg);
    } else if (conv === 'd' || conv === 'i') {
      const v = BigInt(arg as number | bigint);
      const neg = v < 0n;
      let digits = (neg ? -v : v).toString();
      if (prec !== undefined) {
        if (prec === 0 && v === 0n) digits = '';
        digits = digits.padStart(prec, '0');
      }
      sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
      body = digits;
      zeroOk = prec === undefined;
    } else if (conv === 'x' || conv === 'X' || conv === 'o') {
      const v = BigInt(arg as number | bigint);
      let digits = v.toString(conv === 'o' ? 8 : 16);
      if (conv === 'X') digits = digits.toUpperCase();
      if (prec !== undefined) {
        if (prec === 0 && v === 0n) digits = '';
        digits = digits.padStart(prec, '0');
      }
      if (alt) {
        if (conv === 'o') {
          if (digits[0] !== '0') digits = '0' + digits;
        } else if (v !== 0n) {
          prefix = conv === 'x' ? '0x' : '0X';
        }
      }
      body = digits;
      zeroOk = prec === undefined;
    } else {
      const v = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      if (Number.isNaN(v)) {
        body = upper ? 'NAN' : 'nan';
      } else {
        const neg = v < 0 || Object.is(v, -0);
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        const a = Math.abs(v);
        if (a === Infinity) {
          body = upper ? 'INF' : 'inf';
        } else {
          zeroOk = true;
          const lc = conv.toLowerCase();
          if (lc === 'f') {
            body = fixed(a, prec ?? 6, alt);
          } else if (lc === 'e') {
            body = sciStr(a, prec ?? 6, alt, upper);
          } else {
            const P = Math.max(prec ?? 6, 1);
            const X = sci(a, P - 1)[1];
            if (P > X && X >= -4) {
              body = fixed(a, P - 1 - X, alt);
              if (!alt) body = stripZeros(body);
            } else {
              const [d, e] = sci(a, P - 1);
              let m = d[0] + (P > 1 || alt ? '.' + d.slice(1) : '');
              if (!alt) m = stripZeros(m);
              body = m + expStr(e, upper);
            }
          }
        }
      }
    }

    const len = sign.length + prefix.length + body.length;
    if (len >= width) {
      out += sign + prefix + body;
    } else if (minus) {
      out += sign + prefix + body + ' '.repeat(width - len);
    } else if (zero && zeroOk && conv !== 's' && conv !== 'c') {
      out += sign + prefix + '0'.repeat(width - len) + body;
    } else {
      out += ' '.repeat(width - len) + sign + prefix + body;
    }
  }
  return out;
}
