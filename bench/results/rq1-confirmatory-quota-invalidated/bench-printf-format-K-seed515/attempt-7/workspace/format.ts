function decompose(x: number): { m: bigint; e: number } {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, Math.abs(x));
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const be = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (be === 0) return { m, e: -1074 };
  m |= 1n << 52n;
  return { m, e: be - 1075 };
}

function roundScaled(m: bigint, e: number, k: number): bigint {
  let num = m;
  let den = 1n;
  if (e >= 0) num <<= BigInt(e);
  else den <<= BigInt(-e);
  if (k >= 0) num *= 10n ** BigInt(k);
  else den *= 10n ** BigInt(-k);
  const q = num / den;
  const r2 = (num % den) * 2n;
  if (r2 > den || (r2 === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

function fixedDigits(x: number, p: number): string {
  const { m, e } = decompose(x);
  return roundScaled(m, e, p).toString();
}

function expDigits(x: number, p: number): { digits: string; X: number } {
  if (x === 0) return { digits: '0'.repeat(p + 1), X: 0 };
  const { m, e } = decompose(x);
  let X = Math.floor(Math.log10(Math.abs(x)));
  if (!isFinite(X)) X = -324;
  const lim = 10n ** BigInt(p);
  for (let i = 0; i < 20; i++) {
    const N = roundScaled(m, e, p - X);
    if (N >= lim * 10n) X++;
    else if (N < lim) X--;
    else return { digits: N.toString(), X };
  }
  throw new Error('unreachable');
}

function fmtF(x: number, p: number, alt: boolean): string {
  let d = fixedDigits(x, p);
  if (p > 0) {
    d = d.padStart(p + 1, '0');
    return d.slice(0, d.length - p) + '.' + d.slice(d.length - p);
  }
  return alt ? d + '.' : d;
}

function expStr(X: number, upper: boolean): string {
  const a = Math.abs(X).toString().padStart(2, '0');
  return (upper ? 'E' : 'e') + (X < 0 ? '-' : '+') + a;
}

function fmtE(x: number, p: number, alt: boolean, upper: boolean): string {
  const { digits, X } = expDigits(x, p);
  let s = digits[0];
  if (p > 0) s += '.' + digits.slice(1);
  else if (alt) s += '.';
  return s + expStr(X, upper);
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
    while (fmt[i] >= '0' && fmt[i] <= '9') width = width * 10 + (fmt.charCodeAt(i++) - 48);
    let prec = -1;
    if (fmt[i] === '.') {
      i++;
      prec = 0;
      while (fmt[i] >= '0' && fmt[i] <= '9') prec = prec * 10 + (fmt.charCodeAt(i++) - 48);
    }
    const conv = fmt[i++];
    const arg = args[ai++];

    let sign = '';
    let prefix = '';
    let body = '';
    let canZero = false;

    const signFor = (neg: boolean) => (neg ? '-' : plus ? '+' : space ? ' ' : '');

    if (conv === 's') {
      body = String(arg);
      if (prec >= 0) body = body.slice(0, prec);
    } else if (conv === 'c') {
      body = String(arg);
    } else if (conv === 'd' || conv === 'i' || conv === 'x' || conv === 'X' || conv === 'o') {
      const v = typeof arg === 'bigint' ? arg : BigInt(arg as number);
      const neg = v < 0n;
      const a = neg ? -v : v;
      const radix = conv === 'o' ? 8 : conv === 'd' || conv === 'i' ? 10 : 16;
      let digits = a.toString(radix);
      if (conv === 'X') digits = digits.toUpperCase();
      if (prec === 0 && a === 0n) digits = '';
      if (prec >= 0) digits = digits.padStart(prec, '0');
      if (conv === 'd' || conv === 'i') sign = signFor(neg);
      else if (alt) {
        if (conv === 'o') {
          if (digits[0] !== '0') digits = '0' + digits;
        } else if (a !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      }
      body = digits;
      canZero = prec < 0;
    } else {
      const x = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      if (Number.isNaN(x)) {
        body = upper ? 'NAN' : 'nan';
      } else {
        const neg = x < 0 || Object.is(x, -0);
        sign = signFor(neg);
        if (!isFinite(x)) {
          body = upper ? 'INF' : 'inf';
        } else {
          canZero = true;
          const lc = conv.toLowerCase();
          if (lc === 'f') body = fmtF(x, prec < 0 ? 6 : prec, alt);
          else if (lc === 'e') body = fmtE(x, prec < 0 ? 6 : prec, alt, upper);
          else {
            let P = prec < 0 ? 6 : prec;
            if (P === 0) P = 1;
            const { X } = expDigits(x, P - 1);
            if (P > X && X >= -4) {
              body = fmtF(x, P - 1 - X, alt);
              if (!alt) body = stripZeros(body);
            } else {
              body = fmtE(x, P - 1, alt, upper);
              if (!alt) {
                const idx = body.search(/[eE]/);
                body = stripZeros(body.slice(0, idx)) + body.slice(idx);
              }
            }
          }
        }
      }
      if (Number.isNaN(x) || !isFinite(x)) canZero = false;
    }

    const len = sign.length + prefix.length + body.length;
    if (len < width) {
      const pad = width - len;
      if (minus) out += sign + prefix + body + ' '.repeat(pad);
      else if (zero && canZero) out += sign + prefix + '0'.repeat(pad) + body;
      else out += ' '.repeat(pad) + sign + prefix + body;
    } else out += sign + prefix + body;
  }
  return out;
}
