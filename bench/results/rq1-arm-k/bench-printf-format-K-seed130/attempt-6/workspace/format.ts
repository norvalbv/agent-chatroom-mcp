// value = m * 2^e exactly, for finite x > 0
function decompose(x: number): { m: bigint; e: number } {
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, x);
  const bits = buf.getBigUint64(0);
  const exp = Number((bits >> 52n) & 0x7ffn);
  const frac = bits & ((1n << 52n) - 1n);
  if (exp === 0) return { m: frac, e: -1074 };
  return { m: frac | (1n << 52n), e: exp - 1075 };
}

// round-half-even(value * 10^k)
function scaledRound(m: bigint, e: number, k: number): bigint {
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

// fixed style digits: returns integer part string and fraction string
function fixedParts(x: number, p: number): [string, string] {
  let n = 0n;
  if (x !== 0) {
    const { m, e } = decompose(x);
    n = scaledRound(m, e, p);
  }
  let s = n.toString();
  if (s.length <= p) s = '0'.repeat(p - s.length + 1) + s;
  return [s.slice(0, s.length - p), s.slice(s.length - p)];
}

// exponent style: digits string of length p+1 and exponent
function expParts(x: number, p: number): [string, number] {
  if (x === 0) return ['0'.repeat(p + 1), 0];
  const { m, e } = decompose(x);
  let E = Math.floor(Math.log10(x));
  if (!isFinite(E)) E = -320;
  const lo = 10n ** BigInt(p);
  const hi = lo * 10n;
  for (;;) {
    const n = scaledRound(m, e, p - E);
    if (n >= hi) E++;
    else if (n < lo) E--;
    else return [n.toString(), E];
  }
}

function expText(digits: string, E: number, p: number, alt: boolean, upper: boolean): string {
  let s = digits[0];
  if (p > 0 || alt) s += '.';
  s += digits.slice(1);
  const a = Math.abs(E).toString().padStart(2, '0');
  return s + (upper ? 'E' : 'e') + (E < 0 ? '-' : '+') + a;
}

function stripZeros(s: string): string {
  if (!s.includes('.')) return s;
  s = s.replace(/0+$/, '');
  if (s.endsWith('.')) s = s.slice(0, -1);
  return s;
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
    let numeric = true;

    if (conv === 'd' || conv === 'i' || conv === 'x' || conv === 'X' || conv === 'o') {
      const v = BigInt(arg as number | bigint);
      const neg = v < 0n;
      const mag = neg ? -v : v;
      if (conv === 'd' || conv === 'i') {
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
      }
      let digits = mag === 0n && prec === 0 ? '' : mag.toString(conv === 'o' ? 8 : conv === 'd' || conv === 'i' ? 10 : 16);
      if (conv === 'X') digits = digits.toUpperCase();
      if (prec >= 0) digits = digits.padStart(prec, '0');
      if (alt) {
        if (conv === 'o') {
          if (digits[0] !== '0') digits = '0' + digits;
        } else if ((conv === 'x' || conv === 'X') && mag !== 0n) {
          prefix = conv === 'x' ? '0x' : '0X';
        }
      }
      body = digits;
      if (prec >= 0) canZero = false;
    } else if ('eEfFgG'.includes(conv)) {
      const x = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      if (Number.isNaN(x)) {
        body = upper ? 'NAN' : 'nan';
        canZero = false;
      } else {
        const negative = x < 0 || Object.is(x, -0);
        sign = negative ? '-' : plus ? '+' : space ? ' ' : '';
        const ax = Math.abs(x);
        if (ax === Infinity) {
          body = upper ? 'INF' : 'inf';
          canZero = false;
        } else {
          const lc = conv.toLowerCase();
          if (lc === 'f') {
            const p = prec < 0 ? 6 : prec;
            const [ip, fp] = fixedParts(ax, p);
            body = ip + (p > 0 || alt ? '.' : '') + fp;
          } else if (lc === 'e') {
            const p = prec < 0 ? 6 : prec;
            const [d, E] = expParts(ax, p);
            body = expText(d, E, p, alt, upper);
          } else {
            const P = prec < 0 ? 6 : prec === 0 ? 1 : prec;
            const [d, X] = expParts(ax, P - 1);
            if (P > X && X >= -4) {
              const p = P - 1 - X;
              const [ip, fp] = fixedParts(ax, p);
              body = ip + (p > 0 || alt ? '.' : '') + fp;
              if (!alt) body = stripZeros(body);
            } else {
              const p = P - 1;
              body = expText(d, X, p, alt, upper);
              if (!alt) {
                const k = body.search(/[eE]/);
                body = stripZeros(body.slice(0, k)) + body.slice(k);
              }
            }
          }
        }
      }
    } else if (conv === 's') {
      numeric = false;
      body = String(arg);
      if (prec >= 0) body = body.slice(0, prec);
    } else {
      numeric = false;
      body = String(arg);
    }

    const len = sign.length + prefix.length + body.length;
    if (len >= width) out += sign + prefix + body;
    else if (minus) out += sign + prefix + body + ' '.repeat(width - len);
    else if (zero && numeric && canZero) out += sign + prefix + '0'.repeat(width - len) + body;
    else out += ' '.repeat(width - len) + sign + prefix + body;
  }
  return out;
}
