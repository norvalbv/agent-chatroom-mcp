function decompose(x: number): [bigint, number] {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (expBits === 0) return [m, -1074];
  m |= 1n << 52n;
  return [m, expBits - 1075];
}

// round(m * 2^e * 10^k), ties to even
function roundScaled(m: bigint, e: number, k: number): bigint {
  let num = m;
  let den = 1n;
  if (e >= 0) num <<= BigInt(e);
  else den <<= BigInt(-e);
  if (k >= 0) num *= 10n ** BigInt(k);
  else den *= 10n ** BigInt(-k);
  let q = num / den;
  const twice = (num % den) * 2n;
  if (twice > den || (twice === den && (q & 1n) === 1n)) q++;
  return q;
}

function fixedStyle(abs: number, prec: number, alt: boolean): string {
  const [m, e] = decompose(abs);
  let s = roundScaled(m, e, prec).toString();
  if (prec > 0) {
    s = s.padStart(prec + 1, '0');
    return s.slice(0, s.length - prec) + '.' + s.slice(s.length - prec);
  }
  return alt ? s + '.' : s;
}

function expInfo(abs: number, p: number): { digits: string; x: number } {
  if (abs === 0) return { digits: '0'.repeat(p + 1), x: 0 };
  const [m, e] = decompose(abs);
  let x = Math.floor(Math.log10(abs));
  if (!isFinite(x)) x = -324;
  const hiLim = 10n ** BigInt(p + 1);
  const loLim = 10n ** BigInt(p);
  for (let i = 0; i < 10; i++) {
    const d = roundScaled(m, e, p - x);
    if (d >= hiLim) x++;
    else if (d < loLim) x--;
    else return { digits: d.toString(), x };
  }
  throw new Error('exp');
}

function expStyle(abs: number, prec: number, alt: boolean, upper: boolean): string {
  const { digits, x } = expInfo(abs, prec);
  let s = digits[0];
  if (prec > 0) s += '.' + digits.slice(1);
  else if (alt) s += '.';
  const ax = Math.abs(x);
  s += (upper ? 'E' : 'e') + (x < 0 ? '-' : '+') + (ax < 10 ? '0' : '') + ax;
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
    let prefix = '';
    let body = '';
    let canZero = true;
    const posSign = plus ? '+' : space ? ' ' : '';

    if (conv === 'd' || conv === 'i') {
      const v = BigInt(arg as number | bigint);
      sign = v < 0n ? '-' : posSign;
      body = (v < 0n ? -v : v).toString();
      if (prec !== undefined) {
        if (prec === 0 && v === 0n) body = '';
        body = body.padStart(prec, '0');
        canZero = false;
      }
    } else if (conv === 'x' || conv === 'X' || conv === 'o') {
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
          if (!body.startsWith('0')) body = '0' + body;
        } else if (v !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      }
    } else if ('eEfFgG'.includes(conv)) {
      const v = arg as number;
      const upper = conv === conv.toUpperCase();
      const neg = v < 0 || Object.is(v, -0);
      if (Number.isNaN(v)) {
        sign = '';
        body = upper ? 'NAN' : 'nan';
        canZero = false;
      } else {
        sign = neg ? '-' : posSign;
        const abs = Math.abs(v);
        if (!isFinite(abs)) {
          body = upper ? 'INF' : 'inf';
          canZero = false;
        } else {
          const lc = conv.toLowerCase();
          if (lc === 'f') body = fixedStyle(abs, prec ?? 6, alt);
          else if (lc === 'e') body = expStyle(abs, prec ?? 6, alt, upper);
          else {
            const P = prec === undefined ? 6 : prec === 0 ? 1 : prec;
            const { x } = expInfo(abs, P - 1);
            if (P > x && x >= -4) {
              body = fixedStyle(abs, P - 1 - x, alt);
              if (!alt) body = stripZeros(body);
            } else {
              body = expStyle(abs, P - 1, alt, upper);
              if (!alt) {
                const k = body.search(/[eE]/);
                body = stripZeros(body.slice(0, k)) + body.slice(k);
              }
            }
          }
        }
      }
    } else if (conv === 's') {
      body = String(arg);
      if (prec !== undefined) body = body.slice(0, prec);
      canZero = false;
    } else if (conv === 'c') {
      body = String(arg);
      canZero = false;
    }

    const len = sign.length + prefix.length + body.length;
    if (len < width) {
      const pad = width - len;
      if (minus) out += sign + prefix + body + ' '.repeat(pad);
      else if (zero && canZero) out += sign + prefix + '0'.repeat(pad) + body;
      else out += ' '.repeat(pad) + sign + prefix + body;
    } else out += sign + prefix + body;
  }
  return out;
}
