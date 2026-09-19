function roundDiv(num: bigint, den: bigint): bigint {
  const q = num / den;
  const r = num % den;
  const t = r * 2n;
  if (t > den || (t === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// |v| (finite, nonzero) as num/den exactly
function ratio(v: number): [bigint, bigint] {
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
  return e >= 0 ? [m << BigInt(e), 1n] : [m, 1n << BigInt(-e)];
}

// round |v| * 10^k to integer
function scaled(v: number, k: number): bigint {
  if (v === 0) return 0n;
  let [n, d] = ratio(v);
  if (k >= 0) n *= 10n ** BigInt(k);
  else d *= 10n ** BigInt(-k);
  return roundDiv(n, d);
}

function fixed(v: number, p: number, alt: boolean): string {
  let s = scaled(v, p).toString();
  if (p > 0) {
    s = s.padStart(p + 1, '0');
    s = s.slice(0, s.length - p) + '.' + s.slice(s.length - p);
  } else if (alt) s += '.';
  return s;
}

// returns digits (p+1 of them) and decimal exponent
function sci(v: number, p: number): [string, number] {
  if (v === 0) return ['0'.repeat(p + 1), 0];
  const [n, d] = ratio(v);
  // estimate exponent
  let x = Math.floor(Math.log10(Math.abs(v)));
  if (!isFinite(x)) x = 0;
  const cmp = (X: number) => {
    // is 10^X <= v ?
    return X >= 0 ? n >= d * 10n ** BigInt(X) : n * 10n ** BigInt(-X) >= d;
  };
  while (!cmp(x)) x--;
  while (cmp(x + 1)) x++;
  let digits = scaled(v, p - x);
  if (digits >= 10n ** BigInt(p + 1)) {
    x++;
    digits = scaled(v, p - x);
  }
  return [digits.toString(), x];
}

function expStr(x: number, upper: boolean): string {
  const a = Math.abs(x).toString().padStart(2, '0');
  return (upper ? 'E' : 'e') + (x < 0 ? '-' : '+') + a;
}

function sciStr(v: number, p: number, alt: boolean, upper: boolean): string {
  const [d, x] = sci(v, p);
  let s = d[0];
  if (p > 0) s += '.' + d.slice(1);
  else if (alt) s += '.';
  return s + expStr(x, upper);
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
    let numeric = true;
    let allowZero = true;

    if (conv === 'd' || conv === 'i' || conv === 'x' || conv === 'X' || conv === 'o') {
      let b = BigInt(arg as number | bigint);
      if (conv === 'd' || conv === 'i') {
        if (b < 0n) {
          sign = '-';
          b = -b;
        } else sign = plus ? '+' : space ? ' ' : '';
      }
      const radix = conv === 'o' ? 8 : conv === 'd' || conv === 'i' ? 10 : 16;
      let digits = b.toString(radix);
      if (conv === 'X') digits = digits.toUpperCase();
      if (prec === 0 && b === 0n) digits = '';
      if (prec >= 0) {
        digits = digits.padStart(prec, '0');
        allowZero = false;
      }
      if (alt) {
        if (conv === 'o') {
          if (digits[0] !== '0') digits = '0' + digits;
        } else if ((conv === 'x' || conv === 'X') && b !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      }
      body = digits;
    } else if ('eEfFgG'.includes(conv)) {
      const v = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      const neg = v < 0 || Object.is(v, -0);
      if (Number.isNaN(v)) {
        sign = '';
        body = upper ? 'NAN' : 'nan';
        allowZero = false;
      } else {
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        if (!isFinite(v)) {
          body = upper ? 'INF' : 'inf';
          allowZero = false;
        } else {
          const lc = conv.toLowerCase();
          if (lc === 'f') body = fixed(v, prec < 0 ? 6 : prec, alt);
          else if (lc === 'e') body = sciStr(v, prec < 0 ? 6 : prec, alt, upper);
          else {
            const P = prec < 0 ? 6 : prec === 0 ? 1 : prec;
            const [, X] = sci(v, P - 1);
            if (P > X && X >= -4) {
              body = fixed(v, P - 1 - X, alt);
              if (!alt) body = stripZeros(body);
            } else {
              let s = sciStr(v, P - 1, alt, upper);
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
      if (prec >= 0) body = body.slice(0, prec);
    } else {
      numeric = false;
      body = String(arg)[0];
    }

    const len = sign.length + prefix.length + body.length;
    if (len >= width) out += sign + prefix + body;
    else if (minus) out += sign + prefix + body + ' '.repeat(width - len);
    else if (numeric && zero && allowZero) out += sign + prefix + '0'.repeat(width - len) + body;
    else out += ' '.repeat(width - len) + sign + prefix + body;
  }
  return out;
}
