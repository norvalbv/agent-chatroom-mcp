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

// [num, den] of m * 2^e * 10^k
function frac(m: bigint, e: number, k: number): [bigint, bigint] {
  let num = m;
  let den = 1n;
  if (e >= 0) num <<= BigInt(e);
  else den <<= BigInt(-e);
  if (k >= 0) num *= 10n ** BigInt(k);
  else den *= 10n ** BigInt(-k);
  return [num, den];
}

// round(m * 2^e * 10^k), half to even
function roundScaled(m: bigint, e: number, k: number): bigint {
  const [num, den] = frac(m, e, k);
  const q = num / den;
  const r = num % den;
  const twice = r * 2n;
  if (twice > den || (twice === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// e-style digits: returns [digit string of length prec+1, exponent]
function expDigits(v: number, prec: number): [string, number] {
  if (v === 0) return ['0'.repeat(prec + 1), 0];
  const [m, e] = decompose(v);
  let E = Math.floor(Math.log10(v));
  if (!isFinite(E)) E = -324;
  for (;;) {
    const [n, d] = frac(m, e, -E);
    if (n < d) E--;
    else break;
  }
  for (;;) {
    const [n, d] = frac(m, e, -(E + 1));
    if (n >= d) E++;
    else break;
  }
  let r = roundScaled(m, e, prec - E);
  if (r >= 10n ** BigInt(prec + 1)) {
    E++;
    r = roundScaled(m, e, prec - E);
  }
  return [r.toString(), E];
}

function fixedStr(v: number, prec: number, alt: boolean): string {
  let s: string;
  if (v === 0) s = '0'.repeat(prec + 1);
  else {
    const [m, e] = decompose(v);
    s = roundScaled(m, e, prec).toString();
    if (s.length < prec + 1) s = '0'.repeat(prec + 1 - s.length) + s;
  }
  const ip = s.slice(0, s.length - prec);
  const fp = s.slice(s.length - prec);
  return prec > 0 ? ip + '.' + fp : alt ? ip + '.' : ip;
}

function expStr(digits: string, E: number, prec: number, alt: boolean, upper: boolean): string {
  let mant = digits[0];
  if (prec > 0) mant += '.' + digits.slice(1);
  else if (alt) mant += '.';
  const ae = Math.abs(E);
  return mant + (upper ? 'E' : 'e') + (E < 0 ? '-' : '+') + (ae < 10 ? '0' : '') + ae;
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
    let prec: number | undefined;
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
      if (conv === 's' && prec !== undefined) body = body.slice(0, prec);
      canZero = false;
    } else if (conv === 'd' || conv === 'i') {
      const v = BigInt(arg as number | bigint);
      sign = v < 0n ? '-' : plus ? '+' : space ? ' ' : '';
      body = (v < 0n ? -v : v).toString();
      if (prec !== undefined) {
        if (prec === 0 && v === 0n) body = '';
        else if (body.length < prec) body = '0'.repeat(prec - body.length) + body;
        canZero = false;
      }
    } else if (conv === 'x' || conv === 'X' || conv === 'o') {
      const v = BigInt(arg as number | bigint);
      body = v.toString(conv === 'o' ? 8 : 16);
      if (conv === 'X') body = body.toUpperCase();
      if (prec !== undefined) {
        if (prec === 0 && v === 0n) body = '';
        else if (body.length < prec) body = '0'.repeat(prec - body.length) + body;
        canZero = false;
      }
      if (alt) {
        if (conv === 'o') {
          if (body[0] !== '0') body = '0' + body;
        } else if (v !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      }
    } else {
      const v = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      const neg = v < 0 || Object.is(v, -0);
      if (Number.isNaN(v)) {
        body = upper ? 'NAN' : 'nan';
        canZero = false;
      } else {
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        if (!isFinite(v)) {
          body = upper ? 'INF' : 'inf';
          canZero = false;
        } else {
          const a = Math.abs(v);
          const lc = conv.toLowerCase();
          if (lc === 'f') {
            body = fixedStr(a, prec ?? 6, alt);
          } else if (lc === 'e') {
            const p = prec ?? 6;
            const [d, E] = expDigits(a, p);
            body = expStr(d, E, p, alt, upper);
          } else {
            const P = prec === undefined ? 6 : prec === 0 ? 1 : prec;
            const [d, X] = expDigits(a, P - 1);
            if (P > X && X >= -4) {
              body = fixedStr(a, P - 1 - X, alt);
              if (!alt) body = stripZeros(body);
            } else {
              let mant = d[0] + (P > 1 ? '.' + d.slice(1) : alt ? '.' : '');
              if (!alt) mant = stripZeros(mant);
              const ae = Math.abs(X);
              body = mant + (upper ? 'E' : 'e') + (X < 0 ? '-' : '+') + (ae < 10 ? '0' : '') + ae;
            }
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
