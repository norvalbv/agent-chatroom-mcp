function decompose(v: number): { m: bigint; e: number } {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, v);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const bexp = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (bexp === 0) return { m, e: -1074 };
  m |= 1n << 52n;
  return { m, e: bexp - 1075 };
}

// round-half-even of |v| * 10^k, exact
function scaled(v: number, k: number): bigint {
  const { m, e } = decompose(v);
  let num = m;
  let den = 1n;
  if (e >= 0) num <<= BigInt(e);
  else den <<= BigInt(-e);
  if (k >= 0) num *= 10n ** BigInt(k);
  else den *= 10n ** BigInt(-k);
  const q = num / den;
  const r = num % den;
  const c = 2n * r;
  if (c > den || (c === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

function fixed(v: number, p: number): string {
  let s = scaled(v, p).toString();
  if (p === 0) return s;
  if (s.length <= p) s = '0'.repeat(p + 1 - s.length) + s;
  return s.slice(0, s.length - p) + '.' + s.slice(s.length - p);
}

function expDigits(v: number, p: number): { digits: string; exp: number } {
  if (v === 0) return { digits: '0'.repeat(p + 1), exp: 0 };
  let x = Math.floor(Math.log10(v));
  for (;;) {
    const d = scaled(v, p - x);
    const s = d.toString();
    if (s.length > p + 1) x++;
    else if (s.length < p + 1) x--;
    else return { digits: s, exp: x };
  }
}

function expStr(digits: string, exp: number, alt: boolean, upper: boolean): string {
  const p = digits.length - 1;
  let s = digits[0] + (p > 0 || alt ? '.' : '') + digits.slice(1);
  const a = Math.abs(exp);
  s += (upper ? 'E' : 'e') + (exp < 0 ? '-' : '+') + (a < 10 ? '0' : '') + a;
  return s;
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
    let body = '';
    let zeroOk = false;
    const signFor = (neg: boolean) => (neg ? '-' : plus ? '+' : space ? ' ' : '');

    if (conv === 's' || conv === 'c') {
      body = String(arg);
      if (conv === 's' && prec !== undefined) body = body.slice(0, prec);
    } else if (conv === 'd' || conv === 'i') {
      const b = BigInt(arg as number | bigint);
      sign = signFor(b < 0n);
      let d = (b < 0n ? -b : b).toString();
      if (prec !== undefined) {
        if (prec === 0 && b === 0n) d = '';
        d = d.padStart(prec, '0');
      }
      body = d;
      zeroOk = prec === undefined;
    } else if (conv === 'x' || conv === 'X' || conv === 'o') {
      const b = BigInt(arg as number | bigint);
      let d = b.toString(conv === 'o' ? 8 : 16);
      if (conv === 'X') d = d.toUpperCase();
      if (prec !== undefined) {
        if (prec === 0 && b === 0n) d = '';
        d = d.padStart(prec, '0');
      }
      if (alt) {
        if (conv === 'o') {
          if (!d.startsWith('0')) d = '0' + d;
        } else if (b !== 0n) sign = conv === 'x' ? '0x' : '0X';
      }
      body = d;
      zeroOk = prec === undefined;
    } else {
      const v = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      if (Number.isNaN(v)) {
        body = upper ? 'NAN' : 'nan';
      } else {
        const neg = v < 0 || Object.is(v, -0);
        sign = signFor(neg);
        const a = Math.abs(v);
        if (a === Infinity) {
          body = upper ? 'INF' : 'inf';
        } else {
          zeroOk = true;
          const lc = conv.toLowerCase();
          if (lc === 'f') {
            body = fixed(a, prec ?? 6);
            if (alt && prec === 0) body += '.';
          } else if (lc === 'e') {
            const p = prec ?? 6;
            const { digits, exp } = expDigits(a, p);
            body = expStr(digits, exp, alt, upper);
          } else {
            const P = prec === undefined ? 6 : prec === 0 ? 1 : prec;
            const { digits, exp } = expDigits(a, P - 1);
            if (P > exp && exp >= -4) {
              body = fixed(a, P - 1 - exp);
              if (alt && P - 1 - exp === 0) body += '.';
              if (!alt) body = stripZeros(body);
            } else {
              let mant = digits[0] + (P > 1 || alt ? '.' : '') + digits.slice(1);
              if (!alt) mant = stripZeros(mant);
              const ea = Math.abs(exp);
              body = mant + (upper ? 'E' : 'e') + (exp < 0 ? '-' : '+') + (ea < 10 ? '0' : '') + ea;
            }
          }
        }
        if (a === Infinity) zeroOk = false;
      }
      if (Number.isNaN(v)) zeroOk = false;
    }

    let text = sign + body;
    if (text.length < width) {
      if (minus) text = text + ' '.repeat(width - text.length);
      else if (zero && zeroOk && conv !== 's' && conv !== 'c')
        text = sign + '0'.repeat(width - text.length) + body;
      else text = ' '.repeat(width - text.length) + text;
    }
    out += text;
  }
  return out;
}
