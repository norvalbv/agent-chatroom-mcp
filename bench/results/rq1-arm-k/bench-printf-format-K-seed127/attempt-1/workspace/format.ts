function frac(x: number): [bigint, bigint] {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let e: number;
  if (expBits === 0) {
    e = -1074;
  } else {
    m |= 1n << 52n;
    e = expBits - 1075;
  }
  return e >= 0 ? [m << BigInt(e), 1n] : [m, 1n << BigInt(-e)];
}

// round-half-even of num/den * 10^k
function scaled(num: bigint, den: bigint, k: number): bigint {
  if (k >= 0) num *= 10n ** BigInt(k);
  else den *= 10n ** BigInt(-k);
  let q = num / den;
  const r2 = (num % den) * 2n;
  if (r2 > den || (r2 === den && (q & 1n) === 1n)) q += 1n;
  return q;
}

// digits (p+1 of them) and decimal exponent, for x >= 0 finite
function eDigits(x: number, p: number): [string, number] {
  if (x === 0) return ['0'.repeat(p + 1), 0];
  const [num, den] = frac(x);
  let X = Math.floor(Math.log10(x));
  const lo = 10n ** BigInt(p);
  const hi = lo * 10n;
  for (let i = 0; i < 10; i++) {
    const n = scaled(num, den, p - X);
    if (n < lo) X -= 1;
    else if (n >= hi) X += 1;
    else return [n.toString(), X];
  }
  throw new Error('unreachable');
}

function fDigits(x: number, p: number): string {
  if (x === 0) return '0'.repeat(p + 1);
  const [num, den] = frac(x);
  let s = scaled(num, den, p).toString();
  if (s.length < p + 1) s = '0'.repeat(p + 1 - s.length) + s;
  return s;
}

function expStr(X: number, upper: boolean): string {
  const a = Math.abs(X).toString().padStart(2, '0');
  return (upper ? 'E' : 'e') + (X < 0 ? '-' : '+') + a;
}

function fmtFloat(x: number, conv: string, prec: number | null, alt: boolean): string {
  const upper = conv === 'E' || conv === 'F' || conv === 'G';
  const lc = conv.toLowerCase();
  const eStyle = (p: number, strip: boolean): string => {
    const [d, X] = eDigits(x, p);
    let fr = d.slice(1);
    if (strip) fr = fr.replace(/0+$/, '');
    return d[0] + (fr.length || alt ? '.' : '') + fr + expStr(X, upper);
  };
  const fStyle = (p: number, strip: boolean): string => {
    const d = fDigits(x, p);
    const ip = d.slice(0, d.length - p);
    let fr = d.slice(d.length - p);
    if (strip) fr = fr.replace(/0+$/, '');
    return ip + (fr.length || alt ? '.' : '') + fr;
  };
  if (lc === 'e') return eStyle(prec ?? 6, false);
  if (lc === 'f') return fStyle(prec ?? 6, false);
  let P = prec ?? 6;
  if (P === 0) P = 1;
  const X = eDigits(x, P - 1)[1];
  if (P > X && X >= -4) return fStyle(P - 1 - X, !alt);
  return eStyle(P - 1, !alt);
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
    let minus = false, plus = false, space = false, zero = false, alt = false;
    for (;; i++) {
      const f = fmt[i];
      if (f === '-') minus = true;
      else if (f === '+') plus = true;
      else if (f === ' ') space = true;
      else if (f === '0') zero = true;
      else if (f === '#') alt = true;
      else break;
    }
    let width = 0;
    while (fmt[i] >= '0' && fmt[i] <= '9') width = width * 10 + Number(fmt[i++]);
    let prec: number | null = null;
    if (fmt[i] === '.') {
      i++;
      prec = 0;
      while (fmt[i] >= '0' && fmt[i] <= '9') prec = prec * 10 + Number(fmt[i++]);
    }
    const conv = fmt[i++];
    const arg = args[ai++];
    let sign = '';
    let prefix = '';
    let body = '';
    let canZero = false;
    const signFor = (neg: boolean) => (neg ? '-' : plus ? '+' : space ? ' ' : '');
    if (conv === 'd' || conv === 'i') {
      const v = BigInt(arg as number | bigint);
      sign = signFor(v < 0n);
      body = (v < 0n ? -v : v).toString();
      if (prec !== null) {
        if (prec === 0 && v === 0n) body = '';
        body = body.padStart(prec, '0');
      }
      canZero = prec === null;
    } else if (conv === 'x' || conv === 'X' || conv === 'o') {
      const v = BigInt(arg as number | bigint);
      body = v.toString(conv === 'o' ? 8 : 16);
      if (conv === 'X') body = body.toUpperCase();
      if (prec !== null) {
        if (prec === 0 && v === 0n) body = '';
        body = body.padStart(prec, '0');
      }
      if (alt) {
        if (conv === 'o') {
          if (body[0] !== '0') body = '0' + body;
        } else if (v !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      }
      canZero = prec === null;
    } else if ('eEfFgG'.includes(conv)) {
      const v = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      if (Number.isNaN(v)) {
        body = upper ? 'NAN' : 'nan';
      } else {
        const neg = v < 0 || Object.is(v, -0);
        sign = signFor(neg);
        if (!Number.isFinite(v)) body = upper ? 'INF' : 'inf';
        else {
          body = fmtFloat(Math.abs(v), conv, prec, alt);
          canZero = true;
        }
      }
    } else if (conv === 's') {
      body = String(arg);
      if (prec !== null) body = body.slice(0, prec);
    } else {
      body = String(arg);
    }
    const len = sign.length + prefix.length + body.length;
    let text: string;
    if (len >= width) text = sign + prefix + body;
    else if (minus) text = sign + prefix + body + ' '.repeat(width - len);
    else if (zero && canZero) text = sign + prefix + '0'.repeat(width - len) + body;
    else text = ' '.repeat(width - len) + sign + prefix + body;
    out += text;
  }
  return out;
}
