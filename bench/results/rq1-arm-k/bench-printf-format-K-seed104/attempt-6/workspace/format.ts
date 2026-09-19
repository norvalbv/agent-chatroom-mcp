function roundDiv(a: bigint, b: bigint): bigint {
  const q = a / b;
  const r = a - q * b;
  const t = r * 2n;
  if (t > b || (t === b && (q & 1n) === 1n)) return q + 1n;
  return q;
}

function pow10(n: number): bigint {
  return 10n ** BigInt(n);
}

// exact rational of a finite non-negative double
function rational(v: number): [bigint, bigint] {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, v);
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

function fixedDigits(v: number, p: number): string {
  const [n, d] = rational(v);
  let s = roundDiv(n * pow10(p), d).toString();
  if (s.length < p + 1) s = '0'.repeat(p + 1 - s.length) + s;
  return p === 0 ? s : s.slice(0, s.length - p) + '.' + s.slice(s.length - p);
}

// returns digits (p+1 of them) and decimal exponent
function expDigits(v: number, p: number): [string, number] {
  if (v === 0) return ['0'.repeat(p + 1), 0];
  const [n, d] = rational(v);
  const ge = (e: number) => (e >= 0 ? n >= pow10(e) * d : n * pow10(-e) >= d);
  let e = Math.floor(Math.log10(v));
  if (!isFinite(e)) e = -324;
  while (!ge(e)) e--;
  while (ge(e + 1)) e++;
  const k = p - e;
  let s = k >= 0 ? roundDiv(n * pow10(k), d) : roundDiv(n, d * pow10(-k));
  if (s === pow10(p + 1)) {
    e++;
    s = pow10(p);
  }
  return [s.toString(), e];
}

function expStr(digits: string, e: number, alt: boolean, upper: boolean): string {
  let m = digits[0];
  if (digits.length > 1) m += '.' + digits.slice(1);
  else if (alt) m += '.';
  const ae = Math.abs(e);
  return m + (upper ? 'E' : 'e') + (e < 0 ? '-' : '+') + (ae < 10 ? '0' : '') + ae;
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

    if (conv === 's' || conv === 'c') {
      body = String(arg);
      if (conv === 's' && prec >= 0) body = body.slice(0, prec);
      canZero = false;
    } else if (conv === 'd' || conv === 'i' || conv === 'x' || conv === 'X' || conv === 'o') {
      let v = BigInt(arg as number | bigint);
      if (conv === 'd' || conv === 'i') {
        if (v < 0n) {
          sign = '-';
          v = -v;
        } else sign = plus ? '+' : space ? ' ' : '';
      }
      const radix = conv === 'o' ? 8 : conv === 'd' || conv === 'i' ? 10 : 16;
      let digits = v.toString(radix);
      if (conv === 'X') digits = digits.toUpperCase();
      if (prec === 0 && v === 0n) digits = '';
      if (prec > digits.length) digits = '0'.repeat(prec - digits.length) + digits;
      if (alt) {
        if (conv === 'o') {
          if (digits[0] !== '0') digits = '0' + digits;
        } else if ((conv === 'x' || conv === 'X') && v !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      }
      body = digits;
      if (prec >= 0) canZero = false;
    } else {
      const x = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      const neg = x < 0 || Object.is(x, -0);
      if (Number.isNaN(x)) sign = '';
      else sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
      if (Number.isNaN(x) || !isFinite(x)) {
        body = Number.isNaN(x) ? 'nan' : 'inf';
        if (upper) body = body.toUpperCase();
        canZero = false;
      } else {
        const v = Math.abs(x);
        const lc = conv.toLowerCase();
        if (lc === 'f') {
          const p = prec < 0 ? 6 : prec;
          body = fixedDigits(v, p);
          if (p === 0 && alt) body += '.';
        } else if (lc === 'e') {
          const p = prec < 0 ? 6 : prec;
          const [dg, e] = expDigits(v, p);
          body = expStr(dg, e, alt, upper);
        } else {
          let P = prec < 0 ? 6 : prec;
          if (P === 0) P = 1;
          const [dg, X] = expDigits(v, P - 1);
          if (P > X && X >= -4) {
            const p = P - 1 - X;
            body = fixedDigits(v, p);
            if (p === 0 && alt) body += '.';
            if (!alt) body = stripZeros(body);
          } else {
            let m = dg[0];
            if (dg.length > 1) m += '.' + dg.slice(1);
            else if (alt) m += '.';
            if (!alt) m = stripZeros(m);
            const ae = Math.abs(X);
            body = m + (upper ? 'E' : 'e') + (X < 0 ? '-' : '+') + (ae < 10 ? '0' : '') + ae;
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
