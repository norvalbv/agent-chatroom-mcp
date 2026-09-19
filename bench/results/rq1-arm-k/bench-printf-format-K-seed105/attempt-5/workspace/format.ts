function decompose(x: number): [bigint, bigint] {
  // returns [N, D] with x = N / D exactly, x >= 0 finite
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let e: number;
  if (expBits === 0) e = -1074;
  else {
    m |= 1n << 52n;
    e = expBits - 1075;
  }
  return e >= 0 ? [m << BigInt(e), 1n] : [m, 1n << BigInt(-e)];
}

// round(N/D * 10^k), half to even
function roundScaled(N: bigint, D: bigint, k: number): bigint {
  if (k >= 0) N *= 10n ** BigInt(k);
  else D *= 10n ** BigInt(-k);
  const q = N / D;
  const r2 = (N % D) * 2n;
  if (r2 > D || (r2 === D && (q & 1n) === 1n)) return q + 1n;
  return q;
}

function fixedDigits(x: number, prec: number): string {
  const [N, D] = decompose(x);
  let s = roundScaled(N, D, prec).toString();
  if (prec > 0) {
    s = s.padStart(prec + 1, '0');
    return s.slice(0, s.length - prec) + '.' + s.slice(s.length - prec);
  }
  return s;
}

// digits string of length prec+1 and decimal exponent
function expDigits(x: number, prec: number): [string, number] {
  if (x === 0) return ['0'.repeat(prec + 1), 0];
  const [N, D] = decompose(x);
  let E = Math.floor(Math.log10(x));
  if (!isFinite(E)) E = -324;
  const ge = (p: number) => (p >= 0 ? N >= D * 10n ** BigInt(p) : N * 10n ** BigInt(-p) >= D);
  while (!ge(E)) E--;
  while (ge(E + 1)) E++;
  let d = roundScaled(N, D, prec - E);
  if (d >= 10n ** BigInt(prec + 1)) {
    E++;
    d = roundScaled(N, D, prec - E);
  }
  return [d.toString(), E];
}

function expStyle(x: number, prec: number, alt: boolean, upper: boolean, strip: boolean): string {
  const [ds, E] = expDigits(x, prec);
  let frac = ds.slice(1);
  if (strip && !alt) frac = frac.replace(/0+$/, '');
  let mant = ds[0] + (frac.length > 0 || alt ? '.' : '') + frac;
  const ae = Math.abs(E);
  const es = (E < 0 ? '-' : '+') + (ae < 10 ? '0' + ae : String(ae));
  return mant + (upper ? 'E' : 'e') + es;
}

function fixedStyle(x: number, prec: number, alt: boolean, strip: boolean): string {
  let s = fixedDigits(x, prec);
  if (strip && !alt && s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  else if (prec === 0 && alt) s += '.';
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
    let allowZero = zero && !minus;
    const signOf = (neg: boolean) => (neg ? '-' : plus ? '+' : space ? ' ' : '');

    switch (conv) {
      case 'd':
      case 'i': {
        const v = BigInt(arg as number | bigint);
        sign = signOf(v < 0n);
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
        const v = arg as number;
        const upper = conv === 'E' || conv === 'F' || conv === 'G';
        const neg = v < 0 || Object.is(v, -0);
        if (Number.isNaN(v)) {
          body = upper ? 'NAN' : 'nan';
          allowZero = false;
        } else {
          sign = signOf(neg);
          const a = Math.abs(v);
          if (a === Infinity) {
            body = upper ? 'INF' : 'inf';
            allowZero = false;
          } else if (conv === 'e' || conv === 'E') {
            body = expStyle(a, prec < 0 ? 6 : prec, alt, upper, false);
          } else if (conv === 'f' || conv === 'F') {
            body = fixedStyle(a, prec < 0 ? 6 : prec, alt, false);
          } else {
            let P = prec < 0 ? 6 : prec;
            if (P === 0) P = 1;
            const X = expDigits(a, P - 1)[1];
            if (P > X && X >= -4) body = fixedStyle(a, P - 1 - X, alt, true);
            else body = expStyle(a, P - 1, alt, upper, true);
          }
        }
        break;
      }
      case 's':
        numeric = false;
        body = String(arg);
        if (prec >= 0) body = body.slice(0, prec);
        break;
      case 'c':
        numeric = false;
        body = String(arg);
        break;
    }
    const len = sign.length + prefix.length + body.length;
    if (len >= width) out += sign + prefix + body;
    else if (numeric && allowZero) out += sign + prefix + '0'.repeat(width - len) + body;
    else if (minus) out += sign + prefix + body + ' '.repeat(width - len);
    else out += ' '.repeat(width - len) + sign + prefix + body;
  }
  return out;
}
