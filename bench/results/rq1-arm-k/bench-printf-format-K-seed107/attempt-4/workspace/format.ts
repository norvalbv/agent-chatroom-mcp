// round(abs * 10^k) half-to-even, using the exact binary value of abs (abs >= 0, finite)
function decode(abs: number): { m: bigint; e: number } {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, abs);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const be = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (be === 0) return { m, e: -1074 };
  m |= 1n << 52n;
  return { m, e: be - 1075 };
}

function scaledRound(abs: number, k: number): bigint {
  const { m, e } = decode(abs);
  let num = m;
  let den = 1n;
  if (k >= 0) num *= 10n ** BigInt(k);
  else den *= 10n ** BigInt(-k);
  if (e >= 0) num *= 1n << BigInt(e);
  else den *= 1n << BigInt(-e);
  const q = num / den;
  const r = num - q * den;
  const twice = r * 2n;
  if (twice > den || (twice === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// digits string of length prec+1 and decimal exponent, for e style
function expDigits(abs: number, prec: number): { digits: string; x: number } {
  if (abs === 0) return { digits: '0'.repeat(prec + 1), x: 0 };
  let x = Math.floor(Math.log10(abs));
  if (!isFinite(x)) x = -324;
  const lowB = 10n ** BigInt(prec);
  for (;;) {
    const q = scaledRound(abs, prec - x);
    if (q >= lowB * 10n) x++;
    else if (q < lowB) x--;
    else return { digits: q.toString(), x };
  }
}

function fixedStr(abs: number, prec: number, alt: boolean): string {
  let s = scaledRound(abs, prec).toString();
  if (prec > 0) {
    s = s.padStart(prec + 1, '0');
    return s.slice(0, s.length - prec) + '.' + s.slice(s.length - prec);
  }
  return alt ? s + '.' : s;
}

function expStr(abs: number, prec: number, alt: boolean, upper: boolean): string {
  const { digits, x } = expDigits(abs, prec);
  let s = digits[0];
  if (prec > 0) s += '.' + digits.slice(1);
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
    let left = false, plus = false, space = false, zero = false, alt = false;
    for (;; i++) {
      const c = fmt[i];
      if (c === '-') left = true;
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
    let prefix = '';
    let body = '';
    let canZero = false;

    switch (conv) {
      case 'd':
      case 'i': {
        const v = BigInt(arg as number | bigint);
        const neg = v < 0n;
        let d = (neg ? -v : v).toString();
        if (prec === 0 && v === 0n) d = '';
        if (prec > 0) d = d.padStart(prec, '0');
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        body = d;
        canZero = prec < 0;
        break;
      }
      case 'x':
      case 'X':
      case 'o': {
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
        break;
      }
      case 'e': case 'E': case 'f': case 'F': case 'g': case 'G': {
        const v = Number(arg);
        const upper = conv === 'E' || conv === 'F' || conv === 'G';
        if (Number.isNaN(v)) {
          body = upper ? 'NAN' : 'nan';
          break;
        }
        const neg = v < 0 || Object.is(v, -0);
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        const abs = Math.abs(v);
        if (!isFinite(abs)) {
          body = upper ? 'INF' : 'inf';
          break;
        }
        canZero = true;
        const lc = conv.toLowerCase();
        if (lc === 'f') body = fixedStr(abs, prec < 0 ? 6 : prec, alt);
        else if (lc === 'e') body = expStr(abs, prec < 0 ? 6 : prec, alt, upper);
        else {
          let P = prec < 0 ? 6 : prec;
          if (P === 0) P = 1;
          const { x } = expDigits(abs, P - 1);
          if (P > x && x >= -4) {
            body = fixedStr(abs, P - 1 - x, alt);
            if (!alt) body = stripZeros(body);
          } else {
            const s = expStr(abs, P - 1, alt, upper);
            if (alt) body = s;
            else {
              const idx = s.search(/[eE]/);
              body = stripZeros(s.slice(0, idx)) + s.slice(idx);
            }
          }
        }
        break;
      }
      case 's': {
        body = String(arg);
        if (prec >= 0) body = body.slice(0, prec);
        break;
      }
      case 'c':
        body = String(arg);
        break;
      default:
        throw new Error('bad conversion');
    }

    const len = sign.length + prefix.length + body.length;
    if (len >= width) out += sign + prefix + body;
    else if (left) out += sign + prefix + body + ' '.repeat(width - len);
    else if (zero && canZero) out += sign + prefix + '0'.repeat(width - len) + body;
    else out += ' '.repeat(width - len) + sign + prefix + body;
  }
  return out;
}
