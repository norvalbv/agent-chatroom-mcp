function decompose(x: number): { mant: bigint; exp2: number } {
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, x);
  const hi = buf.getUint32(0);
  const lo = buf.getUint32(4);
  const e = (hi >>> 20) & 0x7ff;
  let mant = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (e === 0) return { mant, exp2: -1074 };
  mant |= 1n << 52n;
  return { mant, exp2: e - 1075 };
}

// round(|x| * 10^k), ties to even, exact
function roundScaled(mant: bigint, exp2: number, k: number): bigint {
  let num = mant;
  let den = 1n;
  if (exp2 >= 0) num <<= BigInt(exp2);
  else den <<= BigInt(-exp2);
  if (k >= 0) num *= 10n ** BigInt(k);
  else den *= 10n ** BigInt(-k);
  const q = num / den;
  const r = num % den;
  const twice = r * 2n;
  if (twice > den || (twice === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

function fixedDigits(ax: number, prec: number, alt: boolean): string {
  const { mant, exp2 } = decompose(ax);
  let s = roundScaled(mant, exp2, prec).toString();
  if (prec > 0) {
    s = s.padStart(prec + 1, '0');
    return s.slice(0, s.length - prec) + '.' + s.slice(s.length - prec);
  }
  return alt ? s + '.' : s;
}

// returns digit string (p+1 digits) and decimal exponent
function expDigits(ax: number, p: number): { digits: string; x: number } {
  if (ax === 0) return { digits: '0'.repeat(p + 1), x: 0 };
  const { mant, exp2 } = decompose(ax);
  let x = Math.floor(Math.log10(ax));
  if (!isFinite(x)) x = 0;
  const lo = 10n ** BigInt(p);
  const hi = lo * 10n;
  for (let i = 0; i < 20; i++) {
    const d = roundScaled(mant, exp2, p - x);
    if (d >= hi) x++;
    else if (d < lo) x--;
    else return { digits: d.toString(), x };
  }
  throw new Error('exp failure');
}

function expStyle(ax: number, p: number, alt: boolean, upper: boolean): string {
  const { digits, x } = expDigits(ax, p);
  let s = digits[0];
  if (p > 0) s += '.' + digits.slice(1);
  else if (alt) s += '.';
  const ax2 = Math.abs(x);
  s += (upper ? 'E' : 'e') + (x < 0 ? '-' : '+') + (ax2 < 10 ? '0' : '') + ax2;
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
    let canZero = true;

    if (conv === 'd' || conv === 'i' || conv === 'x' || conv === 'X' || conv === 'o') {
      const v = BigInt(arg as number | bigint);
      const neg = v < 0n;
      const mag = neg ? -v : v;
      if (conv === 'd' || conv === 'i') {
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
      }
      let digits = conv === 'o' ? mag.toString(8) : conv === 'd' || conv === 'i' ? mag.toString() : mag.toString(16);
      if (conv === 'X') digits = digits.toUpperCase();
      if (prec === 0 && mag === 0n) digits = '';
      if (prec >= 0) {
        digits = digits.padStart(prec, '0');
        canZero = false;
      }
      if (alt) {
        if (conv === 'o') {
          if (digits === '' || digits[0] !== '0') digits = '0' + digits;
        } else if ((conv === 'x' || conv === 'X') && mag !== 0n) {
          prefix = conv === 'x' ? '0x' : '0X';
        }
      }
      body = digits;
    } else if ('eEfFgG'.includes(conv)) {
      const x = arg as number;
      const upper = conv === conv.toUpperCase();
      const negBit = x < 0 || Object.is(x, -0);
      if (Number.isNaN(x)) {
        body = upper ? 'NAN' : 'nan';
        canZero = false;
      } else {
        sign = negBit ? '-' : plus ? '+' : space ? ' ' : '';
        const ax = Math.abs(x);
        if (ax === Infinity) {
          body = upper ? 'INF' : 'inf';
          canZero = false;
        } else {
          const lc = conv.toLowerCase();
          if (lc === 'f') {
            body = fixedDigits(ax, prec < 0 ? 6 : prec, alt);
          } else if (lc === 'e') {
            body = expStyle(ax, prec < 0 ? 6 : prec, alt, upper);
          } else {
            let P = prec < 0 ? 6 : prec;
            if (P === 0) P = 1;
            const { x: X } = expDigits(ax, P - 1);
            if (P > X && X >= -4) body = fixedDigits(ax, P - 1 - X, alt);
            else body = expStyle(ax, P - 1, alt, upper);
            if (!alt) {
              const m = body.match(/^([0-9]*)(\.[0-9]*)?(.*)$/)!;
              let frac = m[2] ?? '';
              frac = frac.replace(/0+$/, '');
              if (frac === '.') frac = '';
              body = m[1] + frac + m[3];
            }
          }
        }
      }
    } else if (conv === 's') {
      body = String(arg);
      if (prec >= 0) body = body.slice(0, prec);
      canZero = false;
    } else {
      body = String(arg);
      canZero = false;
    }

    const len = sign.length + prefix.length + body.length;
    if (len >= width) out += sign + prefix + body;
    else if (minus) out += sign + prefix + body + ' '.repeat(width - len);
    else if (zero && canZero) out += sign + prefix + '0'.repeat(width - len) + body;
    else out += ' '.repeat(width - len) + sign + prefix + body;
  }
  return out;
}
