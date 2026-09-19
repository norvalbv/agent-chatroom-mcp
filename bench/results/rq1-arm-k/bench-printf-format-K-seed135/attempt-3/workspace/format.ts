function roundDiv(num: bigint, den: bigint): bigint {
  const q = num / den;
  const r2 = (num - q * den) * 2n;
  if (r2 > den || (r2 === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// x finite, > 0 : returns [num, den] with x = num/den exactly
function ratio(x: number): [bigint, bigint] {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, x);
  const bits = dv.getBigUint64(0);
  const e = Number((bits >> 52n) & 0x7ffn);
  const f = bits & ((1n << 52n) - 1n);
  let mant: bigint;
  let exp: number;
  if (e === 0) {
    mant = f;
    exp = -1074;
  } else {
    mant = f | (1n << 52n);
    exp = e - 1075;
  }
  return exp >= 0 ? [mant << BigInt(exp), 1n] : [mant, 1n << BigInt(-exp)];
}

// round(x * 10^k) half-even
function scaled(x: number, k: number): bigint {
  if (x === 0) return 0n;
  let [n, d] = ratio(x);
  if (k >= 0) n *= 10n ** BigInt(k);
  else d *= 10n ** BigInt(-k);
  return roundDiv(n, d);
}

// decimal exponent of x>0 (floor(log10 x)) exactly
function exp10(x: number): number {
  const [n, d] = ratio(x);
  let X = Math.floor(Math.log10(x));
  if (!Number.isFinite(X)) X = 0;
  const ge = (k: number) => (k >= 0 ? n >= d * 10n ** BigInt(k) : n * 10n ** BigInt(-k) >= d);
  while (!ge(X)) X--;
  while (ge(X + 1)) X++;
  return X;
}

// digits (prec+1 of them) and exponent in e style after rounding
function eParts(x: number, prec: number): [string, number] {
  if (x === 0) return ['0'.repeat(prec + 1), 0];
  let X = exp10(x);
  let q = scaled(x, prec - X);
  if (q >= 10n ** BigInt(prec + 1)) {
    X++;
    q = scaled(x, prec - X);
  }
  return [q.toString(), X];
}

function eText(digits: string, X: number, prec: number, alt: boolean, upper: boolean): string {
  let s = digits[0];
  if (prec > 0 || alt) s += '.';
  s += digits.slice(1);
  const ax = Math.abs(X);
  return s + (upper ? 'E' : 'e') + (X < 0 ? '-' : '+') + (ax < 10 ? '0' : '') + ax;
}

function fText(x: number, prec: number, alt: boolean): string {
  const s = scaled(x, prec).toString().padStart(prec + 1, '0');
  const ip = s.slice(0, s.length - prec);
  const fp = s.slice(s.length - prec);
  return ip + (prec > 0 || alt ? '.' : '') + fp;
}

function stripZeros(s: string): string {
  // s has form int[.frac][e...]
  const m = /^([^e]*?)((?:[eE].*)?)$/.exec(s)!;
  let mant = m[1];
  if (mant.includes('.')) mant = mant.replace(/0+$/, '').replace(/\.$/, '');
  return mant + m[2];
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
      const c = fmt[i];
      if (c === '-') left = true;
      else if (c === '+') plus = true;
      else if (c === ' ') space = true;
      else if (c === '0') zero = true;
      else if (c === '#') alt = true;
      else break;
    }
    let width = 0;
    while (i < fmt.length && fmt[i] >= '0' && fmt[i] <= '9') width = width * 10 + (fmt.charCodeAt(i++) - 48);
    let prec = -1;
    if (fmt[i] === '.') {
      i++;
      prec = 0;
      while (i < fmt.length && fmt[i] >= '0' && fmt[i] <= '9') prec = prec * 10 + (fmt.charCodeAt(i++) - 48);
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
      const v = BigInt(arg as number | bigint);
      if (conv === 'd' || conv === 'i') {
        sign = v < 0n ? '-' : plus ? '+' : space ? ' ' : '';
        body = (v < 0n ? -v : v).toString();
      } else {
        body = v.toString(conv === 'o' ? 8 : 16);
        if (conv === 'X') body = body.toUpperCase();
      }
      if (prec >= 0) {
        if (prec === 0 && v === 0n) body = '';
        body = body.padStart(prec, '0');
        canZero = false;
      }
      if (alt) {
        if (conv === 'o') {
          if (body[0] !== '0') body = '0' + body;
        } else if (conv !== 'd' && conv !== 'i' && v !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      }
    } else {
      const x = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      const neg = x < 0 || Object.is(x, -0);
      if (!Number.isNaN(x)) sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
      if (!Number.isFinite(x)) {
        body = Number.isNaN(x) ? 'nan' : 'inf';
        if (upper) body = body.toUpperCase();
        canZero = false;
      } else {
        const ax = Math.abs(x);
        const lc = conv.toLowerCase();
        if (lc === 'f') {
          body = fText(ax, prec < 0 ? 6 : prec, alt);
        } else if (lc === 'e') {
          const p = prec < 0 ? 6 : prec;
          const [d, X] = eParts(ax, p);
          body = eText(d, X, p, alt, upper);
        } else {
          const P = prec < 0 ? 6 : prec === 0 ? 1 : prec;
          const [d, X] = eParts(ax, P - 1);
          if (P > X && X >= -4) {
            body = fText(ax, P - 1 - X, alt);
          } else {
            body = eText(d, X, P - 1, alt, upper);
          }
          if (!alt) body = stripZeros(body);
        }
      }
    }

    const len = sign.length + prefix.length + body.length;
    if (len >= width) out += sign + prefix + body;
    else if (left) out += sign + prefix + body + ' '.repeat(width - len);
    else if (zero && canZero) out += sign + prefix + '0'.repeat(width - len) + body;
    else out += ' '.repeat(width - len) + sign + prefix + body;
  }
  return out;
}
