function roundDiv(a: bigint, b: bigint): bigint {
  const q = a / b;
  const r = a % b;
  const t = 2n * r;
  if (t > b || (t === b && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// exact rational |x| = num/den
function toRational(x: number): [bigint, bigint] {
  x = Math.abs(x);
  if (x === 0) return [0n, 1n];
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const be = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let e: number;
  if (be === 0) e = -1074;
  else {
    m |= 1n << 52n;
    e = be - 1075;
  }
  return e >= 0 ? [m << BigInt(e), 1n] : [m, 1n << BigInt(-e)];
}

const p10 = (k: number) => 10n ** BigInt(k);

// round(v * 10^k) half-even
function scaledRound(r: [bigint, bigint], k: number): bigint {
  return k >= 0 ? roundDiv(r[0] * p10(k), r[1]) : roundDiv(r[0], r[1] * p10(-k));
}

function fixedStr(x: number, n: number, alt: boolean): string {
  const d = scaledRound(toRational(x), n).toString().padStart(n + 1, '0');
  const ip = d.slice(0, d.length - n);
  const fp = d.slice(d.length - n);
  return ip + (n > 0 ? '.' + fp : alt ? '.' : '');
}

// returns digits (n+1 digits) and exponent
function sciParts(x: number, n: number): [string, number] {
  const r = toRational(x);
  if (r[0] === 0n) return ['0'.repeat(n + 1), 0];
  let e = Math.floor(Math.log10(Math.abs(x)));
  if (!isFinite(e)) e = 0;
  // exact correction: 10^e <= v < 10^(e+1)
  const ge = (k: number) => (k >= 0 ? r[0] >= p10(k) * r[1] : r[0] * p10(-k) >= r[1]);
  while (!ge(e)) e--;
  while (ge(e + 1)) e++;
  let d = scaledRound(r, n - e);
  if (d >= p10(n + 1)) {
    e++;
    d = scaledRound(r, n - e);
  }
  return [d.toString(), e];
}

function sciStr(digits: string, e: number, upper: boolean, alt: boolean, strip: boolean): string {
  let mant = digits[0];
  let frac = digits.slice(1);
  if (strip) frac = frac.replace(/0+$/, '');
  if (frac.length > 0) mant += '.' + frac;
  else if (alt) mant += '.';
  const ae = Math.abs(e);
  return mant + (upper ? 'E' : 'e') + (e < 0 ? '-' : '+') + (ae < 10 ? '0' + ae : String(ae));
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

    const signFor = (neg: boolean) => (neg ? '-' : plus ? '+' : space ? ' ' : '');

    switch (conv) {
      case 'd':
      case 'i':
      case 'x':
      case 'X':
      case 'o': {
        const v = BigInt(arg as number | bigint);
        const neg = v < 0n;
        const mag = neg ? -v : v;
        if (conv === 'd' || conv === 'i') sign = signFor(neg);
        let digits = mag.toString(conv === 'o' ? 8 : conv === 'd' || conv === 'i' ? 10 : 16);
        if (conv === 'X') digits = digits.toUpperCase();
        if (prec >= 0) {
          zeroOk = false;
          if (prec === 0 && mag === 0n) digits = '';
          else digits = digits.padStart(prec, '0');
        }
        if (alt) {
          if (conv === 'o') {
            if (digits[0] !== '0') digits = '0' + digits;
          } else if ((conv === 'x' || conv === 'X') && mag !== 0n) prefix = conv === 'x' ? '0x' : '0X';
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
        if (Number.isNaN(x)) {
          body = upper ? 'NAN' : 'nan';
          zeroOk = false;
          break;
        }
        const neg = x < 0 || Object.is(x, -0);
        sign = signFor(neg);
        if (!isFinite(x)) {
          body = upper ? 'INF' : 'inf';
          zeroOk = false;
          break;
        }
        const lc = conv.toLowerCase();
        if (lc === 'f') {
          body = fixedStr(x, prec < 0 ? 6 : prec, alt);
        } else if (lc === 'e') {
          const n = prec < 0 ? 6 : prec;
          const [d, e] = sciParts(x, n);
          body = sciStr(d, e, upper, alt, false);
        } else {
          let P = prec < 0 ? 6 : prec;
          if (P === 0) P = 1;
          const [d, X] = sciParts(x, P - 1);
          if (P > X && X >= -4) {
            body = fixedStr(x, P - 1 - X, alt);
            if (!alt && body.includes('.')) body = body.replace(/0+$/, '').replace(/\.$/, '');
          } else {
            body = sciStr(d, X, upper, alt, !alt);
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
    else if (numeric && zeroOk) out += sign + prefix + '0'.repeat(width - len) + body;
    else out += ' '.repeat(width - len) + sign + prefix + body;
  }
  return out;
}
