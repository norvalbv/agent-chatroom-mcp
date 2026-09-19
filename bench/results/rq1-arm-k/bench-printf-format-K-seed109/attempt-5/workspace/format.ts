// Decompose |v| (finite, non-negative) into m * 2^e2 exactly.
function decompose(v: number): { m: bigint; e2: number } {
  if (v === 0) return { m: 0n, e2: 0 };
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, v);
  const hi = buf.getUint32(0);
  const lo = buf.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (expBits === 0) return { m, e2: -1074 };
  m |= 1n << 52n;
  return { m, e2: expBits - 1075 };
}

// round-half-even of |v| * 10^k as a BigInt
function scaledRound(d: { m: bigint; e2: number }, k: number): bigint {
  let num = d.m;
  let den = 1n;
  if (d.e2 >= 0) num <<= BigInt(d.e2);
  else den <<= BigInt(-d.e2);
  if (k >= 0) num *= 10n ** BigInt(k);
  else den *= 10n ** BigInt(-k);
  const q = num / den;
  const r = num % den;
  const twice = r * 2n;
  if (twice > den || (twice === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

function fixedBody(v: number, prec: number, alt: boolean): string {
  const D = scaledRound(decompose(v), prec);
  let s = D.toString();
  if (prec > 0) {
    s = s.padStart(prec + 1, '0');
    return s.slice(0, s.length - prec) + '.' + s.slice(s.length - prec);
  }
  return alt ? s + '.' : s;
}

function sciParts(v: number, prec: number): { digits: string; x: number } {
  if (v === 0) return { digits: '0'.repeat(prec + 1), x: 0 };
  const d = decompose(v);
  let x = Math.floor(Math.log10(v));
  const lo = 10n ** BigInt(prec);
  const hi = lo * 10n;
  for (;;) {
    const D = scaledRound(d, prec - x);
    if (D >= hi) x++;
    else if (D < lo) x--;
    else return { digits: D.toString(), x };
  }
}

function sciBody(digits: string, x: number, alt: boolean, upper: boolean): string {
  const prec = digits.length - 1;
  let s = digits[0];
  if (prec > 0) s += '.' + digits.slice(1);
  else if (alt) s += '.';
  const ax = Math.abs(x);
  return s + (upper ? 'E' : 'e') + (x < 0 ? '-' : '+') + (ax < 10 ? '0' + ax : String(ax));
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
    let prec: number | undefined;
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
    let allowZero = zero && !minus;

    const lower = conv.toLowerCase();
    if (conv === 'd' || conv === 'i' || conv === 'x' || conv === 'X' || conv === 'o') {
      let n = BigInt(arg as number | bigint);
      if (conv === 'd' || conv === 'i') {
        if (n < 0n) {
          sign = '-';
          n = -n;
        } else sign = plus ? '+' : space ? ' ' : '';
      }
      let digits = conv === 'x' ? n.toString(16) : conv === 'X' ? n.toString(16).toUpperCase() : conv === 'o' ? n.toString(8) : n.toString();
      if (prec !== undefined) {
        allowZero = false;
        if (prec === 0 && n === 0n) digits = '';
        digits = digits.padStart(prec, '0');
      }
      if (alt) {
        if (conv === 'o') {
          if (!digits.startsWith('0')) digits = '0' + digits;
        } else if ((conv === 'x' || conv === 'X') && n !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      }
      body = digits;
    } else if (lower === 'e' || lower === 'f' || lower === 'g') {
      const v = arg as number;
      const upper = conv !== lower;
      const neg = v < 0 || Object.is(v, -0);
      if (Number.isNaN(v)) {
        body = upper ? 'NAN' : 'nan';
        allowZero = false;
      } else {
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        if (!Number.isFinite(v)) {
          body = upper ? 'INF' : 'inf';
          allowZero = false;
        } else {
          const a = Math.abs(v);
          if (lower === 'f') body = fixedBody(a, prec ?? 6, alt);
          else if (lower === 'e') {
            const p = sciParts(a, prec ?? 6);
            body = sciBody(p.digits, p.x, alt, upper);
          } else {
            const P = prec === undefined ? 6 : prec === 0 ? 1 : prec;
            const p = sciParts(a, P - 1);
            if (P > p.x && p.x >= -4) {
              body = fixedBody(a, P - 1 - p.x, alt);
              if (!alt) body = stripZeros(body);
            } else {
              let s = sciBody(p.digits, p.x, alt, upper);
              if (!alt) {
                const k = s.search(/[eE]/);
                s = stripZeros(s.slice(0, k)) + s.slice(k);
              }
              body = s;
            }
          }
        }
      }
    } else if (conv === 's') {
      numeric = false;
      body = String(arg);
      if (prec !== undefined) body = body.slice(0, prec);
    } else {
      numeric = false;
      body = String(arg);
    }

    const len = sign.length + prefix.length + body.length;
    if (len >= width) out += sign + prefix + body;
    else if (minus) out += sign + prefix + body + ' '.repeat(width - len);
    else if (numeric && allowZero) out += sign + prefix + '0'.repeat(width - len) + body;
    else out += ' '.repeat(width - len) + sign + prefix + body;
  }
  return out;
}
