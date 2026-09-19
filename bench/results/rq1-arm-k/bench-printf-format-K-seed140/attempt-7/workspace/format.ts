const P10 = (n: number): bigint => 10n ** BigInt(n);

// Exact decomposition of a finite non-negative double into num/den.
function ratio(v: number): [bigint, bigint] {
  if (v === 0) return [0n, 1n];
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, v);
  const hi = buf.getUint32(0);
  const lo = buf.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let e: number;
  if (expBits === 0) {
    e = -1074;
  } else {
    m |= 1n << 52n;
    e = expBits - 1075;
  }
  return e >= 0 ? [m << BigInt(e), 1n] : [m, 1n << BigInt(-e)];
}

// round(v * 10^k), half to even, exactly.
function roundScaled(v: number, k: number): bigint {
  let [num, den] = ratio(v);
  if (k >= 0) num *= P10(k);
  else den *= P10(-k);
  const q = num / den;
  const r = num % den;
  const twice = r * 2n;
  if (twice > den || (twice === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// Fixed notation: digits string of the integer part and fraction.
function fixedParts(v: number, prec: number): [string, string] {
  let s = roundScaled(v, prec).toString();
  if (prec > 0) {
    s = s.padStart(prec + 1, '0');
    return [s.slice(0, s.length - prec), s.slice(s.length - prec)];
  }
  return [s, ''];
}

// Scientific: digits (length p+1) and decimal exponent.
function sciParts(v: number, p: number): [string, number] {
  if (v === 0) return ['0'.repeat(p + 1), 0];
  let x = Math.floor(Math.log10(v));
  if (!isFinite(x)) x = -324;
  const lowB = P10(p);
  const highB = P10(p + 1);
  for (;;) {
    const d = roundScaled(v, p - x);
    if (d >= highB) x++;
    else if (d < lowB) x--;
    else return [d.toString(), x];
  }
}

function expStr(x: number, upper: boolean): string {
  const a = Math.abs(x).toString().padStart(2, '0');
  return (upper ? 'E' : 'e') + (x < 0 ? '-' : '+') + a;
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
    while (fmt[i] >= '0' && fmt[i] <= '9') width = width * 10 + (fmt.charCodeAt(i++) - 48);
    let prec = -1;
    if (fmt[i] === '.') {
      i++;
      prec = 0;
      while (fmt[i] >= '0' && fmt[i] <= '9') prec = prec * 10 + (fmt.charCodeAt(i++) - 48);
    }
    const conv = fmt[i++];
    const arg = args[ai++];

    let prefix = '';
    let body = '';
    let numeric = true;
    let allowZero = zero && !minus;
    const signFor = (neg: boolean): string => (neg ? '-' : plus ? '+' : space ? ' ' : '');

    switch (conv) {
      case 'd':
      case 'i':
      case 'x':
      case 'X':
      case 'o': {
        const big = typeof arg === 'bigint' ? arg : BigInt(arg as number);
        const neg = big < 0n;
        const mag = neg ? -big : big;
        let digits: string;
        if (conv === 'd' || conv === 'i') digits = mag.toString();
        else if (conv === 'o') digits = mag.toString(8);
        else digits = mag.toString(16);
        if (conv === 'X') digits = digits.toUpperCase();
        if (prec === 0 && mag === 0n) digits = '';
        if (prec >= 0) {
          digits = digits.padStart(prec, '0');
          allowZero = false;
        }
        if (conv === 'd' || conv === 'i') prefix = signFor(neg);
        else if (alt) {
          if (conv === 'o') {
            if (digits[0] !== '0') digits = '0' + digits;
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
        const v = arg as number;
        const upperCase = conv === 'E' || conv === 'F' || conv === 'G';
        if (Number.isNaN(v)) {
          body = upperCase ? 'NAN' : 'nan';
          allowZero = false;
          break;
        }
        const neg = v < 0 || Object.is(v, -0);
        prefix = signFor(neg);
        if (!isFinite(v)) {
          body = upperCase ? 'INF' : 'inf';
          allowZero = false;
          break;
        }
        const a = Math.abs(v);
        const lc = conv.toLowerCase();
        const sci = (p: number, keepZeros: boolean): string => {
          const [d, x] = sciParts(a, p);
          let frac = d.slice(1);
          if (!keepZeros) frac = frac.replace(/0+$/, '');
          return d[0] + (frac || alt ? '.' : '') + frac + expStr(x, conv === 'E' || conv === 'G');
        };
        const fix = (p: number, keepZeros: boolean): string => {
          const [ip, fp0] = fixedParts(a, p);
          let fp = fp0;
          if (!keepZeros) fp = fp.replace(/0+$/, '');
          return ip + (fp || alt ? '.' : '') + fp;
        };
        if (lc === 'e') {
          body = sci(prec < 0 ? 6 : prec, true);
        } else if (lc === 'f') {
          body = fix(prec < 0 ? 6 : prec, true);
        } else {
          let P = prec < 0 ? 6 : prec;
          if (P === 0) P = 1;
          const x = sciParts(a, P - 1)[1];
          if (P > x && x >= -4) body = fix(P - 1 - x, alt);
          else body = sci(P - 1, alt);
        }
        break;
      }
      case 's': {
        numeric = false;
        body = arg as string;
        if (prec >= 0) body = body.slice(0, prec);
        break;
      }
      case 'c': {
        numeric = false;
        body = arg as string;
        break;
      }
      default:
        throw new Error('bad conversion');
    }

    const len = prefix.length + body.length;
    if (len >= width) out += prefix + body;
    else if (minus) out += prefix + body + ' '.repeat(width - len);
    else if (numeric && allowZero) out += prefix + '0'.repeat(width - len) + body;
    else out += ' '.repeat(width - len) + prefix + body;
  }
  return out;
}
