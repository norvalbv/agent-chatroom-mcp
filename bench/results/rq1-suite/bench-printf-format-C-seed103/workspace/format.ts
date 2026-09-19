// Round-half-even of num/den (both positive BigInt).
function divRound(num: bigint, den: bigint): bigint {
  const q = num / den;
  const r2 = (num - q * den) * 2n;
  if (r2 > den || (r2 === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// Decompose finite non-negative double into m * 2^e.
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

// round_half_even(|v| * 10^k) as BigInt.
function scaled(v: number, k: number): bigint {
  const [m, e] = decompose(v);
  let num = m;
  let den = 1n;
  if (e >= 0) num *= 1n << BigInt(e);
  else den *= 1n << BigInt(-e);
  if (k >= 0) num *= 10n ** BigInt(k);
  else den *= 10n ** BigInt(-k);
  return divRound(num, den);
}

// Digits and exponent for e-style with p fractional digits.
function expDigits(v: number, p: number): [string, number] {
  if (v === 0) return ['0'.repeat(p + 1), 0];
  let x = Math.floor(Math.log10(v));
  if (!isFinite(x)) x = -324;
  const lowB = 10n ** BigInt(p);
  const highB = lowB * 10n;
  for (let i = 0; i < 20; i++) {
    const n = scaled(v, p - x);
    if (n >= highB) x++;
    else if (n < lowB) x--;
    else return [n.toString(), x];
  }
  throw new Error('exp failure');
}

function fixedStr(v: number, p: number, alt: boolean): string {
  let s = scaled(v, p).toString();
  if (p > 0) {
    s = s.padStart(p + 1, '0');
    return s.slice(0, s.length - p) + '.' + s.slice(s.length - p);
  }
  return alt ? s + '.' : s;
}

function expStr(v: number, p: number, alt: boolean, upper: boolean): string {
  const [d, x] = expDigits(v, p);
  let s = d[0];
  if (p > 0) s += '.' + d.slice(1);
  else if (alt) s += '.';
  const ax = Math.abs(x);
  s += (upper ? 'E' : 'e') + (x < 0 ? '-' : '+') + (ax < 10 ? '0' + ax : String(ax));
  return s;
}

function stripZeros(s: string): string {
  if (s.indexOf('.') < 0) return s;
  return s.replace(/0+$/, '').replace(/\.$/, '');
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let out = '';
  let ai = 0;
  let i = 0;
  const n = fmt.length;
  while (i < n) {
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
    while (fmt[i] >= '0' && fmt[i] <= '9') width = width * 10 + (fmt.charCodeAt(i++) - 48);
    let prec = -1;
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
    let canZero = true;

    if (conv === 's' || conv === 'c') {
      body = String(arg);
      if (conv === 's' && prec >= 0) body = body.slice(0, prec);
      canZero = false;
    } else if (conv === 'd' || conv === 'i' || conv === 'x' || conv === 'X' || conv === 'o') {
      let v = BigInt(arg as number | bigint);
      if (conv === 'd' || conv === 'i') {
        if (v < 0n) {
          sign = '-';
          v = -v;
        } else sign = plus ? '+' : space ? ' ' : '';
      }
      const radix = conv === 'o' ? 8 : conv === 'd' || conv === 'i' ? 10 : 16;
      body = v.toString(radix);
      if (conv === 'X') body = body.toUpperCase();
      if (prec === 0 && v === 0n) body = '';
      if (prec >= 0) {
        body = body.padStart(prec, '0');
        canZero = false;
      }
      if (alt) {
        if (conv === 'o') {
          if (body[0] !== '0') body = '0' + body;
        } else if ((conv === 'x' || conv === 'X') && v !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      }
    } else {
      const v = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      if (Number.isNaN(v)) {
        body = upper ? 'NAN' : 'nan';
        canZero = false;
      } else {
        if (v < 0 || Object.is(v, -0)) sign = '-';
        else sign = plus ? '+' : space ? ' ' : '';
        const a = Math.abs(v);
        if (a === Infinity) {
          body = upper ? 'INF' : 'inf';
          canZero = false;
        } else if (conv === 'f' || conv === 'F') {
          body = fixedStr(a, prec < 0 ? 6 : prec, alt);
        } else if (conv === 'e' || conv === 'E') {
          body = expStr(a, prec < 0 ? 6 : prec, alt, upper);
        } else {
          let p = prec < 0 ? 6 : prec;
          if (p === 0) p = 1;
          const x = expDigits(a, p - 1)[1];
          if (p > x && x >= -4) {
            body = fixedStr(a, p - 1 - x, alt);
            if (!alt) body = stripZeros(body);
          } else {
            body = expStr(a, p - 1, alt, upper);
            if (!alt) {
              const k = body.search(/[eE]/);
              body = stripZeros(body.slice(0, k)) + body.slice(k);
            }
          }
        }
      }
    }

    let len = sign.length + prefix.length + body.length;
    if (len < width) {
      if (minus) body = body + ' '.repeat(width - len);
      else if (zero && canZero && conv !== 's' && conv !== 'c') body = '0'.repeat(width - len) + body;
      else sign = ' '.repeat(width - len) + sign;
    }
    out += sign + prefix + body;
  }
  return out;
}
