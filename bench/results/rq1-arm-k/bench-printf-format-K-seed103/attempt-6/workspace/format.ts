function decompose(x: number): { m: bigint; e: number } {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, Math.abs(x));
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const expField = (hi >>> 20) & 0x7ff;
  const mant = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (expField === 0) return { m: mant, e: -1074 };
  return { m: mant | (1n << 52n), e: expField - 1075 };
}

// round(m * 2^e * 10^k), ties to even
function roundScaled(m: bigint, e: number, k: number): bigint {
  let num = m;
  let den = 1n;
  if (e >= 0) num <<= BigInt(e);
  else den <<= BigInt(-e);
  if (k >= 0) num *= 10n ** BigInt(k);
  else den *= 10n ** BigInt(-k);
  const q = num / den;
  const r = num % den;
  const twice = 2n * r;
  if (twice > den || (twice === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

function fixedStr(x: number, prec: number, alt: boolean): string {
  const { m, e } = decompose(x);
  let s = roundScaled(m, e, prec).toString();
  if (prec > 0) {
    s = s.padStart(prec + 1, '0');
    return s.slice(0, s.length - prec) + '.' + s.slice(s.length - prec);
  }
  return alt ? s + '.' : s;
}

// returns P significant digits and decimal exponent
function sciDigits(x: number, P: number): { digits: string; X: number } {
  if (x === 0) return { digits: '0'.repeat(P), X: 0 };
  const { m, e } = decompose(x);
  let X = Math.floor(Math.log10(Math.abs(x)));
  if (!isFinite(X)) X = Math.floor((e + 52) * Math.LOG10E * Math.LN2);
  const lo = 10n ** BigInt(P - 1);
  const hi = lo * 10n;
  for (let i = 0; i < 2000; i++) {
    const q = roundScaled(m, e, P - 1 - X);
    if (q >= hi) X++;
    else if (q < lo) X--;
    else return { digits: q.toString(), X };
  }
  throw new Error('no convergence');
}

function sciStr(x: number, prec: number, alt: boolean, upper: boolean, strip: boolean): string {
  const { digits, X } = sciDigits(x, prec + 1);
  let mant = digits[0];
  if (prec > 0) mant += '.' + digits.slice(1);
  else if (alt) mant += '.';
  if (strip) mant = stripZeros(mant);
  const ax = Math.abs(X);
  return mant + (upper ? 'E' : 'e') + (X < 0 ? '-' : '+') + (ax < 10 ? '0' + ax : String(ax));
}

function stripZeros(s: string): string {
  if (!s.includes('.')) return s;
  s = s.replace(/0+$/, '');
  if (s.endsWith('.')) s = s.slice(0, -1);
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
    let prec: number | undefined;
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
    let canZero = false;

    if (conv === 'd' || conv === 'i') {
      const v = BigInt(arg as number | bigint);
      const neg = v < 0n;
      let digits = (neg ? -v : v).toString();
      if (prec !== undefined) {
        if (prec === 0 && v === 0n) digits = '';
        digits = digits.padStart(prec, '0');
      }
      sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
      body = digits;
      canZero = prec === undefined;
    } else if (conv === 'x' || conv === 'X' || conv === 'o') {
      const v = BigInt(arg as number | bigint);
      let digits = v.toString(conv === 'o' ? 8 : 16);
      if (conv === 'X') digits = digits.toUpperCase();
      if (prec !== undefined) {
        if (prec === 0 && v === 0n) digits = '';
        digits = digits.padStart(prec, '0');
      }
      if (alt) {
        if (conv === 'o') {
          if (!digits.startsWith('0')) digits = '0' + digits;
        } else if (v !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      }
      body = digits;
      canZero = prec === undefined;
    } else if ('eEfFgG'.includes(conv)) {
      const x = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      if (Number.isNaN(x)) {
        body = upper ? 'NAN' : 'nan';
      } else {
        const neg = x < 0 || Object.is(x, -0);
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        if (!isFinite(x)) {
          body = upper ? 'INF' : 'inf';
        } else {
          canZero = true;
          const lc = conv.toLowerCase();
          if (lc === 'f') body = fixedStr(x, prec ?? 6, alt);
          else if (lc === 'e') body = sciStr(x, prec ?? 6, alt, upper, false);
          else {
            const P = prec === undefined ? 6 : Math.max(prec, 1);
            const { X } = sciDigits(x, P);
            if (P > X && X >= -4) {
              body = fixedStr(x, P - 1 - X, alt);
              if (!alt) body = stripZeros(body);
            } else {
              body = sciStr(x, P - 1, alt, upper, !alt);
            }
          }
        }
      }
    } else if (conv === 's') {
      body = String(arg);
      if (prec !== undefined) body = body.slice(0, prec);
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
