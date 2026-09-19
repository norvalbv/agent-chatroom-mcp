function decompose(v: number): [bigint, number] {
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, v);
  const hi = buf.getUint32(0);
  const lo = buf.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (expBits === 0) return [m, -1074];
  m |= 1n << 52n;
  return [m, expBits - 1075];
}

// round(m * 2^e * 10^k) to nearest, ties to even
function roundScaled(m: bigint, e: number, k: number, floorOnly = false): bigint {
  let num = m;
  let den = 1n;
  if (e >= 0) num <<= BigInt(e);
  else den <<= BigInt(-e);
  if (k >= 0) num *= 10n ** BigInt(k);
  else den *= 10n ** BigInt(-k);
  const q = num / den;
  if (floorOnly) return q;
  const r2 = (num % den) * 2n;
  if (r2 > den || (r2 === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

function fixedDigits(a: number, prec: number, alt: boolean): string {
  const [m, e] = decompose(a);
  let s = roundScaled(m, e, prec).toString();
  if (s.length < prec + 1) s = '0'.repeat(prec + 1 - s.length) + s;
  const ip = s.slice(0, s.length - prec);
  const fp = s.slice(s.length - prec);
  return ip + (prec > 0 || alt ? '.' : '') + fp;
}

// returns digits (prec+1 chars) and decimal exponent
function expDigits(a: number, prec: number): [string, number] {
  if (a === 0) return ['0'.repeat(prec + 1), 0];
  const [m, e] = decompose(a);
  let X = Math.floor(Math.log10(a));
  if (!Number.isFinite(X)) X = -324;
  for (;;) {
    const f = roundScaled(m, e, -X, true);
    if (f >= 10n) X++;
    else if (f < 1n) X--;
    else break;
  }
  let N = roundScaled(m, e, prec - X);
  if (N >= 10n ** BigInt(prec + 1)) {
    X++;
    N = roundScaled(m, e, prec - X);
  }
  return [N.toString(), X];
}

function expStr(a: number, prec: number, alt: boolean, upper: boolean): string {
  const [d, X] = expDigits(a, prec);
  const ax = Math.abs(X);
  return (
    d[0] + (prec > 0 || alt ? '.' : '') + d.slice(1) + (upper ? 'E' : 'e') +
    (X < 0 ? '-' : '+') + (ax < 10 ? '0' : '') + ax
  );
}

function stripZeros(s: string): string {
  // s may contain exponent part
  const idx = s.search(/[eE]/);
  let mant = idx >= 0 ? s.slice(0, idx) : s;
  const tail = idx >= 0 ? s.slice(idx) : '';
  if (mant.includes('.')) mant = mant.replace(/0+$/, '').replace(/\.$/, '');
  return mant + tail;
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
    let allowZero = true;
    const signOf = (neg: boolean) => (neg ? '-' : plus ? '+' : space ? ' ' : '');

    if (conv === 'd' || conv === 'i' || conv === 'x' || conv === 'X' || conv === 'o') {
      const v = BigInt(arg as number | bigint);
      const neg = v < 0n;
      const mag = neg ? -v : v;
      if (conv === 'd' || conv === 'i') {
        sign = signOf(neg);
        body = mag.toString(10);
      } else {
        body = mag.toString(conv === 'o' ? 8 : 16);
        if (conv === 'X') body = body.toUpperCase();
      }
      if (prec === 0 && mag === 0n) body = '';
      if (prec >= 0) {
        if (body.length < prec) body = '0'.repeat(prec - body.length) + body;
        allowZero = false;
      }
      if (alt) {
        if (conv === 'o') {
          if (body[0] !== '0') body = '0' + body;
        } else if ((conv === 'x' || conv === 'X') && mag !== 0n) {
          prefix = conv === 'x' ? '0x' : '0X';
        }
      }
    } else if ('eEfFgG'.includes(conv)) {
      const v = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      if (Number.isNaN(v)) {
        body = upper ? 'NAN' : 'nan';
        allowZero = false;
      } else {
        const neg = v < 0 || Object.is(v, -0);
        sign = signOf(neg);
        const a = Math.abs(v);
        if (a === Infinity) {
          body = upper ? 'INF' : 'inf';
          allowZero = false;
        } else {
          const lc = conv.toLowerCase();
          if (lc === 'f') {
            body = fixedDigits(a, prec < 0 ? 6 : prec, alt);
          } else if (lc === 'e') {
            body = expStr(a, prec < 0 ? 6 : prec, alt, upper);
          } else {
            let P = prec < 0 ? 6 : prec;
            if (P === 0) P = 1;
            const X = expDigits(a, P - 1)[1];
            if (P > X && X >= -4) body = fixedDigits(a, P - 1 - X, alt);
            else body = expStr(a, P - 1, alt, upper);
            if (!alt) body = stripZeros(body);
          }
        }
      }
    } else if (conv === 's' || conv === 'c') {
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
