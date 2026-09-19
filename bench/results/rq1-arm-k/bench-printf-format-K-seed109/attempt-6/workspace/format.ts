function decompose(x: number): [bigint, number] {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  const frac = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (expBits === 0) return [frac, -1074];
  return [frac | (1n << 52n), expBits - 1075];
}

// x = m * 2^e; returns [N, D] with x * 10^s = N / D
function scaled(m: bigint, e: number, s: number): [bigint, bigint] {
  let n = m;
  let d = 1n;
  if (e >= 0) n <<= BigInt(e);
  else d <<= BigInt(-e);
  if (s >= 0) n *= 10n ** BigInt(s);
  else d *= 10n ** BigInt(-s);
  return [n, d];
}

function roundScaled(m: bigint, e: number, s: number): bigint {
  const [n, d] = scaled(m, e, s);
  let q = n / d;
  const r2 = (n % d) * 2n;
  if (r2 > d || (r2 === d && (q & 1n) === 1n)) q += 1n;
  return q;
}

function floorScaled(m: bigint, e: number, s: number): bigint {
  const [n, d] = scaled(m, e, s);
  return n / d;
}

// abs finite value; returns digit string (p+1 digits) and exponent
function expStyle(x: number, p: number): [string, number] {
  if (x === 0) return ['0'.repeat(p + 1), 0];
  const [m, e] = decompose(x);
  let k = Math.floor(Math.log10(x));
  if (!Number.isFinite(k)) k = 0;
  while (floorScaled(m, e, -k) >= 10n) k++;
  while (floorScaled(m, e, -k) === 0n) k--;
  let digits = roundScaled(m, e, p - k);
  if (digits >= 10n ** BigInt(p + 1)) {
    k++;
    digits = roundScaled(m, e, p - k);
  }
  return [digits.toString(), k];
}

function fixedStyle(x: number, p: number): string {
  let s: string;
  if (x === 0) s = '0'.repeat(p + 1);
  else {
    const [m, e] = decompose(x);
    s = roundScaled(m, e, p).toString();
  }
  if (s.length < p + 1) s = '0'.repeat(p + 1 - s.length) + s;
  return p === 0 ? s : s.slice(0, s.length - p) + '.' + s.slice(s.length - p);
}

function fmtE(x: number, p: number, alt: boolean, upper: boolean): string {
  const [d, k] = expStyle(x, p);
  let out = d[0];
  if (p > 0) out += '.' + d.slice(1);
  else if (alt) out += '.';
  const ak = Math.abs(k);
  out += (upper ? 'E' : 'e') + (k < 0 ? '-' : '+') + (ak < 10 ? '0' : '') + ak;
  return out;
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
    let prec = -1;
    if (fmt[i] === '.') {
      i++;
      prec = 0;
      while (i < fmt.length && fmt[i] >= '0' && fmt[i] <= '9') prec = prec * 10 + Number(fmt[i++]);
    }
    const conv = fmt[i++];
    const arg = args[ai++];

    let sign = '';
    let body = '';
    let canZero = true;
    const signFor = (neg: boolean) => (neg ? '-' : plus ? '+' : space ? ' ' : '');

    if (conv === 's' || conv === 'c') {
      body = String(arg);
      if (conv === 's' && prec >= 0) body = body.slice(0, prec);
      canZero = false;
    } else if (conv === 'd' || conv === 'i') {
      const v = BigInt(arg as number | bigint);
      sign = signFor(v < 0n);
      body = (v < 0n ? -v : v).toString();
      if (prec === 0 && v === 0n) body = '';
      if (prec >= 0) {
        body = body.padStart(prec, '0');
        canZero = false;
      }
    } else if (conv === 'x' || conv === 'X' || conv === 'o') {
      const v = BigInt(arg as number | bigint);
      body = v.toString(conv === 'o' ? 8 : 16);
      if (conv === 'X') body = body.toUpperCase();
      if (prec === 0 && v === 0n) body = '';
      if (prec >= 0) {
        body = body.padStart(prec, '0');
        canZero = false;
      }
      if (alt) {
        if (conv === 'o') {
          if (body[0] !== '0') body = '0' + body;
        } else if (v !== 0n) sign = conv === 'x' ? '0x' : '0X';
      }
    } else {
      const v = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      if (Number.isNaN(v)) {
        body = upper ? 'NAN' : 'nan';
        canZero = false;
      } else {
        const neg = v < 0 || Object.is(v, -0);
        sign = signFor(neg);
        const a = Math.abs(v);
        if (a === Infinity) {
          body = upper ? 'INF' : 'inf';
          canZero = false;
        } else {
          const lc = conv.toLowerCase();
          if (lc === 'e') {
            body = fmtE(a, prec < 0 ? 6 : prec, alt, upper);
          } else if (lc === 'f') {
            const p = prec < 0 ? 6 : prec;
            body = fixedStyle(a, p);
            if (p === 0 && alt) body += '.';
          } else {
            let P = prec < 0 ? 6 : prec;
            if (P === 0) P = 1;
            const X = expStyle(a, P - 1)[1];
            if (P > X && X >= -4) {
              const p = P - 1 - X;
              body = fixedStyle(a, p);
              if (alt) {
                if (p === 0) body += '.';
              } else body = stripZeros(body);
            } else {
              body = fmtE(a, P - 1, alt, upper);
              if (!alt) {
                const idx = body.search(/[eE]/);
                body = stripZeros(body.slice(0, idx)) + body.slice(idx);
              }
            }
          }
        }
      }
    }

    const len = sign.length + body.length;
    if (len < width) {
      const pad = width - len;
      if (minus) out += sign + body + ' '.repeat(pad);
      else if (zero && canZero) out += sign + '0'.repeat(pad) + body;
      else out += ' '.repeat(pad) + sign + body;
    } else out += sign + body;
  }
  return out;
}
