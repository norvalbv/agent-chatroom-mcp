function decompose(v: number): { m: bigint; e: number } {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, Math.abs(v));
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (expBits === 0) return { m, e: -1074 };
  m |= 1n << 52n;
  return { m, e: expBits - 1075 };
}

// round(|v| * 10^k), ties to even, exact
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

function fixedDigits(v: number, p: number): string {
  const { m, e } = decompose(v);
  let s = roundScaled(m, e, p).toString();
  if (p > 0) {
    s = s.padStart(p + 1, '0');
    return s.slice(0, s.length - p) + '.' + s.slice(s.length - p);
  }
  return s;
}

function expDigits(v: number, p: number): { digits: string; x: number } {
  if (v === 0) return { digits: '0'.repeat(p + 1), x: 0 };
  const { m, e } = decompose(v);
  let x = Math.floor(Math.log10(Math.abs(v)));
  if (!Number.isFinite(x)) x = -324;
  const lim = 10n ** BigInt(p);
  for (let i = 0; i < 20; i++) {
    const d = roundScaled(m, e, p - x);
    if (d >= lim * 10n) x++;
    else if (d < lim) x--;
    else return { digits: d.toString(), x };
  }
  throw new Error('exponent search failed');
}

function expStyle(v: number, p: number, upper: boolean, alt: boolean): string {
  const { digits, x } = expDigits(v, p);
  let s = digits[0];
  if (p > 0) s += '.' + digits.slice(1);
  else if (alt) s += '.';
  const ax = Math.abs(x);
  s += (upper ? 'E' : 'e') + (x < 0 ? '-' : '+') + (ax < 10 ? '0' + ax : String(ax));
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
    while (fmt[i] >= '0' && fmt[i] <= '9') width = width * 10 + (fmt.charCodeAt(i++) - 48);
    let prec: number | undefined;
    if (fmt[i] === '.') {
      i++;
      prec = 0;
      while (fmt[i] >= '0' && fmt[i] <= '9') prec = prec * 10 + (fmt.charCodeAt(i++) - 48);
    }
    const conv = fmt[i++];
    const arg = args[ai++];

    let sign = '';
    let prefix = '';
    let body = '';
    let canZero = false;

    const upper = conv === 'E' || conv === 'F' || conv === 'G';
    const signFor = (neg: boolean) => (neg ? '-' : plus ? '+' : space ? ' ' : '');

    switch (conv) {
      case 'd':
      case 'i':
      case 'x':
      case 'X':
      case 'o': {
        const n = BigInt(arg as number | bigint);
        const neg = n < 0n;
        const mag = neg ? -n : n;
        if (conv === 'd' || conv === 'i') {
          sign = signFor(neg);
          body = mag.toString();
        } else if (conv === 'o') {
          body = mag.toString(8);
        } else {
          body = mag.toString(16);
          if (conv === 'X') body = body.toUpperCase();
        }
        if (prec !== undefined) {
          if (prec === 0 && mag === 0n) body = '';
          else body = body.padStart(prec, '0');
        }
        if (conv === 'o' && alt && !body.startsWith('0')) body = '0' + body;
        if ((conv === 'x' || conv === 'X') && alt && mag !== 0n) prefix = conv === 'x' ? '0x' : '0X';
        canZero = prec === undefined;
        break;
      }
      case 'e':
      case 'E':
      case 'f':
      case 'F':
      case 'g':
      case 'G': {
        const v = arg as number;
        if (Number.isNaN(v)) {
          body = upper ? 'NAN' : 'nan';
          break;
        }
        const neg = v < 0 || Object.is(v, -0);
        sign = signFor(neg);
        if (!Number.isFinite(v)) {
          body = upper ? 'INF' : 'inf';
          break;
        }
        canZero = true;
        const a = Math.abs(v);
        if (conv === 'e' || conv === 'E') {
          body = expStyle(a, prec ?? 6, upper, alt);
        } else if (conv === 'f' || conv === 'F') {
          body = fixedDigits(a, prec ?? 6);
          if (alt && (prec ?? 6) === 0) body += '.';
        } else {
          let P = prec ?? 6;
          if (P === 0) P = 1;
          const { x } = expDigits(a, P - 1);
          if (P > x && x >= -4) {
            body = fixedDigits(a, P - 1 - x);
            if (alt && P - 1 - x === 0) body += '.';
            if (!alt) body = stripZeros(body);
          } else {
            body = expStyle(a, P - 1, upper, alt);
            if (!alt) {
              const idx = body.search(/[eE]/);
              body = stripZeros(body.slice(0, idx)) + body.slice(idx);
            }
          }
        }
        break;
      }
      case 's': {
        body = String(arg);
        if (prec !== undefined) body = body.slice(0, prec);
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
    else if (minus) out += sign + prefix + body + ' '.repeat(width - len);
    else if (zero && canZero) out += sign + prefix + '0'.repeat(width - len) + body;
    else out += ' '.repeat(width - len) + sign + prefix + body;
  }
  return out;
}
