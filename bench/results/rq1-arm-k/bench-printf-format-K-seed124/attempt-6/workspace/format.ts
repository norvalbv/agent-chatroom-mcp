// Exact decimal expansion of a finite non-negative double: value = D * 10^-s.
function exact(x: number): { D: bigint; s: number } {
  if (x === 0) return { D: 0n, s: 0 };
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, x);
  const hi = buf.getUint32(0);
  const lo = buf.getUint32(4);
  const bexp = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let e: number;
  if (bexp === 0) e = -1074;
  else {
    m |= 1n << 52n;
    e = bexp - 1075;
  }
  if (e >= 0) return { D: m << BigInt(e), s: 0 };
  return { D: m * 5n ** BigInt(-e), s: -e };
}

// round(D * 10^-s * 10^n) half-even, as a bigint
function roundTo(D: bigint, s: number, n: number): bigint {
  if (n >= s) return D * 10n ** BigInt(n - s);
  const div = 10n ** BigInt(s - n);
  const q = D / div;
  const r = D % div;
  const t = r * 2n;
  if (t > div || (t === div && (q & 1n) === 1n)) return q + 1n;
  return q;
}

function fixed(x: number, prec: number, alt: boolean): string {
  const { D, s } = exact(x);
  let N = roundTo(D, s, prec).toString();
  if (N.length < prec + 1) N = '0'.repeat(prec + 1 - N.length) + N;
  const ip = N.slice(0, N.length - prec);
  const fp = N.slice(N.length - prec);
  return ip + (prec > 0 || alt ? '.' : '') + fp;
}

// digits: prec+1 significant digits, exp: decimal exponent
function sci(x: number, prec: number): { digits: string; exp: number } {
  if (x === 0) return { digits: '0'.repeat(prec + 1), exp: 0 };
  const { D, s } = exact(x);
  let exp = D.toString().length - 1 - s;
  let N = roundTo(D, s, prec - exp);
  if (N.toString().length > prec + 1) {
    exp++;
    N = N / 10n;
  }
  return { digits: N.toString(), exp };
}

function sciStr(digits: string, exp: number, upper: boolean, alt: boolean, strip: boolean): string {
  let frac = digits.slice(1);
  if (strip) frac = frac.replace(/0+$/, '');
  const ae = Math.abs(exp);
  const es = (ae < 10 ? '0' : '') + ae;
  return digits[0] + (frac.length > 0 || alt ? '.' : '') + frac + (upper ? 'E' : 'e') + (exp < 0 ? '-' : '+') + es;
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
    let w = '';
    while (i < fmt.length && fmt[i] >= '0' && fmt[i] <= '9') w += fmt[i++];
    const width = w ? parseInt(w, 10) : 0;
    let prec: number | undefined;
    if (fmt[i] === '.') {
      i++;
      let p = '';
      while (i < fmt.length && fmt[i] >= '0' && fmt[i] <= '9') p += fmt[i++];
      prec = p ? parseInt(p, 10) : 0;
    }
    const conv = fmt[i++];
    const arg = args[ai++];
    let sign = '';
    let prefix = '';
    let body = '';
    let canZero = true;

    switch (conv) {
      case 'd':
      case 'i':
      case 'x':
      case 'X':
      case 'o': {
        const v = BigInt(arg as number | bigint);
        const neg = v < 0n;
        const mag = neg ? -v : v;
        let digits = mag.toString(conv === 'x' || conv === 'X' ? 16 : conv === 'o' ? 8 : 10);
        if (conv === 'X') digits = digits.toUpperCase();
        if (prec !== undefined) {
          if (prec === 0 && mag === 0n) digits = '';
          else if (digits.length < prec) digits = '0'.repeat(prec - digits.length) + digits;
          canZero = false;
        }
        if (conv === 'd' || conv === 'i') {
          sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        } else if (alt) {
          if (conv === 'o') {
            if (!digits.startsWith('0')) digits = '0' + digits;
          } else if (mag !== 0n) prefix = conv === 'x' ? '0x' : '0X';
        }
        body = digits;
        break;
      }
      case 'e':
      case 'E':
      case 'f':
      case 'F':
      case 'g':
      case 'G': {
        const x = arg as number;
        const upper = conv === 'E' || conv === 'F' || conv === 'G';
        const isNaNv = Number.isNaN(x);
        if (!isNaNv) sign = x < 0 || Object.is(x, -0) ? '-' : plus ? '+' : space ? ' ' : '';
        if (isNaNv || !Number.isFinite(x)) {
          body = isNaNv ? 'nan' : 'inf';
          if (upper) body = body.toUpperCase();
          canZero = false;
          break;
        }
        const ax = Math.abs(x);
        const lc = conv.toLowerCase();
        if (lc === 'f') body = fixed(ax, prec ?? 6, alt);
        else if (lc === 'e') {
          const p = prec ?? 6;
          const r = sci(ax, p);
          body = sciStr(r.digits, r.exp, upper, alt, false);
        } else {
          let P = prec ?? 6;
          if (P === 0) P = 1;
          const r = sci(ax, P - 1);
          if (P > r.exp && r.exp >= -4) {
            body = fixed(ax, P - 1 - r.exp, alt);
            if (!alt && body.includes('.')) body = body.replace(/0+$/, '').replace(/\.$/, '');
          } else {
            body = sciStr(r.digits, r.exp, upper, alt, !alt);
          }
        }
        break;
      }
      case 's': {
        body = String(arg);
        if (prec !== undefined) body = body.slice(0, prec);
        canZero = false;
        break;
      }
      case 'c':
        body = String(arg);
        canZero = false;
        break;
    }

    const len = sign.length + prefix.length + body.length;
    if (len >= width) out += sign + prefix + body;
    else if (minus) out += sign + prefix + body + ' '.repeat(width - len);
    else if (zero && canZero) out += sign + prefix + '0'.repeat(width - len) + body;
    else out += ' '.repeat(width - len) + sign + prefix + body;
  }
  return out;
}
