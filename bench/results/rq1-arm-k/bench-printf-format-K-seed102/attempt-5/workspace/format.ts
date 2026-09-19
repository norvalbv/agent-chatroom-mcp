// Decompose a finite non-negative double into m * 2^e exactly.
function decompose(x: number): [bigint, number] {
  if (x === 0) return [0n, 0];
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, x);
  const bits = buf.getBigUint64(0);
  const expBits = Number((bits >> 52n) & 0x7ffn);
  const frac = bits & ((1n << 52n) - 1n);
  if (expBits === 0) return [frac, -1074];
  return [frac | (1n << 52n), expBits - 1075];
}

// round-half-even(x * 10^k) as bigint
function roundScaled(m: bigint, e: number, k: number): bigint {
  let num = m;
  let den = 1n;
  if (k > 0) num *= 10n ** BigInt(k);
  else if (k < 0) den *= 10n ** BigInt(-k);
  if (e > 0) num *= 1n << BigInt(e);
  else if (e < 0) den *= 1n << BigInt(-e);
  const q = num / den;
  const r = num % den;
  const twice = r * 2n;
  if (twice > den || (twice === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

function fixedStr(x: number, prec: number, alt: boolean): string {
  const [m, e] = decompose(x);
  const n = roundScaled(m, e, prec);
  let s = n.toString();
  if (prec > 0) {
    s = s.padStart(prec + 1, '0');
    return s.slice(0, s.length - prec) + '.' + s.slice(s.length - prec);
  }
  return alt ? s + '.' : s;
}

// returns [digits string (1 + prec digits), exponent]
function expParts(x: number, prec: number): [string, number] {
  if (x === 0) return ['0'.repeat(prec + 1), 0];
  const [m, e] = decompose(x);
  let X = Math.floor(Math.log10(x));
  if (!isFinite(X)) X = 0;
  const lo = 10n ** BigInt(prec);
  const hi = lo * 10n;
  for (let i = 0; i < 10; i++) {
    let n = roundScaled(m, e, prec - X);
    if (n < lo) {
      X--;
      continue;
    }
    if (n >= hi) {
      // either rounding overflow or estimate too low
      const n2 = roundScaled(m, e, prec - (X + 1));
      if (n2 >= lo && n2 < hi) return [n2.toString(), X + 1];
      X++;
      continue;
    }
    return [n.toString(), X];
  }
  throw new Error('exp failure');
}

function expStr(digits: string, X: number, upper: boolean, alt: boolean): string {
  const prec = digits.length - 1;
  let s = digits[0];
  if (prec > 0) s += '.' + digits.slice(1);
  else if (alt) s += '.';
  const ax = Math.abs(X);
  return s + (upper ? 'E' : 'e') + (X < 0 ? '-' : '+') + (ax < 10 ? '0' + ax : String(ax));
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
      const f = fmt[i];
      if (f === '-') minus = true;
      else if (f === '+') plus = true;
      else if (f === ' ') space = true;
      else if (f === '0') zero = true;
      else if (f === '#') alt = true;
      else break;
    }
    let width = 0;
    while (i < fmt.length && fmt[i] >= '0' && fmt[i] <= '9') {
      width = width * 10 + (fmt.charCodeAt(i) - 48);
      i++;
    }
    let prec = -1;
    if (fmt[i] === '.') {
      i++;
      prec = 0;
      while (i < fmt.length && fmt[i] >= '0' && fmt[i] <= '9') {
        prec = prec * 10 + (fmt.charCodeAt(i) - 48);
        i++;
      }
    }
    const conv = fmt[i++];
    const arg = args[ai++];
    let sign = '';
    let prefix = '';
    let body = '';
    let canZero = false;
    const lc = conv.toLowerCase();

    if (conv === 'd' || conv === 'i') {
      const v = BigInt(arg as number | bigint);
      const neg = v < 0n;
      let d = (neg ? -v : v).toString();
      if (prec === 0 && v === 0n) d = '';
      if (prec > 0) d = d.padStart(prec, '0');
      sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
      body = d;
      canZero = prec < 0;
    } else if (conv === 'x' || conv === 'X' || conv === 'o') {
      const v = BigInt(arg as number | bigint);
      let d = v.toString(conv === 'o' ? 8 : 16);
      if (conv === 'X') d = d.toUpperCase();
      if (prec === 0 && v === 0n) d = '';
      if (prec > 0) d = d.padStart(prec, '0');
      if (alt) {
        if (conv === 'o') {
          if (d[0] !== '0') d = '0' + d;
        } else if (v !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      }
      body = d;
      canZero = prec < 0;
    } else if (lc === 'e' || lc === 'f' || lc === 'g') {
      const x = arg as number;
      const upper = conv !== lc;
      const isNaNv = Number.isNaN(x);
      const negBit = !isNaNv && (x < 0 || Object.is(x, -0));
      sign = isNaNv ? '' : negBit ? '-' : plus ? '+' : space ? ' ' : '';
      if (isNaNv || !isFinite(x)) {
        body = isNaNv ? 'nan' : 'inf';
        if (upper) body = body.toUpperCase();
        canZero = false;
      } else {
        const a = Math.abs(x);
        canZero = true;
        if (lc === 'f') {
          body = fixedStr(a, prec < 0 ? 6 : prec, alt);
        } else if (lc === 'e') {
          const [dg, X] = expParts(a, prec < 0 ? 6 : prec);
          body = expStr(dg, X, upper, alt);
        } else {
          let P = prec < 0 ? 6 : prec;
          if (P === 0) P = 1;
          const [dg, X] = expParts(a, P - 1);
          if (P > X && X >= -4) {
            body = fixedStr(a, P - 1 - X, alt);
            if (!alt) body = stripZeros(body);
          } else {
            let mant = dg[0] + (P > 1 ? '.' + dg.slice(1) : alt ? '.' : '');
            if (!alt) mant = stripZeros(mant);
            const ax = Math.abs(X);
            body = mant + (upper ? 'E' : 'e') + (X < 0 ? '-' : '+') + (ax < 10 ? '0' + ax : String(ax));
          }
        }
      }
    } else if (conv === 's') {
      body = String(arg);
      if (prec >= 0) body = body.slice(0, prec);
    } else if (conv === 'c') {
      body = String(arg);
    }

    const len = sign.length + prefix.length + body.length;
    if (len >= width) out += sign + prefix + body;
    else if (minus) out += sign + prefix + body + ' '.repeat(width - len);
    else if (zero && canZero) out += sign + prefix + '0'.repeat(width - len) + body;
    else out += ' '.repeat(width - len) + sign + prefix + body;
  }
  return out;
}
