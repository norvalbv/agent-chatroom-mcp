function decompose(x: number): { m: bigint; e: number } {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const exp = (hi >>> 20) & 0x7ff;
  const frac = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (exp === 0) return { m: frac, e: -1074 };
  return { m: frac | (1n << 52n), e: exp - 1075 };
}

// round_half_even(m * 2^e * 10^k)
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

function fixedStr(ax: number, p: number, alt: boolean): string {
  const { m, e } = decompose(ax);
  const s = roundScaled(m, e, p).toString().padStart(p + 1, '0');
  const ip = s.slice(0, s.length - p);
  const fp = s.slice(s.length - p);
  return ip + (p > 0 || alt ? '.' : '') + fp;
}

// returns digit string of length p+1 and decimal exponent
function expParts(ax: number, p: number): { digits: string; exp: number } {
  if (ax === 0) return { digits: '0'.repeat(p + 1), exp: 0 };
  const { m, e } = decompose(ax);
  let E = Math.floor(Math.log10(ax));
  if (!isFinite(E)) E = -324;
  const lo = 10n ** BigInt(p);
  const hi = lo * 10n;
  for (let i = 0; i < 10; i++) {
    const N = roundScaled(m, e, p - E);
    if (N >= hi) E++;
    else if (N < lo) E--;
    else return { digits: N.toString(), exp: E };
  }
  throw new Error('exp search failed');
}

function expStr(ax: number, p: number, alt: boolean, upper: boolean): string {
  const { digits, exp } = expParts(ax, p);
  const es = String(Math.abs(exp)).padStart(2, '0');
  return (
    digits[0] + (p > 0 || alt ? '.' : '') + digits.slice(1) +
    (upper ? 'E' : 'e') + (exp < 0 ? '-' : '+') + es
  );
}

function stripZeros(s: string): string {
  // s may contain exponent part
  let mant = s;
  let tail = '';
  const idx = s.search(/[eE]/);
  if (idx >= 0) {
    mant = s.slice(0, idx);
    tail = s.slice(idx);
  }
  if (mant.includes('.')) mant = mant.replace(/0+$/, '').replace(/\.$/, '');
  return mant + tail;
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
      const c = fmt[i];
      if (c === '-') minus = true;
      else if (c === '+') plus = true;
      else if (c === ' ') space = true;
      else if (c === '0') zero = true;
      else if (c === '#') alt = true;
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
    const signFor = (neg: boolean) => (neg ? '-' : plus ? '+' : space ? ' ' : '');

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
          sign = signFor(neg);
          body = mag.toString();
        } else if (conv === 'o') {
          body = mag.toString(8);
        } else {
          body = mag.toString(16);
          if (conv === 'X') body = body.toUpperCase();
        }
        if (prec >= 0) {
          if (prec === 0 && mag === 0n) body = '';
          body = body.padStart(prec, '0');
          canZero = false;
        }
        if (conv === 'o' && alt && body[0] !== '0') body = '0' + body;
        if ((conv === 'x' || conv === 'X') && alt && mag !== 0n) prefix = conv === 'x' ? '0x' : '0X';
        break;
      }
      case 'e':
      case 'E':
      case 'f':
      case 'F':
      case 'g':
      case 'G': {
        const x = arg as number;
        const upper = conv === 'E' || conv === 'F' || conv === 'G';
        if (Number.isNaN(x)) {
          body = upper ? 'NAN' : 'nan';
          canZero = false;
          break;
        }
        const neg = x < 0 || Object.is(x, -0);
        sign = signFor(neg);
        if (!isFinite(x)) {
          body = upper ? 'INF' : 'inf';
          canZero = false;
          break;
        }
        const ax = Math.abs(x);
        const p = prec < 0 ? 6 : prec;
        if (conv === 'f' || conv === 'F') body = fixedStr(ax, p, alt);
        else if (conv === 'e' || conv === 'E') body = expStr(ax, p, alt, upper);
        else {
          const P = p === 0 ? 1 : p;
          const X = expParts(ax, P - 1).exp;
          if (P > X && X >= -4) body = fixedStr(ax, P - 1 - X, alt);
          else body = expStr(ax, P - 1, alt, upper);
          if (!alt) body = stripZeros(body);
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
