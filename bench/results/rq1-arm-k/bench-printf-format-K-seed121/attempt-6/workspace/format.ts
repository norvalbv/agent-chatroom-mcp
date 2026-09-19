function decompose(v: number): [bigint, bigint] {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, v);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  const frac = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let m: bigint;
  let e: number;
  if (expBits === 0) {
    m = frac;
    e = -1074;
  } else {
    m = frac | (1n << 52n);
    e = expBits - 1075;
  }
  return e >= 0 ? [m << BigInt(e), 1n] : [m, 1n << BigInt(-e)];
}

function roundDiv(a: bigint, b: bigint): bigint {
  const q = a / b;
  const r2 = (a % b) * 2n;
  if (r2 > b || (r2 === b && (q & 1n) === 1n)) return q + 1n;
  return q;
}

const pow10 = (n: number): bigint => 10n ** BigInt(n);

// v is finite and >= 0. Returns digit string of length n and decimal exponent.
function eDigits(v: number, n: number): [string, number] {
  if (v === 0) return ['0'.repeat(n), 0];
  const [num, den] = decompose(v);
  let X = Math.floor(Math.log10(v));
  if (!Number.isFinite(X)) X = 0;
  const ge = (k: number) => (k >= 0 ? num >= den * pow10(k) : num * pow10(-k) >= den);
  while (!ge(X)) X--;
  while (ge(X + 1)) X++;
  const round = (x: number): bigint => {
    const s = x - n + 1;
    return s >= 0 ? roundDiv(num, den * pow10(s)) : roundDiv(num * pow10(-s), den);
  };
  let d = round(X);
  if (d >= pow10(n)) {
    X++;
    d = round(X);
  }
  return [d.toString(), X];
}

function fDigits(v: number, p: number): string {
  const [num, den] = decompose(v);
  let s = roundDiv(num * pow10(p), den).toString();
  if (s.length <= p) s = '0'.repeat(p - s.length + 1) + s;
  return p === 0 ? s : s.slice(0, s.length - p) + '.' + s.slice(s.length - p);
}

function expStyle(v: number, p: number, alt: boolean, upper: boolean): string {
  const [d, X] = eDigits(v, p + 1);
  let s = d[0];
  if (p > 0) s += '.' + d.slice(1);
  else if (alt) s += '.';
  const ax = Math.abs(X);
  return s + (upper ? 'E' : 'e') + (X < 0 ? '-' : '+') + (ax < 10 ? '0' : '') + ax;
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
    let body: string;
    let zeroOk = zero && !minus;

    if (conv === 's' || conv === 'c') {
      body = String(arg);
      if (conv === 's' && prec !== undefined) body = body.slice(0, prec);
      zeroOk = false;
    } else if (conv === 'd' || conv === 'i' || conv === 'x' || conv === 'X' || conv === 'o') {
      let n = BigInt(arg as number | bigint);
      if (conv === 'd' || conv === 'i') {
        if (n < 0n) {
          sign = '-';
          n = -n;
        } else sign = plus ? '+' : space ? ' ' : '';
      }
      const radix = conv === 'o' ? 8 : conv === 'd' || conv === 'i' ? 10 : 16;
      body = n.toString(radix);
      if (conv === 'X') body = body.toUpperCase();
      if (prec !== undefined) {
        if (prec === 0 && n === 0n) body = '';
        body = body.padStart(prec, '0');
        zeroOk = false;
      }
      if (alt) {
        if (conv === 'o') {
          if (body[0] !== '0') body = '0' + body;
        } else if ((conv === 'x' || conv === 'X') && n !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      }
    } else {
      const v = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      const neg = v < 0 || Object.is(v, -0);
      if (!Number.isNaN(v)) sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
      if (!Number.isFinite(v)) {
        body = Number.isNaN(v) ? 'nan' : 'inf';
        if (upper) body = body.toUpperCase();
        zeroOk = false;
      } else {
        const a = Math.abs(v);
        const lc = conv.toLowerCase();
        if (lc === 'f') {
          body = fDigits(a, prec ?? 6);
          if (alt && (prec ?? 6) === 0) body += '.';
        } else if (lc === 'e') {
          body = expStyle(a, prec ?? 6, alt, upper);
        } else {
          let P = prec ?? 6;
          if (P === 0) P = 1;
          const X = eDigits(a, P)[1];
          if (P > X && X >= -4) {
            body = fDigits(a, P - 1 - X);
            if (P - 1 - X === 0 && alt) body += '.';
            if (!alt) body = stripZeros(body);
          } else {
            body = expStyle(a, P - 1, alt, upper);
            if (!alt) {
              const k = body.search(/[eE]/);
              body = stripZeros(body.slice(0, k)) + body.slice(k);
            }
          }
        }
        if (prec === undefined && false) zeroOk = false;
      }
    }

    const len = sign.length + prefix.length + body.length;
    if (len >= width) out += sign + prefix + body;
    else if (minus) out += sign + prefix + body + ' '.repeat(width - len);
    else if (zeroOk) out += sign + prefix + '0'.repeat(width - len) + body;
    else out += ' '.repeat(width - len) + sign + prefix + body;
  }
  return out;
}
