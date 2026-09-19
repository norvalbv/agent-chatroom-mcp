const P10 = (n: number): bigint => 10n ** BigInt(n);

// Decompose a finite non-negative double into m * 2^e.
function decompose(v: number): [bigint, number] {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, v);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (expBits === 0) return [m, -1074];
  m |= 1n << 52n;
  return [m, expBits - 1075];
}

// round-half-even(m * 2^e * 10^k)
function scaledRound(m: bigint, e: number, k: number): bigint {
  const num = m * P10(Math.max(k, 0)) * (1n << BigInt(Math.max(e, 0)));
  const den = P10(Math.max(-k, 0)) * (1n << BigInt(Math.max(-e, 0)));
  const q = num / den;
  const r2 = (num % den) * 2n;
  if (r2 > den || (r2 === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// Fixed notation with prec fractional digits.
function fixedDigits(v: number, prec: number, alt: boolean): string {
  const [m, e] = decompose(v);
  let s = scaledRound(m, e, prec).toString();
  if (prec > 0) {
    s = s.padStart(prec + 1, '0');
    return s.slice(0, s.length - prec) + '.' + s.slice(s.length - prec);
  }
  return alt ? s + '.' : s;
}

// Exponent-style pieces: digit string of length prec+1 and decimal exponent.
function expParts(v: number, prec: number): [string, number] {
  if (v === 0) return ['0'.repeat(prec + 1), 0];
  const [m, e] = decompose(v);
  let X = Math.floor(Math.log10(v));
  if (!Number.isFinite(X)) X = v < 1 ? -324 : 308;
  const lo = P10(prec);
  const hi = P10(prec + 1);
  for (let i = 0; i < 20; i++) {
    const D = scaledRound(m, e, prec - X);
    if (D >= hi) X++;
    else if (D < lo) X--;
    else return [D.toString(), X];
  }
  throw new Error('exponent search failed');
}

function expStyle(digits: string, X: number, upper: boolean, alt: boolean): string {
  let s = digits[0];
  if (digits.length > 1) s += '.' + digits.slice(1);
  else if (alt) s += '.';
  const ax = Math.abs(X);
  s += (upper ? 'E' : 'e') + (X < 0 ? '-' : '+') + (ax < 10 ? '0' + ax : String(ax));
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
    } else if (conv === 'd' || conv === 'i') {
      const b = BigInt(arg as number | bigint);
      const neg = b < 0n;
      body = (neg ? -b : b).toString();
      if (prec >= 0) {
        if (prec === 0 && b === 0n) body = '';
        body = body.padStart(prec, '0');
        canZero = false;
      }
      sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
    } else if (conv === 'x' || conv === 'X' || conv === 'o') {
      const b = BigInt(arg as number | bigint);
      body = b.toString(conv === 'o' ? 8 : 16);
      if (conv === 'X') body = body.toUpperCase();
      if (prec >= 0) {
        if (prec === 0 && b === 0n) body = '';
        body = body.padStart(prec, '0');
        canZero = false;
      }
      if (alt) {
        if (conv === 'o') {
          if (body[0] !== '0') body = '0' + body;
        } else if (b !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      }
    } else {
      const v = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      const neg = v < 0 || Object.is(v, -0);
      sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
      if (Number.isNaN(v)) {
        sign = '';
        body = upper ? 'NAN' : 'nan';
        canZero = false;
      } else if (!Number.isFinite(v)) {
        body = upper ? 'INF' : 'inf';
        canZero = false;
      } else {
        const av = Math.abs(v);
        const lc = conv.toLowerCase();
        if (lc === 'f') {
          body = fixedDigits(av, prec < 0 ? 6 : prec, alt);
        } else if (lc === 'e') {
          const p = prec < 0 ? 6 : prec;
          const [d, X] = expParts(av, p);
          body = expStyle(d, X, upper, alt);
        } else {
          const P = prec < 0 ? 6 : prec === 0 ? 1 : prec;
          const [d, X] = expParts(av, P - 1);
          if (P > X && X >= -4) {
            body = fixedDigits(av, P - 1 - X, alt);
            if (!alt) body = stripZeros(body);
          } else {
            let mant = d[0] + (P > 1 ? '.' + d.slice(1) : alt ? '.' : '');
            if (!alt) mant = stripZeros(mant);
            const ax = Math.abs(X);
            body = mant + (upper ? 'E' : 'e') + (X < 0 ? '-' : '+') + (ax < 10 ? '0' + ax : String(ax));
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
