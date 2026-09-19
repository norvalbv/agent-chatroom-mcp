function decompose(abs: number): [bigint, number] {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, abs);
  const bits = dv.getBigUint64(0);
  const ex = Number((bits >> 52n) & 0x7ffn);
  const frac = bits & 0xfffffffffffffn;
  if (ex === 0) return [frac, -1074];
  return [frac | (1n << 52n), ex - 1075];
}

// round(abs * 10^p), ties to even, exact
function scaled(abs: number, p: number): bigint {
  const [m, e] = decompose(abs);
  let num = m;
  let den = 1n;
  if (e >= 0) num <<= BigInt(e);
  else den <<= BigInt(-e);
  if (p >= 0) num *= 10n ** BigInt(p);
  else den *= 10n ** BigInt(-p);
  const q = num / den;
  const r = num % den;
  const twice = r * 2n;
  if (twice > den || (twice === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

function fixedDigits(abs: number, prec: number, alt: boolean): string {
  let s = scaled(abs, prec).toString();
  if (prec > 0) {
    s = s.padStart(prec + 1, '0');
    s = s.slice(0, s.length - prec) + '.' + s.slice(s.length - prec);
  } else if (alt) s += '.';
  return s;
}

// returns [digit string of prec+1 digits, exponent]
function expParts(abs: number, prec: number): [string, number] {
  if (abs === 0) return ['0'.repeat(prec + 1), 0];
  let e10 = Math.floor(Math.log10(abs));
  if (!isFinite(e10)) e10 = -324;
  const lo = 10n ** BigInt(prec);
  const hi = lo * 10n;
  for (;;) {
    const n = scaled(abs, prec - e10);
    if (n >= hi) e10++;
    else if (n < lo) e10--;
    else return [n.toString(), e10];
  }
}

function expStr(digits: string, x: number, alt: boolean, upper: boolean): string {
  const prec = digits.length - 1;
  let s = digits[0];
  if (prec > 0) s += '.' + digits.slice(1);
  else if (alt) s += '.';
  const ax = Math.abs(x);
  s += (upper ? 'E' : 'e') + (x < 0 ? '-' : '+') + (ax < 10 ? '0' : '') + ax;
  return s;
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let out = '';
  let ai = 0;
  let i = 0;
  while (i < fmt.length) {
    const ch = fmt[i++];
    if (ch !== '%') {
      out += ch;
      continue;
    }
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
    let allowZero = true;
    const lower = conv.toLowerCase();

    if (conv === 'd' || conv === 'i' || lower === 'x' || conv === 'o') {
      let v = BigInt(arg as number | bigint);
      if (conv === 'd' || conv === 'i') {
        if (v < 0n) {
          sign = '-';
          v = -v;
        } else sign = plus ? '+' : space ? ' ' : '';
      }
      let digits = conv === 'o' ? v.toString(8) : lower === 'x' ? v.toString(16) : v.toString();
      if (conv === 'X') digits = digits.toUpperCase();
      if (prec === 0 && v === 0n) digits = '';
      if (prec >= 0) {
        digits = digits.padStart(prec, '0');
        allowZero = false;
      }
      if (alt) {
        if (conv === 'o') {
          if (digits[0] !== '0') digits = '0' + digits;
        } else if (lower === 'x' && v !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      }
      body = digits;
    } else if ('eEfFgG'.includes(conv)) {
      const v = arg as number;
      const upper = conv === conv.toUpperCase();
      const neg = v < 0 || Object.is(v, -0);
      if (Number.isNaN(v)) sign = '';
      else sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
      if (!Number.isFinite(v)) {
        body = Number.isNaN(v) ? 'nan' : 'inf';
        if (upper) body = body.toUpperCase();
        allowZero = false;
      } else {
        const abs = Math.abs(v);
        if (lower === 'f') {
          body = fixedDigits(abs, prec < 0 ? 6 : prec, alt);
        } else if (lower === 'e') {
          const [d, x] = expParts(abs, prec < 0 ? 6 : prec);
          body = expStr(d, x, alt, upper);
        } else {
          const P = prec < 0 ? 6 : prec === 0 ? 1 : prec;
          const [d, x] = expParts(abs, P - 1);
          if (P > x && x >= -4) {
            body = fixedDigits(abs, P - 1 - x, alt);
            if (!alt && body.includes('.')) body = body.replace(/0+$/, '').replace(/\.$/, '');
          } else {
            let dd = d;
            if (!alt) dd = d[0] + d.slice(1).replace(/0+$/, '');
            body = expStr(dd, x, alt, upper);
          }
        }
      }
    } else {
      numeric = false;
      body = String(arg);
      if (conv === 's' && prec >= 0) body = body.slice(0, prec);
    }

    const len = sign.length + prefix.length + body.length;
    if (len >= width) out += sign + prefix + body;
    else if (minus) out += sign + prefix + body + ' '.repeat(width - len);
    else if (numeric && zero && allowZero) out += sign + prefix + '0'.repeat(width - len) + body;
    else out += ' '.repeat(width - len) + sign + prefix + body;
  }
  return out;
}
