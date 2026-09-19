// Exact rational |x| = n / d for a finite double.
function exact(x: number): { n: bigint; d: bigint } {
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, Math.abs(x));
  const hi = buf.getUint32(0);
  const lo = buf.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  let mant = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let e: number;
  if (expBits === 0) e = -1074;
  else {
    mant |= 1n << 52n;
    e = expBits - 1075;
  }
  return e >= 0 ? { n: mant << BigInt(e), d: 1n } : { n: mant, d: 1n << BigInt(-e) };
}

const P10 = (k: number): bigint => 10n ** BigInt(k);

// round(n/d) half-even
function divRound(n: bigint, d: bigint): bigint {
  const q = n / d;
  const r = n % d;
  const twice = r * 2n;
  if (twice > d || (twice === d && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// digits of |x| with p fractional digits
function fixedDigits(x: number, p: number): string {
  const { n, d } = exact(x);
  const s = divRound(n * P10(p), d).toString();
  if (p === 0) return s;
  const padded = s.padStart(p + 1, '0');
  return padded.slice(0, padded.length - p) + '.' + padded.slice(padded.length - p);
}

// |x| in e style: digit string of p+1 digits and decimal exponent
function expParts(x: number, p: number): { digits: string; exp: number } {
  if (x === 0) return { digits: '0'.repeat(p + 1), exp: 0 };
  const { n, d } = exact(x);
  let e = Math.floor(Math.log10(Math.abs(x)));
  if (!isFinite(e)) e = 0;
  // fix estimate so that 10^e <= x < 10^(e+1)
  const ge = (k: number): boolean => (k >= 0 ? n >= d * P10(k) : n * P10(-k) >= d);
  while (!ge(e)) e--;
  while (ge(e + 1)) e++;
  const scale = p - e;
  let q = scale >= 0 ? divRound(n * P10(scale), d) : divRound(n, d * P10(-scale));
  if (q >= P10(p + 1)) {
    e++;
    q = scale - 1 >= 0 ? divRound(n * P10(scale - 1), d) : divRound(n, d * P10(-(scale - 1)));
  }
  return { digits: q.toString(), exp: e };
}

function expStr(digits: string, exp: number, upper: boolean, alt: boolean): string {
  const p = digits.length - 1;
  let s = digits[0] + (p > 0 || alt ? '.' : '') + digits.slice(1);
  const a = Math.abs(exp);
  s += (upper ? 'E' : 'e') + (exp < 0 ? '-' : '+') + (a < 10 ? '0' + a : String(a));
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
    const signFor = (neg: boolean): string => (neg ? '-' : plus ? '+' : space ? ' ' : '');

    switch (conv) {
      case 'd':
      case 'i': {
        const v = typeof arg === 'bigint' ? arg : BigInt(arg as number);
        sign = signFor(v < 0n);
        body = (v < 0n ? -v : v).toString();
        if (prec >= 0) {
          if (prec === 0 && v === 0n) body = '';
          body = body.padStart(prec, '0');
          canZero = false;
        }
        break;
      }
      case 'x':
      case 'X':
      case 'o': {
        const v = typeof arg === 'bigint' ? arg : BigInt(arg as number);
        body = v.toString(conv === 'o' ? 8 : 16);
        if (conv === 'X') body = body.toUpperCase();
        if (prec >= 0) {
          if (prec === 0 && v === 0n) body = '';
          body = body.padStart(prec, '0');
          canZero = false;
        }
        if (alt) {
          if (conv === 'o') {
            if (body[0] !== '0') body = '0' + body;
          } else if (v !== 0n) prefix = conv === 'x' ? '0x' : '0X';
        }
        break;
      }
      case 'e': case 'E': case 'f': case 'F': case 'g': case 'G': {
        const x = arg as number;
        const upper = conv === 'E' || conv === 'F' || conv === 'G';
        if (Number.isNaN(x)) {
          body = upper ? 'NAN' : 'nan';
          canZero = false;
          break;
        }
        sign = signFor(x < 0 || Object.is(x, -0));
        if (!isFinite(x)) {
          body = upper ? 'INF' : 'inf';
          canZero = false;
          break;
        }
        const lc = conv.toLowerCase();
        if (lc === 'f') {
          const p = prec < 0 ? 6 : prec;
          body = fixedDigits(x, p);
          if (p === 0 && alt) body += '.';
        } else if (lc === 'e') {
          const p = prec < 0 ? 6 : prec;
          const { digits, exp } = expParts(x, p);
          body = expStr(digits, exp, upper, alt);
        } else {
          let P = prec < 0 ? 6 : prec;
          if (P === 0) P = 1;
          const { digits, exp } = expParts(x, P - 1);
          if (P > exp && exp >= -4) {
            body = fixedDigits(x, P - 1 - exp);
            if (alt && !body.includes('.')) body += '.';
            if (!alt && body.includes('.')) body = body.replace(/0+$/, '').replace(/\.$/, '');
          } else {
            let dg = digits;
            if (!alt) dg = dg[0] + dg.slice(1).replace(/0+$/, '');
            body = expStr(dg, exp, upper, alt);
          }
        }
        break;
      }
      case 's': {
        body = String(arg);
        if (prec >= 0) body = body.slice(0, prec);
        canZero = false;
        break;
      }
      case 'c': {
        body = String(arg);
        canZero = false;
        break;
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
