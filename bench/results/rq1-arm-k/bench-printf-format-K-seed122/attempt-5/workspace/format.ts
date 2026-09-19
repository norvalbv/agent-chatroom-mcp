function decompose(abs: number): [bigint, number] {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, abs);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  let mant = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (expBits === 0) return [mant, -1074];
  mant |= 1n << 52n;
  return [mant, expBits - 1075];
}

// round(m * 2^e * 10^k), ties to even
function roundScaled(m: bigint, e: number, k: number): bigint {
  let num = m;
  let den = 1n;
  if (e >= 0) num <<= BigInt(e);
  else den <<= BigInt(-e);
  if (k >= 0) num *= 10n ** BigInt(k);
  else den *= 10n ** BigInt(-k);
  const q = num / den;
  const r = num % den;
  const twice = r * 2n;
  if (twice > den || (twice === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

function fixedDigits(abs: number, prec: number): string {
  const [m, e] = decompose(abs);
  let s = roundScaled(m, e, prec).toString();
  if (prec > 0) {
    s = s.padStart(prec + 1, '0');
    return s.slice(0, s.length - prec) + '.' + s.slice(s.length - prec);
  }
  return s;
}

// returns digit string of length prec+1 and decimal exponent
function expDigits(abs: number, prec: number): [string, number] {
  if (abs === 0) return ['0'.repeat(prec + 1), 0];
  const [m, e] = decompose(abs);
  let x = Math.floor(Math.log10(abs));
  if (!isFinite(x)) x = -324;
  const lo = 10n ** BigInt(prec);
  const hi = lo * 10n;
  for (;;) {
    const n = roundScaled(m, e, prec - x);
    if (n >= hi) x++;
    else if (n < lo) x--;
    else return [n.toString(), x];
  }
}

function expStr(digits: string, x: number, alt: boolean, upper: boolean): string {
  let s = digits[0];
  if (digits.length > 1) s += '.' + digits.slice(1);
  else if (alt) s += '.';
  const ax = Math.abs(x);
  s += (upper ? 'E' : 'e') + (x < 0 ? '-' : '+') + (ax < 10 ? '0' : '') + ax;
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
    let body = '';
    let numeric = true;
    let canZero = zero && !minus;

    const lc = conv.toLowerCase();
    if (conv === 'd' || conv === 'i' || conv === 'x' || conv === 'X' || conv === 'o') {
      const v = BigInt(arg as number | bigint);
      const neg = v < 0n;
      const mag = neg ? -v : v;
      if (conv === 'd' || conv === 'i') {
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        body = mag.toString(10);
      } else if (conv === 'o') body = mag.toString(8);
      else body = mag.toString(16);
      if (conv === 'X') body = body.toUpperCase();
      if (prec >= 0) {
        if (prec === 0 && mag === 0n) body = '';
        body = body.padStart(prec, '0');
        canZero = false;
      }
      if (alt) {
        if (conv === 'o') {
          if (body[0] !== '0') body = '0' + body;
        } else if ((conv === 'x' || conv === 'X') && mag !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      }
    } else if ('efg'.includes(lc)) {
      const v = arg as number;
      const upper = conv !== lc;
      const negBit = v < 0 || Object.is(v, -0);
      if (Number.isNaN(v)) {
        body = upper ? 'NAN' : 'nan';
        canZero = false;
      } else {
        sign = negBit ? '-' : plus ? '+' : space ? ' ' : '';
        if (!isFinite(v)) {
          body = upper ? 'INF' : 'inf';
          canZero = false;
        } else {
          const abs = Math.abs(v);
          if (lc === 'f') {
            const p = prec < 0 ? 6 : prec;
            body = fixedDigits(abs, p);
            if (p === 0 && alt) body += '.';
          } else if (lc === 'e') {
            const p = prec < 0 ? 6 : prec;
            const [d, x] = expDigits(abs, p);
            body = expStr(d, x, alt, upper);
          } else {
            const P = prec < 0 ? 6 : prec === 0 ? 1 : prec;
            const [d, x] = expDigits(abs, P - 1);
            if (P > x && x >= -4) {
              body = fixedDigits(abs, P - 1 - x);
              if (!alt) body = stripZeros(body);
              else if (!body.includes('.')) body += '.';
            } else {
              let dd = d;
              if (!alt) dd = d[0] + (stripZeros(d[0] + '.' + d.slice(1)).slice(2));
              body = expStr(dd, x, alt, upper);
            }
          }
        }
      }
    } else if (conv === 's') {
      numeric = false;
      body = String(arg);
      if (prec >= 0) body = body.slice(0, prec);
    } else {
      numeric = false;
      body = String(arg);
    }

    const len = sign.length + prefix.length + body.length;
    if (len >= width) out += sign + prefix + body;
    else if (numeric && canZero) out += sign + prefix + '0'.repeat(width - len) + body;
    else if (minus) out += sign + prefix + body + ' '.repeat(width - len);
    else out += ' '.repeat(width - len) + sign + prefix + body;
  }
  return out;
}
