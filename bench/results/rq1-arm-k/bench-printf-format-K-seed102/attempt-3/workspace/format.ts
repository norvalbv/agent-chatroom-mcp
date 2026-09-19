function decompose(x: number): { mant: bigint; exp2: number } {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const ef = (hi >>> 20) & 0x7ff;
  const frac = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (ef === 0) return { mant: frac, exp2: -1074 };
  return { mant: frac | (1n << 52n), exp2: ef - 1075 };
}

// round-half-even of mant * 2^exp2 * 10^k
function roundScaled(mant: bigint, exp2: number, k: number): bigint {
  let num = mant;
  let den = 1n;
  if (exp2 > 0) num <<= BigInt(exp2);
  else den <<= BigInt(-exp2);
  if (k >= 0) num *= 10n ** BigInt(k);
  else den *= 10n ** BigInt(-k);
  const q = num / den;
  const r = num % den;
  const twice = r * 2n;
  if (twice > den || (twice === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

function fixedDigits(x: number, prec: number, alt: boolean): string {
  const { mant, exp2 } = decompose(x);
  let s = roundScaled(mant, exp2, prec).toString();
  if (s.length < prec + 1) s = '0'.repeat(prec + 1 - s.length) + s;
  const ip = s.slice(0, s.length - prec);
  const fp = s.slice(s.length - prec);
  return prec > 0 ? ip + '.' + fp : alt ? ip + '.' : ip;
}

// returns digit string of length prec+1 and decimal exponent
function expParts(x: number, prec: number): { digits: string; e: number } {
  if (x === 0) return { digits: '0'.repeat(prec + 1), e: 0 };
  const { mant, exp2 } = decompose(x);
  let e = Math.floor(Math.log10(x));
  if (!isFinite(e)) e = -324;
  const lo = 10n ** BigInt(prec);
  const hi = lo * 10n;
  for (let i = 0; i < 10; i++) {
    const n = roundScaled(mant, exp2, prec - e);
    if (n >= hi) e++;
    else if (n < lo) e--;
    else return { digits: n.toString(), e };
  }
  throw new Error('exp');
}

function expString(digits: string, e: number, upper: boolean, alt: boolean): string {
  const prec = digits.length - 1;
  let m = digits[0];
  if (prec > 0) m += '.' + digits.slice(1);
  else if (alt) m += '.';
  const ae = Math.abs(e);
  return m + (upper ? 'E' : 'e') + (e < 0 ? '-' : '+') + (ae < 10 ? '0' : '') + ae;
}

function stripZeros(s: string): string {
  // s has a '.'; strip trailing zeros in fractional part (before any exponent)
  const ei = s.search(/[eE]/);
  let body = ei >= 0 ? s.slice(0, ei) : s;
  const tail = ei >= 0 ? s.slice(ei) : '';
  if (body.includes('.')) {
    body = body.replace(/0+$/, '');
    if (body.endsWith('.')) body = body.slice(0, -1);
  }
  return body + tail;
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
    let width = 0;
    while (fmt[i] >= '0' && fmt[i] <= '9') width = width * 10 + (fmt.charCodeAt(i++) - 48);
    let prec: number | undefined;
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
    let numeric = true;
    let canZero = true;
    const posSign = plus ? '+' : space ? ' ' : '';

    switch (conv) {
      case 'd':
      case 'i': {
        const v = BigInt(arg as number | bigint);
        sign = v < 0n ? '-' : posSign;
        const a = v < 0n ? -v : v;
        body = a === 0n && prec === 0 ? '' : a.toString();
        if (prec !== undefined) {
          body = body.padStart(prec, '0');
          canZero = false;
        }
        break;
      }
      case 'x':
      case 'X':
      case 'o': {
        const v = BigInt(arg as number | bigint);
        body = v === 0n && prec === 0 ? '' : v.toString(conv === 'o' ? 8 : 16);
        if (conv === 'X') body = body.toUpperCase();
        if (prec !== undefined) {
          body = body.padStart(prec, '0');
          canZero = false;
        }
        if (alt) {
          if (conv === 'o') {
            if (body[0] !== '0') body = '0' + body;
          } else if (v !== 0n) prefix = conv === 'x' ? '0x' : '0X';
        }
        break;
      }
      case 'e': case 'E': case 'f': case 'F': case 'g': case 'G': {
        const x = arg as number;
        const upper = conv === 'E' || conv === 'F' || conv === 'G';
        if (Number.isNaN(x)) {
          body = upper ? 'NAN' : 'nan';
          canZero = false;
          break;
        }
        const neg = x < 0 || Object.is(x, -0);
        sign = neg ? '-' : posSign;
        if (!isFinite(x)) {
          body = upper ? 'INF' : 'inf';
          canZero = false;
          break;
        }
        const ax = Math.abs(x);
        const lc = conv.toLowerCase();
        if (lc === 'f') {
          body = fixedDigits(ax, prec ?? 6, alt);
        } else if (lc === 'e') {
          const p = prec ?? 6;
          const { digits, e } = expParts(ax, p);
          body = expString(digits, e, upper, alt);
        } else {
          let P = prec ?? 6;
          if (P === 0) P = 1;
          const { digits, e: X } = expParts(ax, P - 1);
          if (P > X && X >= -4) {
            body = fixedDigits(ax, P - 1 - X, alt);
          } else {
            body = expString(digits, X, upper, alt);
          }
          if (!alt) body = stripZeros(body);
        }
        break;
      }
      case 's': {
        numeric = false;
        body = String(arg);
        if (prec !== undefined) body = body.slice(0, prec);
        break;
      }
      case 'c': {
        numeric = false;
        body = String(arg);
        break;
      }
      default:
        throw new Error('bad conversion');
    }

    const len = sign.length + prefix.length + body.length;
    if (len >= width) {
      out += sign + prefix + body;
    } else if (minus) {
      out += sign + prefix + body + ' '.repeat(width - len);
    } else if (numeric && zero && canZero) {
      out += sign + prefix + '0'.repeat(width - len) + body;
    } else {
      out += ' '.repeat(width - len) + sign + prefix + body;
    }
  }
  return out;
}
