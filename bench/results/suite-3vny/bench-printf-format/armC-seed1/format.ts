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

// round-half-even of |x| * 10^k, exact
function scaled(x: number, k: number): bigint {
  const [m, e] = decompose(x);
  let num = m;
  let den = 1n;
  if (e >= 0) num <<= BigInt(e);
  else den <<= BigInt(-e);
  if (k >= 0) num *= 10n ** BigInt(k);
  else den *= 10n ** BigInt(-k);
  let q = num / den;
  const r2 = (num % den) * 2n;
  if (r2 > den || (r2 === den && (q & 1n) === 1n)) q += 1n;
  return q;
}

function fixedDigits(x: number, prec: number): string {
  let s = scaled(x, prec).toString();
  if (prec > 0) {
    s = s.padStart(prec + 1, '0');
    return s.slice(0, s.length - prec) + '.' + s.slice(s.length - prec);
  }
  return s;
}

// returns digit string (p+1 digits) and decimal exponent
function expDigits(x: number, p: number): [string, number] {
  if (x === 0) return ['0'.repeat(p + 1), 0];
  let E = Math.floor(Math.log10(x));
  if (!isFinite(E)) E = -324;
  const lo = 10n ** BigInt(p);
  for (let i = 0; i < 20; i++) {
    const N = scaled(x, p - E);
    if (N >= lo * 10n) E++;
    else if (N < lo) E--;
    else return [N.toString(), E];
  }
  throw new Error('exp');
}

function expStr(digits: string, E: number, alt: boolean, upper: boolean): string {
  let s = digits[0];
  if (digits.length > 1) s += '.' + digits.slice(1);
  else if (alt) s += '.';
  const ae = Math.abs(E);
  return s + (upper ? 'E' : 'e') + (E < 0 ? '-' : '+') + (ae < 10 ? '0' : '') + ae;
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
    let numeric = true;
    let canZero = true;
    const lower = conv.toLowerCase();

    if (conv === 's' || conv === 'c') {
      numeric = false;
      body = String(arg);
      if (conv === 's' && prec >= 0) body = body.slice(0, prec);
    } else if (conv === 'd' || conv === 'i') {
      const v = BigInt(arg as number | bigint);
      const neg = v < 0n;
      body = (neg ? -v : v).toString();
      if (prec >= 0) {
        if (prec === 0 && v === 0n) body = '';
        body = body.padStart(prec, '0');
        canZero = false;
      }
      sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
    } else if (conv === 'x' || conv === 'X' || conv === 'o') {
      const v = BigInt(arg as number | bigint);
      body = v.toString(conv === 'o' ? 8 : 16);
      if (conv === 'X') body = body.toUpperCase();
      if (prec >= 0) {
        if (prec === 0 && v === 0n) body = '';
        body = body.padStart(prec, '0');
        canZero = false;
      }
      if (alt) {
        if (conv === 'o') {
          if (body[0] !== '0') body = '0' + body;
        } else if (v !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      }
    } else {
      const x = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      const neg = x < 0 || Object.is(x, -0);
      sign = Number.isNaN(x) ? '' : neg ? '-' : plus ? '+' : space ? ' ' : '';
      if (!isFinite(x)) {
        body = Number.isNaN(x) ? 'nan' : 'inf';
        if (upper) body = body.toUpperCase();
        canZero = false;
      } else {
        const ax = Math.abs(x);
        if (lower === 'f') {
          const p = prec < 0 ? 6 : prec;
          body = fixedDigits(ax, p);
          if (p === 0 && alt) body += '.';
        } else if (lower === 'e') {
          const p = prec < 0 ? 6 : prec;
          const [d, E] = expDigits(ax, p);
          body = expStr(d, E, alt, upper);
        } else {
          const P = prec < 0 ? 6 : prec === 0 ? 1 : prec;
          const [d, E] = expDigits(ax, P - 1);
          if (P > E && E >= -4) {
            body = fixedDigits(ax, P - 1 - E);
            if (!alt) {
              if (body.includes('.')) body = body.replace(/0+$/, '').replace(/\.$/, '');
            } else if (!body.includes('.')) body += '.';
          } else {
            let dd = d;
            if (!alt) dd = dd[0] + dd.slice(1).replace(/0+$/, '');
            body = expStr(dd, E, alt, upper);
          }
        }
      }
    }

    let len = sign.length + prefix.length + body.length;
    if (len < width) {
      const n = width - len;
      if (minus) body = body + ' '.repeat(n);
      else if (numeric && zero && canZero) body = '0'.repeat(n) + body;
      else sign = ' '.repeat(n) + sign;
    }
    out += sign + prefix + body;
  }
  return out;
}
