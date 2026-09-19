function decompose(v: number): { m: bigint; e: number } {
  // v >= 0 finite; v = m * 2^e exactly
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, v);
  const hi = buf.getUint32(0);
  const lo = buf.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (expBits === 0) return { m, e: -1074 };
  m |= 1n << 52n;
  return { m, e: expBits - 1075 };
}

// round_half_even(v * 10^k) exactly
function scaledRound(v: number, k: number): bigint {
  const { m, e } = decompose(v);
  let num = m;
  let den = 1n;
  if (e >= 0) num <<= BigInt(e);
  else den <<= BigInt(-e);
  if (k >= 0) num *= 10n ** BigInt(k);
  else den *= 10n ** BigInt(-k);
  const q = num / den;
  const r = num % den;
  const twice = r * 2n;
  if (twice > den || (twice === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

function fixed(v: number, prec: number, alt: boolean): string {
  const s = scaledRound(v, prec).toString().padStart(prec + 1, '0');
  if (prec === 0) return alt ? s + '.' : s;
  return s.slice(0, s.length - prec) + '.' + s.slice(s.length - prec);
}

// digits string of length prec+1 and exponent
function expDigits(v: number, prec: number): { digits: string; x: number } {
  if (v === 0) return { digits: '0'.repeat(prec + 1), x: 0 };
  let x = Math.floor(Math.log10(v));
  if (!isFinite(x)) x = -324;
  const lo = 10n ** BigInt(prec);
  const hi = lo * 10n;
  for (let i = 0; i < 20; i++) {
    const d = scaledRound(v, prec - x);
    if (d >= hi) x++;
    else if (d < lo) x--;
    else return { digits: d.toString(), x };
  }
  throw new Error('exp');
}

function expStr(digits: string, x: number, alt: boolean, upper: boolean, strip: boolean): string {
  let frac = digits.slice(1);
  if (strip) frac = frac.replace(/0+$/, '');
  let s = digits[0] + (frac.length > 0 || alt ? '.' + frac : '');
  const ax = Math.abs(x);
  s += (upper ? 'E' : 'e') + (x < 0 ? '-' : '+') + (ax < 10 ? '0' + ax : String(ax));
  return s;
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
    let canZero = zero && !minus;

    const signFor = (neg: boolean) => (neg ? '-' : plus ? '+' : space ? ' ' : '');

    if (conv === 'd' || conv === 'i') {
      const b = BigInt(arg as number | bigint);
      sign = signFor(b < 0n);
      const mag = b < 0n ? -b : b;
      body = prec === 0 && mag === 0n ? '' : mag.toString();
      if (prec >= 0) {
        body = body.padStart(prec, '0');
        canZero = false;
      }
    } else if (conv === 'x' || conv === 'X' || conv === 'o') {
      const b = BigInt(arg as number | bigint);
      body = prec === 0 && b === 0n ? '' : b.toString(conv === 'o' ? 8 : 16);
      if (conv === 'X') body = body.toUpperCase();
      if (prec >= 0) {
        body = body.padStart(prec, '0');
        canZero = false;
      }
      if (alt) {
        if (conv === 'o') {
          if (body[0] !== '0') body = '0' + body;
        } else if (b !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      }
    } else if ('eEfFgG'.includes(conv)) {
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
          if (lc === 'f') {
            body = fixed(a, prec < 0 ? 6 : prec, alt);
          } else if (lc === 'e') {
            const p = prec < 0 ? 6 : prec;
            const { digits, x } = expDigits(a, p);
            body = expStr(digits, x, alt, upper, false);
          } else {
            let P = prec < 0 ? 6 : prec;
            if (P === 0) P = 1;
            const { digits, x } = expDigits(a, P - 1);
            if (P > x && x >= -4) {
              body = fixed(a, P - 1 - x, alt);
              if (!alt && body.includes('.')) body = body.replace(/0+$/, '').replace(/\.$/, '');
            } else {
              body = expStr(digits, x, alt, upper, !alt);
            }
          }
        }
      }
    } else if (conv === 's') {
      const s = String(arg);
      body = prec >= 0 ? s.slice(0, prec) : s;
      canZero = false;
    } else {
      body = String(arg);
      canZero = false;
    }

    const len = sign.length + prefix.length + body.length;
    if (len < width) {
      const pad = width - len;
      if (minus) out += sign + prefix + body + ' '.repeat(pad);
      else if (canZero) out += sign + prefix + '0'.repeat(pad) + body;
      else out += ' '.repeat(pad) + sign + prefix + body;
    } else out += sign + prefix + body;
  }
  return out;
}
