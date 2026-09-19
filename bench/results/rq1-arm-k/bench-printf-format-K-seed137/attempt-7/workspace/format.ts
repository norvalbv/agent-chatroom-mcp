function decompose(abs: number): [bigint, number] {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, abs);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  let mant = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (expBits === 0) return [mant, -1074];
  mant |= 1n << 52n;
  return [mant, expBits - 1075];
}

// round(abs * 10^k) with ties to even, exact
function scaledRound(abs: number, k: number): bigint {
  const [m, e] = decompose(abs);
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

function fixedStr(abs: number, prec: number, alt: boolean): string {
  const n = scaledRound(abs, prec);
  let s = n.toString();
  if (prec > 0) {
    s = s.padStart(prec + 1, '0');
    return s.slice(0, s.length - prec) + '.' + s.slice(s.length - prec);
  }
  return alt ? s + '.' : s;
}

// returns digits (prec+1 of them) and decimal exponent
function sciParts(abs: number, prec: number): [string, number] {
  if (abs === 0) return ['0'.repeat(prec + 1), 0];
  let x = Math.floor(Math.log10(abs));
  if (!isFinite(x)) x = -324;
  const lo = 10n ** BigInt(prec);
  const hi = lo * 10n;
  for (;;) {
    const n = scaledRound(abs, prec - x);
    if (n >= hi) x++;
    else if (n < lo) x--;
    else return [n.toString(), x];
  }
}

function sciStr(digits: string, x: number, prec: number, alt: boolean, upper: boolean): string {
  let s = digits[0];
  if (prec > 0) s += '.' + digits.slice(1);
  else if (alt) s += '.';
  const ax = Math.abs(x);
  s += (upper ? 'E' : 'e') + (x < 0 ? '-' : '+') + (ax < 10 ? '0' + ax : String(ax));
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
    let prefix = '';
    let body = '';
    let canZero = zero && !minus;

    if (conv === 'd' || conv === 'i' || conv === 'x' || conv === 'X' || conv === 'o') {
      const v = BigInt(arg as number | bigint);
      const neg = v < 0n;
      const mag = neg ? -v : v;
      let digits = conv === 'x' ? mag.toString(16) : conv === 'X' ? mag.toString(16).toUpperCase() : conv === 'o' ? mag.toString(8) : mag.toString();
      if (prec === 0 && mag === 0n) digits = '';
      if (prec > 0) digits = digits.padStart(prec, '0');
      if (conv === 'd' || conv === 'i') {
        prefix = neg ? '-' : plus ? '+' : space ? ' ' : '';
      } else if (alt) {
        if (conv === 'o') {
          if (digits[0] !== '0') digits = '0' + digits;
        } else if (mag !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      }
      body = digits;
      if (prec >= 0) canZero = false;
    } else if (conv === 's' || conv === 'c') {
      let s = String(arg);
      if (conv === 's' && prec >= 0) s = s.slice(0, prec);
      body = s;
      canZero = false;
    } else {
      const v = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      const neg = v < 0 || Object.is(v, -0);
      const isNaNv = Number.isNaN(v);
      if (!isNaNv) prefix = neg ? '-' : plus ? '+' : space ? ' ' : '';
      if (isNaNv || !isFinite(v)) {
        body = isNaNv ? 'nan' : 'inf';
        if (upper) body = body.toUpperCase();
        canZero = false;
      } else {
        const abs = Math.abs(v);
        const lc = conv.toLowerCase();
        if (lc === 'f') {
          body = fixedStr(abs, prec < 0 ? 6 : prec, alt);
        } else if (lc === 'e') {
          const p = prec < 0 ? 6 : prec;
          const [d, x] = sciParts(abs, p);
          body = sciStr(d, x, p, alt, upper);
        } else {
          let p = prec < 0 ? 6 : prec;
          if (p === 0) p = 1;
          const [d, x] = sciParts(abs, p - 1);
          if (p > x && x >= -4) {
            body = fixedStr(abs, p - 1 - x, alt);
            if (!alt) body = stripZeros(body);
          } else {
            let mant = d[0] + (p > 1 ? '.' + d.slice(1) : alt ? '.' : '');
            if (!alt) mant = stripZeros(mant);
            const ax = Math.abs(x);
            body = mant + (upper ? 'E' : 'e') + (x < 0 ? '-' : '+') + (ax < 10 ? '0' + ax : String(ax));
          }
        }
      }
    }

    const len = prefix.length + body.length;
    if (len < width) {
      const pad = width - len;
      if (minus) out += prefix + body + ' '.repeat(pad);
      else if (canZero) out += prefix + '0'.repeat(pad) + body;
      else out += ' '.repeat(pad) + prefix + body;
    } else out += prefix + body;
  }
  return out;
}
