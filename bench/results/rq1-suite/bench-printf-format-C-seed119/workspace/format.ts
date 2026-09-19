// Round the exact value m*2^e*10^k to an integer, ties to even.
function scaledRound(m: bigint, e: number, k: number): bigint {
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

// Decompose a finite non-negative double into m * 2^e.
function decompose(v: number): { m: bigint; e: number } {
  if (v === 0) return { m: 0n, e: 0 };
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, v);
  const hi = buf.getUint32(0);
  const lo = buf.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (expBits === 0) return { m, e: -1074 };
  m |= 1n << 52n;
  return { m, e: expBits - 1075 };
}

// Fixed notation digits: integer part and fraction string.
function fixedDigits(v: number, prec: number): { int: string; frac: string } {
  const { m, e } = decompose(v);
  let s = scaledRound(m, e, prec).toString();
  if (s.length < prec + 1) s = '0'.repeat(prec + 1 - s.length) + s;
  return { int: s.slice(0, s.length - prec), frac: s.slice(s.length - prec) };
}

// p significant digits and the decimal exponent (after rounding).
function sciDigits(v: number, p: number): { digits: string; exp: number } {
  if (v === 0) return { digits: '0'.repeat(p), exp: 0 };
  const { m, e } = decompose(v);
  let x = Math.floor(Math.log10(v));
  if (!isFinite(x)) x = -324;
  const lo = 10n ** BigInt(p - 1);
  const hi = lo * 10n;
  for (let i = 0; i < 20; i++) {
    const n = scaledRound(m, e, p - 1 - x);
    if (n >= hi) x++;
    else if (n < lo) x--;
    else return { digits: n.toString(), exp: x };
  }
  throw new Error('unreachable');
}

function expStr(x: number, upper: boolean): string {
  const a = Math.abs(x);
  return (upper ? 'E' : 'e') + (x < 0 ? '-' : '+') + (a < 10 ? '0' : '') + a;
}

function fmtE(v: number, prec: number, alt: boolean, upper: boolean): string {
  const { digits, exp } = sciDigits(v, prec + 1);
  return digits[0] + (prec > 0 || alt ? '.' : '') + digits.slice(1) + expStr(exp, upper);
}

function fmtF(v: number, prec: number, alt: boolean): string {
  const { int, frac } = fixedDigits(v, prec);
  return int + (prec > 0 || alt ? '.' : '') + frac;
}

function stripZeros(s: string): string {
  if (!s.includes('.')) return s;
  return s.replace(/0+$/, '').replace(/\.$/, '');
}

function fmtG(v: number, prec: number, alt: boolean, upper: boolean): string {
  const P = prec === 0 ? 1 : prec;
  const { exp: X } = sciDigits(v, P);
  let body: string;
  if (P > X && X >= -4) {
    body = fmtF(v, P - 1 - X, alt);
    if (!alt) body = stripZeros(body);
  } else {
    body = fmtE(v, P - 1, alt, upper);
    if (!alt) {
      const idx = body.search(/[eE]/);
      body = stripZeros(body.slice(0, idx)) + body.slice(idx);
    }
  }
  return body;
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
    } else if (conv === 'd' || conv === 'i' || conv === 'x' || conv === 'X' || conv === 'o') {
      let n = typeof arg === 'bigint' ? arg : BigInt(arg as number);
      if (conv === 'd' || conv === 'i') {
        if (n < 0n) {
          sign = '-';
          n = -n;
        } else sign = plus ? '+' : space ? ' ' : '';
        body = n.toString();
      } else {
        body = n.toString(conv === 'o' ? 8 : 16);
        if (conv === 'X') body = body.toUpperCase();
      }
      if (prec === 0 && n === 0n) body = '';
      if (prec >= 0) {
        if (body.length < prec) body = '0'.repeat(prec - body.length) + body;
        canZero = false;
      }
      if (alt) {
        if (conv === 'o') {
          if (body[0] !== '0') body = '0' + body;
        } else if ((conv === 'x' || conv === 'X') && n !== 0n) {
          prefix = conv === 'x' ? '0x' : '0X';
        }
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
        const a = Math.abs(v);
        if (a === Infinity) {
          body = upper ? 'INF' : 'inf';
          canZero = false;
        } else {
          const p = prec < 0 ? 6 : prec;
          const lc = conv.toLowerCase();
          if (lc === 'e') body = fmtE(a, p, alt, conv === 'E');
          else if (lc === 'f') body = fmtF(a, p, alt);
          else body = fmtG(a, p, alt, conv === 'G');
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
