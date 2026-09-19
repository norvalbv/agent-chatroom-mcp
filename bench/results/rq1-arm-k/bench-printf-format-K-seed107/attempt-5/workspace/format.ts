function ratio(v: number): [bigint, bigint] {
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, v);
  const bits = buf.getBigUint64(0);
  const be = Number((bits >> 52n) & 0x7ffn);
  const frac = bits & ((1n << 52n) - 1n);
  let mant: bigint;
  let exp: number;
  if (be === 0) {
    mant = frac;
    exp = -1074;
  } else {
    mant = frac | (1n << 52n);
    exp = be - 1075;
  }
  return exp >= 0 ? [mant << BigInt(exp), 1n] : [mant, 1n << BigInt(-exp)];
}

// round num/den to nearest integer, ties to even
function divRound(num: bigint, den: bigint): bigint {
  const q = num / den;
  const r = num % den;
  const twice = r * 2n;
  if (twice > den || (twice === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

const pow10 = (n: number): bigint => 10n ** BigInt(n);

// v >= 0 finite
function fixed(v: number, p: number, alt: boolean): string {
  const [n, d] = ratio(v);
  const s = divRound(n * pow10(p), d).toString().padStart(p + 1, '0');
  if (p === 0) return alt ? s + '.' : s;
  return s.slice(0, s.length - p) + '.' + s.slice(s.length - p);
}

// returns digit string (p+1 digits) and exponent
function sci(v: number, p: number): [string, number] {
  if (v === 0) return ['0'.repeat(p + 1), 0];
  const [n, d] = ratio(v);
  let x = Math.floor(Math.log10(v));
  if (!isFinite(x)) x = 0;
  // fix estimate: want 10^x <= v < 10^(x+1)
  const ge = (k: number) => (k >= 0 ? n >= d * pow10(k) : n * pow10(-k) >= d);
  while (!ge(x)) x--;
  while (ge(x + 1)) x++;
  const digits = (xx: number) => {
    const k = xx - p;
    return k >= 0 ? divRound(n, d * pow10(k)) : divRound(n * pow10(-k), d);
  };
  let dg = digits(x);
  if (dg >= pow10(p + 1)) {
    x++;
    dg = digits(x);
  }
  return [dg.toString(), x];
}

function expStyle(v: number, p: number, alt: boolean, upper: boolean): string {
  const [dg, x] = sci(v, p);
  let m = dg[0];
  if (p > 0) m += '.' + dg.slice(1);
  else if (alt) m += '.';
  const ax = Math.abs(x);
  return m + (upper ? 'E' : 'e') + (x < 0 ? '-' : '+') + (ax < 10 ? '0' : '') + ax;
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
      const c = fmt[i];
      if (c === '-') minus = true;
      else if (c === '+') plus = true;
      else if (c === ' ') space = true;
      else if (c === '0') zero = true;
      else if (c === '#') alt = true;
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

    if (conv === 's' || conv === 'c') {
      numeric = false;
      body = String(arg);
      if (conv === 's' && prec >= 0) body = body.slice(0, prec);
    } else if (conv === 'd' || conv === 'i') {
      const b = BigInt(arg as number | bigint);
      sign = b < 0n ? '-' : plus ? '+' : space ? ' ' : '';
      body = (b < 0n ? -b : b).toString();
      if (prec >= 0) {
        if (prec === 0 && b === 0n) body = '';
        body = body.padStart(prec, '0');
        zeroOk = false;
      }
    } else if (conv === 'x' || conv === 'X' || conv === 'o') {
      const b = BigInt(arg as number | bigint);
      body = b.toString(conv === 'o' ? 8 : 16);
      if (conv === 'X') body = body.toUpperCase();
      if (prec >= 0) {
        if (prec === 0 && b === 0n) body = '';
        body = body.padStart(prec, '0');
        zeroOk = false;
      }
      if (alt) {
        if (conv === 'o') {
          if (body[0] !== '0') body = '0' + body;
        } else if (b !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      }
    } else {
      const v = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      const neg = v < 0 || Object.is(v, -0);
      sign = Number.isNaN(v) ? '' : neg ? '-' : plus ? '+' : space ? ' ' : '';
      const a = Math.abs(v);
      if (!isFinite(a)) {
        body = Number.isNaN(v) ? 'nan' : 'inf';
        if (upper) body = body.toUpperCase();
        zeroOk = false;
      } else if (conv === 'f' || conv === 'F') {
        body = fixed(a, prec < 0 ? 6 : prec, alt);
      } else if (conv === 'e' || conv === 'E') {
        body = expStyle(a, prec < 0 ? 6 : prec, alt, upper);
      } else {
        let P = prec < 0 ? 6 : prec;
        if (P === 0) P = 1;
        const x = sci(a, P - 1)[1];
        if (P > x && x >= -4) {
          body = fixed(a, P - 1 - x, alt);
          if (!alt) body = stripZeros(body);
        } else {
          body = expStyle(a, P - 1, alt, upper);
          if (!alt) {
            const k = body.search(/[eE]/);
            body = stripZeros(body.slice(0, k)) + body.slice(k);
          }
        }
      }
    }

    const len = sign.length + prefix.length + body.length;
    let text: string;
    if (len >= width) text = sign + prefix + body;
    else if (minus) text = (sign + prefix + body).padEnd(width, ' ');
    else if (numeric && zeroOk) text = sign + prefix + '0'.repeat(width - len) + body;
    else text = (sign + prefix + body).padStart(width, ' ');
    out += text;
  }
  return out;
}
