function roundDiv(n: bigint, d: bigint): bigint {
  const q = n / d;
  const r = n % d;
  const twice = r * 2n;
  if (twice > d || (twice === d && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// exact abs value as N/D
function toRatio(x: number): [bigint, bigint] {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, Math.abs(x));
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

function pow10(n: number): bigint {
  return 10n ** BigInt(n);
}

function scaled(N: bigint, D: bigint, s: number): bigint {
  return s >= 0 ? roundDiv(N * pow10(s), D) : roundDiv(N, D * pow10(-s));
}

// fixed notation of |x| with p fraction digits
function fixedStr(x: number, p: number, alt: boolean): string {
  const [N, D] = toRatio(x);
  let s = scaled(N, D, p).toString();
  if (p > 0) {
    s = s.padStart(p + 1, '0');
    return s.slice(0, s.length - p) + '.' + s.slice(s.length - p);
  }
  return alt ? s + '.' : s;
}

// returns digits (p+1 digits) and decimal exponent
function expParts(x: number, p: number): [string, number] {
  const [N, D] = toRatio(x);
  if (N === 0n) return ['0'.repeat(p + 1), 0];
  let X = Math.floor(Math.log10(Math.abs(x)));
  if (!isFinite(X)) X = -324;
  const lo = pow10(p);
  const hi = pow10(p + 1);
  for (let i = 0; i < 10; i++) {
    const d = scaled(N, D, p - X);
    if (d >= hi) X++;
    else if (d < lo) X--;
    else return [d.toString(), X];
  }
  throw new Error('exp');
}

function expStr(x: number, p: number, alt: boolean, upper: boolean): string {
  const [digs, X] = expParts(x, p);
  let s = digs[0];
  if (p > 0) s += '.' + digs.slice(1);
  else if (alt) s += '.';
  const ax = Math.abs(X);
  return s + (upper ? 'E' : 'e') + (X < 0 ? '-' : '+') + (ax < 10 ? '0' : '') + ax;
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
    let body = '';
    let numeric = true;
    let zeroOk = true;
    const lc = conv.toLowerCase();

    if (conv === 'd' || conv === 'i') {
      const v = BigInt(arg as number | bigint);
      const neg = v < 0n;
      let digits = (neg ? -v : v).toString();
      if (prec === 0 && v === 0n) digits = '';
      if (prec > 0) digits = digits.padStart(prec, '0');
      sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
      body = digits;
      if (prec >= 0) zeroOk = false;
    } else if (conv === 'x' || conv === 'X' || conv === 'o') {
      const v = BigInt(arg as number | bigint);
      let digits = v.toString(conv === 'o' ? 8 : 16);
      if (conv === 'X') digits = digits.toUpperCase();
      if (prec === 0 && v === 0n) digits = '';
      if (prec > 0) digits = digits.padStart(prec, '0');
      if (alt) {
        if (conv === 'o') {
          if (digits[0] !== '0') digits = '0' + digits;
        } else if (v !== 0n) {
          sign = conv === 'x' ? '0x' : '0X';
        }
      }
      body = digits;
      if (prec >= 0) zeroOk = false;
    } else if ('efg'.includes(lc)) {
      const x = arg as number;
      const upper = conv !== lc;
      const negBit = x < 0 || Object.is(x, -0);
      if (Number.isNaN(x)) {
        body = upper ? 'NAN' : 'nan';
        zeroOk = false;
      } else {
        sign = negBit ? '-' : plus ? '+' : space ? ' ' : '';
        if (!isFinite(x)) {
          body = upper ? 'INF' : 'inf';
          zeroOk = false;
        } else if (lc === 'f') {
          body = fixedStr(x, prec < 0 ? 6 : prec, alt);
        } else if (lc === 'e') {
          body = expStr(x, prec < 0 ? 6 : prec, alt, upper);
        } else {
          const P = prec < 0 ? 6 : prec === 0 ? 1 : prec;
          const X = expParts(x, P - 1)[1];
          let s: string;
          if (P > X && X >= -4) {
            s = fixedStr(x, P - 1 - X, alt);
            if (!alt && s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
          } else {
            s = expStr(x, P - 1, alt, upper);
            if (!alt) {
              const m = s.match(/^([^eE]*)([eE].*)$/)!;
              let mant = m[1];
              if (mant.includes('.')) mant = mant.replace(/0+$/, '').replace(/\.$/, '');
              s = mant + m[2];
            }
          }
          body = s;
        }
      }
    } else if (conv === 's') {
      numeric = false;
      body = String(arg);
      if (prec >= 0) body = body.slice(0, prec);
    } else if (conv === 'c') {
      numeric = false;
      body = String(arg);
    }

    const len = sign.length + body.length;
    if (len >= width) out += sign + body;
    else if (minus) out += sign + body + ' '.repeat(width - len);
    else if (numeric && zero && zeroOk) out += sign + '0'.repeat(width - len) + body;
    else out += ' '.repeat(width - len) + sign + body;
  }
  return out;
}
