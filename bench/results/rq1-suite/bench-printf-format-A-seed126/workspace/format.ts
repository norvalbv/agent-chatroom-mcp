// round(|x| * 10^k) to integer, half-even, exact. x finite nonzero-or-zero.
function decompose(x: number): { mant: bigint; exp: number } {
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, Math.abs(x));
  const hi = buf.getUint32(0);
  const lo = buf.getUint32(4);
  const e = (hi >>> 20) & 0x7ff;
  let mant = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (e === 0) return { mant, exp: -1074 };
  mant |= 1n << 52n;
  return { mant, exp: e - 1075 };
}

function scaled(x: number, k: number): bigint {
  const { mant, exp } = decompose(x);
  let num = mant;
  let den = 1n;
  if (exp >= 0) num <<= BigInt(exp);
  else den <<= BigInt(-exp);
  if (k >= 0) num *= 10n ** BigInt(k);
  else den *= 10n ** BigInt(-k);
  const q = num / den;
  const r2 = (num % den) * 2n;
  if (r2 > den || (r2 === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

function sciParts(x: number, p: number): { digits: string; exp10: number } {
  if (x === 0) return { digits: '0'.repeat(p + 1), exp10: 0 };
  let e10 = Math.floor(Math.log10(Math.abs(x)));
  if (!isFinite(e10)) e10 = -324;
  const lowB = 10n ** BigInt(p);
  const highB = lowB * 10n;
  for (let i = 0; i < 20; i++) {
    const v = scaled(x, p - e10);
    if (v >= highB) e10++;
    else if (v < lowB) e10--;
    else return { digits: v.toString(), exp10: e10 };
  }
  throw new Error('exp search failed');
}

function fixedStr(x: number, prec: number, alt: boolean): string {
  let s = scaled(x, prec).toString();
  if (prec > 0) {
    s = s.padStart(prec + 1, '0');
    return s.slice(0, s.length - prec) + '.' + s.slice(s.length - prec);
  }
  return alt ? s + '.' : s;
}

function sciStr(x: number, prec: number, alt: boolean, upper: boolean): string {
  const { digits, exp10 } = sciParts(x, prec);
  let s = digits[0];
  if (prec > 0) s += '.' + digits.slice(1);
  else if (alt) s += '.';
  const ae = Math.abs(exp10);
  s += (upper ? 'E' : 'e') + (exp10 < 0 ? '-' : '+') + (ae < 10 ? '0' + ae : String(ae));
  return s;
}

function stripZeros(s: string): string {
  const ei = s.search(/[eE]/);
  let mantissa = ei >= 0 ? s.slice(0, ei) : s;
  const tail = ei >= 0 ? s.slice(ei) : '';
  if (mantissa.includes('.')) mantissa = mantissa.replace(/0+$/, '').replace(/\.$/, '');
  return mantissa + tail;
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
    } else if (conv === 'd' || conv === 'i' || conv === 'x' || conv === 'X' || conv === 'o') {
      let v = typeof arg === 'bigint' ? arg : BigInt(arg as number);
      if (v < 0n) {
        sign = '-';
        v = -v;
      } else if (conv === 'd' || conv === 'i') {
        sign = plus ? '+' : space ? ' ' : '';
      }
      const radix = conv === 'o' ? 8 : conv === 'd' || conv === 'i' ? 10 : 16;
      let digits = v.toString(radix);
      if (conv === 'X') digits = digits.toUpperCase();
      if (prec === 0 && v === 0n) digits = '';
      if (prec >= 0) digits = digits.padStart(prec, '0');
      if (alt) {
        if (conv === 'o') {
          if (digits[0] !== '0') digits = '0' + digits;
        } else if ((conv === 'x' || conv === 'X') && v !== 0n) {
          prefix = conv === 'x' ? '0x' : '0X';
        }
      }
      body = digits;
      if (prec >= 0) canZero = false;
    } else {
      const x = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      const neg = x < 0 || Object.is(x, -0);
      if (!Number.isNaN(x)) sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
      if (!isFinite(x)) {
        body = Number.isNaN(x) ? 'nan' : 'inf';
        if (upper) body = body.toUpperCase();
        canZero = false;
      } else {
        const p = prec < 0 ? 6 : prec;
        const lc = conv.toLowerCase();
        if (lc === 'f') body = fixedStr(x, p, alt);
        else if (lc === 'e') body = sciStr(x, p, alt, upper);
        else {
          const P = p === 0 ? 1 : p;
          const X = sciParts(x, P - 1).exp10;
          if (P > X && X >= -4) body = fixedStr(x, P - 1 - X, alt);
          else body = sciStr(x, P - 1, alt, upper);
          if (!alt) body = stripZeros(body);
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
