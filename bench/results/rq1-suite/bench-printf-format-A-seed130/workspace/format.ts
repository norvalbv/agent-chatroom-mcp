function roundDiv(n: bigint, d: bigint): bigint {
  const q = n / d;
  const r2 = (n - q * d) * 2n;
  if (r2 > d || (r2 === d && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// exact |x| as [num, den]
function ratio(x: number): [bigint, bigint] {
  x = Math.abs(x);
  if (x === 0) return [0n, 1n];
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, x);
  const bits = buf.getBigUint64(0);
  const ex = Number((bits >> 52n) & 0x7ffn);
  let m = bits & ((1n << 52n) - 1n);
  let e: number;
  if (ex === 0) e = -1074;
  else {
    m |= 1n << 52n;
    e = ex - 1075;
  }
  return e >= 0 ? [m << BigInt(e), 1n] : [m, 1n << BigInt(-e)];
}

// round(|x| * 10^k)
function scaled(x: number, k: number): bigint {
  let [n, d] = ratio(x);
  if (k >= 0) n *= 10n ** BigInt(k);
  else d *= 10n ** BigInt(-k);
  return roundDiv(n, d);
}

function fixed(x: number, p: number, alt: boolean): string {
  let s = scaled(x, p).toString();
  if (p > 0) {
    s = s.padStart(p + 1, '0');
    return s.slice(0, s.length - p) + '.' + s.slice(s.length - p);
  }
  return alt ? s + '.' : s;
}

function expParts(x: number, p: number): [string, number] {
  if (x === 0) return ['0'.repeat(p + 1), 0];
  let X = Math.floor(Math.log10(Math.abs(x)));
  if (!isFinite(X)) X = -324;
  const lo = 10n ** BigInt(p);
  const hi = lo * 10n;
  for (let i = 0; i < 10; i++) {
    const dg = scaled(x, p - X);
    if (dg >= hi) X++;
    else if (dg < lo) X--;
    else return [dg.toString(), X];
  }
  throw new Error('exp');
}

function expStr(x: number, p: number, alt: boolean, upper: boolean): string {
  const [dg, X] = expParts(x, p);
  let s = dg[0];
  if (p > 0) s += '.' + dg.slice(1);
  else if (alt) s += '.';
  const a = Math.abs(X);
  return s + (upper ? 'E' : 'e') + (X < 0 ? '-' : '+') + (a < 10 ? '0' + a : String(a));
}

function stripZeros(s: string): string {
  const ei = s.search(/[eE]/);
  let mant = ei < 0 ? s : s.slice(0, ei);
  const rest = ei < 0 ? '' : s.slice(ei);
  if (mant.includes('.')) mant = mant.replace(/0+$/, '').replace(/\.$/, '');
  return mant + rest;
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
    let body: string;
    let canZero = true;
    const lc = conv.toLowerCase();

    if (conv === 's' || conv === 'c') {
      body = String(arg);
      if (conv === 's' && prec >= 0) body = body.slice(0, prec);
      canZero = false;
      zero = false;
    } else if (conv === 'd' || conv === 'i' || conv === 'x' || conv === 'X' || conv === 'o') {
      const v = typeof arg === 'bigint' ? arg : BigInt(arg as number);
      const neg = v < 0n;
      const mag = neg ? -v : v;
      let dg = conv === 'd' || conv === 'i' ? mag.toString() : conv === 'o' ? mag.toString(8) : mag.toString(16);
      if (conv === 'X') dg = dg.toUpperCase();
      if (prec === 0 && mag === 0n) dg = '';
      if (prec > dg.length) dg = dg.padStart(prec, '0');
      if (conv === 'd' || conv === 'i') {
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
      } else if (alt) {
        if (conv === 'o') {
          if (dg[0] !== '0') dg = '0' + dg;
        } else if (mag !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      }
      body = dg;
      if (prec >= 0) canZero = false;
    } else {
      const x = arg as number;
      const upper = conv === conv.toUpperCase();
      const neg = !Number.isNaN(x) && (x < 0 || Object.is(x, -0));
      sign = Number.isNaN(x) ? '' : neg ? '-' : plus ? '+' : space ? ' ' : '';
      if (Number.isNaN(x) || !isFinite(x)) {
        body = Number.isNaN(x) ? 'nan' : 'inf';
        if (upper) body = body.toUpperCase();
        canZero = false;
      } else {
        const p = prec < 0 ? 6 : prec;
        if (lc === 'f') body = fixed(x, p, alt);
        else if (lc === 'e') body = expStr(x, p, alt, upper);
        else {
          const P = p === 0 ? 1 : p;
          const X = expParts(x, P - 1)[1];
          if (P > X && X >= -4) body = fixed(x, P - 1 - X, alt);
          else body = expStr(x, P - 1, alt, upper);
          if (!alt) body = stripZeros(body);
          else if (!body.includes('.')) {
            const ei = body.search(/[eE]/);
            body = ei < 0 ? body + '.' : body.slice(0, ei) + '.' + body.slice(ei);
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
