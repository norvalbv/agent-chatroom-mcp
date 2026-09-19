const f64 = new Float64Array(1);
const u64 = new BigUint64Array(f64.buffer);

// |x| (finite) as an exact fraction num/den
function toFrac(x: number): [bigint, bigint] {
  f64[0] = Math.abs(x);
  const bits = u64[0];
  const expBits = Number((bits >> 52n) & 0x7ffn);
  const frac = bits & ((1n << 52n) - 1n);
  let mant: bigint;
  let exp: number;
  if (expBits === 0) {
    mant = frac;
    exp = -1074;
  } else {
    mant = frac | (1n << 52n);
    exp = expBits - 1075;
  }
  return exp >= 0 ? [mant << BigInt(exp), 1n] : [mant, 1n << BigInt(-exp)];
}

// round-half-even of (num/den) * 10^k
function roundScaled(num: bigint, den: bigint, k: number): bigint {
  if (k >= 0) num *= 10n ** BigInt(k);
  else den *= 10n ** BigInt(-k);
  const q = num / den;
  const r = num % den;
  const twice = r * 2n;
  if (twice > den || (twice === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

function fixedDigits(x: number, prec: number): string {
  const [n, d] = toFrac(x);
  return roundScaled(n, d, prec).toString();
}

// digits (prec+1 chars) and decimal exponent
function expParts(x: number, prec: number): { digits: string; exp: number } {
  if (x === 0) return { digits: '0'.repeat(prec + 1), exp: 0 };
  const [n, d] = toFrac(x);
  let e10 = n.toString().length - d.toString().length;
  const lo = 10n ** BigInt(prec);
  const hi = lo * 10n;
  for (;;) {
    const v = roundScaled(n, d, prec - e10);
    if (v >= hi) e10++;
    else if (v < lo) e10--;
    else return { digits: v.toString(), exp: e10 };
  }
}

function fStyle(x: number, prec: number, alt: boolean): string {
  let s = fixedDigits(x, prec);
  if (s.length <= prec) s = '0'.repeat(prec + 1 - s.length) + s;
  const ip = s.slice(0, s.length - prec);
  const fp = s.slice(s.length - prec);
  return ip + (prec > 0 || alt ? '.' : '') + fp;
}

function eStyle(x: number, prec: number, alt: boolean, upper: boolean, strip: boolean): string {
  const { digits, exp } = expParts(x, prec);
  let fp = digits.slice(1);
  if (strip) fp = fp.replace(/0+$/, '');
  const a = Math.abs(exp);
  const es = (a < 10 ? '0' : '') + a;
  return digits[0] + (fp.length > 0 || alt ? '.' : '') + fp + (upper ? 'E' : 'e') + (exp < 0 ? '-' : '+') + es;
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
    const lower = conv.toLowerCase();

    if (conv === 's' || conv === 'c') {
      body = String(arg);
      if (conv === 's' && prec >= 0) body = body.slice(0, prec);
      canZero = false;
    } else if (conv === 'd' || conv === 'i') {
      const v = BigInt(arg as number | bigint);
      sign = v < 0n ? '-' : plus ? '+' : space ? ' ' : '';
      body = v === 0n && prec === 0 ? '' : (v < 0n ? -v : v).toString();
      if (prec >= 0) {
        body = body.padStart(prec, '0');
        canZero = false;
      }
    } else if (lower === 'x' || conv === 'o') {
      const v = BigInt(arg as number | bigint);
      body = v === 0n && prec === 0 ? '' : v.toString(conv === 'o' ? 8 : 16);
      if (conv === 'X') body = body.toUpperCase();
      if (prec >= 0) {
        body = body.padStart(prec, '0');
        canZero = false;
      }
      if (alt) {
        if (conv === 'o') {
          if (body[0] !== '0') body = '0' + body;
        } else if (v !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      }
    } else {
      const x = arg as number;
      const upper = conv === conv.toUpperCase();
      if (Number.isNaN(x)) {
        body = upper ? 'NAN' : 'nan';
        canZero = false;
      } else {
        const neg = x < 0 || Object.is(x, -0);
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        if (!Number.isFinite(x)) {
          body = upper ? 'INF' : 'inf';
          canZero = false;
        } else if (lower === 'f') {
          body = fStyle(x, prec < 0 ? 6 : prec, alt);
        } else if (lower === 'e') {
          body = eStyle(x, prec < 0 ? 6 : prec, alt, upper, false);
        } else {
          const P = prec < 0 ? 6 : prec === 0 ? 1 : prec;
          const X = expParts(x, P - 1).exp;
          if (P > X && X >= -4) {
            body = fStyle(x, P - 1 - X, alt);
            if (!alt && body.includes('.')) body = body.replace(/0+$/, '').replace(/\.$/, '');
          } else {
            body = eStyle(x, P - 1, alt, upper, !alt);
          }
        }
      }
    }

    let len = sign.length + prefix.length + body.length;
    if (len < width) {
      const n = width - len;
      if (minus) body += ' '.repeat(n);
      else if (zero && canZero) body = '0'.repeat(n) + body;
      else sign = ' '.repeat(n) + sign;
    }
    out += sign + prefix + body;
  }
  return out;
}
