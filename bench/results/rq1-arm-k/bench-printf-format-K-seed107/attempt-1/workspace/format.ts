const buf = new DataView(new ArrayBuffer(8));

// exact |x| = num/den for finite x
function toRational(x: number): [bigint, bigint] {
  buf.setFloat64(0, Math.abs(x));
  const hi = buf.getUint32(0);
  const lo = buf.getUint32(4);
  const bexp = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let e: number;
  if (bexp === 0) e = -1074;
  else {
    m |= 1n << 52n;
    e = bexp - 1075;
  }
  return e >= 0 ? [m << BigInt(e), 1n] : [m, 1n << BigInt(-e)];
}

const pow10 = (k: number): bigint => 10n ** BigInt(k);

// round(num/den * 10^k), half to even
function roundScaled(num: bigint, den: bigint, k: number): bigint {
  if (k >= 0) num *= pow10(k);
  else den *= pow10(-k);
  const q = num / den;
  const r = num % den;
  const c = 2n * r;
  if (c > den || (c === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

function estExp(num: bigint, den: bigint): number {
  let e = Math.floor(Math.log10(Number(num) / Number(den)));
  if (!isFinite(e)) e = num.toString().length - den.toString().length;
  const ge = (k: number) => (k >= 0 ? num >= den * pow10(k) : num * pow10(-k) >= den);
  while (!ge(e)) e--;
  while (ge(e + 1)) e++;
  return e;
}

// digits (p+1 of them) and decimal exponent
function eDigits(x: number, p: number): [string, number] {
  if (x === 0) return ['0'.repeat(p + 1), 0];
  const [num, den] = toRational(x);
  let e = estExp(num, den);
  let s = roundScaled(num, den, p - e);
  if (s >= pow10(p + 1)) {
    e++;
    s = roundScaled(num, den, p - e);
  }
  return [s.toString(), e];
}

function fStyle(x: number, p: number, alt: boolean): string {
  const [num, den] = toRational(x);
  let s = roundScaled(num, den, p).toString();
  if (s.length <= p) s = '0'.repeat(p + 1 - s.length) + s;
  const ip = s.slice(0, s.length - p);
  const fp = s.slice(s.length - p);
  return p > 0 ? ip + '.' + fp : alt ? ip + '.' : ip;
}

function eStyle(x: number, p: number, alt: boolean, upper: boolean): string {
  const [d, e] = eDigits(x, p);
  let out = d[0];
  if (p > 0) out += '.' + d.slice(1);
  else if (alt) out += '.';
  const ae = Math.abs(e);
  return out + (upper ? 'E' : 'e') + (e < 0 ? '-' : '+') + (ae < 10 ? '0' : '') + ae;
}

function stripZeros(s: string): string {
  if (!s.includes('.')) return s;
  s = s.replace(/0+$/, '');
  return s.endsWith('.') ? s.slice(0, -1) : s;
}

function gStyle(x: number, P: number, alt: boolean, upper: boolean): string {
  if (P === 0) P = 1;
  const X = eDigits(x, P - 1)[1];
  if (P > X && X >= -4) {
    const s = fStyle(x, P - 1 - X, alt);
    return alt ? s : stripZeros(s);
  }
  const s = eStyle(x, P - 1, alt, upper);
  if (alt) return s;
  const i = s.search(/[eE]/);
  return stripZeros(s.slice(0, i)) + s.slice(i);
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
    let prec = -1;
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
    let numeric = true;
    let zeroOk = zero && !minus;
    const signOf = (neg: boolean) => (neg ? '-' : plus ? '+' : space ? ' ' : '');

    switch (conv) {
      case 'd':
      case 'i': {
        const v = BigInt(arg as number | bigint);
        sign = signOf(v < 0n);
        body = (v < 0n ? -v : v).toString();
        if (prec === 0 && v === 0n) body = '';
        if (prec >= 0) {
          body = body.padStart(prec, '0');
          zeroOk = false;
        }
        break;
      }
      case 'x':
      case 'X':
      case 'o': {
        const v = BigInt(arg as number | bigint);
        body = v.toString(conv === 'o' ? 8 : 16);
        if (conv === 'X') body = body.toUpperCase();
        if (prec === 0 && v === 0n) body = '';
        if (prec >= 0) {
          body = body.padStart(prec, '0');
          zeroOk = false;
        }
        if (alt) {
          if (conv === 'o') {
            if (body[0] !== '0') body = '0' + body;
          } else if (v !== 0n) prefix = conv === 'x' ? '0x' : '0X';
        }
        break;
      }
      case 'e':
      case 'E':
      case 'f':
      case 'F':
      case 'g':
      case 'G': {
        const v = arg as number;
        const upper = conv === 'E' || conv === 'F' || conv === 'G';
        if (Number.isNaN(v)) {
          body = upper ? 'NAN' : 'nan';
          zeroOk = false;
        } else {
          sign = signOf(v < 0 || Object.is(v, -0));
          if (!isFinite(v)) {
            body = upper ? 'INF' : 'inf';
            zeroOk = false;
          } else {
            const a = Math.abs(v);
            const p = prec < 0 ? 6 : prec;
            const lc = conv.toLowerCase();
            body =
              lc === 'f' ? fStyle(a, p, alt) : lc === 'e' ? eStyle(a, p, alt, upper) : gStyle(a, p, alt, upper);
          }
        }
        break;
      }
      case 's':
        numeric = false;
        body = String(arg);
        if (prec >= 0) body = body.slice(0, prec);
        break;
      case 'c':
        numeric = false;
        body = String(arg);
        break;
    }
    const len = sign.length + prefix.length + body.length;
    if (len >= width) out += sign + prefix + body;
    else if (minus) out += sign + prefix + body + ' '.repeat(width - len);
    else if (numeric && zeroOk) out += sign + prefix + '0'.repeat(width - len) + body;
    else out += ' '.repeat(width - len) + sign + prefix + body;
  }
  return out;
}
