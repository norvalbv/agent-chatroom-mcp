function decompose(v: number): { mant: bigint; exp2: number } {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, Math.abs(v));
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const be = (hi >>> 20) & 0x7ff;
  const frac = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (be === 0) return { mant: frac, exp2: -1074 };
  return { mant: frac | (1n << 52n), exp2: be - 1075 };
}

// round(|v| * 10^k) to integer, half to even, exactly
function roundScaled(d: { mant: bigint; exp2: number }, k: number): bigint {
  let num = d.mant;
  let den = 1n;
  if (d.exp2 >= 0) num <<= BigInt(d.exp2);
  else den <<= BigInt(-d.exp2);
  if (k >= 0) num *= 10n ** BigInt(k);
  else den *= 10n ** BigInt(-k);
  const q = num / den;
  const r2 = (num % den) * 2n;
  if (r2 > den || (r2 === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

function fixedStr(v: number, prec: number, alt: boolean): string {
  const q = roundScaled(decompose(v), prec).toString().padStart(prec + 1, '0');
  const ip = q.slice(0, q.length - prec);
  const fp = q.slice(q.length - prec);
  return ip + (prec > 0 || alt ? '.' : '') + fp;
}

// digits (p+1 of them) and decimal exponent after rounding
function expParts(v: number, p: number): { digits: string; e10: number } {
  const d = decompose(v);
  if (d.mant === 0n) return { digits: '0'.repeat(p + 1), e10: 0 };
  let e10 = Math.floor(Math.log10(Math.abs(v)));
  if (!isFinite(e10)) e10 = -324;
  const hiB = 10n ** BigInt(p + 1);
  const loB = 10n ** BigInt(p);
  for (let i = 0; i < 100; i++) {
    const dg = roundScaled(d, p - e10);
    if (dg >= hiB) e10++;
    else if (dg < loB) e10--;
    else return { digits: dg.toString(), e10 };
  }
  throw new Error('exp');
}

function expStr(v: number, prec: number, alt: boolean, upper: boolean): string {
  const { digits, e10 } = expParts(v, prec);
  const m = digits[0] + (prec > 0 || alt ? '.' : '') + digits.slice(1);
  const ae = Math.abs(e10);
  return m + (upper ? 'E' : 'e') + (e10 < 0 ? '-' : '+') + (ae < 10 ? '0' : '') + ae;
}

function stripZeros(s: string): string {
  const ei = s.search(/[eE]/);
  let mant = ei >= 0 ? s.slice(0, ei) : s;
  const rest = ei >= 0 ? s.slice(ei) : '';
  if (mant.includes('.')) mant = mant.replace(/0+$/, '').replace(/\.$/, '');
  return mant + rest;
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
    let prec: number | undefined;
    if (fmt[i] === '.') {
      i++;
      prec = 0;
      while (fmt[i] >= '0' && fmt[i] <= '9') prec = prec * 10 + Number(fmt[i++]);
    }
    const conv = fmt[i++];
    const arg = args[ai++];

    let prefix = '';
    let body = '';
    let zeroOk = zero && !minus;

    if (conv === 's' || conv === 'c') {
      body = String(arg);
      if (conv === 's' && prec !== undefined) body = body.slice(0, prec);
      zeroOk = false;
    } else if ('dixXo'.includes(conv)) {
      let n = typeof arg === 'bigint' ? arg : BigInt(arg as number);
      const neg = n < 0n;
      if (neg) n = -n;
      let digits = conv === 'x' ? n.toString(16) : conv === 'X' ? n.toString(16).toUpperCase() : conv === 'o' ? n.toString(8) : n.toString();
      if (prec !== undefined) {
        if (prec === 0 && n === 0n) digits = '';
        digits = digits.padStart(prec, '0');
        zeroOk = false;
      }
      if (conv === 'd' || conv === 'i') {
        prefix = neg ? '-' : plus ? '+' : space ? ' ' : '';
      } else if (alt) {
        if (conv === 'o') {
          if (digits[0] !== '0') digits = '0' + digits;
        } else if (n !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      }
      body = digits;
    } else {
      const v = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      const neg = v < 0 || Object.is(v, -0);
      if (Number.isNaN(v)) {
        body = upper ? 'NAN' : 'nan';
        zeroOk = false;
      } else {
        prefix = neg ? '-' : plus ? '+' : space ? ' ' : '';
        if (!isFinite(v)) {
          body = upper ? 'INF' : 'inf';
          zeroOk = false;
        } else {
          const lc = conv.toLowerCase();
          if (lc === 'f') body = fixedStr(v, prec ?? 6, alt);
          else if (lc === 'e') body = expStr(v, prec ?? 6, alt, upper);
          else {
            const P = prec === undefined ? 6 : prec === 0 ? 1 : prec;
            const X = expParts(v, P - 1).e10;
            if (P > X && X >= -4) body = fixedStr(v, P - 1 - X, alt);
            else body = expStr(v, P - 1, alt, upper);
            if (!alt) body = stripZeros(body);
          }
        }
      }
    }

    const len = prefix.length + body.length;
    if (len < width) {
      const pad = width - len;
      if (minus) body = prefix + body + ' '.repeat(pad);
      else if (zeroOk) body = prefix + '0'.repeat(pad) + body;
      else body = ' '.repeat(pad) + prefix + body;
    } else body = prefix + body;
    out += body;
  }
  return out;
}
