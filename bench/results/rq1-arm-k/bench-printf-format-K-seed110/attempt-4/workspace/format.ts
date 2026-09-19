function decompose(v: number): { neg: boolean; m: bigint; e2: number } {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, v);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const neg = (hi >>> 31) === 1;
  const ef = (hi >>> 20) & 0x7ff;
  const frac = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (ef === 0) return { neg, m: frac, e2: -1074 };
  return { neg, m: frac | (1n << 52n), e2: ef - 1075 };
}

const P10 = (n: number): bigint => 10n ** BigInt(n);

// round(m * 2^e2 * 10^k) half-even, exact
function scaledRound(m: bigint, e2: number, k: number): bigint {
  let num = m * (e2 > 0 ? 1n << BigInt(e2) : 1n) * (k > 0 ? P10(k) : 1n);
  const den = (e2 < 0 ? 1n << BigInt(-e2) : 1n) * (k < 0 ? P10(-k) : 1n);
  const q = num / den;
  const r = num % den;
  const twice = r * 2n;
  if (twice > den || (twice === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

function fixedDigits(m: bigint, e2: number, prec: number, alt: boolean): string {
  let s = scaledRound(m, e2, prec).toString();
  if (prec > 0) {
    s = s.padStart(prec + 1, '0');
    return s.slice(0, s.length - prec) + '.' + s.slice(s.length - prec);
  }
  return alt ? s + '.' : s;
}

function decExp(m: bigint, e2: number): number {
  const v = Number(m) * Math.pow(2, e2);
  let X = v > 0 && isFinite(v) ? Math.floor(Math.log10(v)) : -320;
  const ge = (x: number): boolean => {
    const num = m * (e2 > 0 ? 1n << BigInt(e2) : 1n) * (x < 0 ? P10(-x) : 1n);
    const den = (e2 < 0 ? 1n << BigInt(-e2) : 1n) * (x > 0 ? P10(x) : 1n);
    return num >= den;
  };
  while (ge(X + 1)) X++;
  while (!ge(X)) X--;
  return X;
}

// returns {digits (prec+1 digits), exp}
function expParts(m: bigint, e2: number, prec: number): { d: string; x: number } {
  if (m === 0n) return { d: '0'.repeat(prec + 1), x: 0 };
  let x = decExp(m, e2);
  let q = scaledRound(m, e2, prec - x);
  if (q >= P10(prec + 1)) {
    x++;
    q = scaledRound(m, e2, prec - x);
  }
  return { d: q.toString(), x };
}

function expStr(d: string, x: number, alt: boolean, upper: boolean): string {
  let s = d[0];
  if (d.length > 1) s += '.' + d.slice(1);
  else if (alt) s += '.';
  const ax = Math.abs(x);
  return s + (upper ? 'E' : 'e') + (x < 0 ? '-' : '+') + (ax < 10 ? '0' + ax : String(ax));
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
    let canZero = true;

    if (conv === 's' || conv === 'c') {
      body = String(arg);
      if (conv === 's' && prec >= 0) body = body.slice(0, prec);
      canZero = false;
    } else if (conv === 'd' || conv === 'i' || conv === 'x' || conv === 'X' || conv === 'o') {
      let n = BigInt(arg as number | bigint);
      if (conv === 'd' || conv === 'i') {
        if (n < 0n) {
          sign = '-';
          n = -n;
        } else sign = plus ? '+' : space ? ' ' : '';
        body = n.toString();
      } else {
        body = n.toString(conv === 'o' ? 8 : 16);
        if (conv === 'X') body = body.toUpperCase();
      }
      if (prec >= 0) {
        if (prec === 0 && n === 0n) body = '';
        body = body.padStart(prec, '0');
        canZero = false;
      }
      if (alt) {
        if (conv === 'o') {
          if (body[0] !== '0') body = '0' + body;
        } else if (conv !== 'd' && conv !== 'i' && n !== 0n) {
          prefix = conv === 'x' ? '0x' : '0X';
        }
      }
    } else {
      const v = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      if (Number.isNaN(v)) {
        body = upper ? 'NAN' : 'nan';
        canZero = false;
      } else {
        const { neg, m, e2 } = decompose(v);
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        if (!Number.isFinite(v)) {
          body = upper ? 'INF' : 'inf';
          canZero = false;
        } else {
          const lc = conv.toLowerCase();
          if (lc === 'f') {
            body = fixedDigits(m, e2, prec < 0 ? 6 : prec, alt);
          } else if (lc === 'e') {
            const p = prec < 0 ? 6 : prec;
            const { d, x } = expParts(m, e2, p);
            body = expStr(d, x, alt, upper);
          } else {
            const P = prec < 0 ? 6 : prec === 0 ? 1 : prec;
            const { d, x } = expParts(m, e2, P - 1);
            if (P > x && x >= -4) {
              body = fixedDigits(m, e2, P - 1 - x, alt);
              if (!alt) body = stripZeros(body);
            } else {
              let mant = d[0] + (d.length > 1 ? '.' + d.slice(1) : alt ? '.' : '');
              if (!alt) mant = stripZeros(mant);
              const ax = Math.abs(x);
              body = mant + (upper ? 'E' : 'e') + (x < 0 ? '-' : '+') + (ax < 10 ? '0' + ax : String(ax));
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
