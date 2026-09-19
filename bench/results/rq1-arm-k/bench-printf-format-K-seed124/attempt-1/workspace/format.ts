function decompose(x: number): { m: bigint; e: number } {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const exp = (hi >>> 20) & 0x7ff;
  const frac = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (exp === 0) return { m: frac, e: -1074 };
  return { m: frac | (1n << 52n), e: exp - 1075 };
}

// round(m * 2^e * 10^s), half to even, exact
function roundScaled(m: bigint, e: number, s: number): bigint {
  let num = m;
  let den = 1n;
  if (e >= 0) num <<= BigInt(e);
  else den <<= BigInt(-e);
  if (s >= 0) num *= 10n ** BigInt(s);
  else den *= 10n ** BigInt(-s);
  const q = num / den;
  const r = num % den;
  const twice = r * 2n;
  if (twice > den || (twice === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

function fixedDigits(x: number, prec: number, alt: boolean): string {
  const { m, e } = decompose(x);
  let s = roundScaled(m, e, prec).toString();
  if (s.length < prec + 1) s = s.padStart(prec + 1, '0');
  const ip = s.slice(0, s.length - prec);
  const fp = s.slice(s.length - prec);
  return ip + (prec > 0 || alt ? '.' : '') + fp;
}

// digits (prec+1 of them) and decimal exponent
function expDigits(x: number, prec: number): { digits: string; exp: number } {
  if (x === 0) return { digits: '0'.repeat(prec + 1), exp: 0 };
  const { m, e } = decompose(x);
  let d = Math.floor(Math.log10(x));
  if (!isFinite(d)) d = -324;
  const lo = 10n ** BigInt(prec);
  const hi = lo * 10n;
  for (let i = 0; i < 20; i++) {
    const n = roundScaled(m, e, prec - d);
    if (n >= hi) d++;
    else if (n < lo) d--;
    else return { digits: n.toString(), exp: d };
  }
  throw new Error('exp search failed');
}

function expStr(x: number, prec: number, alt: boolean, upper: boolean): string {
  const { digits, exp } = expDigits(x, prec);
  let r = digits[0] + (prec > 0 || alt ? '.' : '') + digits.slice(1);
  r += (upper ? 'E' : 'e') + (exp < 0 ? '-' : '+') + String(Math.abs(exp)).padStart(2, '0');
  return r;
}

function stripZeros(s: string): string {
  const ei = s.search(/[eE]/);
  let mant = ei >= 0 ? s.slice(0, ei) : s;
  const tail = ei >= 0 ? s.slice(ei) : '';
  if (mant.includes('.')) mant = mant.replace(/0+$/, '').replace(/\.$/, '');
  return mant + tail;
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
    let digits = '';
    let canZero = true;
    const signFor = (neg: boolean) => (neg ? '-' : plus ? '+' : space ? ' ' : '');

    switch (conv) {
      case 'd':
      case 'i':
      case 'x':
      case 'X':
      case 'o': {
        const v = BigInt(arg as number | bigint);
        const neg = v < 0n;
        const mag = neg ? -v : v;
        if (conv === 'd' || conv === 'i') {
          sign = signFor(neg);
          digits = mag.toString();
        } else if (conv === 'o') {
          digits = mag.toString(8);
        } else {
          digits = mag.toString(16);
          if (conv === 'X') digits = digits.toUpperCase();
        }
        if (prec >= 0) {
          canZero = false;
          if (mag === 0n && prec === 0) digits = '';
          digits = digits.padStart(prec, '0');
        }
        if (conv === 'o' && alt && digits[0] !== '0') digits = '0' + digits;
        if ((conv === 'x' || conv === 'X') && alt && mag !== 0n) prefix = conv === 'x' ? '0x' : '0X';
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
          digits = upper ? 'NAN' : 'nan';
          canZero = false;
          break;
        }
        const neg = x < 0 || Object.is(x, -0);
        sign = signFor(neg);
        const ax = Math.abs(x);
        if (ax === Infinity) {
          digits = upper ? 'INF' : 'inf';
          canZero = false;
          break;
        }
        const lc = conv.toLowerCase();
        if (lc === 'f') {
          digits = fixedDigits(ax, prec < 0 ? 6 : prec, alt);
        } else if (lc === 'e') {
          digits = expStr(ax, prec < 0 ? 6 : prec, alt, upper);
        } else {
          let P = prec < 0 ? 6 : prec;
          if (P === 0) P = 1;
          const X = expDigits(ax, P - 1).exp;
          if (P > X && X >= -4) digits = fixedDigits(ax, P - 1 - X, alt);
          else digits = expStr(ax, P - 1, alt, upper);
          if (!alt) digits = stripZeros(digits);
        }
        break;
      }
      case 's': {
        digits = String(arg);
        if (prec >= 0) digits = digits.slice(0, prec);
        canZero = false;
        break;
      }
      case 'c': {
        digits = String(arg);
        canZero = false;
        break;
      }
      default:
        throw new Error('bad conversion');
    }

    const head = sign + prefix;
    const len = head.length + digits.length;
    if (len >= width) out += head + digits;
    else if (minus) out += head + digits + ' '.repeat(width - len);
    else if (zero && canZero) out += head + '0'.repeat(width - len) + digits;
    else out += ' '.repeat(width - len) + head + digits;
  }
  return out;
}
