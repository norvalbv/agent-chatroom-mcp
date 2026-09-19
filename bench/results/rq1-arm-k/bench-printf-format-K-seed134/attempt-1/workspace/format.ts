function decompose(v: number): { num: bigint; den: bigint } {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, Math.abs(v));
  const bits = dv.getBigUint64(0);
  const expBits = Number((bits >> 52n) & 0x7ffn);
  const frac = bits & ((1n << 52n) - 1n);
  let m: bigint;
  let e: number;
  if (expBits === 0) {
    m = frac;
    e = -1074;
  } else {
    m = frac | (1n << 52n);
    e = expBits - 1075;
  }
  return e >= 0 ? { num: m << BigInt(e), den: 1n } : { num: m, den: 1n << BigInt(-e) };
}

// round(v * 10^s) half-even, exact
function scaledRound(v: { num: bigint; den: bigint }, s: number): bigint {
  let { num, den } = v;
  if (s >= 0) num *= 10n ** BigInt(s);
  else den *= 10n ** BigInt(-s);
  const q = num / den;
  const r = num % den;
  const twice = 2n * r;
  if (twice > den || (twice === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// fixed: digits string with p fractional digits
function fixedDigits(v: number, p: number, alt: boolean): string {
  const s = scaledRound(decompose(v), p).toString().padStart(p + 1, '0');
  const ip = s.slice(0, s.length - p);
  const fp = s.slice(s.length - p);
  return p > 0 ? ip + '.' + fp : alt ? ip + '.' : ip;
}

// exponent-style: returns digit string (p+1 digits) and exponent
function expDigits(v: number, p: number): { digits: string; x: number } {
  if (v === 0) return { digits: '0'.repeat(p + 1), x: 0 };
  const d = decompose(v);
  let x = Math.floor(Math.log10(Math.abs(v)));
  if (!Number.isFinite(x)) x = -324;
  // adjust so 10^x <= |v| < 10^(x+1)
  const ge = (k: number) => (k >= 0 ? d.num >= d.den * 10n ** BigInt(k) : d.num * 10n ** BigInt(-k) >= d.den);
  while (!ge(x)) x--;
  while (ge(x + 1)) x++;
  let q = scaledRound(d, p - x);
  if (q >= 10n ** BigInt(p + 1)) {
    x++;
    q = scaledRound(d, p - x);
  }
  return { digits: q.toString(), x };
}

function expStr(v: number, p: number, alt: boolean, upper: boolean): string {
  const { digits, x } = expDigits(v, p);
  let s = digits[0];
  if (p > 0) s += '.' + digits.slice(1);
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
    let w = '';
    while (i < fmt.length && fmt[i] >= '0' && fmt[i] <= '9') w += fmt[i++];
    const width = w ? parseInt(w, 10) : 0;
    let prec: number | null = null;
    if (fmt[i] === '.') {
      i++;
      let p = '';
      while (i < fmt.length && fmt[i] >= '0' && fmt[i] <= '9') p += fmt[i++];
      prec = p ? parseInt(p, 10) : 0;
    }
    const conv = fmt[i++];
    const arg = args[ai++];

    let sign = '';
    let prefix = '';
    let body = '';
    let canZero = false;
    const signFor = (neg: boolean) => (neg ? '-' : plus ? '+' : space ? ' ' : '');

    if (conv === 'd' || conv === 'i') {
      const n = BigInt(arg as number | bigint);
      sign = signFor(n < 0n);
      body = (n < 0n ? -n : n).toString();
      if (prec !== null) {
        if (prec === 0 && n === 0n) body = '';
        body = body.padStart(prec, '0');
      }
      canZero = prec === null;
    } else if (conv === 'x' || conv === 'X' || conv === 'o') {
      const n = BigInt(arg as number | bigint);
      body = n.toString(conv === 'o' ? 8 : 16);
      if (conv === 'X') body = body.toUpperCase();
      if (prec !== null) {
        if (prec === 0 && n === 0n) body = '';
        body = body.padStart(prec, '0');
      }
      if (alt) {
        if (conv === 'o') {
          if (body[0] !== '0') body = '0' + body;
        } else if (n !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      }
      canZero = prec === null;
    } else if ('eEfFgG'.includes(conv)) {
      const v = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      if (Number.isNaN(v)) {
        body = upper ? 'NAN' : 'nan';
      } else {
        const neg = v < 0 || Object.is(v, -0);
        sign = signFor(neg);
        if (!Number.isFinite(v)) {
          body = upper ? 'INF' : 'inf';
        } else {
          canZero = true;
          const lc = conv.toLowerCase();
          if (lc === 'f') body = fixedDigits(v, prec ?? 6, alt);
          else if (lc === 'e') body = expStr(v, prec ?? 6, alt, upper);
          else {
            const P = prec === null ? 6 : prec === 0 ? 1 : prec;
            const { x } = expDigits(v, P - 1);
            if (P > x && x >= -4) {
              body = fixedDigits(v, P - 1 - x, alt);
              if (!alt) body = stripZeros(body);
            } else {
              const s = expStr(v, P - 1, alt, upper);
              if (alt) body = s;
              else {
                const k = s.search(/[eE]/);
                body = stripZeros(s.slice(0, k)) + s.slice(k);
              }
            }
          }
        }
      }
    } else if (conv === 's') {
      body = String(arg);
      if (prec !== null) body = body.slice(0, prec);
    } else if (conv === 'c') {
      body = String(arg);
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
