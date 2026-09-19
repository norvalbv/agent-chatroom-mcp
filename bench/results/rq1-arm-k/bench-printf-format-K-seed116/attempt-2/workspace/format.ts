function decompose(x: number): { m: bigint; e: number } {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const be = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (be === 0) return { m, e: -1074 };
  m |= 1n << 52n;
  return { m, e: be - 1075 };
}

// round(m * 2^e * 10^k), ties to even
function roundScaled(m: bigint, e: number, k: number): bigint {
  let num = m;
  let den = 1n;
  if (e >= 0) num <<= BigInt(e);
  else den <<= BigInt(-e);
  if (k >= 0) num *= 10n ** BigInt(k);
  else den *= 10n ** BigInt(-k);
  let q = num / den;
  const r2 = (num % den) * 2n;
  if (r2 > den || (r2 === den && (q & 1n) === 1n)) q++;
  return q;
}

function fixedDigits(x: number, prec: number, alt: boolean): string {
  const { m, e } = decompose(x);
  let s = roundScaled(m, e, prec).toString();
  if (prec > 0) {
    s = s.padStart(prec + 1, '0');
    return s.slice(0, s.length - prec) + '.' + s.slice(s.length - prec);
  }
  return alt ? s + '.' : s;
}

// x >= 0 finite; returns digit string of nd+1 digits and decimal exponent
function expDigits(x: number, nd: number): { digits: string; exp: number } {
  if (x === 0) return { digits: '0'.repeat(nd + 1), exp: 0 };
  const { m, e } = decompose(x);
  let X = Math.floor(Math.log10(x));
  if (!Number.isFinite(X)) X = -324;
  const lo = 10n ** BigInt(nd);
  for (;;) {
    const q = roundScaled(m, e, nd - X);
    if (q < lo) X--;
    else if (q >= lo * 10n) X++;
    else return { digits: q.toString(), exp: X };
  }
}

function expStr(digits: string, exp: number, alt: boolean, upper: boolean): string {
  let s = digits[0];
  if (digits.length > 1) s += '.' + digits.slice(1);
  else if (alt) s += '.';
  const ae = Math.abs(exp);
  s += (upper ? 'E' : 'e') + (exp < 0 ? '-' : '+') + (ae < 10 ? '0' + ae : String(ae));
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
    let numeric = true;
    let zeroOk = zero && !minus;

    if (conv === 's' || conv === 'c') {
      numeric = false;
      body = String(arg);
      if (conv === 's' && prec >= 0) body = body.slice(0, prec);
    } else if ('dixXo'.includes(conv)) {
      let v = BigInt(arg as number | bigint);
      let neg = v < 0n;
      if (neg) v = -v;
      sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
      let digits = conv === 'd' || conv === 'i' ? v.toString() : conv === 'o' ? v.toString(8) : v.toString(16);
      if (conv === 'X') digits = digits.toUpperCase();
      if (prec >= 0) {
        if (prec === 0 && v === 0n) digits = '';
        digits = digits.padStart(prec, '0');
        zeroOk = false;
      }
      if (alt) {
        if (conv === 'o') {
          if (digits[0] !== '0') digits = '0' + digits;
        } else if ((conv === 'x' || conv === 'X') && v !== 0n) {
          prefix = conv === 'x' ? '0x' : '0X';
        }
      }
      body = digits;
    } else {
      const x = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      const neg = x < 0 || Object.is(x, -0);
      sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
      if (Number.isNaN(x)) {
        sign = '';
        body = upper ? 'NAN' : 'nan';
        zeroOk = false;
      } else if (!Number.isFinite(x)) {
        body = upper ? 'INF' : 'inf';
        zeroOk = false;
      } else {
        const ax = Math.abs(x);
        const lc = conv.toLowerCase();
        if (lc === 'f') {
          body = fixedDigits(ax, prec < 0 ? 6 : prec, alt);
        } else if (lc === 'e') {
          const p = prec < 0 ? 6 : prec;
          const r = expDigits(ax, p);
          body = expStr(r.digits, r.exp, alt, upper);
        } else {
          let P = prec < 0 ? 6 : prec;
          if (P === 0) P = 1;
          const r = expDigits(ax, P - 1);
          const X = r.exp;
          if (P > X && X >= -4) {
            body = fixedDigits(ax, P - 1 - X, alt);
            if (!alt) body = stripZeros(body);
          } else {
            let d = r.digits;
            if (!alt) d = d[0] + (d.length > 1 ? '.' + d.slice(1) : '');
            if (!alt) {
              const mant = stripZeros(d);
              body = mant + (upper ? 'E' : 'e') + (X < 0 ? '-' : '+') + (Math.abs(X) < 10 ? '0' : '') + Math.abs(X);
            } else {
              body = expStr(r.digits, X, true, upper);
            }
          }
        }
      }
    }

    const len = sign.length + prefix.length + body.length;
    if (len < width) {
      const pad = width - len;
      if (minus) body = sign + prefix + body + ' '.repeat(pad);
      else if (numeric && zeroOk) body = sign + prefix + '0'.repeat(pad) + body;
      else body = ' '.repeat(pad) + sign + prefix + body;
    } else {
      body = sign + prefix + body;
    }
    out += body;
  }
  return out;
}
