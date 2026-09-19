function decompose(x: number): { m: bigint; e: number } {
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, x);
  const hi = buf.getUint32(0);
  const lo = buf.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (expBits === 0) return { m, e: -1074 };
  m |= 1n << 52n;
  return { m, e: expBits - 1075 };
}

// round(m * 2^e * 10^k), half to even
function roundScaled(m: bigint, e: number, k: number): bigint {
  let num = m;
  let den = 1n;
  if (e >= 0) num <<= BigInt(e);
  else den <<= BigInt(-e);
  if (k >= 0) num *= 10n ** BigInt(k);
  else den *= 10n ** BigInt(-k);
  const q = num / den;
  const r2 = (num % den) * 2n;
  if (r2 > den || (r2 === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

function fixedDigits(x: number, p: number): string {
  const { m, e } = decompose(Math.abs(x));
  let s = roundScaled(m, e, p).toString();
  if (p > 0) {
    s = s.padStart(p + 1, '0');
    return s.slice(0, s.length - p) + '.' + s.slice(s.length - p);
  }
  return s;
}

// returns digit string of length p+1 and decimal exponent
function expDigits(x: number, p: number): { d: string; x: number } {
  if (x === 0) return { d: '0'.repeat(p + 1), x: 0 };
  const { m, e } = decompose(Math.abs(x));
  let E = Math.floor(Math.log10(Math.abs(x)));
  const hi = 10n ** BigInt(p + 1);
  const lo = 10n ** BigInt(p);
  for (let i = 0; i < 20; i++) {
    const N = roundScaled(m, e, p - E);
    if (N >= hi) E++;
    else if (N < lo) E--;
    else return { d: N.toString(), x: E };
  }
  throw new Error('exp');
}

function expStr(d: string, X: number, p: number, alt: boolean, upper: boolean): string {
  let s = d[0];
  if (p > 0 || alt) s += '.';
  s += d.slice(1);
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
    let body = '';
    let zeroOk = true;

    if (conv === 's' || conv === 'c') {
      body = String(arg);
      if (conv === 's' && prec >= 0) body = body.slice(0, prec);
      zeroOk = false;
    } else if (conv === 'd' || conv === 'i' || conv === 'x' || conv === 'X' || conv === 'o') {
      const v = BigInt(arg as number | bigint);
      const neg = v < 0n;
      const mag = neg ? -v : v;
      let digits = conv === 'd' || conv === 'i' ? mag.toString()
        : conv === 'o' ? mag.toString(8)
        : mag.toString(16);
      if (conv === 'X') digits = digits.toUpperCase();
      if (prec === 0 && mag === 0n) digits = '';
      if (prec > digits.length) digits = digits.padStart(prec, '0');
      if (conv === 'd' || conv === 'i') {
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
      } else if (conv === 'o') {
        if (alt && digits[0] !== '0') digits = '0' + digits;
      } else if (alt && mag !== 0n) {
        sign = conv === 'x' ? '0x' : '0X';
      }
      body = digits;
      if (prec >= 0) zeroOk = false;
    } else {
      const x = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      const neg = x < 0 || Object.is(x, -0);
      if (Number.isNaN(x)) {
        body = upper ? 'NAN' : 'nan';
        zeroOk = false;
      } else {
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        if (!Number.isFinite(x)) {
          body = upper ? 'INF' : 'inf';
          zeroOk = false;
        } else {
          const lc = conv.toLowerCase();
          if (lc === 'f') {
            const p = prec < 0 ? 6 : prec;
            body = fixedDigits(x, p);
            if (p === 0 && alt) body += '.';
          } else if (lc === 'e') {
            const p = prec < 0 ? 6 : prec;
            const r = expDigits(x, p);
            body = expStr(r.d, r.x, p, alt, upper);
          } else {
            const P = prec < 0 ? 6 : prec === 0 ? 1 : prec;
            const r = expDigits(x, P - 1);
            if (P > r.x && r.x >= -4) {
              const p = P - 1 - r.x;
              body = fixedDigits(x, p);
              if (p === 0 && alt) body += '.';
              if (!alt) body = stripZeros(body);
            } else {
              let s = expStr(r.d, r.x, P - 1, alt, upper);
              if (!alt) {
                const k = s.search(/[eE]/);
                s = stripZeros(s.slice(0, k)) + s.slice(k);
              }
              body = s;
            }
          }
        }
      }
    }

    const len = sign.length + body.length;
    if (len >= width) out += sign + body;
    else if (minus) out += sign + body + ' '.repeat(width - len);
    else if (zero && zeroOk) out += sign + '0'.repeat(width - len) + body;
    else out += ' '.repeat(width - len) + sign + body;
  }
  return out;
}
