function decompose(x: number): [bigint, number] {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (expBits === 0) return [m, -1074];
  m |= 1n << 52n;
  return [m, expBits - 1075];
}

// round-half-even of |x| * 10^n (n may be negative)
function roundScaled(x: number, n: number): bigint {
  const [m, e] = decompose(x);
  let num = m;
  let den = 1n;
  if (n >= 0) num *= 10n ** BigInt(n);
  else den *= 10n ** BigInt(-n);
  if (e >= 0) num <<= BigInt(e);
  else den <<= BigInt(-e);
  let q = num / den;
  const r2 = (num % den) * 2n;
  if (r2 > den || (r2 === den && (q & 1n) === 1n)) q += 1n;
  return q;
}

function fixed(x: number, prec: number, alt: boolean): string {
  const q = roundScaled(x, prec);
  let s = q.toString();
  if (prec > 0) {
    s = s.padStart(prec + 1, '0');
    return s.slice(0, s.length - prec) + '.' + s.slice(s.length - prec);
  }
  return alt ? s + '.' : s;
}

// returns digits string (prec+1 digits) and decimal exponent
function expDigits(x: number, prec: number): [string, number] {
  if (x === 0) return ['0'.repeat(prec + 1), 0];
  let e10 = Math.floor(Math.log10(x));
  if (!isFinite(e10)) e10 = -324;
  const lo = 10n ** BigInt(prec);
  const hi = lo * 10n;
  for (let i = 0; i < 20; i++) {
    const q = roundScaled(x, prec - e10);
    if (q >= hi) e10++;
    else if (q < lo) e10--;
    else return [q.toString(), e10];
  }
  throw new Error('exp');
}

function expStr(digits: string, e10: number, upper: boolean, alt: boolean, strip: boolean): string {
  let frac = digits.slice(1);
  if (strip) frac = frac.replace(/0+$/, '');
  let s = digits[0] + (frac.length > 0 || alt ? '.' : '') + frac;
  const a = Math.abs(e10);
  s += (upper ? 'E' : 'e') + (e10 < 0 ? '-' : '+') + (a < 10 ? '0' + a : String(a));
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
    let numeric = true;
    let allowZero = true;
    const signFor = (neg: boolean) => (neg ? '-' : plus ? '+' : space ? ' ' : '');

    switch (conv) {
      case 'd':
      case 'i': {
        const v = BigInt(arg as number | bigint);
        sign = signFor(v < 0n);
        body = (v < 0n ? -v : v).toString();
        if (prec >= 0) {
          if (prec === 0 && v === 0n) body = '';
          body = body.padStart(prec, '0');
          allowZero = false;
        }
        break;
      }
      case 'x':
      case 'X':
      case 'o': {
        const v = BigInt(arg as number | bigint);
        body = v.toString(conv === 'o' ? 8 : 16);
        if (conv === 'X') body = body.toUpperCase();
        if (prec >= 0) {
          if (prec === 0 && v === 0n) body = '';
          body = body.padStart(prec, '0');
          allowZero = false;
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
        const neg = Object.is(x, -0) || (x < 0);
        if (Number.isNaN(x)) {
          body = upper ? 'NAN' : 'nan';
          allowZero = false;
        } else {
          sign = signFor(neg);
          const ax = Math.abs(x);
          if (ax === Infinity) {
            body = upper ? 'INF' : 'inf';
            allowZero = false;
          } else if (conv === 'f' || conv === 'F') {
            body = fixed(ax, prec < 0 ? 6 : prec, alt);
          } else if (conv === 'e' || conv === 'E') {
            const p = prec < 0 ? 6 : prec;
            const [d, e10] = expDigits(ax, p);
            body = expStr(d, e10, upper, alt, false);
          } else {
            let p = prec < 0 ? 6 : prec;
            if (p === 0) p = 1;
            const [d, e10] = expDigits(ax, p - 1);
            if (p > e10 && e10 >= -4) {
              body = fixed(ax, p - 1 - e10, alt);
              if (!alt && body.includes('.')) body = body.replace(/0+$/, '').replace(/\.$/, '');
            } else {
              body = expStr(d, e10, upper, alt, !alt);
            }
          }
        }
        break;
      }
      case 's': {
        numeric = false;
        body = String(arg);
        if (prec >= 0) body = body.slice(0, prec);
        break;
      }
      case 'c': {
        numeric = false;
        body = String(arg);
        break;
      }
    }

    const len = sign.length + prefix.length + body.length;
    if (len >= width) out += sign + prefix + body;
    else if (minus) out += sign + prefix + body + ' '.repeat(width - len);
    else if (numeric && zero && allowZero) out += sign + prefix + '0'.repeat(width - len) + body;
    else out += ' '.repeat(width - len) + sign + prefix + body;
  }
  return out;
}
