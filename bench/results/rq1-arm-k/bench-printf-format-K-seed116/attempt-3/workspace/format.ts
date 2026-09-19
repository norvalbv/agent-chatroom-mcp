function ratio(x: number): [bigint, bigint] {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let k: number;
  if (expBits === 0) {
    k = -1074;
  } else {
    m |= 1n << 52n;
    k = expBits - 1075;
  }
  return k >= 0 ? [m << BigInt(k), 1n] : [m, 1n << BigInt(-k)];
}

function roundDiv(n: bigint, d: bigint): bigint {
  const q = n / d;
  const r2 = (n % d) * 2n;
  if (r2 > d || (r2 === d && (q & 1n) === 1n)) return q + 1n;
  return q;
}

const pow10 = (n: number): bigint => 10n ** BigInt(n);

// round(x / 10^p) half-even
function scaled(num: bigint, den: bigint, p: number): bigint {
  if (p >= 0) return roundDiv(num, den * pow10(p));
  return roundDiv(num * pow10(-p), den);
}

// x >= 0 finite. Returns digit string (no point) with precision digits after the point.
function fixedDigits(x: number, prec: number): string {
  const [n, d] = ratio(x);
  return scaled(n, d, -prec).toString();
}

function fixedStr(x: number, prec: number, alt: boolean): string {
  let s = fixedDigits(x, prec);
  if (prec > 0) {
    s = s.padStart(prec + 1, '0');
    s = s.slice(0, s.length - prec) + '.' + s.slice(s.length - prec);
  } else if (alt) s += '.';
  return s;
}

function expParts(x: number, prec: number): { digits: string; e: number } {
  if (x === 0) return { digits: '0'.repeat(prec + 1), e: 0 };
  const [n, d] = ratio(x);
  let e = Math.floor(Math.log10(x));
  const ge = (t: number): boolean => (t >= 0 ? n >= pow10(t) * d : n * pow10(-t) >= d);
  while (!ge(e)) e--;
  while (ge(e + 1)) e++;
  let dig = scaled(n, d, e - prec);
  if (dig >= pow10(prec + 1)) {
    e++;
    dig = scaled(n, d, e - prec);
  }
  return { digits: dig.toString(), e };
}

function expStr(x: number, prec: number, alt: boolean, upper: boolean): string {
  const { digits, e } = expParts(x, prec);
  let s = digits[0];
  if (prec > 0) s += '.' + digits.slice(1);
  else if (alt) s += '.';
  const ae = Math.abs(e);
  s += (upper ? 'E' : 'e') + (e < 0 ? '-' : '+') + (ae < 10 ? '0' : '') + ae;
  return s;
}

function stripZeros(s: string): string {
  if (!s.includes('.')) return s;
  return s.replace(/0+$/, '').replace(/\.$/, '');
}

function stripMantissa(s: string): string {
  const m = s.match(/^([^eE]*)([eE].*)$/);
  if (!m) return stripZeros(s);
  return stripZeros(m[1]) + m[2];
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

    if (conv === 's' || conv === 'c') {
      body = String(arg);
      if (conv === 's' && prec >= 0) body = body.slice(0, prec);
      canZero = false;
    } else if ('dixXo'.includes(conv)) {
      let v = typeof arg === 'bigint' ? arg : BigInt(arg as number);
      if (conv === 'd' || conv === 'i') {
        if (v < 0n) {
          sign = '-';
          v = -v;
        } else sign = plus ? '+' : space ? ' ' : '';
      }
      const radix = conv === 'o' ? 8 : conv === 'd' || conv === 'i' ? 10 : 16;
      body = v === 0n && prec === 0 ? '' : v.toString(radix);
      if (conv === 'X') body = body.toUpperCase();
      if (prec >= 0) {
        body = body.padStart(prec, '0');
        canZero = false;
      }
      if (alt) {
        if (conv === 'o') {
          if (body[0] !== '0') body = '0' + body;
        } else if ((conv === 'x' || conv === 'X') && v !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      }
    } else {
      const x = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      const neg = x < 0 || Object.is(x, -0);
      if (Number.isNaN(x)) {
        body = upper ? 'NAN' : 'nan';
        canZero = false;
      } else {
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        const a = Math.abs(x);
        if (a === Infinity) {
          body = upper ? 'INF' : 'inf';
          canZero = false;
        } else if (conv === 'f' || conv === 'F') {
          body = fixedStr(a, prec < 0 ? 6 : prec, alt);
        } else if (conv === 'e' || conv === 'E') {
          body = expStr(a, prec < 0 ? 6 : prec, alt, upper);
        } else {
          const P = prec < 0 ? 6 : prec === 0 ? 1 : prec;
          const X = expParts(a, P - 1).e;
          if (P > X && X >= -4) {
            body = fixedStr(a, P - 1 - X, alt);
            if (!alt) body = stripZeros(body);
          } else {
            body = expStr(a, P - 1, alt, upper);
            if (!alt) body = stripMantissa(body);
          }
        }
      }
    }

    const len = sign.length + prefix.length + body.length;
    if (len < width) {
      if (minus) body = sign + prefix + body + ' '.repeat(width - len);
      else if (zero && canZero) body = sign + prefix + '0'.repeat(width - len) + body;
      else body = ' '.repeat(width - len) + sign + prefix + body;
    } else body = sign + prefix + body;
    out += body;
  }
  return out;
}
