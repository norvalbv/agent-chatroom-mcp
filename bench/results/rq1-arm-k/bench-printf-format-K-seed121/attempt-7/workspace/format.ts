function decompose(x: number): { m: bigint; e: number } {
  // x finite, positive or zero: x = m * 2^e exactly
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
  const r = num % den;
  const twice = r * 2n;
  if (twice > den || (twice === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// fixed: integer digits and fraction digits
function fixedDigits(ax: number, prec: number): string {
  const { m, e } = decompose(ax);
  let s = roundScaled(m, e, prec).toString();
  if (prec > 0) {
    if (s.length <= prec) s = '0'.repeat(prec - s.length + 1) + s;
    return s.slice(0, s.length - prec) + '.' + s.slice(s.length - prec);
  }
  return s;
}

// exponent style: returns digit string of length p+1 and exponent
function expDigits(ax: number, p: number): { d: string; x: number } {
  if (ax === 0) return { d: '0'.repeat(p + 1), x: 0 };
  const { m, e } = decompose(ax);
  let E = Math.floor(Math.log10(ax));
  if (!isFinite(E)) E = -324;
  for (;;) {
    const n = roundScaled(m, e, p - E);
    const s = n.toString();
    if (s.length > p + 1) E++;
    else if (s.length < p + 1) E--;
    else return { d: s, x: E };
  }
}

function expStyle(ax: number, p: number, alt: boolean, upper: boolean): string {
  const { d, x } = expDigits(ax, p);
  let s = d[0];
  if (p > 0 || alt) s += '.';
  s += d.slice(1);
  const ex = Math.abs(x).toString().padStart(2, '0');
  return s + (upper ? 'E' : 'e') + (x < 0 ? '-' : '+') + ex;
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

    if (conv === 'd' || conv === 'i' || conv === 'x' || conv === 'X' || conv === 'o') {
      const v = BigInt(arg as number | bigint);
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
      if (prec === 0 && mag === 0n) body = '';
      if (prec >= 0) {
        body = body.padStart(prec, '0');
        canZero = false;
      }
      if (alt) {
        if (conv === 'o') {
          if (body[0] !== '0') body = '0' + body;
        } else if (conv === 'x' && mag !== 0n) prefix = '0x';
        else if (conv === 'X' && mag !== 0n) prefix = '0X';
      }
    } else if ('eEfFgG'.includes(conv)) {
      const x = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      const negBit = x < 0 || Object.is(x, -0);
      if (!Number.isNaN(x)) sign = negBit ? '-' : plus ? '+' : space ? ' ' : '';
      const ax = Math.abs(x);
      if (Number.isNaN(x)) {
        body = upper ? 'NAN' : 'nan';
        canZero = false;
      } else if (!isFinite(x)) {
        body = upper ? 'INF' : 'inf';
        canZero = false;
      } else if (conv === 'e' || conv === 'E') {
        body = expStyle(ax, prec < 0 ? 6 : prec, alt, upper);
      } else if (conv === 'f' || conv === 'F') {
        body = fixedDigits(ax, prec < 0 ? 6 : prec);
        if (prec === 0 && alt) body += '.';
      } else {
        let P = prec < 0 ? 6 : prec;
        if (P === 0) P = 1;
        const X = expDigits(ax, P - 1).x;
        if (P > X && X >= -4) {
          body = fixedDigits(ax, P - 1 - X);
          if (P - 1 - X === 0 && alt) body += '.';
          if (!alt) body = stripZeros(body);
        } else {
          body = expStyle(ax, P - 1, alt, upper);
          if (!alt) {
            const idx = body.search(/[eE]/);
            body = stripZeros(body.slice(0, idx)) + body.slice(idx);
          }
        }
      }
    } else if (conv === 's') {
      body = String(arg);
      if (prec >= 0) body = body.slice(0, prec);
      canZero = false;
    } else {
      body = String(arg);
      canZero = false;
    }

    const len = sign.length + prefix.length + body.length;
    if (len < width) {
      const pad = width - len;
      if (minus) out += sign + prefix + body + ' '.repeat(pad);
      else if (zero && canZero) out += sign + prefix + '0'.repeat(pad) + body;
      else out += ' '.repeat(pad) + sign + prefix + body;
    } else out += sign + prefix + body;
  }
  return out;
}
