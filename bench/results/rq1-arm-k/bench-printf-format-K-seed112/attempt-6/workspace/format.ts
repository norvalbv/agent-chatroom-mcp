function pow10(n: number): bigint {
  return 10n ** BigInt(n);
}

// x (finite, > 0) as num/den exactly
function exact(x: number): [bigint, bigint] {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const bexp = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let k: number;
  if (bexp === 0) {
    k = -1074;
  } else {
    m |= 1n << 52n;
    k = bexp - 1075;
  }
  return k >= 0 ? [m << BigInt(k), 1n] : [m, 1n << BigInt(-k)];
}

function divHalfEven(n: bigint, d: bigint): bigint {
  const q = n / d;
  const r = n - q * d;
  const twice = r * 2n;
  if (twice > d || (twice === d && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// round x * 10^s to an integer, half-even
function scaledRound(f: [bigint, bigint], s: number): bigint {
  let [n, d] = f;
  if (s >= 0) n *= pow10(s);
  else d *= pow10(-s);
  return divHalfEven(n, d);
}

// x >= 0 finite. Returns digits string (p+1 digits) and decimal exponent.
function eDigits(x: number, p: number): [string, number] {
  if (x === 0) return ['0'.repeat(p + 1), 0];
  const f = exact(x);
  let e = Math.floor(Math.log10(x));
  if (!isFinite(e)) e = 0;
  const lowB = pow10(p);
  const highB = pow10(p + 1);
  for (;;) {
    const d = scaledRound(f, p - e);
    if (d < lowB) e--;
    else if (d >= highB) e++;
    else return [d.toString(), e];
  }
}

function fixed(x: number, p: number): string {
  let s: string;
  if (x === 0) s = '0'.repeat(p + 1);
  else s = scaledRound(exact(x), p).toString().padStart(p + 1, '0');
  if (p === 0) return s;
  return s.slice(0, s.length - p) + '.' + s.slice(s.length - p);
}

function expStr(e: number, upper: boolean): string {
  const a = Math.abs(e);
  return (upper ? 'E' : 'e') + (e < 0 ? '-' : '+') + (a < 10 ? '0' + a : String(a));
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

    if (conv === 's' || conv === 'c') {
      body = String(arg);
      if (conv === 's' && prec >= 0) body = body.slice(0, prec);
      canZero = false;
    } else if (conv === 'd' || conv === 'i') {
      const v = typeof arg === 'bigint' ? arg : BigInt(arg as number);
      const neg = v < 0n;
      let digits = (neg ? -v : v).toString();
      if (prec >= 0) {
        if (prec === 0 && v === 0n) digits = '';
        digits = digits.padStart(prec, '0');
        canZero = false;
      }
      sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
      body = digits;
    } else if (conv === 'x' || conv === 'X' || conv === 'o') {
      const v = typeof arg === 'bigint' ? arg : BigInt(arg as number);
      let digits = v.toString(conv === 'o' ? 8 : 16);
      if (conv === 'X') digits = digits.toUpperCase();
      if (prec >= 0) {
        if (prec === 0 && v === 0n) digits = '';
        digits = digits.padStart(prec, '0');
        canZero = false;
      }
      if (alt) {
        if (conv === 'o') {
          if (digits[0] !== '0') digits = '0' + digits;
        } else if (v !== 0n) {
          prefix = conv === 'x' ? '0x' : '0X';
        }
      }
      body = digits;
    } else {
      const x = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
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
        } else if (conv === 'f' || conv === 'F') {
          const p = prec < 0 ? 6 : prec;
          body = fixed(a, p);
          if (p === 0 && alt) body += '.';
        } else if (conv === 'e' || conv === 'E') {
          const p = prec < 0 ? 6 : prec;
          const [d, e] = eDigits(a, p);
          body = d[0] + (p > 0 ? '.' + d.slice(1) : alt ? '.' : '') + expStr(e, upper);
        } else {
          let p = prec < 0 ? 6 : prec;
          if (p === 0) p = 1;
          const [d, e] = eDigits(a, p - 1);
          if (p > e && e >= -4) {
            body = fixed(a, p - 1 - e);
            if (!alt) body = stripZeros(body);
            else if (!body.includes('.')) body += '.';
          } else {
            let m = d[0] + (p > 1 ? '.' + d.slice(1) : '');
            if (!alt) m = stripZeros(m);
            else if (!m.includes('.')) m += '.';
            body = m + expStr(e, upper);
          }
        }
      }
    }

    let text = sign + prefix + body;
    if (text.length < width) {
      const n = width - text.length;
      if (minus) text += ' '.repeat(n);
      else if (zero && canZero) text = sign + prefix + '0'.repeat(n) + body;
      else text = ' '.repeat(n) + text;
    }
    out += text;
  }
  return out;
}
