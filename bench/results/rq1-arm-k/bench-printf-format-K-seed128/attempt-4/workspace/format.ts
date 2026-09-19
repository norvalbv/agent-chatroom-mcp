function decompose(x: number): [bigint, number] {
  // x finite, >= 0, nonzero. returns m, e with x = m * 2^e
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

// round(x * 10^k) half-even, exact
function roundScaled(m: bigint, e: number, k: number): bigint {
  let num = m;
  let den = 1n;
  if (k > 0) num *= 10n ** BigInt(k);
  else if (k < 0) den *= 10n ** BigInt(-k);
  if (e > 0) num <<= BigInt(e);
  else if (e < 0) den <<= BigInt(-e);
  const q = num / den;
  const r = num % den;
  const c = 2n * r;
  if (c > den || (c === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

function fixedStr(x: number, prec: number, alt: boolean): string {
  let digits: string;
  if (x === 0) digits = '0'.repeat(prec + 1);
  else {
    const [m, e] = decompose(x);
    digits = roundScaled(m, e, prec).toString();
    if (digits.length < prec + 1) digits = '0'.repeat(prec + 1 - digits.length) + digits;
  }
  const ip = digits.slice(0, digits.length - prec);
  const fp = digits.slice(digits.length - prec);
  return ip + (prec > 0 || alt ? '.' : '') + fp;
}

// returns [digit string of prec+1 digits, exponent]
function expDigits(x: number, prec: number): [string, number] {
  if (x === 0) return ['0'.repeat(prec + 1), 0];
  const [m, e] = decompose(x);
  let X = Math.floor(Math.log10(x));
  if (!isFinite(X)) X = 0;
  const lowB = 10n ** BigInt(prec);
  for (;;) {
    const q = roundScaled(m, e, prec - X);
    if (q >= lowB * 10n) X++;
    else if (q < lowB) X--;
    else return [q.toString(), X];
  }
}

function expStr(x: number, prec: number, alt: boolean, upper: boolean): string {
  const [d, X] = expDigits(x, prec);
  const ax = Math.abs(X);
  return (
    d[0] +
    (prec > 0 || alt ? '.' : '') +
    d.slice(1) +
    (upper ? 'E' : 'e') +
    (X < 0 ? '-' : '+') +
    (ax < 10 ? '0' + ax : String(ax))
  );
}

function stripZeros(s: string): string {
  // s has a '.' in mantissa; strip trailing zeros of the fractional part
  const ei = s.search(/[eE]/);
  const mant = ei >= 0 ? s.slice(0, ei) : s;
  const rest = ei >= 0 ? s.slice(ei) : '';
  if (!mant.includes('.')) return s;
  return mant.replace(/0+$/, '').replace(/\.$/, '') + rest;
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
    while (i < fmt.length && fmt[i] >= '0' && fmt[i] <= '9') width = width * 10 + (fmt.charCodeAt(i++) - 48);
    let prec = -1;
    if (fmt[i] === '.') {
      i++;
      prec = 0;
      while (i < fmt.length && fmt[i] >= '0' && fmt[i] <= '9') prec = prec * 10 + (fmt.charCodeAt(i++) - 48);
    }
    const conv = fmt[i++];
    const arg = args[ai++];
    let sign = '';
    let prefix = '';
    let body = '';
    let numeric = true;
    let canZero = true;
    const lower = conv.toLowerCase();

    if (conv === 's' || conv === 'c') {
      numeric = false;
      body = String(arg);
      if (conv === 's' && prec >= 0) body = body.slice(0, prec);
    } else if (conv === 'd' || conv === 'i' || conv === 'x' || conv === 'X' || conv === 'o') {
      let v = BigInt(arg as number | bigint);
      if (conv === 'd' || conv === 'i') {
        if (v < 0n) {
          sign = '-';
          v = -v;
        } else sign = plus ? '+' : space ? ' ' : '';
      }
      let digits = conv === 'o' ? v.toString(8) : conv === 'd' || conv === 'i' ? v.toString() : v.toString(16);
      if (conv === 'X') digits = digits.toUpperCase();
      if (prec >= 0) {
        if (prec === 0 && v === 0n) digits = '';
        if (digits.length < prec) digits = '0'.repeat(prec - digits.length) + digits;
        canZero = false;
      }
      if (alt) {
        if (conv === 'o') {
          if (digits[0] !== '0') digits = '0' + digits;
        } else if ((conv === 'x' || conv === 'X') && v !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      }
      body = digits;
    } else {
      const x = arg as number;
      const neg = x < 0 || Object.is(x, -0);
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      if (Number.isNaN(x)) {
        body = upper ? 'NAN' : 'nan';
        canZero = false;
      } else {
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        const ax = Math.abs(x);
        if (!isFinite(ax)) {
          body = upper ? 'INF' : 'inf';
          canZero = false;
        } else if (lower === 'f') {
          body = fixedStr(ax, prec < 0 ? 6 : prec, alt);
        } else if (lower === 'e') {
          body = expStr(ax, prec < 0 ? 6 : prec, alt, upper);
        } else {
          const P = prec < 0 ? 6 : prec === 0 ? 1 : prec;
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
      else if (numeric && zero && canZero) body = '0'.repeat(width - len) + body;
      else sign = ' '.repeat(width - len) + sign;
    }
    out += sign + prefix + body;
  }
  return out;
}
