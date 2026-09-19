function decompose(x: number): [bigint, bigint] {
  const f = new Float64Array(1);
  f[0] = x;
  const bits = new BigUint64Array(f.buffer)[0];
  const ex = Number((bits >> 52n) & 0x7ffn);
  const frac = bits & ((1n << 52n) - 1n);
  let m: bigint;
  let e2: number;
  if (ex === 0) {
    m = frac;
    e2 = -1074;
  } else {
    m = frac | (1n << 52n);
    e2 = ex - 1075;
  }
  return e2 >= 0 ? [m << BigInt(e2), 1n] : [m, 1n << BigInt(-e2)];
}

function divRoundEven(n: bigint, d: bigint): bigint {
  const q = n / d;
  const r = n % d;
  const t = r * 2n;
  if (t > d || (t === d && (q & 1n) === 1n)) return q + 1n;
  return q;
}

const p10 = (n: number): bigint => 10n ** BigInt(n);

// abs value x (finite, >= 0) with p decimals -> digit string (with point)
function fixed(x: number, p: number, alt: boolean): string {
  const [N, D] = decompose(x);
  let s = divRoundEven(N * p10(p), D).toString();
  if (p > 0) {
    s = s.padStart(p + 1, '0');
    return s.slice(0, s.length - p) + '.' + s.slice(s.length - p);
  }
  return alt ? s + '.' : s;
}

// returns [digits (p+1 chars), exponent]
function sci(x: number, p: number): [string, number] {
  if (x === 0) return ['0'.repeat(p + 1), 0];
  const [N, D] = decompose(x);
  const ge = (e: number): boolean => (e >= 0 ? N >= p10(e) * D : N * p10(-e) >= D);
  let e = Math.floor(Math.log10(x));
  if (!isFinite(e)) e = -324;
  while (!ge(e)) e--;
  while (ge(e + 1)) e++;
  const k = p - e;
  let d = k >= 0 ? divRoundEven(N * p10(k), D) : divRoundEven(N, D * p10(-k));
  if (d >= p10(p + 1)) {
    e++;
    d = p10(p);
  }
  return [d.toString(), e];
}

function expStr(e: number, upper: boolean): string {
  const a = Math.abs(e).toString().padStart(2, '0');
  return (upper ? 'E' : 'e') + (e < 0 ? '-' : '+') + a;
}

function sciStr(x: number, p: number, alt: boolean, upper: boolean): string {
  const [d, e] = sci(x, p);
  let s = d[0];
  if (p > 0) s += '.' + d.slice(1);
  else if (alt) s += '.';
  return s + expStr(e, upper);
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
    let canZero = false;
    const lc = conv.toLowerCase();
    if (conv === 'd' || conv === 'i') {
      const v = BigInt(arg as number | bigint);
      const neg = v < 0n;
      let digits = (neg ? -v : v).toString();
      if (prec === 0 && v === 0n) digits = '';
      if (prec >= 0) digits = digits.padStart(prec, '0');
      sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
      body = digits;
      canZero = prec < 0;
    } else if (conv === 'x' || conv === 'X' || conv === 'o') {
      const v = BigInt(arg as number | bigint);
      let digits = v.toString(conv === 'o' ? 8 : 16);
      if (conv === 'X') digits = digits.toUpperCase();
      if (prec === 0 && v === 0n) digits = '';
      if (prec >= 0) digits = digits.padStart(prec, '0');
      if (alt) {
        if (conv === 'o') {
          if (digits[0] !== '0') digits = '0' + digits;
        } else if (v !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      }
      body = digits;
      canZero = prec < 0;
    } else if (lc === 'e' || lc === 'f' || lc === 'g') {
      const v = arg as number;
      const upper = conv !== lc;
      const isNeg = v < 0 || Object.is(v, -0);
      if (Number.isNaN(v)) {
        body = upper ? 'NAN' : 'nan';
      } else {
        sign = isNeg ? '-' : plus ? '+' : space ? ' ' : '';
        if (!isFinite(v)) {
          body = upper ? 'INF' : 'inf';
        } else {
          const x = Math.abs(v);
          canZero = true;
          if (lc === 'f') body = fixed(x, prec < 0 ? 6 : prec, alt);
          else if (lc === 'e') body = sciStr(x, prec < 0 ? 6 : prec, alt, upper);
          else {
            const P = prec < 0 ? 6 : prec === 0 ? 1 : prec;
            const X = sci(x, P - 1)[1];
            if (P > X && X >= -4) {
              body = fixed(x, P - 1 - X, alt);
              if (!alt) body = stripZeros(body);
            } else {
              body = sciStr(x, P - 1, alt, upper);
              if (!alt) {
                const k = body.search(/[eE]/);
                body = stripZeros(body.slice(0, k)) + body.slice(k);
              }
            }
          }
        }
      }
    } else if (conv === 's') {
      body = String(arg);
      if (prec >= 0) body = body.slice(0, prec);
    } else if (conv === 'c') {
      body = String(arg);
    }
    const len = sign.length + prefix.length + body.length;
    if (len >= width) out += sign + prefix + body;
    else if (minus) out += sign + prefix + body + ' '.repeat(width - len);
    else if (zero && canZero) out += sign + prefix + '0'.repeat(width - len) + body;
    else out += ' '.repeat(width - len) + sign + prefix + body;
  }
  return out;
}
