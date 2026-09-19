function decompose(x: number): { mant: bigint; exp2: number } {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const e = (hi >>> 20) & 0x7ff;
  let mant = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (e === 0) return { mant, exp2: -1074 };
  mant |= 1n << 52n;
  return { mant, exp2: e - 1075 };
}

// round_half_even(mant * 2^exp2 * 10^k)
function scaled(mant: bigint, exp2: number, k: number): bigint {
  let num = mant;
  let den = 1n;
  if (exp2 >= 0) num <<= BigInt(exp2);
  else den <<= BigInt(-exp2);
  if (k >= 0) num *= 10n ** BigInt(k);
  else den *= 10n ** BigInt(-k);
  const q = num / den;
  const r = num % den;
  const c = r * 2n;
  if (c > den || (c === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

function fixedDigits(ax: number, p: number): string {
  const { mant, exp2 } = decompose(ax);
  return scaled(mant, exp2, p).toString();
}

// returns digit string of length p+1 and decimal exponent
function expDigits(ax: number, p: number): { digits: string; exp: number } {
  if (ax === 0) return { digits: '0'.repeat(p + 1), exp: 0 };
  const { mant, exp2 } = decompose(ax);
  let e10 = Math.floor(Math.log10(ax));
  if (!isFinite(e10)) e10 = -324;
  for (let i = 0; i < 6; i++) {
    const n = scaled(mant, exp2, p - e10);
    const s = n.toString();
    if (s.length > p + 1) e10++;
    else if (s.length < p + 1) e10--;
    else return { digits: s, exp: e10 };
  }
  throw new Error('exp estimate failed');
}

function fStyle(ax: number, p: number, alt: boolean): string {
  let s = fixedDigits(ax, p);
  if (s.length <= p) s = '0'.repeat(p + 1 - s.length) + s;
  const ip = s.slice(0, s.length - p);
  const fp = s.slice(s.length - p);
  return ip + (p > 0 || alt ? '.' : '') + fp;
}

function eStyle(ax: number, p: number, alt: boolean, upper: boolean): string {
  const { digits, exp } = expDigits(ax, p);
  const m = digits[0] + (p > 0 || alt ? '.' : '') + digits.slice(1);
  const ea = Math.abs(exp).toString().padStart(2, '0');
  return m + (upper ? 'E' : 'e') + (exp < 0 ? '-' : '+') + ea;
}

function stripZeros(s: string): string {
  // s is mantissa possibly with '.', optionally followed by exponent part
  const ei = s.search(/[eE]/);
  let m = ei < 0 ? s : s.slice(0, ei);
  const tail = ei < 0 ? '' : s.slice(ei);
  if (m.includes('.')) {
    m = m.replace(/0+$/, '');
    if (m.endsWith('.')) m = m.slice(0, -1);
  }
  return m + tail;
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
      const f = fmt[i];
      if (f === '-') minus = true;
      else if (f === '+') plus = true;
      else if (f === ' ') space = true;
      else if (f === '0') zero = true;
      else if (f === '#') alt = true;
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
    let digits = '';
    let canZero = false;
    const lc = conv.toLowerCase();
    if (conv === 'd' || conv === 'i') {
      const v = BigInt(arg as number | bigint);
      const neg = v < 0n;
      digits = (neg ? -v : v).toString();
      if (prec >= 0) {
        if (prec === 0 && v === 0n) digits = '';
        digits = digits.padStart(prec, '0');
      }
      sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
      canZero = prec < 0;
    } else if (conv === 'x' || conv === 'X' || conv === 'o') {
      const v = BigInt(arg as number | bigint);
      digits = v.toString(conv === 'o' ? 8 : 16);
      if (conv === 'X') digits = digits.toUpperCase();
      if (prec >= 0) {
        if (prec === 0 && v === 0n) digits = '';
        digits = digits.padStart(prec, '0');
      }
      if (alt) {
        if (conv === 'o') {
          if (!digits.startsWith('0')) digits = '0' + digits;
        } else if (v !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      }
      canZero = prec < 0;
    } else if ('efg'.includes(lc)) {
      const x = arg as number;
      const upper = conv !== lc;
      const neg = x < 0 || Object.is(x, -0);
      if (Number.isNaN(x)) {
        digits = upper ? 'NAN' : 'nan';
      } else {
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        if (!isFinite(x)) digits = upper ? 'INF' : 'inf';
        else {
          const ax = Math.abs(x);
          canZero = true;
          if (lc === 'f') digits = fStyle(ax, prec < 0 ? 6 : prec, alt);
          else if (lc === 'e') digits = eStyle(ax, prec < 0 ? 6 : prec, alt, upper);
          else {
            let P = prec < 0 ? 6 : prec;
            if (P === 0) P = 1;
            const X = expDigits(ax, P - 1).exp;
            if (P > X && X >= -4) digits = fStyle(ax, P - 1 - X, alt);
            else digits = eStyle(ax, P - 1, alt, upper);
            if (!alt) digits = stripZeros(digits);
          }
        }
      }
    } else if (conv === 's') {
      digits = String(arg);
      if (prec >= 0) digits = digits.slice(0, prec);
    } else if (conv === 'c') {
      digits = String(arg);
    }
    const len = sign.length + prefix.length + digits.length;
    if (len >= width) out += sign + prefix + digits;
    else if (minus) out += sign + prefix + digits + ' '.repeat(width - len);
    else if (zero && canZero) out += sign + prefix + '0'.repeat(width - len) + digits;
    else out += ' '.repeat(width - len) + sign + prefix + digits;
  }
  return out;
}
