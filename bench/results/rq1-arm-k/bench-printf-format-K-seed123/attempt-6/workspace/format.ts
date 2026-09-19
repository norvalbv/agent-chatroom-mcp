function decompose(v: number): [bigint, number] {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, v);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const ef = (hi >>> 20) & 0x7ff;
  const frac = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (ef === 0) return [frac, -1074];
  return [frac | (1n << 52n), ef - 1075];
}

// value * 10^k as a fraction [num, den]
function scaled(m: bigint, e2: number, k: number): [bigint, bigint] {
  let num = m;
  let den = 1n;
  if (e2 >= 0) num <<= BigInt(e2);
  else den <<= BigInt(-e2);
  if (k >= 0) num *= 10n ** BigInt(k);
  else den *= 10n ** BigInt(-k);
  return [num, den];
}

function roundEven(num: bigint, den: bigint): bigint {
  const q = num / den;
  const r2 = (num % den) * 2n;
  if (r2 > den || (r2 === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// abs finite, >= 0. Digits of round(abs * 10^p), with decimal point inserted.
function fixedDigits(abs: number, p: number, alt: boolean): string {
  const [m, e2] = decompose(abs);
  const [num, den] = scaled(m, e2, p);
  let s = roundEven(num, den).toString();
  if (p > 0) {
    s = s.padStart(p + 1, '0');
    s = s.slice(0, s.length - p) + '.' + s.slice(s.length - p);
  } else if (alt) s += '.';
  return s;
}

// returns [digit string of p+1 digits, exponent]
function expParts(abs: number, p: number): [string, number] {
  if (abs === 0) return ['0'.repeat(p + 1), 0];
  const [m, e2] = decompose(abs);
  let x = Math.floor(Math.log10(abs));
  if (!isFinite(x)) x = -324;
  for (;;) {
    const [n, d] = scaled(m, e2, -x);
    if (n < d) x--;
    else if (n >= d * 10n) x++;
    else break;
  }
  let n = roundEven(...scaled(m, e2, p - x));
  if (n >= 10n ** BigInt(p + 1)) {
    x++;
    n = roundEven(...scaled(m, e2, p - x));
  }
  return [n.toString(), x];
}

function expStr(abs: number, p: number, alt: boolean, upper: boolean): string {
  const [d, x] = expParts(abs, p);
  let s = d[0];
  if (p > 0) s += '.' + d.slice(1);
  else if (alt) s += '.';
  const ax = Math.abs(x).toString().padStart(2, '0');
  return s + (upper ? 'E' : 'e') + (x < 0 ? '-' : '+') + ax;
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
    let prec: number | undefined;
    if (fmt[i] === '.') {
      i++;
      prec = 0;
      while (fmt[i] >= '0' && fmt[i] <= '9') prec = prec * 10 + Number(fmt[i++]);
    }
    const conv = fmt[i++];
    const arg = args[ai++];
    let sign = '';
    let body = '';
    let numeric = true;
    let canZero = zero && !minus;
    const signFor = (neg: boolean) => (neg ? '-' : plus ? '+' : space ? ' ' : '');

    switch (conv) {
      case 'd':
      case 'i':
      case 'x':
      case 'X':
      case 'o': {
        let v = BigInt(arg as number | bigint);
        const neg = v < 0n;
        if (neg) v = -v;
        const radix = conv === 'x' || conv === 'X' ? 16 : conv === 'o' ? 8 : 10;
        let digits = v.toString(radix);
        if (conv === 'X') digits = digits.toUpperCase();
        if (prec !== undefined) {
          if (prec === 0 && v === 0n) digits = '';
          digits = digits.padStart(prec, '0');
          canZero = false;
        }
        if (conv === 'd' || conv === 'i') sign = signFor(neg);
        else if (alt) {
          if (conv === 'o') {
            if (digits[0] !== '0') digits = '0' + digits;
          } else if (v !== 0n) sign = conv === 'x' ? '0x' : '0X';
        }
        body = digits;
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
          canZero = false;
        } else {
          const neg = v < 0 || Object.is(v, -0);
          sign = signFor(neg);
          const abs = Math.abs(v);
          if (abs === Infinity) {
            body = upper ? 'INF' : 'inf';
            canZero = false;
          } else if (conv === 'f' || conv === 'F') {
            body = fixedDigits(abs, prec ?? 6, alt);
          } else if (conv === 'e' || conv === 'E') {
            body = expStr(abs, prec ?? 6, alt, upper);
          } else {
            const P = prec === undefined ? 6 : Math.max(prec, 1);
            const X = expParts(abs, P - 1)[1];
            if (P > X && X >= -4) {
              body = fixedDigits(abs, P - 1 - X, alt);
              if (!alt) body = stripZeros(body);
            } else {
              body = expStr(abs, P - 1, alt, upper);
              if (!alt) {
                const k = body.search(/[eE]/);
                body = stripZeros(body.slice(0, k)) + body.slice(k);
              }
            }
          }
        }
        break;
      }
      case 's': {
        numeric = false;
        body = String(arg);
        if (prec !== undefined) body = body.slice(0, prec);
        break;
      }
      case 'c':
        numeric = false;
        body = String(arg);
        break;
    }
    const len = sign.length + body.length;
    if (len < width) {
      const pad = width - len;
      if (minus) out += sign + body + ' '.repeat(pad);
      else if (numeric && canZero) out += sign + '0'.repeat(pad) + body;
      else out += ' '.repeat(pad) + sign + body;
    } else out += sign + body;
  }
  return out;
}
