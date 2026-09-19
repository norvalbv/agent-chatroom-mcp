function decompose(x: number): [bigint, number] {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (expBits === 0) return [m, -1074];
  m |= 1n << 52n;
  return [m, expBits - 1075];
}

// round(num/den), ties to even
function roundDiv(num: bigint, den: bigint): bigint {
  const q = num / den;
  const r2 = (num % den) * 2n;
  if (r2 > den || (r2 === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// round(|x| * 10^k) exactly, k may be negative
function scaledRound(m: bigint, e: number, k: number): bigint {
  let num = m;
  let den = 1n;
  if (e >= 0) num <<= BigInt(e);
  else den <<= BigInt(-e);
  if (k >= 0) num *= 10n ** BigInt(k);
  else den *= 10n ** BigInt(-k);
  return roundDiv(num, den);
}

// digits (string of p+1 digits) and decimal exponent of |x| in e style
function expDigits(x: number, p: number): [string, number] {
  if (x === 0) return ['0'.repeat(p + 1), 0];
  const [m, e] = decompose(x);
  let x10 = Math.floor(Math.log10(x));
  if (!isFinite(x10)) x10 = Number(x.toExponential().split('e')[1]);
  const lo = 10n ** BigInt(p);
  for (;;) {
    const d = scaledRound(m, e, p - x10);
    if (d >= lo * 10n) x10++;
    else if (d < lo) x10--;
    else return [d.toString(), x10];
  }
}

function fixedStr(x: number, p: number, alt: boolean): string {
  let s: string;
  if (x === 0) s = '0'.repeat(p + 1);
  else {
    const [m, e] = decompose(x);
    s = scaledRound(m, e, p).toString();
    if (s.length < p + 1) s = '0'.repeat(p + 1 - s.length) + s;
  }
  const ip = s.slice(0, s.length - p);
  const fp = s.slice(s.length - p);
  return ip + (p > 0 || alt ? '.' : '') + fp;
}

function expStr(x: number, p: number, alt: boolean, upper: boolean): string {
  const [d, x10] = expDigits(x, p);
  const ax = Math.abs(x10);
  return (
    d[0] + (p > 0 || alt ? '.' : '') + d.slice(1) +
    (upper ? 'E' : 'e') + (x10 < 0 ? '-' : '+') + (ax < 10 ? '0' : '') + ax
  );
}

function stripZeros(s: string): string {
  // s has form digits[.digits] possibly followed by exponent part
  const m = /^([^eE]*)([eE].*)?$/.exec(s)!;
  let mant = m[1];
  if (mant.includes('.')) mant = mant.replace(/0+$/, '').replace(/\.$/, '');
  return mant + (m[2] ?? '');
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
    let body = '';
    let canZero = true;

    if (conv === 's' || conv === 'c') {
      body = String(arg);
      if (conv === 's' && prec >= 0) body = body.slice(0, prec);
      canZero = false;
    } else if (conv === 'd' || conv === 'i' || conv === 'x' || conv === 'X' || conv === 'o') {
      const v = typeof arg === 'bigint' ? arg : BigInt(arg as number);
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
        canZero = false;
        if (prec === 0 && mag === 0n) body = '';
        else if (body.length < prec) body = '0'.repeat(prec - body.length) + body;
      }
      if (alt) {
        if (conv === 'o') {
          if (body[0] !== '0') body = '0' + body;
        } else if (mag !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      }
    } else {
      const x = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      const lc = conv.toLowerCase();
      if (Number.isNaN(x)) {
        body = upper ? 'NAN' : 'nan';
        canZero = false;
      } else {
        const negative = x < 0 || Object.is(x, -0);
        sign = negative ? '-' : plus ? '+' : space ? ' ' : '';
        const ax = Math.abs(x);
        if (ax === Infinity) {
          body = upper ? 'INF' : 'inf';
          canZero = false;
        } else if (lc === 'f') {
          body = fixedStr(ax, prec < 0 ? 6 : prec, alt);
        } else if (lc === 'e') {
          body = expStr(ax, prec < 0 ? 6 : prec, alt, upper);
        } else {
          let P = prec < 0 ? 6 : prec;
          if (P === 0) P = 1;
          const X = expDigits(ax, P - 1)[1];
          if (P > X && X >= -4) body = fixedStr(ax, P - 1 - X, alt);
          else body = expStr(ax, P - 1, alt, upper);
          if (!alt) body = stripZeros(body);
        }
      }
    }

    let len = sign.length + prefix.length + body.length;
    if (len < width) {
      if (minus) body = body + ' '.repeat(width - len);
      else if (zero && canZero) body = '0'.repeat(width - len) + body;
      else sign = ' '.repeat(width - len) + sign;
    }
    out += sign + prefix + body;
  }
  return out;
}
