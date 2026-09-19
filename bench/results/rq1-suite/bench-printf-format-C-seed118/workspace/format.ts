// x = m * 2^e2 exactly, for a finite positive double
function decompose(x: number): [bigint, number] {
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, x);
  const bits = buf.getBigUint64(0);
  const expBits = Number((bits >> 52n) & 0x7ffn);
  const frac = bits & ((1n << 52n) - 1n);
  if (expBits === 0) return [frac, -1074];
  return [frac | (1n << 52n), expBits - 1075];
}

// round-half-even (or floor) of x * 10^k as a bigint
function scaled(x: number, k: number, floorOnly = false): bigint {
  const [m, e2] = decompose(x);
  let num = m;
  let den = 1n;
  if (e2 >= 0) num <<= BigInt(e2);
  else den <<= BigInt(-e2);
  if (k >= 0) num *= 10n ** BigInt(k);
  else den *= 10n ** BigInt(-k);
  const q = num / den;
  if (floorOnly) return q;
  const r2 = (num % den) * 2n;
  if (r2 > den || (r2 === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// digits (prec+1 of them) and decimal exponent of positive x, rounded
function sci(x: number, prec: number): [string, number] {
  if (x === 0) return ['0'.repeat(prec + 1), 0];
  let X = Math.floor(Math.log10(x));
  if (!Number.isFinite(X)) X = 0;
  for (;;) {
    const n = scaled(x, -X, true);
    if (n === 0n) X--;
    else if (n >= 10n) X++;
    else break;
  }
  let n = scaled(x, prec - X);
  if (n >= 10n ** BigInt(prec + 1)) {
    X++;
    n = scaled(x, prec - X);
  }
  return [n.toString(), X];
}

function fixed(x: number, prec: number, alt: boolean): string {
  let s = scaled(x, prec).toString();
  if (prec > 0) {
    s = s.padStart(prec + 1, '0');
    s = s.slice(0, s.length - prec) + '.' + s.slice(s.length - prec);
  } else if (alt) s += '.';
  return s;
}

function expStyle(digits: string, X: number, prec: number, alt: boolean, upper: boolean): string {
  let s = digits[0];
  if (prec > 0) s += '.' + digits.slice(1);
  else if (alt) s += '.';
  const a = Math.abs(X);
  s += (upper ? 'E' : 'e') + (X < 0 ? '-' : '+') + (a < 10 ? '0' + a : String(a));
  return s;
}

function stripZeros(s: string): string {
  // s has a '.' in the mantissa part; strip before any exponent
  const ei = s.search(/[eE]/);
  let mant = ei >= 0 ? s.slice(0, ei) : s;
  const rest = ei >= 0 ? s.slice(ei) : '';
  if (mant.includes('.')) {
    mant = mant.replace(/0+$/, '');
    if (mant.endsWith('.')) mant = mant.slice(0, -1);
  }
  return mant + rest;
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
    while (i < fmt.length && fmt[i] >= '0' && fmt[i] <= '9') width = width * 10 + Number(fmt[i++]);
    let prec = -1;
    if (fmt[i] === '.') {
      i++;
      prec = 0;
      while (i < fmt.length && fmt[i] >= '0' && fmt[i] <= '9') prec = prec * 10 + Number(fmt[i++]);
    }
    const conv = fmt[i++];
    const arg = args[ai++];

    let sign = '';
    let prefix = '';
    let body = '';
    let numeric = true;
    let canZero = zero && !minus;

    if (conv === 's' || conv === 'c') {
      numeric = false;
      body = String(arg);
      if (conv === 's' && prec >= 0) body = body.slice(0, prec);
    } else if (conv === 'd' || conv === 'i' || conv === 'x' || conv === 'X' || conv === 'o') {
      const v = BigInt(arg as number | bigint);
      const neg = v < 0n;
      const mag = neg ? -v : v;
      if (conv === 'd' || conv === 'i') {
        body = mag.toString();
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
      } else if (conv === 'o') body = mag.toString(8);
      else {
        body = mag.toString(16);
        if (conv === 'X') body = body.toUpperCase();
      }
      if (prec >= 0) {
        if (prec === 0 && mag === 0n) body = '';
        body = body.padStart(prec, '0');
        canZero = false;
      }
      if (conv === 'o' && alt && !body.startsWith('0')) body = '0' + body;
      if ((conv === 'x' || conv === 'X') && alt && mag !== 0n) prefix = conv === 'x' ? '0x' : '0X';
    } else {
      const v = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      const neg = v < 0 || Object.is(v, -0);
      if (Number.isNaN(v)) {
        body = upper ? 'NAN' : 'nan';
        canZero = false;
      } else {
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        const x = Math.abs(v);
        if (x === Infinity) {
          body = upper ? 'INF' : 'inf';
          canZero = false;
        } else if (conv === 'f' || conv === 'F') {
          body = fixed(x, prec < 0 ? 6 : prec, alt);
        } else if (conv === 'e' || conv === 'E') {
          const p = prec < 0 ? 6 : prec;
          const [d, X] = sci(x, p);
          body = expStyle(d, X, p, alt, upper);
        } else {
          let P = prec < 0 ? 6 : prec;
          if (P === 0) P = 1;
          const [d, X] = sci(x, P - 1);
          if (P > X && X >= -4) body = fixed(x, P - 1 - X, alt);
          else body = expStyle(d, X, P - 1, alt, upper);
          if (!alt) body = stripZeros(body);
        }
      }
    }

    let text = sign + prefix + body;
    if (text.length < width) {
      const pad = width - text.length;
      if (minus) text += ' '.repeat(pad);
      else if (numeric && canZero) text = sign + prefix + '0'.repeat(pad) + body;
      else text = ' '.repeat(pad) + text;
    }
    out += text;
  }
  return out;
}
