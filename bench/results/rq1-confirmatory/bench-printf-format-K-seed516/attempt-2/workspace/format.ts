function decompose(v: number): [bigint, number] {
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, v);
  const hi = buf.getUint32(0);
  const lo = buf.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (expBits === 0) return [m, -1074];
  m |= 1n << 52n;
  return [m, expBits - 1075];
}

// round(|v| * 10^k) half-even, exact
function roundScaled(m: bigint, e2: number, k: number): bigint {
  let num = m;
  let den = 1n;
  if (k >= 0) num *= 10n ** BigInt(k);
  else den *= 10n ** BigInt(-k);
  if (e2 >= 0) num <<= BigInt(e2);
  else den <<= BigInt(-e2);
  const q = num / den;
  const r2 = (num % den) * 2n;
  if (r2 > den || (r2 === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

function fixedStr(a: number, p: number, alt: boolean): string {
  const [m, e2] = decompose(a);
  let s = roundScaled(m, e2, p).toString();
  if (p === 0) return alt ? s + '.' : s;
  if (s.length < p + 1) s = '0'.repeat(p + 1 - s.length) + s;
  return s.slice(0, s.length - p) + '.' + s.slice(s.length - p);
}

// returns digits string (p+1 digits) and exponent
function expParts(a: number, p: number): [string, number] {
  if (a === 0) return ['0'.repeat(p + 1), 0];
  const [m, e2] = decompose(a);
  let x = Math.floor(Math.log10(a));
  if (!isFinite(x)) x = -324;
  const lo = 10n ** BigInt(p);
  const hi = lo * 10n;
  for (;;) {
    const q = roundScaled(m, e2, p - x);
    if (q >= hi) x++;
    else if (q < lo) x--;
    else return [q.toString(), x];
  }
}

function expStr(digits: string, x: number, alt: boolean, upper: boolean): string {
  const p = digits.length - 1;
  let s = digits[0];
  if (p > 0) s += '.' + digits.slice(1);
  else if (alt) s += '.';
  const ax = Math.abs(x);
  s += (upper ? 'E' : 'e') + (x < 0 ? '-' : '+') + (ax < 10 ? '0' + ax : String(ax));
  return s;
}

function stripZeros(s: string): string {
  if (!s.includes('.')) return s;
  s = s.replace(/0+$/, '');
  return s.endsWith('.') ? s.slice(0, -1) : s;
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
    let canZero = true;

    switch (conv) {
      case 'd':
      case 'i':
      case 'x':
      case 'X':
      case 'o': {
        const v = BigInt(arg as number | bigint);
        const neg = v < 0n;
        const mag = neg ? -v : v;
        if (conv === 'd' || conv === 'i') {
          body = mag.toString();
          sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        } else {
          body = mag.toString(conv === 'o' ? 8 : 16);
          if (conv === 'X') body = body.toUpperCase();
        }
        if (prec === 0 && mag === 0n) body = '';
        if (prec >= 0) {
          canZero = false;
          if (body.length < prec) body = '0'.repeat(prec - body.length) + body;
        }
        if (alt) {
          if (conv === 'o') {
            if (!body.startsWith('0')) body = '0' + body;
          } else if ((conv === 'x' || conv === 'X') && mag !== 0n) {
            prefix = conv === 'x' ? '0x' : '0X';
          }
        }
        break;
      }
      case 'e':
      case 'E':
      case 'f':
      case 'F':
      case 'g':
      case 'G': {
        const v = arg as number;
        const upper = conv === 'E' || conv === 'F' || conv === 'G';
        const negBit = v < 0 || Object.is(v, -0);
        if (Number.isNaN(v)) {
          body = upper ? 'NAN' : 'nan';
          canZero = false;
          break;
        }
        sign = negBit ? '-' : plus ? '+' : space ? ' ' : '';
        if (!isFinite(v)) {
          body = upper ? 'INF' : 'inf';
          canZero = false;
          break;
        }
        const a = Math.abs(v);
        const lc = conv.toLowerCase();
        if (lc === 'f') {
          body = fixedStr(a, prec < 0 ? 6 : prec, alt);
        } else if (lc === 'e') {
          const [d, x] = expParts(a, prec < 0 ? 6 : prec);
          body = expStr(d, x, alt, upper);
        } else {
          let P = prec < 0 ? 6 : prec;
          if (P === 0) P = 1;
          const [d, x] = expParts(a, P - 1);
          if (P > x && x >= -4) {
            body = fixedStr(a, P - 1 - x, alt);
            if (!alt) body = stripZeros(body);
          } else {
            let mant = d[0] + (P > 1 ? '.' + d.slice(1) : alt ? '.' : '');
            if (!alt) mant = stripZeros(mant);
            const ax = Math.abs(x);
            body = mant + (upper ? 'E' : 'e') + (x < 0 ? '-' : '+') + (ax < 10 ? '0' + ax : String(ax));
          }
        }
        break;
      }
      case 's': {
        body = String(arg);
        if (prec >= 0) body = body.slice(0, prec);
        canZero = false;
        break;
      }
      case 'c':
        body = String(arg);
        canZero = false;
        break;
    }

    const len = sign.length + prefix.length + body.length;
    if (len >= width) out += sign + prefix + body;
    else if (minus) out += sign + prefix + body + ' '.repeat(width - len);
    else if (zero && canZero) out += sign + prefix + '0'.repeat(width - len) + body;
    else out += ' '.repeat(width - len) + sign + prefix + body;
  }
  return out;
}
