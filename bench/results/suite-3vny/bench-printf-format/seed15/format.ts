function roundDiv(n: bigint, d: bigint): bigint {
  const q = n / d;
  const r2 = (n % d) * 2n;
  if (r2 > d || (r2 === d && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// |v| = num / den exactly
function ratio(v: number): [bigint, bigint] {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, Math.abs(v));
  const bits = dv.getBigUint64(0);
  const ex = Number((bits >> 52n) & 0x7ffn);
  const frac = bits & ((1n << 52n) - 1n);
  let m: bigint, e: number;
  if (ex === 0) { m = frac; e = -1074; } else { m = frac | (1n << 52n); e = ex - 1075; }
  return e >= 0 ? [m << BigInt(e), 1n] : [m, 1n << BigInt(-e)];
}

const pow10 = (n: number): bigint => 10n ** BigInt(n);

function fixedDigits(v: number, p: number): { int: string; frac: string } {
  const [num, den] = ratio(v);
  let s = roundDiv(num * pow10(p), den).toString();
  if (s.length < p + 1) s = '0'.repeat(p + 1 - s.length) + s;
  return { int: s.slice(0, s.length - p), frac: s.slice(s.length - p) };
}

function expDigits(v: number, p: number): { digits: string; exp: number } {
  if (v === 0) return { digits: '0'.repeat(p + 1), exp: 0 };
  const [num, den] = ratio(v);
  // find e with 10^e <= v < 10^(e+1)
  let e = Math.floor(Math.log10(Math.abs(v)));
  if (!isFinite(e)) e = -324;
  const ge = (k: number) => (k >= 0 ? num >= den * pow10(k) : num * pow10(-k) >= den);
  while (!ge(e)) e--;
  while (ge(e + 1)) e++;
  const sh = p - e;
  let n = sh >= 0 ? roundDiv(num * pow10(sh), den) : roundDiv(num, den * pow10(-sh));
  if (n === pow10(p + 1)) { e++; n = pow10(p); }
  return { digits: n.toString(), exp: e };
}

function expStr(digits: string, exp: number, alt: boolean, upper: boolean): string {
  let s = digits[0];
  if (digits.length > 1) s += '.' + digits.slice(1);
  else if (alt) s += '.';
  const ae = Math.abs(exp);
  s += (upper ? 'E' : 'e') + (exp < 0 ? '-' : '+') + (ae < 10 ? '0' + ae : String(ae));
  return s;
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let out = '';
  let ai = 0;
  let i = 0;
  while (i < fmt.length) {
    const ch = fmt[i];
    if (ch !== '%') { out += ch; i++; continue; }
    i++;
    if (fmt[i] === '%') { out += '%'; i++; continue; }
    let left = false, plus = false, space = false, zero = false, alt = false;
    for (; i < fmt.length; i++) {
      const f = fmt[i];
      if (f === '-') left = true;
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
    const signFor = (neg: boolean) => (neg ? '-' : plus ? '+' : space ? ' ' : '');

    switch (conv) {
      case 'd': case 'i': case 'x': case 'X': case 'o': {
        const b = typeof arg === 'bigint' ? arg : BigInt(arg as number);
        const neg = b < 0n;
        const mag = neg ? -b : b;
        if (conv === 'd' || conv === 'i') { sign = signFor(neg); body = mag.toString(); }
        else if (conv === 'o') body = mag.toString(8);
        else {
          body = mag.toString(16);
          if (conv === 'X') body = body.toUpperCase();
        }
        if (prec === 0 && mag === 0n) body = '';
        if (prec > body.length) body = '0'.repeat(prec - body.length) + body;
        if (conv === 'o' && alt && body[0] !== '0') body = '0' + body;
        if ((conv === 'x' || conv === 'X') && alt && mag !== 0n) prefix = conv === 'x' ? '0x' : '0X';
        if (prec >= 0) canZero = false;
        break;
      }
      case 'e': case 'E': case 'f': case 'F': case 'g': case 'G': {
        const v = arg as number;
        const upper = conv === 'E' || conv === 'F' || conv === 'G';
        if (Number.isNaN(v)) {
          body = upper ? 'NAN' : 'nan';
          canZero = false;
          break;
        }
        sign = signFor(v < 0 || Object.is(v, -0));
        if (!isFinite(v)) {
          body = upper ? 'INF' : 'inf';
          canZero = false;
          break;
        }
        const lc = conv.toLowerCase();
        if (lc === 'f') {
          const p = prec < 0 ? 6 : prec;
          const { int, frac } = fixedDigits(v, p);
          body = int + (p > 0 ? '.' + frac : alt ? '.' : '');
        } else if (lc === 'e') {
          const p = prec < 0 ? 6 : prec;
          const { digits, exp } = expDigits(v, p);
          body = expStr(digits, exp, alt, upper);
        } else {
          let P = prec < 0 ? 6 : prec;
          if (P === 0) P = 1;
          const { digits, exp: X } = expDigits(v, P - 1);
          if (P > X && X >= -4) {
            const p = P - 1 - X;
            const { int, frac } = fixedDigits(v, p);
            let fr = frac;
            if (!alt) fr = fr.replace(/0+$/, '');
            body = int + (fr.length > 0 ? '.' + fr : alt ? '.' : '');
          } else {
            let d = digits;
            if (!alt) d = d[0] + d.slice(1).replace(/0+$/, '');
            body = expStr(d, X, alt, upper);
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
    else if (left) out += sign + prefix + body + ' '.repeat(width - len);
    else if (zero && canZero) out += sign + prefix + '0'.repeat(width - len) + body;
    else out += ' '.repeat(width - len) + sign + prefix + body;
  }
  return out;
}
