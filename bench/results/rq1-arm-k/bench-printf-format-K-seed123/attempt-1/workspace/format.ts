function roundDiv(a: bigint, b: bigint): bigint {
  const q = a / b;
  const r = a % b;
  const t = r * 2n;
  if (t > b || (t === b && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// exact rational of a positive finite double
function toRational(v: number): [bigint, bigint] {
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

// round(v * 10^k) half-even
function scaled(r: [bigint, bigint], k: number): bigint {
  const [n, d] = r;
  if (k >= 0) return roundDiv(n * 10n ** BigInt(k), d);
  return roundDiv(n, d * 10n ** BigInt(-k));
}

function fixedDigits(v: number, prec: number): string {
  if (v === 0) return '0'.repeat(prec + 1);
  let s = scaled(toRational(v), prec).toString();
  if (s.length < prec + 1) s = '0'.repeat(prec + 1 - s.length) + s;
  return s;
}

// returns digits (p+1 of them) and exponent
function expDigits(v: number, p: number): [string, number] {
  if (v === 0) return ['0'.repeat(p + 1), 0];
  const r = toRational(v);
  let X = Math.floor(Math.log10(v));
  if (!Number.isFinite(X)) X = -324;
  // adjust so that 10^X <= v < 10^(X+1)
  const ge = (x: number) => {
    // v >= 10^x
    const [n, d] = r;
    return x >= 0 ? n >= d * 10n ** BigInt(x) : n * 10n ** BigInt(-x) >= d;
  };
  while (!ge(X)) X--;
  while (ge(X + 1)) X++;
  let N = scaled(r, p - X);
  if (N >= 10n ** BigInt(p + 1)) {
    X++;
    N = scaled(r, p - X);
  }
  return [N.toString(), X];
}

function fmtE(v: number, p: number, alt: boolean, upper: boolean): string {
  const [d, X] = expDigits(v, p);
  let s = d[0];
  if (p > 0 || alt) s += '.';
  s += d.slice(1);
  const ax = Math.abs(X);
  s += (upper ? 'E' : 'e') + (X < 0 ? '-' : '+') + (ax < 10 ? '0' + ax : String(ax));
  return s;
}

function fmtF(v: number, p: number, alt: boolean): string {
  const s = fixedDigits(v, p);
  const ip = s.slice(0, s.length - p);
  const fp = s.slice(s.length - p);
  return ip + (p > 0 || alt ? '.' : '') + fp;
}

function stripZeros(s: string): string {
  // s has a '.' possibly; strip trailing zeros of fraction (before any exponent)
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
    for (;; i++) {
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
    let numeric = true;
    let canZero = true;

    const signFor = (neg: boolean) => (neg ? '-' : plus ? '+' : space ? ' ' : '');

    if (conv === 'd' || conv === 'i') {
      const b = BigInt(arg as number | bigint);
      sign = signFor(b < 0n);
      body = (b < 0n ? -b : b).toString();
      if (prec >= 0) {
        if (prec === 0 && b === 0n) body = '';
        body = body.padStart(prec, '0');
        canZero = false;
      }
    } else if (conv === 'x' || conv === 'X' || conv === 'o') {
      const b = BigInt(arg as number | bigint);
      body = b.toString(conv === 'o' ? 8 : 16);
      if (conv === 'X') body = body.toUpperCase();
      if (prec >= 0) {
        if (prec === 0 && b === 0n) body = '';
        body = body.padStart(prec, '0');
        canZero = false;
      }
      if (alt) {
        if (conv === 'o') {
          if (!body.startsWith('0')) body = '0' + body;
        } else if (b !== 0n) {
          prefix = conv === 'x' ? '0x' : '0X';
        }
      }
    } else if ('eEfFgG'.includes(conv)) {
      const v = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      if (Number.isNaN(v)) {
        body = upper ? 'NAN' : 'nan';
        canZero = false;
      } else {
        sign = signFor(v < 0 || Object.is(v, -0));
        const a = Math.abs(v);
        if (!Number.isFinite(a)) {
          body = upper ? 'INF' : 'inf';
          canZero = false;
        } else if (conv === 'e' || conv === 'E') {
          body = fmtE(a, prec < 0 ? 6 : prec, alt, upper);
        } else if (conv === 'f' || conv === 'F') {
          body = fmtF(a, prec < 0 ? 6 : prec, alt);
        } else {
          let P = prec < 0 ? 6 : prec;
          if (P === 0) P = 1;
          const X = expDigits(a, P - 1)[1];
          if (P > X && X >= -4) body = fmtF(a, P - 1 - X, alt);
          else body = fmtE(a, P - 1, alt, upper);
          if (!alt) body = stripZeros(body);
        }
      }
    } else if (conv === 's') {
      numeric = false;
      body = String(arg);
      if (prec >= 0) body = body.slice(0, prec);
    } else {
      numeric = false;
      body = String(arg);
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
