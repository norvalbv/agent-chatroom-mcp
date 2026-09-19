// Decompose a finite non-negative double into m * 2^e exactly.
function decompose(x: number): [bigint, number] {
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, x);
  const hi = buf.getUint32(0);
  const lo = buf.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (expBits === 0) return [m, -1074];
  m |= 1n << 52n;
  return [m, expBits - 1075];
}

function ratio(x: number, k: number): [bigint, bigint] {
  const [m, e] = decompose(x);
  let num = m;
  let den = 1n;
  if (e >= 0) num <<= BigInt(e);
  else den <<= BigInt(-e);
  if (k >= 0) num *= 10n ** BigInt(k);
  else den *= 10n ** BigInt(-k);
  return [num, den];
}

// round-half-even of x * 10^k
function roundScaled(x: number, k: number): bigint {
  const [num, den] = ratio(x, k);
  const q = num / den;
  const r2 = (num % den) * 2n;
  if (r2 > den || (r2 === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

function floorScaled(x: number, k: number): bigint {
  const [num, den] = ratio(x, k);
  return num / den;
}

// decimal exponent of positive x (before rounding)
function exponentOf(x: number): number {
  let X = Math.floor(Math.log10(x));
  if (!Number.isFinite(X)) X = 0;
  while (floorScaled(x, -X) >= 10n) X++;
  while (floorScaled(x, -X) < 1n) X--;
  return X;
}

// e-style digits: returns [digit string of length p+1, exponent]
function eDigits(x: number, p: number): [string, number] {
  if (x === 0) return ['0'.repeat(p + 1), 0];
  let X = exponentOf(x);
  let d = roundScaled(x, p - X);
  if (d >= 10n ** BigInt(p + 1)) {
    X++;
    d = roundScaled(x, p - X);
  }
  return [d.toString(), X];
}

function fixedStr(x: number, p: number, alt: boolean): string {
  let s = roundScaled(x, p).toString();
  if (p > 0) {
    s = s.padStart(p + 1, '0');
    s = s.slice(0, s.length - p) + '.' + s.slice(s.length - p);
  } else if (alt) s += '.';
  return s;
}

function expStr(x: number, p: number, alt: boolean, upper: boolean): string {
  const [d, X] = eDigits(x, p);
  let s = d[0];
  if (p > 0) s += '.' + d.slice(1);
  else if (alt) s += '.';
  const ax = Math.abs(X);
  s += (upper ? 'E' : 'e') + (X < 0 ? '-' : '+') + (ax < 10 ? '0' : '') + ax;
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

    let prefix = '';
    let body = '';
    let canZero = false;
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
        if (prec === 0 && mag === 0n) digits = '';
        if (prec > digits.length) digits = digits.padStart(prec, '0');
        if (conv === 'd' || conv === 'i') {
          prefix = neg ? '-' : plus ? '+' : space ? ' ' : '';
        } else if (alt) {
          if (conv === 'o') {
            if (digits[0] !== '0') digits = '0' + digits;
          } else if (mag !== 0n) prefix = conv === 'x' ? '0x' : '0X';
        }
        body = digits;
        canZero = prec < 0;
        break;
      }
      case 'e':
      case 'E':
      case 'f':
      case 'F':
      case 'g':
      case 'G': {
        const v = arg as number;
        const upperC = conv === 'E' || conv === 'F' || conv === 'G';
        const neg = !Number.isNaN(v) && (v < 0 || Object.is(v, -0));
        prefix = Number.isNaN(v) ? '' : neg ? '-' : plus ? '+' : space ? ' ' : '';
        if (!Number.isFinite(v)) {
          body = Number.isNaN(v) ? 'nan' : 'inf';
          if (upperC) body = body.toUpperCase();
          canZero = false;
          break;
        }
        const x = Math.abs(v);
        const lower = conv.toLowerCase();
        if (lower === 'f') {
          body = fixedStr(x, prec < 0 ? 6 : prec, alt);
        } else if (lower === 'e') {
          body = expStr(x, prec < 0 ? 6 : prec, alt, conv === 'E');
        } else {
          let P = prec < 0 ? 6 : prec;
          if (P === 0) P = 1;
          const X = x === 0 ? 0 : eDigits(x, P - 1)[1];
          let s: string;
          if (P > X && X >= -4) {
            s = fixedStr(x, P - 1 - X, alt);
            if (!alt && s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
          } else {
            s = expStr(x, P - 1, alt, conv === 'G');
            if (!alt) {
              const k = s.search(/[eE]/);
              let mant = s.slice(0, k);
              if (mant.includes('.')) mant = mant.replace(/0+$/, '').replace(/\.$/, '');
              s = mant + s.slice(k);
            }
          }
          body = s;
        }
        canZero = true;
        break;
      }
      case 's':
        body = arg as string;
        if (prec >= 0) body = body.slice(0, prec);
        break;
      case 'c':
        body = arg as string;
        break;
    }
    const len = prefix.length + body.length;
    if (len >= width) out += prefix + body;
    else if (minus) out += prefix + body + ' '.repeat(width - len);
    else if (zero && canZero) out += prefix + '0'.repeat(width - len) + body;
    else out += ' '.repeat(width - len) + prefix + body;
  }
  return out;
}
