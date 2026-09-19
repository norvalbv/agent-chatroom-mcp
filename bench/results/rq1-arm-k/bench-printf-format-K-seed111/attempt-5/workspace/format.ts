function decompose(v: number): { m: bigint; e: number } {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, Math.abs(v));
  const bits = dv.getBigUint64(0);
  const exp = Number((bits >> 52n) & 0x7ffn);
  const frac = bits & ((1n << 52n) - 1n);
  if (exp === 0) return { m: frac, e: -1074 };
  return { m: frac | (1n << 52n), e: exp - 1075 };
}

// round(v * 10^k) half-even, exact, v = |finite number|
function scaledRound(v: number, k: number): bigint {
  const { m, e } = decompose(v);
  let num = m;
  let den = 1n;
  if (e >= 0) num <<= BigInt(e);
  else den <<= BigInt(-e);
  if (k >= 0) num *= 10n ** BigInt(k);
  else den *= 10n ** BigInt(-k);
  const q = num / den;
  const r = num - q * den;
  const twice = 2n * r;
  if (twice > den || (twice === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

function fixed(v: number, prec: number, alt: boolean): string {
  const D = scaledRound(v, prec);
  let s = D.toString().padStart(prec + 1, '0');
  if (prec > 0) s = s.slice(0, s.length - prec) + '.' + s.slice(s.length - prec);
  else if (alt) s += '.';
  return s;
}

// P significant digits, returns digit string and decimal exponent
function sig(v: number, P: number): { digits: string; X: number } {
  if (v === 0) return { digits: '0'.repeat(P), X: 0 };
  let X = Math.floor(Math.log10(v));
  if (!Number.isFinite(X)) X = -324;
  const lo = 10n ** BigInt(P - 1);
  const hi = 10n ** BigInt(P);
  for (;;) {
    const D = scaledRound(v, P - 1 - X);
    if (D >= hi) X++;
    else if (D < lo) X--;
    else return { digits: D.toString(), X };
  }
}

function expStyle(digits: string, X: number, upper: boolean, alt: boolean): string {
  let s = digits[0];
  if (digits.length > 1) s += '.' + digits.slice(1);
  else if (alt) s += '.';
  const ax = Math.abs(X);
  return s + (upper ? 'E' : 'e') + (X < 0 ? '-' : '+') + (ax < 10 ? '0' + ax : String(ax));
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
    let canZero = true;
    const signOf = (neg: boolean) => (neg ? '-' : plus ? '+' : space ? ' ' : '');

    switch (conv) {
      case 'd':
      case 'i':
      case 'x':
      case 'X':
      case 'o': {
        const n = BigInt(arg as number | bigint);
        const neg = n < 0n;
        const mag = neg ? -n : n;
        if (conv === 'd' || conv === 'i') sign = signOf(neg);
        let digits = mag.toString(conv === 'o' ? 8 : conv === 'd' || conv === 'i' ? 10 : 16);
        if (conv === 'X') digits = digits.toUpperCase();
        if (prec === 0 && mag === 0n) digits = '';
        if (prec >= 0) {
          digits = digits.padStart(prec, '0');
          canZero = false;
        }
        if (alt) {
          if (conv === 'o') {
            if (digits[0] !== '0') digits = '0' + digits;
          } else if ((conv === 'x' || conv === 'X') && mag !== 0n) {
            prefix = conv === 'x' ? '0x' : '0X';
          }
        }
        body = digits;
        break;
      }
      case 'e':
      case 'E':
      case 'f':
      case 'F':
      case 'g':
      case 'G': {
        const v = arg as number;
        const upper = conv === 'E' || conv === 'F' || conv === 'G';
        if (Number.isNaN(v)) {
          body = upper ? 'NAN' : 'nan';
          canZero = false;
          break;
        }
        const neg = v < 0 || Object.is(v, -0);
        sign = signOf(neg);
        if (!Number.isFinite(v)) {
          body = upper ? 'INF' : 'inf';
          canZero = false;
          break;
        }
        const a = Math.abs(v);
        const lc = conv.toLowerCase();
        if (lc === 'f') {
          body = fixed(a, prec < 0 ? 6 : prec, alt);
        } else if (lc === 'e') {
          const p = prec < 0 ? 6 : prec;
          const { digits, X } = sig(a, p + 1);
          body = expStyle(digits, X, upper, alt);
        } else {
          let P = prec < 0 ? 6 : prec;
          if (P === 0) P = 1;
          const { digits, X } = sig(a, P);
          if (P > X && X >= -4) {
            body = fixed(a, P - 1 - X, alt);
            if (!alt && body.includes('.')) body = body.replace(/0+$/, '').replace(/\.$/, '');
          } else {
            let d = digits;
            if (!alt) d = d[0] + d.slice(1).replace(/0+$/, '');
            body = expStyle(d, X, upper, alt);
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
