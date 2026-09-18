type Rat = [bigint, bigint];

function toRat(x: number): Rat {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
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

const p10 = (n: number) => 10n ** BigInt(n);

// round(v * 10^s), half to even
function roundScaled(v: Rat, s: number): bigint {
  let [n, d] = v;
  if (s >= 0) n *= p10(s);
  else d *= p10(-s);
  const q = n / d;
  const r2 = (n % d) * 2n;
  if (r2 > d || (r2 === d && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// compare v with 10^k
function cmp10(v: Rat, k: number): number {
  let [n, d] = v;
  let a = n, b = d;
  if (k >= 0) b *= p10(k);
  else a *= p10(-k);
  return a < b ? -1 : a > b ? 1 : 0;
}

function fixedStr(v: Rat, p: number, alt: boolean): string {
  let s = roundScaled(v, p).toString();
  if (p > 0) {
    s = s.padStart(p + 1, '0');
    s = s.slice(0, s.length - p) + '.' + s.slice(s.length - p);
  } else if (alt) s += '.';
  return s;
}

// returns digits (p+1 of them) and exponent
function expParts(v: Rat, zero: boolean, p: number): [string, number] {
  if (zero) return ['0'.repeat(p + 1), 0];
  let k = Math.floor(Math.log10(Number(v[0]) / Number(v[1])));
  if (!isFinite(k)) k = 0;
  while (cmp10(v, k) < 0) k--;
  while (cmp10(v, k + 1) >= 0) k++;
  let dg = roundScaled(v, p - k).toString();
  if (dg.length > p + 1) {
    k++;
    dg = dg.slice(0, p + 1);
  }
  return [dg, k];
}

function expStr(dg: string, k: number, alt: boolean, upper: boolean): string {
  const p = dg.length - 1;
  let s = dg[0] + (p > 0 ? '.' + dg.slice(1) : alt ? '.' : '');
  const ax = Math.abs(k);
  s += (upper ? 'E' : 'e') + (k < 0 ? '-' : '+') + (ax < 10 ? '0' + ax : String(ax));
  return s;
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let out = '';
  let ai = 0;
  let i = 0;
  while (i < fmt.length) {
    const ch = fmt[i++];
    if (ch !== '%') {
      out += ch;
      continue;
    }
    if (fmt[i] === '%') {
      out += '%';
      i++;
      continue;
    }
    let left = false, plus = false, space = false, zero = false, alt = false;
    for (; i < fmt.length; i++) {
      const c = fmt[i];
      if (c === '-') left = true;
      else if (c === '+') plus = true;
      else if (c === ' ') space = true;
      else if (c === '0') zero = true;
      else if (c === '#') alt = true;
      else break;
    }
    let width = 0;
    if (fmt[i] === '*') {
      width = Number(args[ai++]);
      i++;
      if (width < 0) {
        left = true;
        width = -width;
      }
    } else {
      while (fmt[i] >= '0' && fmt[i] <= '9') width = width * 10 + Number(fmt[i++]);
    }
    let prec = -1;
    if (fmt[i] === '.') {
      i++;
      prec = 0;
      if (fmt[i] === '*') {
        prec = Number(args[ai++]);
        i++;
      } else {
        while (fmt[i] >= '0' && fmt[i] <= '9') prec = prec * 10 + Number(fmt[i++]);
      }
    }
    let bits = 32;
    if (fmt[i] === 'h') {
      i++;
      if (fmt[i] === 'h') {
        i++;
        bits = 8;
      } else bits = 16;
    } else if (fmt[i] === 'l') {
      i++;
      if (fmt[i] === 'l') i++;
      bits = 64;
    }
    const conv = fmt[i++];
    const arg = args[ai++];

    let prefix = '';
    let body = '';
    let canZero = false;

    switch (conv) {
      case 'd': case 'i': case 'u': case 'x': case 'X': case 'o': {
        const big = BigInt(arg as number | bigint);
        let val: bigint;
        if (conv === 'd' || conv === 'i') val = BigInt.asIntN(bits, big);
        else val = BigInt.asUintN(bits, big);
        const neg = val < 0n;
        const mag = neg ? -val : val;
        let digits = mag.toString(conv === 'o' ? 8 : conv === 'x' || conv === 'X' ? 16 : 10);
        if (conv === 'X') digits = digits.toUpperCase();
        if (prec === 0 && mag === 0n) digits = '';
        if (prec > digits.length) digits = '0'.repeat(prec - digits.length) + digits;
        if (conv === 'o' && alt && digits[0] !== '0') digits = '0' + digits;
        if (conv === 'd' || conv === 'i') prefix = neg ? '-' : plus ? '+' : space ? ' ' : '';
        else if ((conv === 'x' || conv === 'X') && alt && mag !== 0n) prefix = conv === 'x' ? '0x' : '0X';
        body = digits;
        canZero = prec < 0;
        break;
      }
      case 'e': case 'E': case 'f': case 'F': case 'g': case 'G': {
        const x = arg as number;
        const upper = conv === 'E' || conv === 'F' || conv === 'G';
        if (Number.isNaN(x)) {
          body = upper ? 'NAN' : 'nan';
          break;
        }
        const negBit = x < 0 || Object.is(x, -0);
        prefix = negBit ? '-' : plus ? '+' : space ? ' ' : '';
        if (!isFinite(x)) {
          body = upper ? 'INF' : 'inf';
          break;
        }
        canZero = true;
        const v = toRat(Math.abs(x));
        const isZero = x === 0;
        const lc = conv.toLowerCase();
        if (lc === 'f') {
          body = fixedStr(v, prec < 0 ? 6 : prec, alt);
        } else if (lc === 'e') {
          const p = prec < 0 ? 6 : prec;
          const [dg, k] = expParts(v, isZero, p);
          body = expStr(dg, k, alt, upper);
        } else {
          let P = prec < 0 ? 6 : prec;
          if (P === 0) P = 1;
          const [dg, X] = expParts(v, isZero, P - 1);
          if (P > X && X >= -4) {
            body = fixedStr(v, P - 1 - X, alt);
            if (!alt && body.includes('.')) body = body.replace(/0+$/, '').replace(/\.$/, '');
          } else {
            let d = dg;
            if (!alt) d = d[0] + d.slice(1).replace(/0+$/, '');
            body = expStr(d, X, alt, upper);
          }
        }
        break;
      }
      case 's': {
        body = String(arg);
        if (prec >= 0) body = body.slice(0, prec);
        break;
      }
      case 'c':
        body = String(arg);
        break;
    }

    const len = prefix.length + body.length;
    if (len >= width) out += prefix + body;
    else if (left) out += prefix + body + ' '.repeat(width - len);
    else if (zero && canZero) out += prefix + '0'.repeat(width - len) + body;
    else out += ' '.repeat(width - len) + prefix + body;
  }
  return out;
}
