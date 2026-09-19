function roundDiv(n: bigint, d: bigint): bigint {
  const q = n / d;
  const r = n % d;
  const t = 2n * r;
  if (t > d || (t === d && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// x finite, >= 0. Returns [mantissa, exp2] with x = m * 2^e exactly.
function decompose(x: number): [bigint, number] {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const be = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (be === 0) return [m, -1074];
  m |= 1n << 52n;
  return [m, be - 1075];
}

// round(x * 10^s), half-even, exact
function scaled(x: number, s: number): bigint {
  const [m, e] = decompose(x);
  let num = m;
  let den = 1n;
  if (e >= 0) num <<= BigInt(e);
  else den <<= BigInt(-e);
  if (s >= 0) num *= 10n ** BigInt(s);
  else den *= 10n ** BigInt(-s);
  return roundDiv(num, den);
}

function fixedParts(x: number, p: number): [string, string] {
  let s = scaled(x, p).toString();
  if (p === 0) return [s, ''];
  s = s.padStart(p + 1, '0');
  return [s.slice(0, s.length - p), s.slice(s.length - p)];
}

function expParts(x: number, p: number): [string, number] {
  if (x === 0) return ['0'.repeat(p + 1), 0];
  let k = Math.floor(Math.log10(x));
  const lowB = 10n ** BigInt(p);
  for (let i = 0; i < 10; i++) {
    const d = scaled(x, p - k);
    if (d < lowB) k--;
    else if (d >= lowB * 10n) k++;
    else return [d.toString(), k];
  }
  throw new Error('exponent search failed');
}

function fmtExp(digits: string, k: number, alt: boolean, upper: boolean): string {
  let s = digits[0];
  if (digits.length > 1) s += '.' + digits.slice(1);
  else if (alt) s += '.';
  const ak = Math.abs(k);
  s += (upper ? 'E' : 'e') + (k < 0 ? '-' : '+') + (ak < 10 ? '0' + ak : String(ak));
  return s;
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
    while (i < fmt.length && fmt[i] >= '0' && fmt[i] <= '9') width = width * 10 + Number(fmt[i++]);
    let prec: number | undefined;
    if (fmt[i] === '.') {
      i++;
      prec = 0;
      while (i < fmt.length && fmt[i] >= '0' && fmt[i] <= '9') prec = prec * 10 + Number(fmt[i++]);
    }
    const conv = fmt[i++];
    const arg = args[ai++];

    let sign = '';
    let body = '';
    let numeric = true;
    let canZero = true;
    const lc = conv.toLowerCase();

    if (conv === 's' || conv === 'c') {
      numeric = false;
      body = String(arg);
      if (conv === 's' && prec !== undefined) body = body.slice(0, prec);
    } else if (conv === 'd' || conv === 'i') {
      let v = BigInt(arg as number | bigint);
      sign = v < 0n ? '-' : plus ? '+' : space ? ' ' : '';
      if (v < 0n) v = -v;
      body = prec === 0 && v === 0n ? '' : v.toString();
      if (prec !== undefined) {
        body = body.padStart(prec, '0');
        canZero = false;
      }
    } else if (conv === 'x' || conv === 'X' || conv === 'o') {
      const v = BigInt(arg as number | bigint);
      body = conv === 'o' ? v.toString(8) : v.toString(16);
      if (conv === 'X') body = body.toUpperCase();
      if (prec === 0 && v === 0n) body = '';
      if (prec !== undefined) {
        body = body.padStart(prec, '0');
        canZero = false;
      }
      if (alt) {
        if (conv === 'o') {
          if (body[0] !== '0') body = '0' + body;
        } else if (v !== 0n) {
          sign = conv === 'x' ? '0x' : '0X';
        }
      }
    } else {
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      const v = arg as number;
      const neg = v < 0 || Object.is(v, -0);
      if (Number.isNaN(v)) {
        sign = '';
        body = upper ? 'NAN' : 'nan';
        canZero = false;
      } else {
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        const x = Math.abs(v);
        if (x === Infinity) {
          body = upper ? 'INF' : 'inf';
          canZero = false;
        } else if (lc === 'f') {
          const p = prec ?? 6;
          const [ip, fp] = fixedParts(x, p);
          body = ip + (p > 0 || alt ? '.' : '') + fp;
        } else if (lc === 'e') {
          const p = prec ?? 6;
          const [d, k] = expParts(x, p);
          body = fmtExp(d, k, alt, upper);
        } else {
          const P = prec === undefined ? 6 : prec === 0 ? 1 : prec;
          const [d, X] = expParts(x, P - 1);
          if (P > X && X >= -4) {
            const p = P - 1 - X;
            const [ip, fp] = fixedParts(x, p);
            body = ip + (p > 0 || alt ? '.' : '') + fp;
            if (!alt) body = stripZeros(body);
          } else {
            let dd = d;
            let mant = dd[0] + (dd.length > 1 ? '.' + dd.slice(1) : alt ? '.' : '');
            if (!alt) mant = stripZeros(mant);
            const ak = Math.abs(X);
            body = mant + (upper ? 'E' : 'e') + (X < 0 ? '-' : '+') + (ak < 10 ? '0' + ak : String(ak));
          }
        }
      }
    }

    const len = sign.length + body.length;
    if (len < width) {
      const pad = width - len;
      if (minus) out += sign + body + ' '.repeat(pad);
      else if (zero && numeric && canZero) out += sign + '0'.repeat(pad) + body;
      else out += ' '.repeat(pad) + sign + body;
    } else {
      out += sign + body;
    }
  }
  return out;
}
