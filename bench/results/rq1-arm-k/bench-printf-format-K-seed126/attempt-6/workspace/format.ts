// value = m * 2^e exactly, for finite non-negative x
function decompose(x: number): [bigint, number] {
  if (x === 0) return [0n, 0];
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, x);
  const hi = buf.getUint32(0);
  const lo = buf.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  let mant = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (expBits === 0) return [mant, -1074];
  mant |= 1n << 52n;
  return [mant, expBits - 1075];
}

// round(m * 2^e * 10^p) half-even, p may be negative
function roundScaled(m: bigint, e: number, p: number): bigint {
  let num = m;
  let den = 1n;
  if (e >= 0) num <<= BigInt(e);
  else den <<= BigInt(-e);
  if (p >= 0) num *= 10n ** BigInt(p);
  else den *= 10n ** BigInt(-p);
  const q = num / den;
  const r2 = (num % den) * 2n;
  if (r2 > den || (r2 === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

function fixedDigits(x: number, prec: number): string {
  const [m, e] = decompose(x);
  return roundScaled(m, e, prec).toString();
}

// returns digit string of prec+1 digits and decimal exponent
function expDigits(x: number, prec: number): [string, number] {
  if (x === 0) return ['0'.repeat(prec + 1), 0];
  const [m, e] = decompose(x);
  let k = Math.floor(Math.log10(x));
  if (!isFinite(k)) k = -324;
  const lowB = 10n ** BigInt(prec);
  for (;;) {
    const s = roundScaled(m, e, prec - k);
    if (s >= lowB * 10n) k++;
    else if (s < lowB) k--;
    else return [s.toString(), k];
  }
}

function fmtExp(x: number, prec: number, alt: boolean, upper: boolean): string {
  const [d, k] = expDigits(x, prec);
  let s = d[0];
  if (prec > 0 || alt) s += '.';
  s += d.slice(1);
  const ak = Math.abs(k);
  return s + (upper ? 'E' : 'e') + (k < 0 ? '-' : '+') + (ak < 10 ? '0' : '') + ak;
}

function fmtFixed(x: number, prec: number, alt: boolean): string {
  let d = fixedDigits(x, prec);
  if (d.length <= prec) d = '0'.repeat(prec - d.length + 1) + d;
  const ip = d.slice(0, d.length - prec);
  const fp = d.slice(d.length - prec);
  return ip + (prec > 0 || alt ? '.' : '') + fp;
}

function stripZeros(s: string): string {
  // s has form int[.frac] optionally followed by exponent part
  const ei = s.search(/[eE]/);
  let mant = ei >= 0 ? s.slice(0, ei) : s;
  const ex = ei >= 0 ? s.slice(ei) : '';
  if (mant.includes('.')) mant = mant.replace(/0+$/, '').replace(/\.$/, '');
  return mant + ex;
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
    let canZero = true;
    const lower = conv.toLowerCase();

    if (conv === 's' || conv === 'c') {
      body = String(arg);
      if (conv === 's' && prec >= 0) body = body.slice(0, prec);
      canZero = false;
    } else if (conv === 'd' || conv === 'i') {
      const v = BigInt(arg as number | bigint);
      const neg = v < 0n;
      body = (neg ? -v : v).toString();
      if (prec >= 0) {
        if (prec === 0 && v === 0n) body = '';
        body = body.padStart(prec, '0');
        canZero = false;
      }
      sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
    } else if (conv === 'x' || conv === 'X' || conv === 'o') {
      const v = BigInt(arg as number | bigint);
      body = v.toString(conv === 'o' ? 8 : 16);
      if (conv === 'X') body = body.toUpperCase();
      if (prec >= 0) {
        if (prec === 0 && v === 0n) body = '';
        body = body.padStart(prec, '0');
        canZero = false;
      }
      if (alt) {
        if (conv === 'o') {
          if (!body.startsWith('0')) body = '0' + body;
        } else if (v !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      }
    } else {
      const x = arg as number;
      const upper = conv === conv.toUpperCase();
      const neg = x < 0 || Object.is(x, -0);
      if (Number.isNaN(x)) {
        body = upper ? 'NAN' : 'nan';
        canZero = false;
      } else {
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        const ax = Math.abs(x);
        if (ax === Infinity) {
          body = upper ? 'INF' : 'inf';
          canZero = false;
        } else if (lower === 'e') {
          body = fmtExp(ax, prec < 0 ? 6 : prec, alt, upper);
        } else if (lower === 'f') {
          body = fmtFixed(ax, prec < 0 ? 6 : prec, alt);
        } else {
          let P = prec < 0 ? 6 : prec;
          if (P === 0) P = 1;
          const X = expDigits(ax, P - 1)[1];
          if (P > X && X >= -4) {
            body = fmtFixed(ax, P - 1 - X, alt);
          } else {
            body = fmtExp(ax, P - 1, alt, upper);
          }
          if (!alt) body = stripZeros(body);
        }
      }
    }

    const len = sign.length + prefix.length + body.length;
    if (len >= width) out += sign + prefix + body;
    else if (minus) out += sign + prefix + body + ' '.repeat(width - len);
    else if (zero && canZero && lower !== 's' && conv !== 'c') {
      out += sign + prefix + '0'.repeat(width - len) + body;
    } else out += ' '.repeat(width - len) + sign + prefix + body;
  }
  return out;
}
