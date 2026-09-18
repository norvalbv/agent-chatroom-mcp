// Decompose a finite non-negative double into m * 2^e exactly.
function decompose(v: number): [bigint, number] {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, v);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (expBits === 0) return [m, -1074];
  m |= 1n << 52n;
  return [m, expBits - 1075];
}

// round(v * 10^k), half-to-even, exact.
function roundScaled(m: bigint, e: number, k: number): bigint {
  let num = m;
  let den = 1n;
  if (e >= 0) num <<= BigInt(e);
  else den <<= BigInt(-e);
  if (k >= 0) num *= 10n ** BigInt(k);
  else den *= 10n ** BigInt(-k);
  const q = num / den;
  const r = num - q * den;
  const twice = r * 2n;
  if (twice > den || (twice === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// Fixed style: returns digits string (integer part + fraction) split.
function fixedParts(v: number, prec: number): [string, string] {
  const [m, e] = decompose(v);
  let s = roundScaled(m, e, prec).toString();
  if (prec > 0) {
    s = s.padStart(prec + 1, '0');
    return [s.slice(0, s.length - prec), s.slice(s.length - prec)];
  }
  return [s, ''];
}

// Exponent style: returns [first digit, fraction digits, exponent].
function expParts(v: number, prec: number): [string, string, number] {
  if (v === 0) return ['0', '0'.repeat(prec), 0];
  const [m, e] = decompose(v);
  let X = Math.floor(Math.log10(v));
  if (!isFinite(X)) X = -324;
  const lim = 10n ** BigInt(prec);
  for (;;) {
    const d = roundScaled(m, e, prec - X);
    if (d >= lim * 10n) X++;
    else if (d < lim) X--;
    else {
      const s = d.toString();
      return [s[0], s.slice(1), X];
    }
  }
}

function expStr(first: string, frac: string, X: number, upper: boolean, alt: boolean): string {
  const ax = Math.abs(X);
  return (
    first + (frac.length > 0 || alt ? '.' : '') + frac +
    (upper ? 'E' : 'e') + (X < 0 ? '-' : '+') + (ax < 10 ? '0' : '') + ax
  );
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
    let canZero = true;

    const signFor = (neg: boolean) => (neg ? '-' : plus ? '+' : space ? ' ' : '');

    switch (conv) {
      case 'd':
      case 'i':
      case 'x':
      case 'X':
      case 'o': {
        const n = BigInt(arg as number | bigint);
        const neg = n < 0n;
        const mag = neg ? -n : n;
        let digits =
          conv === 'd' || conv === 'i' ? mag.toString() :
          conv === 'o' ? mag.toString(8) :
          mag.toString(16);
        if (conv === 'X') digits = digits.toUpperCase();
        if (prec >= 0) {
          canZero = false;
          if (prec === 0 && mag === 0n) digits = '';
          digits = digits.padStart(prec, '0');
        }
        if (conv === 'd' || conv === 'i') sign = signFor(neg);
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
        const upper = conv === 'E' || conv === 'F' || conv === 'G';
        if (Number.isNaN(v)) {
          body = upper ? 'NAN' : 'nan';
          canZero = false;
          break;
        }
        const neg = v < 0 || Object.is(v, -0);
        sign = signFor(neg);
        if (!isFinite(v)) {
          body = upper ? 'INF' : 'inf';
          canZero = false;
          break;
        }
        const a = Math.abs(v);
        const lc = conv.toLowerCase();
        if (lc === 'f') {
          const p = prec < 0 ? 6 : prec;
          const [ip, fp] = fixedParts(a, p);
          body = ip + (p > 0 || alt ? '.' : '') + fp;
        } else if (lc === 'e') {
          const p = prec < 0 ? 6 : prec;
          const [f, fr, X] = expParts(a, p);
          body = expStr(f, fr, X, upper, alt);
        } else {
          let P = prec < 0 ? 6 : prec;
          if (P === 0) P = 1;
          const [f, fr, X] = expParts(a, P - 1);
          if (P > X && X >= -4) {
            const p = P - 1 - X;
            let [ip, fp] = fixedParts(a, p);
            if (!alt) fp = fp.replace(/0+$/, '');
            body = ip + (fp.length > 0 || alt ? '.' : '') + fp;
          } else {
            let fr2 = fr;
            if (!alt) fr2 = fr2.replace(/0+$/, '');
            body = expStr(f, fr2, X, upper, alt);
          }
        }
        break;
      }
      case 's': {
        body = arg as string;
        if (prec >= 0) body = body.slice(0, prec);
        canZero = false;
        break;
      }
      case 'c':
        body = arg as string;
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
