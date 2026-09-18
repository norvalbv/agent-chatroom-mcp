function decompose(x: number): [bigint, bigint] {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, Math.abs(x));
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const ef = (hi >>> 20) & 0x7ff;
  const frac = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let m: bigint;
  let e: number;
  if (ef === 0) {
    m = frac;
    e = -1074;
  } else {
    m = frac | (1n << 52n);
    e = ef - 1075;
  }
  return e >= 0 ? [m << BigInt(e), 1n] : [m, 1n << BigInt(-e)];
}

function roundDiv(n: bigint, d: bigint): bigint {
  const q = n / d;
  const r = n % d;
  const t = 2n * r;
  if (t > d || (t === d && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// digits of |x| with prec fractional digits: [intPart, fracPart]
function fixedParts(x: number, prec: number): [string, string] {
  const [n, d] = decompose(x);
  const q = roundDiv(n * 10n ** BigInt(prec), d);
  let s = q.toString();
  if (s.length < prec + 1) s = '0'.repeat(prec + 1 - s.length) + s;
  return [s.slice(0, s.length - prec), s.slice(s.length - prec)];
}

// mantissa digits (prec+1 digits) and decimal exponent
function expParts(x: number, prec: number): [string, number] {
  if (x === 0) return ['0'.repeat(prec + 1), 0];
  const [n, d] = decompose(x);
  let e = Math.floor(Math.log10(Math.abs(x)));
  if (!isFinite(e)) e = 0;
  const ge = (ex: number) => (ex >= 0 ? n >= 10n ** BigInt(ex) * d : n * 10n ** BigInt(-ex) >= d);
  while (!ge(e)) e--;
  while (ge(e + 1)) e++;
  const scaleN = (ex: number): bigint => {
    const p = prec - ex;
    return p >= 0 ? roundDiv(n * 10n ** BigInt(p), d) : roundDiv(n, d * 10n ** BigInt(-p));
  };
  let q = scaleN(e);
  if (q >= 10n ** BigInt(prec + 1)) {
    e++;
    q = scaleN(e);
  }
  return [q.toString(), e];
}

function expStr(digits: string, e: number, alt: boolean, upper: boolean): string {
  let s = digits[0];
  if (digits.length > 1 || alt) s += '.' + digits.slice(1);
  const ae = Math.abs(e);
  return s + (upper ? 'E' : 'e') + (e < 0 ? '-' : '+') + (ae < 10 ? '0' : '') + ae;
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
    if (fmt[i] === '*') {
      width = Number(args[ai++]);
      i++;
      if (width < 0) {
        minus = true;
        width = -width;
      }
    } else {
      while (fmt[i] >= '0' && fmt[i] <= '9') width = width * 10 + (fmt.charCodeAt(i++) - 48);
    }
    let prec = -1;
    if (fmt[i] === '.') {
      i++;
      prec = 0;
      if (fmt[i] === '*') {
        prec = Number(args[ai++]);
        i++;
      } else {
        while (fmt[i] >= '0' && fmt[i] <= '9') prec = prec * 10 + (fmt.charCodeAt(i++) - 48);
      }
      if (prec < 0) prec = -1;
    }
    let bits = 32;
    if (fmt[i] === 'h') {
      i++;
      if (fmt[i] === 'h') {
        i++;
        bits = 8;
      } else bits = 16;
    } else if (fmt[i] === 'l') {
      i++;
      if (fmt[i] === 'l') i++;
      bits = 64;
    }
    const conv = fmt[i++];
    const arg = args[ai++];

    let sign = '';
    let prefix = '';
    let body = '';
    let zeroOk = zero && !minus;

    const signFor = (neg: boolean) => (neg ? '-' : plus ? '+' : space ? ' ' : '');

    switch (conv) {
      case 'd': case 'i': case 'u': case 'x': case 'X': case 'o': {
        const big = BigInt(arg as number | bigint);
        const v = conv === 'd' || conv === 'i' ? BigInt.asIntN(bits, big) : BigInt.asUintN(bits, big);
        const neg = v < 0n;
        const mag = neg ? -v : v;
        let digits = conv === 'x' ? mag.toString(16) : conv === 'X' ? mag.toString(16).toUpperCase()
          : conv === 'o' ? mag.toString(8) : mag.toString();
        if (prec === 0 && mag === 0n) digits = '';
        if (prec > digits.length) digits = '0'.repeat(prec - digits.length) + digits;
        if (conv === 'd' || conv === 'i') sign = signFor(neg);
        if (alt && (conv === 'x' || conv === 'X') && mag !== 0n) prefix = '0' + conv;
        if (alt && conv === 'o' && !digits.startsWith('0')) digits = '0' + digits;
        if (prec >= 0) zeroOk = false;
        body = digits;
        break;
      }
      case 'e': case 'E': case 'f': case 'F': case 'g': case 'G': {
        const x = arg as number;
        const upper = conv === 'E' || conv === 'F' || conv === 'G';
        if (Number.isNaN(x)) {
          body = upper ? 'NAN' : 'nan';
          zeroOk = false;
          break;
        }
        sign = signFor(x < 0 || Object.is(x, -0));
        if (!isFinite(x)) {
          body = upper ? 'INF' : 'inf';
          zeroOk = false;
          break;
        }
        const lc = conv.toLowerCase();
        if (lc === 'f') {
          const p = prec < 0 ? 6 : prec;
          const [ip, fp] = fixedParts(x, p);
          body = ip + (p > 0 || alt ? '.' + fp : '');
        } else if (lc === 'e') {
          const p = prec < 0 ? 6 : prec;
          const [dg, e] = expParts(x, p);
          body = expStr(dg, e, alt, upper);
        } else {
          let P = prec < 0 ? 6 : prec;
          if (P === 0) P = 1;
          const [dg, e] = expParts(x, P - 1);
          if (P > e && e >= -4) {
            const p = P - 1 - e;
            const [ip, fp0] = fixedParts(x, p);
            let fp = fp0;
            if (!alt) fp = fp.replace(/0+$/, '');
            body = ip + (fp.length > 0 || alt ? '.' + fp : '');
          } else {
            let m = dg;
            if (!alt) m = m[0] + m.slice(1).replace(/0+$/, '');
            body = expStr(m, e, alt, upper);
          }
        }
        break;
      }
      case 's': {
        body = String(arg);
        if (prec >= 0) body = body.slice(0, prec);
        zeroOk = false;
        break;
      }
      case 'c':
        body = String(arg);
        zeroOk = false;
        break;
    }

    const len = sign.length + prefix.length + body.length;
    if (len >= width) out += sign + prefix + body;
    else if (minus) out += sign + prefix + body + ' '.repeat(width - len);
    else if (zeroOk) out += sign + prefix + '0'.repeat(width - len) + body;
    else out += ' '.repeat(width - len) + sign + prefix + body;
  }
  return out;
}
