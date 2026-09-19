// Decompose a finite positive double into m * 2^e (m, e integers).
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

// round(v * 10^k) to nearest, ties to even, using the exact value of v.
function scaledRound(m: bigint, e: number, k: number): bigint {
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

function fixedDigits(v: number, prec: number, alt: boolean): string {
  let n = 0n;
  if (v !== 0) {
    const [m, e] = decompose(v);
    n = scaledRound(m, e, prec);
  }
  let s = n.toString();
  if (prec > 0) {
    s = s.padStart(prec + 1, '0');
    return s.slice(0, s.length - prec) + '.' + s.slice(s.length - prec);
  }
  return alt ? s + '.' : s;
}

// Returns [digit string of length prec+1, decimal exponent].
function expParts(v: number, prec: number): [string, number] {
  if (v === 0) return ['0'.repeat(prec + 1), 0];
  const [m, e] = decompose(v);
  let X = Math.floor(Math.log10(v));
  if (!isFinite(X)) X = 0;
  const lower = 10n ** BigInt(prec);
  const upper = lower * 10n;
  for (let i = 0; i < 2000; i++) {
    const n = scaledRound(m, e, prec - X);
    if (n >= upper) X++;
    else if (n < lower) X--;
    else return [n.toString(), X];
  }
  throw new Error('exp');
}

function expStr(v: number, prec: number, alt: boolean, upper: boolean): string {
  const [d, X] = expParts(v, prec);
  let s = d[0];
  if (prec > 0) s += '.' + d.slice(1);
  else if (alt) s += '.';
  const ax = Math.abs(X);
  s += (upper ? 'E' : 'e') + (X < 0 ? '-' : '+') + (ax < 10 ? '0' + ax : String(ax));
  return s;
}

function stripZeros(s: string): string {
  if (s.indexOf('.') < 0) return s;
  return s.replace(/0+$/, '').replace(/\.$/, '');
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
    for (; i < n; i++) {
      const f = fmt[i];
      if (f === '-') minus = true;
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
    let canZero = false;

    switch (conv) {
      case 'd':
      case 'i': {
        const v = typeof arg === 'bigint' ? arg : BigInt(arg as number);
        const neg = v < 0n;
        let digits = (neg ? -v : v).toString();
        if (prec === 0 && v === 0n) digits = '';
        if (prec > 0) digits = digits.padStart(prec, '0');
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        body = digits;
        canZero = prec < 0;
        break;
      }
      case 'x':
      case 'X':
      case 'o': {
        const v = typeof arg === 'bigint' ? arg : BigInt(arg as number);
        let digits = v.toString(conv === 'o' ? 8 : 16);
        if (conv === 'X') digits = digits.toUpperCase();
        if (prec === 0 && v === 0n) digits = '';
        if (prec > 0) digits = digits.padStart(prec, '0');
        if (alt) {
          if (conv === 'o') {
            if (digits[0] !== '0') digits = '0' + digits;
          } else if (v !== 0n) prefix = conv === 'x' ? '0x' : '0X';
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
        const x = arg as number;
        const upperCase = conv === 'E' || conv === 'F' || conv === 'G';
        const neg = x < 0 || Object.is(x, -0);
        if (Number.isNaN(x)) {
          body = upperCase ? 'NAN' : 'nan';
        } else {
          sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
          const v = Math.abs(x);
          if (v === Infinity) {
            body = upperCase ? 'INF' : 'inf';
          } else {
            canZero = true;
            const lc = conv.toLowerCase();
            if (lc === 'f') {
              body = fixedDigits(v, prec < 0 ? 6 : prec, alt);
            } else if (lc === 'e') {
              body = expStr(v, prec < 0 ? 6 : prec, alt, conv === 'E');
            } else {
              let P = prec < 0 ? 6 : prec;
              if (P === 0) P = 1;
              const X = expParts(v, P - 1)[1];
              if (P > X && X >= -4) {
                body = fixedDigits(v, P - 1 - X, alt);
                if (!alt) body = stripZeros(body);
              } else {
                body = expStr(v, P - 1, alt, conv === 'G');
                if (!alt) {
                  const k = body.search(/[eE]/);
                  body = stripZeros(body.slice(0, k)) + body.slice(k);
                }
              }
            }
          }
        }
        break;
      }
      case 's': {
        let s = String(arg);
        if (prec >= 0) s = s.slice(0, prec);
        body = s;
        break;
      }
      default: {
        body = String(arg);
      }
    }

    const len = sign.length + prefix.length + body.length;
    if (len >= width) out += sign + prefix + body;
    else if (minus) out += sign + prefix + body + ' '.repeat(width - len);
    else if (zero && canZero) out += sign + prefix + '0'.repeat(width - len) + body;
    else out += ' '.repeat(width - len) + sign + prefix + body;
  }
  return out;
}
