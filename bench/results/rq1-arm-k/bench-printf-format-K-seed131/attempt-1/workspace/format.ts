function decompose(x: number): { m: bigint; e: number } {
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, x);
  const bits = buf.getBigUint64(0);
  const expBits = Number((bits >> 52n) & 0x7ffn);
  const frac = bits & ((1n << 52n) - 1n);
  if (expBits === 0) return { m: frac, e: -1074 };
  return { m: frac | (1n << 52n), e: expBits - 1075 };
}

// round(|x| * 10^k) to an integer, half to even, using the exact binary value
function scaled(m: bigint, e: number, k: number): bigint {
  let num = m;
  let den = 1n;
  if (e >= 0) num <<= BigInt(e);
  else den <<= BigInt(-e);
  if (k >= 0) num *= 10n ** BigInt(k);
  else den *= 10n ** BigInt(-k);
  const q = num / den;
  const r = num % den;
  const twice = r * 2n;
  if (twice > den || (twice === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

function fixedStr(x: number, prec: number, alt: boolean): string {
  const { m, e } = decompose(x);
  let s = scaled(m, e, prec).toString();
  if (s.length < prec + 1) s = '0'.repeat(prec + 1 - s.length) + s;
  const ip = s.slice(0, s.length - prec);
  const fp = s.slice(s.length - prec);
  return ip + (prec > 0 || alt ? '.' : '') + fp;
}

// digits (p+1 digits) and decimal exponent in e style
function expParts(x: number, p: number): { digits: string; exp: number } {
  if (x === 0) return { digits: '0'.repeat(p + 1), exp: 0 };
  const { m, e } = decompose(x);
  let E = Math.floor(Math.log10(x));
  if (!Number.isFinite(E)) E = -324;
  const lo = 10n ** BigInt(p);
  const hi = lo * 10n;
  for (let i = 0; i < 20; i++) {
    const v = scaled(m, e, p - E);
    if (v < lo) E -= 1;
    else if (v >= hi) E += 1;
    else return { digits: v.toString(), exp: E };
  }
  throw new Error('exp');
}

function expStr(digits: string, exp: number, prec: number, alt: boolean, upper: boolean, strip: boolean): string {
  let frac = digits.slice(1);
  if (strip) frac = frac.replace(/0+$/, '');
  const point = frac.length > 0 || alt ? '.' : '';
  const ae = Math.abs(exp);
  return (
    digits[0] + point + frac + (upper ? 'E' : 'e') + (exp < 0 ? '-' : '+') + (ae < 10 ? '0' : '') + ae
  );
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
    const lc = conv.toLowerCase();

    if (conv === 's' || conv === 'c') {
      body = String(arg);
      if (conv === 's' && prec >= 0) body = body.slice(0, prec);
      canZero = false;
    } else if (conv === 'd' || conv === 'i' || conv === 'x' || conv === 'X' || conv === 'o') {
      const v = BigInt(arg as number | bigint);
      const neg = v < 0n;
      const mag = neg ? -v : v;
      if (conv === 'd' || conv === 'i') {
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
      }
      let digits = conv === 'o' ? mag.toString(8) : conv === 'x' ? mag.toString(16) : conv === 'X' ? mag.toString(16).toUpperCase() : mag.toString();
      if (prec === 0 && mag === 0n) digits = '';
      if (prec > digits.length) digits = '0'.repeat(prec - digits.length) + digits;
      if (alt) {
        if (conv === 'o') {
          if (digits[0] !== '0') digits = '0' + digits;
        } else if (conv !== 'd' && conv !== 'i' && mag !== 0n) {
          prefix = conv === 'x' ? '0x' : '0X';
        }
      }
      body = digits;
      if (prec >= 0) canZero = false;
    } else {
      const x = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      const negBit = x < 0 || Object.is(x, -0);
      if (Number.isNaN(x)) {
        body = upper ? 'NAN' : 'nan';
        canZero = false;
      } else {
        sign = negBit ? '-' : plus ? '+' : space ? ' ' : '';
        const ax = Math.abs(x);
        if (ax === Infinity) {
          body = upper ? 'INF' : 'inf';
          canZero = false;
        } else if (lc === 'f') {
          body = fixedStr(ax, prec < 0 ? 6 : prec, alt);
        } else if (lc === 'e') {
          const p = prec < 0 ? 6 : prec;
          const { digits, exp } = expParts(ax, p);
          body = expStr(digits, exp, p, alt, upper, false);
        } else {
          let P = prec < 0 ? 6 : prec;
          if (P === 0) P = 1;
          const { digits, exp } = expParts(ax, P - 1);
          if (P > exp && exp >= -4) {
            body = fixedStr(ax, P - 1 - exp, alt);
            if (!alt && body.includes('.')) body = body.replace(/\.?0+$/, '');
          } else {
            body = expStr(digits, exp, P - 1, alt, upper, !alt);
          }
        }
      }
    }

    let len = sign.length + prefix.length + body.length;
    if (len < width) {
      if (minus) {
        body = body + ' '.repeat(width - len);
      } else if (zero && canZero) {
        body = '0'.repeat(width - len) + body;
      } else {
        sign = ' '.repeat(width - len) + sign;
      }
    }
    out += sign + prefix + body;
  }
  return out;
}
