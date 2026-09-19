function decompose(v: number): [bigint, bigint] {
  // v >= 0 finite; returns [num, den] exactly
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, v);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  let mant = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let e: number;
  if (expBits === 0) {
    e = -1074;
  } else {
    mant |= 1n << 52n;
    e = expBits - 1075;
  }
  return e >= 0 ? [mant << BigInt(e), 1n] : [mant, 1n << BigInt(-e)];
}

// round-half-even(num/den * 10^k)
function roundScaled(num: bigint, den: bigint, k: number): bigint {
  if (k >= 0) num *= 10n ** BigInt(k);
  else den *= 10n ** BigInt(-k);
  const q = num / den;
  const r = num % den;
  const twice = r * 2n;
  if (twice > den || (twice === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

function fixedStr(v: number, p: number, alt: boolean): string {
  const [n, d] = decompose(v);
  let s = roundScaled(n, d, p).toString();
  if (p > 0) {
    s = s.padStart(p + 1, '0');
    return s.slice(0, s.length - p) + '.' + s.slice(s.length - p);
  }
  return alt ? s + '.' : s;
}

// returns digit string of length p+1 and decimal exponent
function expParts(v: number, p: number): [string, number] {
  if (v === 0) return ['0'.repeat(p + 1), 0];
  const [n, d] = decompose(v);
  let X = Math.floor(Math.log10(v));
  if (!isFinite(X)) X = -324;
  const lim = 10n ** BigInt(p);
  for (let i = 0; i < 10; i++) {
    const digs = roundScaled(n, d, p - X);
    if (digs >= lim * 10n) X++;
    else if (digs < lim) X--;
    else return [digs.toString(), X];
  }
  throw new Error('exp');
}

function expStr(digs: string, X: number, upper: boolean, alt: boolean): string {
  const p = digs.length - 1;
  let m = digs[0];
  if (p > 0) m += '.' + digs.slice(1);
  else if (alt) m += '.';
  const ax = Math.abs(X);
  return m + (upper ? 'E' : 'e') + (X < 0 ? '-' : '+') + (ax < 10 ? '0' + ax : String(ax));
}

function stripZeros(s: string): string {
  if (!s.includes('.')) return s;
  return s.replace(/0+$/, '').replace(/\.$/, '');
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
    let prec: number | undefined;
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
    let canZero = true;

    switch (conv) {
      case 'd':
      case 'i': {
        const v = BigInt(arg as number | bigint);
        sign = v < 0n ? '-' : plus ? '+' : space ? ' ' : '';
        body = (v < 0n ? -v : v).toString();
        if (prec !== undefined) {
          if (prec === 0 && v === 0n) body = '';
          body = body.padStart(prec, '0');
          canZero = false;
        }
        break;
      }
      case 'x':
      case 'X':
      case 'o': {
        const v = BigInt(arg as number | bigint);
        body = v.toString(conv === 'o' ? 8 : 16);
        if (conv === 'X') body = body.toUpperCase();
        if (prec !== undefined) {
          if (prec === 0 && v === 0n) body = '';
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
        const v = arg as number;
        const upper = conv === 'E' || conv === 'F' || conv === 'G';
        const neg = v < 0 || Object.is(v, -0);
        if (Number.isNaN(v)) {
          body = upper ? 'NAN' : 'nan';
          canZero = false;
          break;
        }
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        if (!isFinite(v)) {
          body = upper ? 'INF' : 'inf';
          canZero = false;
          break;
        }
        const a = Math.abs(v);
        const lc = conv.toLowerCase();
        if (lc === 'f') {
          body = fixedStr(a, prec ?? 6, alt);
        } else if (lc === 'e') {
          const [digs, X] = expParts(a, prec ?? 6);
          body = expStr(digs, X, upper, alt);
        } else {
          let P = prec ?? 6;
          if (P === 0) P = 1;
          const [digs, X] = expParts(a, P - 1);
          if (P > X && X >= -4) {
            body = fixedStr(a, P - 1 - X, alt);
            if (!alt) body = stripZeros(body);
          } else {
            let m = digs[0];
            if (P - 1 > 0) m += '.' + digs.slice(1);
            if (!alt) m = stripZeros(m);
            else if (P - 1 === 0) m += '.';
            const ax = Math.abs(X);
            body = m + (upper ? 'E' : 'e') + (X < 0 ? '-' : '+') + (ax < 10 ? '0' + ax : String(ax));
          }
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
