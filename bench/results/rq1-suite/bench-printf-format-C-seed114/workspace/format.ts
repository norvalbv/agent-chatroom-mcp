// abs (finite, >= 0) as m * 2^e exactly.
function decompose(abs: number): [bigint, number] {
  if (abs === 0) return [0n, 0];
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, abs);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const be = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (be === 0) return [m, -1074];
  m |= 1n << 52n;
  return [m, be - 1075];
}

// round(abs * 10^k), half to even, exactly.
function scaledRound(m: bigint, e: number, k: number): bigint {
  let num = m;
  let den = 1n;
  if (e >= 0) num <<= BigInt(e);
  else den <<= BigInt(-e);
  if (k >= 0) num *= 10n ** BigInt(k);
  else den *= 10n ** BigInt(-k);
  const q = num / den;
  const r2 = (num % den) * 2n;
  if (r2 > den || (r2 === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

function fixedDigits(abs: number, prec: number, alt: boolean): string {
  const [m, e] = decompose(abs);
  let s = scaledRound(m, e, prec).toString();
  if (prec > 0) {
    s = s.padStart(prec + 1, '0');
    return s.slice(0, s.length - prec) + '.' + s.slice(s.length - prec);
  }
  return alt ? s + '.' : s;
}

// Returns digit string of length prec+1 and decimal exponent.
function expParts(abs: number, prec: number): [string, number] {
  if (abs === 0) return ['0'.repeat(prec + 1), 0];
  const [m, e] = decompose(abs);
  let x = Math.floor(Math.log10(abs));
  const lo = 10n ** BigInt(prec);
  const hi = lo * 10n;
  for (;;) {
    const v = scaledRound(m, e, prec - x);
    if (v >= hi) x++;
    else if (v < lo) x--;
    else return [v.toString(), x];
  }
}

function expStr(digits: string, x: number, upper: boolean, alt: boolean, strip: boolean): string {
  let frac = digits.slice(1);
  if (strip) frac = frac.replace(/0+$/, '');
  let s = digits[0] + (frac.length > 0 || alt ? '.' : '') + frac;
  const ax = Math.abs(x);
  s += (upper ? 'E' : 'e') + (x < 0 ? '-' : '+') + (ax < 10 ? '0' : '') + ax;
  return s;
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let out = '';
  let ai = 0;
  let i = 0;
  const n = fmt.length;
  while (i < n) {
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
    let left = false, plus = false, space = false, zero = false, alt = false;
    for (; i < n; i++) {
      const f = fmt[i];
      if (f === '-') left = true;
      else if (f === '+') plus = true;
      else if (f === ' ') space = true;
      else if (f === '0') zero = true;
      else if (f === '#') alt = true;
      else break;
    }
    let width = 0;
    while (i < n && fmt[i] >= '0' && fmt[i] <= '9') width = width * 10 + (fmt.charCodeAt(i++) - 48);
    let prec = -1;
    if (fmt[i] === '.') {
      i++;
      prec = 0;
      while (i < n && fmt[i] >= '0' && fmt[i] <= '9') prec = prec * 10 + (fmt.charCodeAt(i++) - 48);
    }
    const conv = fmt[i++];
    const arg = args[ai++];

    let sign = '';
    let prefix = '';
    let body = '';
    let canZero = true; // whether the 0 flag applies
    const signFor = (neg: boolean) => (neg ? '-' : plus ? '+' : space ? ' ' : '');

    switch (conv) {
      case 'd':
      case 'i':
      case 'x':
      case 'X':
      case 'o': {
        const v = typeof arg === 'bigint' ? arg : BigInt(arg as number);
        const neg = v < 0n;
        const mag = neg ? -v : v;
        if (conv === 'd' || conv === 'i') {
          sign = signFor(neg);
          body = mag.toString();
        } else if (conv === 'o') {
          body = mag.toString(8);
        } else {
          body = mag.toString(16);
          if (conv === 'X') body = body.toUpperCase();
        }
        if (prec === 0 && mag === 0n) body = '';
        if (prec > 0) body = body.padStart(prec, '0');
        if (alt) {
          if (conv === 'o') {
            if (body[0] !== '0') body = '0' + body;
          } else if ((conv === 'x' || conv === 'X') && mag !== 0n) {
            prefix = conv === 'x' ? '0x' : '0X';
          }
        }
        if (prec >= 0) canZero = false;
        break;
      }
      case 'e':
      case 'E':
      case 'f':
      case 'F':
      case 'g':
      case 'G': {
        const v = arg as number;
        const upper = conv === 'E' || conv === 'F' || conv === 'G';
        if (Number.isNaN(v)) {
          body = upper ? 'NAN' : 'nan';
          canZero = false;
          break;
        }
        const neg = v < 0 || Object.is(v, -0);
        sign = signFor(neg);
        if (!Number.isFinite(v)) {
          body = upper ? 'INF' : 'inf';
          canZero = false;
          break;
        }
        const abs = Math.abs(v);
        const lc = conv.toLowerCase();
        if (lc === 'f') {
          body = fixedDigits(abs, prec < 0 ? 6 : prec, alt);
        } else if (lc === 'e') {
          const [d, x] = expParts(abs, prec < 0 ? 6 : prec);
          body = expStr(d, x, upper && conv === 'E', alt, false);
        } else {
          let P = prec < 0 ? 6 : prec;
          if (P === 0) P = 1;
          const [d, x] = expParts(abs, P - 1);
          if (P > x && x >= -4) {
            body = fixedDigits(abs, P - 1 - x, alt);
            if (!alt && body.includes('.')) body = body.replace(/0+$/, '').replace(/\.$/, '');
          } else {
            body = expStr(d, x, conv === 'G', alt, !alt);
          }
        }
        break;
      }
      case 's': {
        body = String(arg);
        if (prec >= 0) body = body.slice(0, prec);
        canZero = false;
        break;
      }
      case 'c': {
        body = String(arg);
        canZero = false;
        break;
      }
    }

    const len = sign.length + prefix.length + body.length;
    if (len >= width) out += sign + prefix + body;
    else if (left) out += sign + prefix + body + ' '.repeat(width - len);
    else if (zero && canZero) out += sign + prefix + '0'.repeat(width - len) + body;
    else out += ' '.repeat(width - len) + sign + prefix + body;
  }
  return out;
}
