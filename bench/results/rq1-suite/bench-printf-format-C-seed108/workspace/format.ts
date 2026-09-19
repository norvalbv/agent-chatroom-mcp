function decompose(v: number): [bigint, number] {
  // v finite, >= 0 -> [m, e] with v = m * 2^e
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

// round-half-even(v * 10^k) as BigInt
function scaled(m: bigint, e: number, k: number): bigint {
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

// fixed: digits string of round(v*10^prec), split into int and frac
function fixedDigits(v: number, prec: number): [string, string] {
  const [m, e] = decompose(v);
  let s = scaled(m, e, prec).toString();
  if (s.length <= prec) s = '0'.repeat(prec - s.length + 1) + s;
  return [s.slice(0, s.length - prec), s.slice(s.length - prec)];
}

// exponent style: returns [digits (p+1 chars), exponent]
function expDigits(v: number, p: number): [string, number] {
  if (v === 0) return ['0'.repeat(p + 1), 0];
  const [m, e] = decompose(v);
  let X = Math.floor(Math.log10(v));
  if (!isFinite(X)) X = Math.floor((e + 52) * Math.LOG10E * Math.LN2 * 1) ;
  const lowB = 10n ** BigInt(p);
  const highB = lowB * 10n;
  for (let i = 0; i < 2000; i++) {
    const n = scaled(m, e, p - X);
    if (n >= highB) X++;
    else if (n < lowB) X--;
    else return [n.toString(), X];
  }
  throw new Error('exp');
}

function expStr(exp: number, upper: boolean): string {
  const a = Math.abs(exp);
  return (upper ? 'E' : 'e') + (exp < 0 ? '-' : '+') + (a < 10 ? '0' + a : String(a));
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
      const c = fmt[i];
      if (c === '-') minus = true;
      else if (c === '+') plus = true;
      else if (c === ' ') space = true;
      else if (c === '0') zero = true;
      else if (c === '#') alt = true;
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
    let zeroOk = zero && !minus;
    let numeric = true;

    const signFor = (neg: boolean) => (neg ? '-' : plus ? '+' : space ? ' ' : '');

    switch (conv) {
      case 'd':
      case 'i': {
        const b = BigInt(arg as number | bigint);
        sign = signFor(b < 0n);
        body = (b < 0n ? -b : b).toString();
        if (prec === 0 && b === 0n) body = '';
        if (prec >= 0) {
          if (body.length < prec) body = '0'.repeat(prec - body.length) + body;
          zeroOk = false;
        }
        break;
      }
      case 'x':
      case 'X':
      case 'o': {
        const b = BigInt(arg as number | bigint);
        body = b.toString(conv === 'o' ? 8 : 16);
        if (conv === 'X') body = body.toUpperCase();
        if (prec === 0 && b === 0n) body = '';
        if (prec >= 0) {
          if (body.length < prec) body = '0'.repeat(prec - body.length) + body;
          zeroOk = false;
        }
        if (alt) {
          if (conv === 'o') {
            if (body[0] !== '0') body = '0' + body;
          } else if (b !== 0n) prefix = conv === 'x' ? '0x' : '0X';
        }
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
        if (x !== x) {
          body = upper ? 'NAN' : 'nan';
          zeroOk = false;
          break;
        }
        const neg = x < 0 || Object.is(x, -0);
        sign = signFor(neg);
        const v = Math.abs(x);
        if (v === Infinity) {
          body = upper ? 'INF' : 'inf';
          zeroOk = false;
          break;
        }
        const lc = conv.toLowerCase();
        if (lc === 'f') {
          const p = prec < 0 ? 6 : prec;
          const [ip, fp] = fixedDigits(v, p);
          body = ip + (p > 0 || alt ? '.' : '') + fp;
        } else if (lc === 'e') {
          const p = prec < 0 ? 6 : prec;
          const [d, X] = expDigits(v, p);
          body = d[0] + (p > 0 || alt ? '.' : '') + d.slice(1) + expStr(X, upper);
        } else {
          let P = prec < 0 ? 6 : prec === 0 ? 1 : prec;
          const [d, X] = expDigits(v, P - 1);
          let mant: string;
          let suffix = '';
          if (P > X && X >= -4) {
            const [ip, fp] = fixedDigits(v, P - 1 - X);
            mant = ip + (fp.length > 0 ? '.' + fp : '');
          } else {
            mant = d[0] + (d.length > 1 ? '.' + d.slice(1) : '');
            suffix = expStr(X, upper);
          }
          if (alt) {
            if (mant.indexOf('.') < 0) mant += '.';
          } else if (mant.indexOf('.') >= 0) {
            mant = mant.replace(/0+$/, '').replace(/\.$/, '');
          }
          body = mant + suffix;
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
