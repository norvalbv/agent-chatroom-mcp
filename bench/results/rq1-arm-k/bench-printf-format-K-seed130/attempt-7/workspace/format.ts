function roundDiv(n: bigint, d: bigint): bigint {
  const q = n / d;
  const r2 = (n % d) * 2n;
  if (r2 > d || (r2 === d && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// exact rational n/d of a finite non-negative double
function ratio(x: number): [bigint, bigint] {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const be = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let e: number;
  if (be === 0) e = -1074;
  else {
    m |= 1n << 52n;
    e = be - 1075;
  }
  return e >= 0 ? [m << BigInt(e), 1n] : [m, 1n << BigInt(-e)];
}

// round(x * 10^k), half-even, exact
function scaled(x: number, k: number): bigint {
  const [n, d] = ratio(x);
  return k >= 0 ? roundDiv(n * 10n ** BigInt(k), d) : roundDiv(n, d * 10n ** BigInt(-k));
}

// p digits after the point: returns digit string of length p+1 and exponent
function expDigits(x: number, p: number): [string, number] {
  if (x === 0) return ['0'.repeat(p + 1), 0];
  let est = Math.floor(Math.log10(x));
  const lowB = 10n ** BigInt(p);
  const highB = lowB * 10n;
  for (let i = 0; i < 20; i++) {
    const s = scaled(x, p - est);
    if (s === highB) return [lowB.toString(), est + 1];
    if (s > highB) est++;
    else if (s < lowB) est--;
    else return [s.toString(), est];
  }
  throw new Error('exp');
}

function fixedStr(x: number, p: number, alt: boolean): string {
  let s = scaled(x, p).toString();
  if (s.length < p + 1) s = '0'.repeat(p + 1 - s.length) + s;
  const ip = s.slice(0, s.length - p);
  const fp = s.slice(s.length - p);
  return p > 0 ? ip + '.' + fp : alt ? ip + '.' : ip;
}

function expStr(x: number, p: number, alt: boolean, upper: boolean): string {
  const [ds, ex] = expDigits(x, p);
  let out = ds[0];
  if (p > 0) out += '.' + ds.slice(1);
  else if (alt) out += '.';
  const ae = Math.abs(ex);
  return out + (upper ? 'E' : 'e') + (ex < 0 ? '-' : '+') + (ae < 10 ? '0' : '') + ae;
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
      prec = 0;
      while (fmt[i] >= '0' && fmt[i] <= '9') prec = prec * 10 + Number(fmt[i++]);
    }
    const conv = fmt[i++];
    const arg = args[ai++];
    let sign = '';
    let prefix = '';
    let body = '';
    let canZero = zero && !minus;
    const signOf = (neg: boolean) => (neg ? '-' : plus ? '+' : space ? ' ' : '');

    switch (conv) {
      case 'd':
      case 'i':
      case 'x':
      case 'X':
      case 'o': {
        const v = BigInt(arg as number | bigint);
        const neg = v < 0n;
        const mag = neg ? -v : v;
        const base = conv === 'x' || conv === 'X' ? 16 : conv === 'o' ? 8 : 10;
        body = mag.toString(base);
        if (conv === 'X') body = body.toUpperCase();
        if (prec !== undefined) {
          if (prec === 0 && mag === 0n) body = '';
          if (body.length < prec) body = '0'.repeat(prec - body.length) + body;
          canZero = false;
        }
        if (base === 10) sign = signOf(neg);
        else if (alt) {
          if (base === 8) {
            if (body[0] !== '0') body = '0' + body;
          } else if (mag !== 0n) prefix = conv === 'x' ? '0x' : '0X';
        }
        break;
      }
      case 'e':
      case 'E':
      case 'f':
      case 'F':
      case 'g':
      case 'G': {
        const v = arg as number;
        const upper = conv === 'E' || conv === 'F' || conv === 'G';
        if (Number.isNaN(v)) {
          body = upper ? 'NAN' : 'nan';
          canZero = false;
          break;
        }
        const neg = v < 0 || Object.is(v, -0);
        sign = signOf(neg);
        if (!Number.isFinite(v)) {
          body = upper ? 'INF' : 'inf';
          canZero = false;
          break;
        }
        const x = Math.abs(v);
        const lc = conv.toLowerCase();
        if (lc === 'f') body = fixedStr(x, prec ?? 6, alt);
        else if (lc === 'e') body = expStr(x, prec ?? 6, alt, upper);
        else {
          let P = prec ?? 6;
          if (P === 0) P = 1;
          const X = expDigits(x, P - 1)[1];
          if (P > X && X >= -4) {
            body = fixedStr(x, P - 1 - X, alt);
            if (!alt) body = stripZeros(body);
          } else {
            body = expStr(x, P - 1, alt, upper);
            if (!alt) {
              const k = body.search(/[eE]/);
              body = stripZeros(body.slice(0, k)) + body.slice(k);
            }
          }
        }
        break;
      }
      case 's':
        body = String(arg);
        if (prec !== undefined) body = body.slice(0, prec);
        canZero = false;
        break;
      case 'c':
        body = String(arg);
        canZero = false;
        break;
      default:
        throw new Error('bad conversion');
    }

    const len = sign.length + prefix.length + body.length;
    if (len >= width) out += sign + prefix + body;
    else if (minus) out += sign + prefix + body + ' '.repeat(width - len);
    else if (canZero) out += sign + prefix + '0'.repeat(width - len) + body;
    else out += ' '.repeat(width - len) + sign + prefix + body;
  }
  return out;
}
