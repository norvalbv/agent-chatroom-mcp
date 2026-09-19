const p10 = (n: number): bigint => 10n ** BigInt(n);

function decompose(x: number): [bigint, bigint] {
  const f = new Float64Array([x]);
  const b = new BigUint64Array(f.buffer)[0];
  const ex = Number((b >> 52n) & 0x7ffn);
  const mant = b & ((1n << 52n) - 1n);
  let m: bigint;
  let e: number;
  if (ex === 0) {
    m = mant;
    e = -1074;
  } else {
    m = mant | (1n << 52n);
    e = ex - 1075;
  }
  return e >= 0 ? [m << BigInt(e), 1n] : [m, 1n << BigInt(-e)];
}

// round(x * 10^k) half-even, x = num/den
function scaled(num: bigint, den: bigint, k: number): bigint {
  const n = k >= 0 ? num * p10(k) : num;
  const d = k >= 0 ? den : den * p10(-k);
  const q = n / d;
  const r = n % d;
  const c = 2n * r - d;
  if (c > 0n || (c === 0n && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// x >= 10^e ?
function gePow10(num: bigint, den: bigint, e: number): boolean {
  const l = e < 0 ? num * p10(-e) : num;
  const r = e > 0 ? den * p10(e) : den;
  return l >= r;
}

function fixed(ax: number, p: number, alt: boolean): string {
  const [num, den] = decompose(ax);
  let s = scaled(num, den, p).toString();
  if (s.length < p + 1) s = '0'.repeat(p + 1 - s.length) + s;
  const ip = s.slice(0, s.length - p);
  const fp = s.slice(s.length - p);
  return p > 0 ? ip + '.' + fp : alt ? ip + '.' : ip;
}

function expParts(ax: number, p: number): [string, number] {
  if (ax === 0) return ['0'.repeat(p + 1), 0];
  const [num, den] = decompose(ax);
  let e = Math.floor(Math.log10(ax));
  if (!isFinite(e)) e = -324;
  while (gePow10(num, den, e + 1)) e++;
  while (!gePow10(num, den, e)) e--;
  let d = scaled(num, den, p - e);
  if (d >= p10(p + 1)) {
    e++;
    d = scaled(num, den, p - e);
  }
  return [d.toString(), e];
}

function expStyle(ax: number, p: number, alt: boolean, upper: boolean): string {
  const [d, e] = expParts(ax, p);
  let s = d[0];
  if (p > 0) s += '.' + d.slice(1);
  else if (alt) s += '.';
  const ae = Math.abs(e);
  return s + (upper ? 'E' : 'e') + (e < 0 ? '-' : '+') + (ae < 10 ? '0' : '') + ae;
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
    while (i < fmt.length && fmt[i] >= '0' && fmt[i] <= '9') width = width * 10 + Number(fmt[i++]);
    let prec = -1;
    if (fmt[i] === '.') {
      i++;
      prec = 0;
      while (i < fmt.length && fmt[i] >= '0' && fmt[i] <= '9') prec = prec * 10 + Number(fmt[i++]);
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
      const v = BigInt(arg as number | bigint);
      const neg = v < 0n;
      const mag = neg ? -v : v;
      if (conv === 'd' || conv === 'i') {
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
      }
      let digits = conv === 'x' ? mag.toString(16) : conv === 'X' ? mag.toString(16).toUpperCase() : conv === 'o' ? mag.toString(8) : mag.toString();
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
      const x = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      if (Number.isNaN(x)) {
        body = upper ? 'NAN' : 'nan';
        canZero = false;
      } else {
        const negz = x < 0 || Object.is(x, -0);
        sign = negz ? '-' : plus ? '+' : space ? ' ' : '';
        const ax = Math.abs(x);
        if (!isFinite(ax)) {
          body = upper ? 'INF' : 'inf';
          canZero = false;
        } else {
          const lc = conv.toLowerCase();
          if (lc === 'f') {
            body = fixed(ax, prec < 0 ? 6 : prec, alt);
          } else if (lc === 'e') {
            body = expStyle(ax, prec < 0 ? 6 : prec, alt, upper);
          } else {
            let P = prec < 0 ? 6 : prec;
            if (P === 0) P = 1;
            const X = expParts(ax, P - 1)[1];
            if (P > X && X >= -4) {
              body = fixed(ax, P - 1 - X, alt);
              if (!alt) body = stripZeros(body);
            } else {
              const [d, e] = expParts(ax, P - 1);
              let m = d[0];
              if (P - 1 > 0) m += '.' + d.slice(1);
              else if (alt) m += '.';
              if (!alt) m = stripZeros(m);
              const ae = Math.abs(e);
              body = m + (upper ? 'E' : 'e') + (e < 0 ? '-' : '+') + (ae < 10 ? '0' : '') + ae;
            }
          }
        }
      }
    }

    const len = sign.length + prefix.length + body.length;
    if (len < width) {
      const pad = width - len;
      if (minus) body = sign + prefix + body + ' '.repeat(pad);
      else if (zero && canZero) body = sign + prefix + '0'.repeat(pad) + body;
      else body = ' '.repeat(pad) + sign + prefix + body;
    } else {
      body = sign + prefix + body;
    }
    out += body;
  }
  return out;
}
