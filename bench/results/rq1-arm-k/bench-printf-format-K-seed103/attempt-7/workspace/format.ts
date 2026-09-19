function roundDiv(n: bigint, d: bigint): bigint {
  const q = n / d;
  const r2 = (n % d) * 2n;
  if (r2 > d || (r2 === d && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// exact rational of |v| (finite, nonzero)
function exact(v: number): { num: bigint; den: bigint } {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, Math.abs(v));
  const bits = dv.getBigUint64(0);
  const ex = Number((bits >> 52n) & 0x7ffn);
  let m = bits & ((1n << 52n) - 1n);
  let e: number;
  if (ex === 0) e = -1074;
  else {
    m |= 1n << 52n;
    e = ex - 1075;
  }
  return e >= 0 ? { num: m << BigInt(e), den: 1n } : { num: m, den: 1n << BigInt(-e) };
}

const p10 = (n: number): bigint => 10n ** BigInt(n);

// returns [intPart, fracDigits]
function fixed(v: number, p: number): [string, string] {
  let s: string;
  if (v === 0) s = '0'.repeat(p + 1);
  else {
    const { num, den } = exact(v);
    s = roundDiv(num * p10(p), den).toString();
    if (s.length < p + 1) s = '0'.repeat(p + 1 - s.length) + s;
  }
  return [s.slice(0, s.length - p), s.slice(s.length - p)];
}

// returns [digits (p+1 of them), exponent]
function expo(v: number, p: number): [string, number] {
  if (v === 0) return ['0'.repeat(p + 1), 0];
  const { num, den } = exact(v);
  const ge = (E: number): boolean => (E >= 0 ? num >= den * p10(E) : num * p10(-E) >= den);
  let E = num.toString().length - den.toString().length;
  while (!ge(E)) E--;
  while (ge(E + 1)) E++;
  const k = p - E;
  let r = k >= 0 ? roundDiv(num * p10(k), den) : roundDiv(num, den * p10(-k));
  if (r >= p10(p + 1)) {
    E++;
    r /= 10n;
  }
  return [r.toString(), E];
}

function expStr(digits: string, E: number, alt: boolean, upper: boolean): string {
  let s = digits[0];
  if (digits.length > 1 || alt) s += '.' + digits.slice(1);
  const a = Math.abs(E).toString().padStart(2, '0');
  return s + (upper ? 'E' : 'e') + (E < 0 ? '-' : '+') + a;
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
    const lower = conv.toLowerCase();

    if (conv === 's' || conv === 'c') {
      body = String(arg);
      if (conv === 's' && prec >= 0) body = body.slice(0, prec);
      canZero = false;
    } else if (conv === 'd' || conv === 'i' || conv === 'x' || conv === 'X' || conv === 'o') {
      const big = BigInt(arg as number | bigint);
      const neg = big < 0n;
      const mag = neg ? -big : big;
      if (conv === 'd' || conv === 'i') {
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
      }
      let digits = conv === 'x' ? mag.toString(16) : conv === 'X' ? mag.toString(16).toUpperCase() : conv === 'o' ? mag.toString(8) : mag.toString();
      if (prec === 0 && mag === 0n) digits = '';
      if (prec > digits.length) digits = '0'.repeat(prec - digits.length) + digits;
      if (alt) {
        if (conv === 'o') {
          if (digits[0] !== '0') digits = '0' + digits;
        } else if ((conv === 'x' || conv === 'X') && mag !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      }
      body = digits;
      if (prec >= 0) canZero = false;
    } else {
      const v = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      const negBit = v < 0 || Object.is(v, -0);
      if (Number.isNaN(v)) {
        body = upper ? 'NAN' : 'nan';
        canZero = false;
      } else {
        sign = negBit ? '-' : plus ? '+' : space ? ' ' : '';
        if (!Number.isFinite(v)) {
          body = upper ? 'INF' : 'inf';
          canZero = false;
        } else {
          const a = Math.abs(v);
          if (lower === 'f') {
            const p = prec < 0 ? 6 : prec;
            const [ip, fp] = fixed(a, p);
            body = ip + (p > 0 || alt ? '.' + fp : '');
          } else if (lower === 'e') {
            const p = prec < 0 ? 6 : prec;
            const [d, E] = expo(a, p);
            body = expStr(d, E, alt, upper);
          } else {
            let P = prec < 0 ? 6 : prec;
            if (P === 0) P = 1;
            const [d, X] = expo(a, P - 1);
            if (P > X && X >= -4) {
              const p = P - 1 - X;
              const [ip, fp0] = fixed(a, p);
              let fp = fp0;
              if (!alt) fp = fp.replace(/0+$/, '');
              body = ip + (fp.length > 0 || alt ? '.' + fp : '');
            } else {
              let dd = d;
              if (!alt) dd = dd[0] + dd.slice(1).replace(/0+$/, '');
              body = expStr(dd, X, alt, upper);
            }
          }
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
