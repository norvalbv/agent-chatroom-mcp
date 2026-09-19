// round_half_even(abs * 10^k) as a bigint, exact.
function scaled(abs: number, k: number): bigint {
  if (abs === 0) return 0n;
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, abs);
  const hi = buf.getUint32(0);
  const lo = buf.getUint32(4);
  const bexp = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let e: number;
  if (bexp === 0) {
    e = -1074;
  } else {
    m |= 1n << 52n;
    e = bexp - 1075;
  }
  let num = m;
  let den = 1n;
  if (e > 0) num <<= BigInt(e);
  else den <<= BigInt(-e);
  if (k > 0) num *= 10n ** BigInt(k);
  else if (k < 0) den *= 10n ** BigInt(-k);
  let q = num / den;
  const r2 = (num % den) * 2n;
  if (r2 > den || (r2 === den && (q & 1n) === 1n)) q += 1n;
  return q;
}

function fmtF(abs: number, prec: number, alt: boolean): string {
  let s = scaled(abs, prec).toString();
  if (prec > 0) {
    s = s.padStart(prec + 1, '0');
    return s.slice(0, s.length - prec) + '.' + s.slice(s.length - prec);
  }
  return alt ? s + '.' : s;
}

// returns digit string (prec+1 digits) and exponent
function eDigits(abs: number, prec: number): [string, number] {
  if (abs === 0) return ['0'.repeat(prec + 1), 0];
  let x = Math.floor(Math.log10(abs));
  if (!isFinite(x)) x = -324;
  for (let i = 0; i < 10; i++) {
    const s = scaled(abs, prec - x).toString();
    if (s.length === prec + 1) return [s, x];
    if (s.length < prec + 1) x -= 1;
    else x += 1;
  }
  throw new Error('exponent search failed');
}

function fmtE(abs: number, prec: number, alt: boolean, upper: boolean): string {
  const [d, x] = eDigits(abs, prec);
  let s = d[0];
  if (prec > 0) s += '.' + d.slice(1);
  else if (alt) s += '.';
  const ax = Math.abs(x);
  return s + (upper ? 'E' : 'e') + (x < 0 ? '-' : '+') + (ax < 10 ? '0' : '') + ax;
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
    let numeric = true;
    let zeroOk = zero && !minus;

    switch (conv) {
      case 'd':
      case 'i': {
        const v = BigInt(arg as number | bigint);
        const neg = v < 0n;
        let digits = (neg ? -v : v).toString();
        if (prec === 0 && v === 0n) digits = '';
        if (prec >= 0) {
          digits = digits.padStart(prec, '0');
          zeroOk = false;
        }
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        body = digits;
        break;
      }
      case 'x':
      case 'X':
      case 'o': {
        const v = BigInt(arg as number | bigint);
        let digits = v.toString(conv === 'o' ? 8 : 16);
        if (conv === 'X') digits = digits.toUpperCase();
        if (prec === 0 && v === 0n) digits = '';
        if (prec >= 0) {
          digits = digits.padStart(prec, '0');
          zeroOk = false;
        }
        if (alt) {
          if (conv === 'o') {
            if (digits[0] !== '0') digits = '0' + digits;
          } else if (v !== 0n) {
            prefix = conv === 'x' ? '0x' : '0X';
          }
        }
        body = digits;
        break;
      }
      case 'e': case 'E': case 'f': case 'F': case 'g': case 'G': {
        const v = arg as number;
        const upper = conv === 'E' || conv === 'F' || conv === 'G';
        if (Number.isNaN(v)) {
          body = upper ? 'NAN' : 'nan';
          zeroOk = false;
          break;
        }
        const neg = v < 0 || Object.is(v, -0);
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        const abs = Math.abs(v);
        if (!isFinite(abs)) {
          body = upper ? 'INF' : 'inf';
          zeroOk = false;
          break;
        }
        const lc = conv.toLowerCase();
        if (lc === 'f') {
          body = fmtF(abs, prec < 0 ? 6 : prec, alt);
        } else if (lc === 'e') {
          body = fmtE(abs, prec < 0 ? 6 : prec, alt, upper);
        } else {
          let P = prec < 0 ? 6 : prec;
          if (P === 0) P = 1;
          const x = eDigits(abs, P - 1)[1];
          if (P > x && x >= -4) {
            body = fmtF(abs, P - 1 - x, alt);
            if (!alt) body = stripZeros(body);
          } else {
            body = fmtE(abs, P - 1, alt, upper);
            if (!alt) {
              const at = body.search(/[eE]/);
              body = stripZeros(body.slice(0, at)) + body.slice(at);
            }
          }
        }
        break;
      }
      case 's': {
        numeric = false;
        body = String(arg);
        if (prec >= 0) body = body.slice(0, prec);
        break;
      }
      case 'c': {
        numeric = false;
        body = String(arg);
        break;
      }
      default:
        throw new Error('bad conversion');
    }

    const len = sign.length + prefix.length + body.length;
    if (len >= width) {
      out += sign + prefix + body;
    } else if (minus) {
      out += sign + prefix + body + ' '.repeat(width - len);
    } else if (numeric && zeroOk) {
      out += sign + prefix + '0'.repeat(width - len) + body;
    } else {
      out += ' '.repeat(width - len) + sign + prefix + body;
    }
  }
  return out;
}
