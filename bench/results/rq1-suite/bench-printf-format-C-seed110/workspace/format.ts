function decompose(x: number): { m: bigint; e: number } {
  // x finite, >= 0
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const bexp = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (bexp === 0) return { m, e: -1074 };
  m |= 1n << 52n;
  return { m, e: bexp - 1075 };
}

// round-half-even(x * 10^k) for x >= 0
function scaled(x: number, k: number): bigint {
  const { m, e } = decompose(x);
  let num = m;
  let den = 1n;
  if (e > 0) num <<= BigInt(e);
  else den <<= BigInt(-e);
  if (k > 0) num *= 10n ** BigInt(k);
  else if (k < 0) den *= 10n ** BigInt(-k);
  let q = num / den;
  const r2 = (num % den) * 2n;
  if (r2 > den || (r2 === den && (q & 1n) === 1n)) q += 1n;
  return q;
}

// digits (p+1 of them) and decimal exponent in e style
function expDigits(x: number, p: number): { digits: string; exp: number } {
  if (x === 0) return { digits: '0'.repeat(p + 1), exp: 0 };
  let X = Math.floor(Math.log10(x));
  if (!Number.isFinite(X)) X = 0;
  const lo = 10n ** BigInt(p);
  const hi = lo * 10n;
  for (let i = 0; i < 10; i++) {
    const n = scaled(x, p - X);
    if (n >= hi) X++;
    else if (n < lo) X--;
    else return { digits: n.toString(), exp: X };
  }
  throw new Error('exp');
}

function fixedStr(x: number, p: number, alt: boolean): string {
  let s = scaled(x, p).toString();
  if (p > 0) {
    if (s.length <= p) s = '0'.repeat(p - s.length + 1) + s;
    return s.slice(0, s.length - p) + '.' + s.slice(s.length - p);
  }
  return alt ? s + '.' : s;
}

function expStr(x: number, p: number, alt: boolean, upper: boolean): string {
  const { digits, exp } = expDigits(x, p);
  let s = digits[0];
  if (p > 0) s += '.' + digits.slice(1);
  else if (alt) s += '.';
  const ae = Math.abs(exp);
  s += (upper ? 'E' : 'e') + (exp < 0 ? '-' : '+') + (ae < 10 ? '0' + ae : String(ae));
  return s;
}

function stripZeros(s: string): string {
  if (!s.includes('.')) return s;
  return s.replace(/0+$/, '').replace(/\.$/, '');
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
    while (fmt[i] >= '0' && fmt[i] <= '9') width = width * 10 + (fmt.charCodeAt(i++) - 48);
    let prec: number | undefined;
    if (fmt[i] === '.') {
      i++;
      prec = 0;
      while (fmt[i] >= '0' && fmt[i] <= '9') prec = prec * 10 + (fmt.charCodeAt(i++) - 48);
    }
    const conv = fmt[i++];
    const arg = args[ai++];

    let sign = '';
    let body = '';
    let canZero = false;
    const lower = conv.toLowerCase();
    const upper = conv !== lower;

    if (conv === 'd' || conv === 'i' || conv === 'x' || conv === 'X' || conv === 'o') {
      const v = BigInt(arg as number | bigint);
      const neg = v < 0n;
      const mag = neg ? -v : v;
      let digits: string;
      if (prec === 0 && mag === 0n) digits = '';
      else digits = mag.toString(conv === 'o' ? 8 : conv === 'd' || conv === 'i' ? 10 : 16);
      if (conv === 'X') digits = digits.toUpperCase();
      if (prec !== undefined && digits.length < prec) digits = '0'.repeat(prec - digits.length) + digits;
      if (conv === 'd' || conv === 'i') {
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
      } else if (alt) {
        if (conv === 'o') {
          if (digits[0] !== '0') digits = '0' + digits;
        } else if (mag !== 0n) sign = conv === 'x' ? '0x' : '0X';
      }
      body = digits;
      canZero = prec === undefined;
    } else if ('efg'.includes(lower) && lower.length === 1) {
      const x = arg as number;
      const negBit = x < 0 || Object.is(x, -0);
      if (Number.isNaN(x)) {
        body = upper ? 'NAN' : 'nan';
      } else {
        sign = negBit ? '-' : plus ? '+' : space ? ' ' : '';
        const a = Math.abs(x);
        if (a === Infinity) {
          body = upper ? 'INF' : 'inf';
        } else {
          canZero = true;
          if (lower === 'f') body = fixedStr(a, prec ?? 6, alt);
          else if (lower === 'e') body = expStr(a, prec ?? 6, alt, upper);
          else {
            let P = prec ?? 6;
            if (P === 0) P = 1;
            const X = expDigits(a, P - 1).exp;
            if (P > X && X >= -4) {
              body = fixedStr(a, P - 1 - X, alt);
              if (!alt) body = stripZeros(body);
            } else {
              body = expStr(a, P - 1, alt, upper);
              if (!alt) {
                const k = body.search(/[eE]/);
                body = stripZeros(body.slice(0, k)) + body.slice(k);
              }
            }
          }
        }
      }
    } else if (conv === 's') {
      body = String(arg);
      if (prec !== undefined) body = body.slice(0, prec);
    } else {
      body = String(arg);
    }

    const len = sign.length + body.length;
    if (len >= width) out += sign + body;
    else if (minus) out += sign + body + ' '.repeat(width - len);
    else if (zero && canZero) out += sign + '0'.repeat(width - len) + body;
    else out += ' '.repeat(width - len) + sign + body;
  }
  return out;
}
