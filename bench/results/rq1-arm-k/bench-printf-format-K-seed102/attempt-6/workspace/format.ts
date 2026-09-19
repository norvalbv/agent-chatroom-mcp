function roundDiv(n: bigint, d: bigint): bigint {
  const q = n / d;
  const r = n - q * d;
  const twice = r * 2n;
  if (twice > d || (twice === d && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// exact rational of a finite non-negative double
function toRational(x: number): [bigint, bigint] {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  let mant = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let e: number;
  if (expBits === 0) {
    e = -1074;
  } else {
    mant |= 1n << 52n;
    e = expBits - 1075;
  }
  return e >= 0 ? [mant << BigInt(e), 1n] : [mant, 1n << BigInt(-e)];
}

// round(x * 10^k) half-even
function scaled(r: [bigint, bigint], k: number): bigint {
  return k >= 0 ? roundDiv(r[0] * 10n ** BigInt(k), r[1]) : roundDiv(r[0], r[1] * 10n ** BigInt(-k));
}

function fixedDigits(x: number, p: number): { int: string; frac: string } {
  let s = scaled(toRational(x), p).toString();
  if (p === 0) return { int: s, frac: '' };
  if (s.length < p + 1) s = '0'.repeat(p + 1 - s.length) + s;
  return { int: s.slice(0, s.length - p), frac: s.slice(s.length - p) };
}

// x > 0 or 0; returns digit string of length p+1 and decimal exponent
function expDigits(x: number, p: number): { digits: string; exp: number } {
  if (x === 0) return { digits: '0'.repeat(p + 1), exp: 0 };
  const r = toRational(x);
  let e10 = Math.floor(Math.log10(x));
  if (!isFinite(e10)) e10 = 0;
  // adjust so 10^e10 <= x < 10^(e10+1)
  const ge = (k: number) => (k >= 0 ? r[0] >= 10n ** BigInt(k) * r[1] : r[0] * 10n ** BigInt(-k) >= r[1]);
  while (!ge(e10)) e10--;
  while (ge(e10 + 1)) e10++;
  let d = scaled(r, p - e10);
  if (d >= 10n ** BigInt(p + 1)) {
    e10++;
    d = d / 10n;
  }
  return { digits: d.toString(), exp: e10 };
}

function fmtExp(exp: number, upper: boolean): string {
  const a = Math.abs(exp);
  return (upper ? 'E' : 'e') + (exp < 0 ? '-' : '+') + (a < 10 ? '0' : '') + a;
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
    let canZero = false;

    if (conv === 's') {
      body = String(arg);
      if (prec !== undefined) body = body.slice(0, prec);
    } else if (conv === 'c') {
      body = String(arg);
    } else if (conv === 'd' || conv === 'i' || conv === 'x' || conv === 'X' || conv === 'o') {
      const v = BigInt(arg as number | bigint);
      const neg = v < 0n;
      const mag = neg ? -v : v;
      const radix = conv === 'o' ? 8 : conv === 'd' || conv === 'i' ? 10 : 16;
      let digits = mag.toString(radix);
      if (conv === 'X') digits = digits.toUpperCase();
      if (prec !== undefined) {
        if (prec === 0 && mag === 0n) digits = '';
        if (digits.length < prec) digits = '0'.repeat(prec - digits.length) + digits;
      }
      if (conv === 'd' || conv === 'i') {
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
      } else if (alt) {
        if (conv === 'o') {
          if (digits[0] !== '0') digits = '0' + digits;
        } else if (mag !== 0n) {
          prefix = conv === 'x' ? '0x' : '0X';
        }
      }
      body = digits;
      canZero = prec === undefined;
    } else {
      const x = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      const neg = x < 0 || Object.is(x, -0);
      if (Number.isNaN(x)) {
        body = upper ? 'NAN' : 'nan';
      } else {
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        if (!isFinite(x)) {
          body = upper ? 'INF' : 'inf';
        } else {
          canZero = true;
          const ax = Math.abs(x);
          const lc = conv.toLowerCase();
          const asExp = (p: number, strip: boolean) => {
            const { digits, exp } = expDigits(ax, p);
            let frac = digits.slice(1);
            if (strip) frac = frac.replace(/0+$/, '');
            return digits[0] + (frac || alt ? '.' : '') + frac + fmtExp(exp, upper);
          };
          const asFixed = (p: number, strip: boolean) => {
            const { int, frac: f0 } = fixedDigits(ax, p);
            const frac = strip ? f0.replace(/0+$/, '') : f0;
            return int + (frac || alt ? '.' : '') + frac;
          };
          if (lc === 'e') {
            body = asExp(prec ?? 6, false);
          } else if (lc === 'f') {
            body = asFixed(prec ?? 6, false);
          } else {
            const P = prec === undefined ? 6 : Math.max(prec, 1);
            const X = expDigits(ax, P - 1).exp;
            if (P > X && X >= -4) body = asFixed(P - 1 - X, !alt);
            else body = asExp(P - 1, !alt);
          }
        }
        if (!isFinite(x)) canZero = false;
      }
    }

    const len = sign.length + prefix.length + body.length;
    if (len < width) {
      const pad = width - len;
      if (minus) body = sign + prefix + body + ' '.repeat(pad);
      else if (zero && canZero) body = sign + prefix + '0'.repeat(pad) + body;
      else body = ' '.repeat(pad) + sign + prefix + body;
    } else {
      body = sign + prefix + body;
    }
    out += body;
  }
  return out;
}
