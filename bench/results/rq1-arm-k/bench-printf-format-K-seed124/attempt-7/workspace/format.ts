function ratio(x: number): [bigint, bigint] {
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, x);
  const hi = buf.getUint32(0);
  const lo = buf.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let e: number;
  if (expBits === 0) e = -1074;
  else {
    m |= 1n << 52n;
    e = expBits - 1075;
  }
  return e >= 0 ? [m << BigInt(e), 1n] : [m, 1n << BigInt(-e)];
}

// round(num/den) half to even
function divRound(num: bigint, den: bigint): bigint {
  const q = num / den;
  const r2 = (num % den) * 2n;
  if (r2 > den || (r2 === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

function pow10(n: number): bigint {
  return 10n ** BigInt(n);
}

// x >= 0 finite
function fixedDigits(x: number, p: number, alt: boolean): string {
  let n: bigint;
  if (x === 0) n = 0n;
  else {
    const [num, den] = ratio(x);
    n = divRound(num * pow10(p), den);
  }
  let s = n.toString();
  if (s.length < p + 1) s = '0'.repeat(p + 1 - s.length) + s;
  const ip = s.slice(0, s.length - p);
  const fp = s.slice(s.length - p);
  return p > 0 ? ip + '.' + fp : alt ? ip + '.' : ip;
}

// returns [digit string of length p+1, exponent]
function expParts(x: number, p: number): [string, number] {
  if (x === 0) return ['0'.repeat(p + 1), 0];
  const [num, den] = ratio(x);
  let X = Math.floor(Math.log10(x));
  if (!isFinite(X)) X = 0;
  const ge = (k: number) => (k >= 0 ? num >= den * pow10(k) : num * pow10(-k) >= den);
  while (!ge(X)) X--;
  while (ge(X + 1)) X++;
  const sh = p - X;
  let d = sh >= 0 ? divRound(num * pow10(sh), den) : divRound(num, den * pow10(-sh));
  if (d >= pow10(p + 1)) {
    X++;
    d = d / 10n;
  }
  return [d.toString(), X];
}

function expStr(digits: string, X: number, upper: boolean, alt: boolean): string {
  const p = digits.length - 1;
  let m = digits[0];
  if (p > 0) m += '.' + digits.slice(1);
  else if (alt) m += '.';
  const ax = Math.abs(X);
  return m + (upper ? 'E' : 'e') + (X < 0 ? '-' : '+') + (ax < 10 ? '0' : '') + ax;
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
    const lower = conv.toLowerCase();

    if (conv === 's' || conv === 'c') {
      body = String(arg);
      if (conv === 's' && prec >= 0) body = body.slice(0, prec);
      canZero = false;
    } else if (conv === 'd' || conv === 'i' || conv === 'x' || conv === 'X' || conv === 'o') {
      const v = BigInt(arg as number | bigint);
      const neg = v < 0n;
      const mag = neg ? -v : v;
      if (conv === 'd' || conv === 'i') {
        body = mag.toString();
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
      } else if (conv === 'o') body = mag.toString(8);
      else {
        body = mag.toString(16);
        if (conv === 'X') body = body.toUpperCase();
      }
      if (prec >= 0) {
        if (prec === 0 && mag === 0n) body = '';
        if (body.length < prec) body = '0'.repeat(prec - body.length) + body;
        canZero = false;
      }
      if (alt) {
        if (conv === 'o') {
          if (body[0] !== '0') body = '0' + body;
        } else if (conv !== 'd' && conv !== 'i' && mag !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      }
    } else {
      const x = arg as number;
      const upper = conv === conv.toUpperCase();
      if (x !== x) {
        body = upper ? 'NAN' : 'nan';
        canZero = false;
      } else {
        const neg = x < 0 || Object.is(x, -0);
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        const ax = Math.abs(x);
        if (ax === Infinity) {
          body = upper ? 'INF' : 'inf';
          canZero = false;
        } else if (lower === 'f') {
          body = fixedDigits(ax, prec < 0 ? 6 : prec, alt);
        } else if (lower === 'e') {
          const [d, X] = expParts(ax, prec < 0 ? 6 : prec);
          body = expStr(d, X, upper, alt);
        } else {
          const P = prec < 0 ? 6 : prec === 0 ? 1 : prec;
          const [d, X] = expParts(ax, P - 1);
          if (P > X && X >= -4) {
            body = fixedDigits(ax, P - 1 - X, alt);
            if (!alt) body = stripZeros(body);
          } else {
            let dd = d;
            if (!alt) dd = d[0] + (stripZeros('0.' + d.slice(1)).slice(2));
            body = expStr(dd, X, upper, alt);
          }
        }
      }
    }

    const len = sign.length + prefix.length + body.length;
    if (len < width) {
      const pad = width - len;
      if (minus) body = sign + prefix + body + ' '.repeat(pad);
      else if (zero && canZero && conv !== 's' && conv !== 'c') body = sign + prefix + '0'.repeat(pad) + body;
      else body = ' '.repeat(pad) + sign + prefix + body;
    } else body = sign + prefix + body;
    out += body;
  }
  return out;
}
