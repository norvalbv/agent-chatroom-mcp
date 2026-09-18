function decompose(v: number): [bigint, number] {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, Math.abs(v));
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (expBits === 0) return [m, -1074];
  m |= 1n << 52n;
  return [m, expBits - 1075];
}

// round-half-even of |v| * 10^k
function roundScaled(m: bigint, e: number, k: number): bigint {
  let num = m;
  let den = 1n;
  if (e >= 0) num <<= BigInt(e);
  else den <<= BigInt(-e);
  if (k >= 0) num *= 10n ** BigInt(k);
  else den *= 10n ** BigInt(-k);
  const q = num / den;
  const r = num % den;
  const c = 2n * r;
  if (c > den || (c === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

function fixed(v: number, prec: number, alt: boolean): string {
  const [m, e] = decompose(v);
  let s = roundScaled(m, e, prec).toString();
  if (s.length < prec + 1) s = '0'.repeat(prec + 1 - s.length) + s;
  const ip = s.slice(0, s.length - prec);
  const fp = s.slice(s.length - prec);
  return ip + (prec > 0 || alt ? '.' : '') + fp;
}

function expParts(v: number, prec: number): [string, number] {
  const [m, e] = decompose(v);
  if (m === 0n) return ['0'.repeat(prec + 1), 0];
  let x = Math.floor(Math.log10(Math.abs(v)));
  if (!isFinite(x)) x = -324;
  const lowB = 10n ** BigInt(prec);
  const highB = lowB * 10n;
  for (let i = 0; i < 20; i++) {
    const n = roundScaled(m, e, prec - x);
    if (n >= highB) x++;
    else if (n < lowB) x--;
    else return [n.toString(), x];
  }
  const n = roundScaled(m, e, prec - x);
  return [n.toString(), x];
}

function expo(v: number, prec: number, alt: boolean, upper: boolean): string {
  const [d, x] = expParts(v, prec);
  const ax = Math.abs(x);
  return (
    d[0] + (prec > 0 || alt ? '.' : '') + d.slice(1) +
    (upper ? 'E' : 'e') + (x < 0 ? '-' : '+') + (ax < 10 ? '0' + ax : String(ax))
  );
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
    const ch = fmt[i++];
    if (ch !== '%') {
      out += ch;
      continue;
    }
    if (fmt[i] === '%') {
      out += '%';
      i++;
      continue;
    }
    let left = false, plus = false, space = false, zero = false, alt = false;
    for (; i < fmt.length; i++) {
      const f = fmt[i];
      if (f === '-') left = true;
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
    let canZero = true;

    const signFor = (neg: boolean) => (neg ? '-' : plus ? '+' : space ? ' ' : '');

    switch (conv) {
      case 'd':
      case 'i': {
        const b = BigInt(arg as number | bigint);
        sign = signFor(b < 0n);
        let d = (b < 0n ? -b : b).toString();
        if (prec === 0 && b === 0n) d = '';
        if (prec >= 0) {
          if (d.length < prec) d = '0'.repeat(prec - d.length) + d;
          canZero = false;
        }
        body = d;
        break;
      }
      case 'x':
      case 'X':
      case 'o': {
        const b = BigInt(arg as number | bigint);
        let d = b.toString(conv === 'o' ? 8 : 16);
        if (conv === 'X') d = d.toUpperCase();
        if (prec === 0 && b === 0n) d = '';
        if (prec >= 0) {
          if (d.length < prec) d = '0'.repeat(prec - d.length) + d;
          canZero = false;
        }
        if (alt) {
          if (conv === 'o') {
            if (d[0] !== '0') d = '0' + d;
          } else if (b !== 0n) prefix = conv === 'x' ? '0x' : '0X';
        }
        body = d;
        break;
      }
      case 'e': case 'E': case 'f': case 'F': case 'g': case 'G': {
        const v = arg as number;
        const upper = conv === 'E' || conv === 'F' || conv === 'G';
        if (Number.isNaN(v)) {
          body = upper ? 'NAN' : 'nan';
          canZero = false;
          break;
        }
        const neg = v < 0 || Object.is(v, -0);
        sign = signFor(neg);
        if (!isFinite(v)) {
          body = upper ? 'INF' : 'inf';
          canZero = false;
          break;
        }
        const lc = conv.toLowerCase();
        if (lc === 'f') {
          body = fixed(v, prec < 0 ? 6 : prec, alt);
        } else if (lc === 'e') {
          body = expo(v, prec < 0 ? 6 : prec, alt, upper);
        } else {
          let P = prec < 0 ? 6 : prec;
          if (P === 0) P = 1;
          const X = expParts(v, P - 1)[1];
          if (P > X && X >= -4) {
            body = fixed(v, P - 1 - X, alt);
            if (!alt) body = stripZeros(body);
          } else {
            body = expo(v, P - 1, alt, upper);
            if (!alt) {
              const idx = body.search(/[eE]/);
              body = stripZeros(body.slice(0, idx)) + body.slice(idx);
            }
          }
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
      default:
        throw new Error('bad conversion');
    }

    const len = sign.length + prefix.length + body.length;
    if (len >= width) {
      out += sign + prefix + body;
    } else if (left) {
      out += sign + prefix + body + ' '.repeat(width - len);
    } else if (numeric && zero && canZero) {
      out += sign + prefix + '0'.repeat(width - len) + body;
    } else {
      out += ' '.repeat(width - len) + sign + prefix + body;
    }
  }
  return out;
}
