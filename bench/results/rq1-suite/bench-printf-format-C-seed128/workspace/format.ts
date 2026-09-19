const pow10 = (n: number): bigint => 10n ** BigInt(n);

// round num/den (both positive, den > 0) to nearest integer, ties to even
function roundDiv(num: bigint, den: bigint): bigint {
  const q = num / den;
  const r2 = (num % den) * 2n;
  if (r2 > den || (r2 === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// exact rational of |x| (finite): [num, den]
function toRational(x: number): [bigint, bigint] {
  x = Math.abs(x);
  if (x === 0) return [0n, 1n];
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, x);
  const hi = buf.getUint32(0);
  const lo = buf.getUint32(4);
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

// round(num/den * 10^k) for any integer k
function scaledRound(num: bigint, den: bigint, k: number): bigint {
  return k >= 0 ? roundDiv(num * pow10(k), den) : roundDiv(num, den * pow10(-k));
}

function fixedDigits(x: number, prec: number): string {
  const [n, d] = toRational(x);
  return scaledRound(n, d, prec).toString();
}

// returns digits string (prec+1 digits) and decimal exponent
function expDigits(x: number, prec: number): [string, number] {
  const [n, d] = toRational(x);
  if (n === 0n) return ['0'.repeat(prec + 1), 0];
  let X = Math.floor(Math.log10(Math.abs(x)));
  if (!isFinite(X)) X = -324;
  const ge = (k: number) => (k >= 0 ? n >= d * pow10(k) : n * pow10(-k) >= d); // |x| >= 10^k
  while (!ge(X)) X--;
  while (ge(X + 1)) X++;
  let digits = scaledRound(n, d, prec - X);
  if (digits >= pow10(prec + 1)) {
    X++;
    digits = scaledRound(n, d, prec - X);
  }
  return [digits.toString(), X];
}

function fmtFixed(x: number, prec: number, alt: boolean): string {
  let s = fixedDigits(x, prec);
  if (prec > 0) {
    s = s.padStart(prec + 1, '0');
    s = s.slice(0, s.length - prec) + '.' + s.slice(s.length - prec);
  } else if (alt) s += '.';
  return s;
}

function fmtExp(x: number, prec: number, alt: boolean, upper: boolean): string {
  const [digits, X] = expDigits(x, prec);
  let s = digits[0];
  if (prec > 0) s += '.' + digits.slice(1);
  else if (alt) s += '.';
  const ax = Math.abs(X);
  return s + (upper ? 'E' : 'e') + (X < 0 ? '-' : '+') + (ax < 10 ? '0' + ax : String(ax));
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
    let zeroOk = true;

    switch (conv) {
      case 'd':
      case 'i': {
        const v = typeof arg === 'bigint' ? arg : BigInt(arg as number);
        sign = v < 0n ? '-' : plus ? '+' : space ? ' ' : '';
        body = (v < 0n ? -v : v).toString();
        if (prec === 0 && v === 0n) body = '';
        if (prec >= 0) {
          body = body.padStart(prec, '0');
          zeroOk = false;
        }
        break;
      }
      case 'x':
      case 'X':
      case 'o': {
        const v = typeof arg === 'bigint' ? arg : BigInt(arg as number);
        body = v.toString(conv === 'o' ? 8 : 16);
        if (conv === 'X') body = body.toUpperCase();
        if (prec === 0 && v === 0n) body = '';
        if (prec >= 0) {
          body = body.padStart(prec, '0');
          zeroOk = false;
        }
        if (alt) {
          if (conv === 'o') {
            if (body[0] !== '0') body = '0' + body;
          } else if (v !== 0n) prefix = conv === 'x' ? '0x' : '0X';
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
        if (Number.isNaN(x)) {
          body = upper ? 'NAN' : 'nan';
          zeroOk = false;
          break;
        }
        const neg = x < 0 || Object.is(x, -0);
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        if (!isFinite(x)) {
          body = upper ? 'INF' : 'inf';
          zeroOk = false;
          break;
        }
        const lc = conv.toLowerCase();
        if (lc === 'f') {
          body = fmtFixed(x, prec < 0 ? 6 : prec, alt);
        } else if (lc === 'e') {
          body = fmtExp(x, prec < 0 ? 6 : prec, alt, upper);
        } else {
          const P = prec < 0 ? 6 : prec === 0 ? 1 : prec;
          const X = expDigits(x, P - 1)[1];
          if (P > X && X >= -4) {
            body = fmtFixed(x, P - 1 - X, alt);
            if (!alt) body = stripZeros(body);
          } else {
            body = fmtExp(x, P - 1, alt, upper);
            if (!alt) {
              const m = body.match(/^([^eE]*)([eE].*)$/)!;
              body = stripZeros(m[1]) + m[2];
            }
          }
        }
        break;
      }
      case 's': {
        body = String(arg);
        if (prec >= 0) body = body.slice(0, prec);
        zeroOk = false;
        break;
      }
      case 'c': {
        body = String(arg);
        zeroOk = false;
        break;
      }
    }

    const len = sign.length + prefix.length + body.length;
    if (len >= width) out += sign + prefix + body;
    else if (minus) out += sign + prefix + body + ' '.repeat(width - len);
    else if (zero && zeroOk && conv !== 's' && conv !== 'c') out += sign + prefix + '0'.repeat(width - len) + body;
    else out += ' '.repeat(width - len) + sign + prefix + body;
  }
  return out;
}
