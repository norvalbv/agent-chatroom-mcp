function decompose(v: number): { mant: bigint; exp: number } {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, Math.abs(v));
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const be = (hi >>> 20) & 0x7ff;
  let mant = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (be === 0) return { mant, exp: -1074 };
  mant |= 1n << 52n;
  return { mant, exp: be - 1075 };
}

// round-half-even of |v| * 10^k
function scaled(v: number, k: number): bigint {
  const { mant, exp } = decompose(v);
  let num = mant;
  let den = 1n;
  if (exp >= 0) num <<= BigInt(exp);
  else den <<= BigInt(-exp);
  if (k >= 0) num *= 10n ** BigInt(k);
  else den *= 10n ** BigInt(-k);
  const q = num / den;
  const r = num % den;
  const twice = r * 2n;
  if (twice > den || (twice === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// n significant digits; returns digit string of length n and decimal exponent
function sci(v: number, n: number): { digits: string; x: number } {
  if (v === 0) return { digits: '0'.repeat(n), x: 0 };
  let x = Math.floor(Math.log10(Math.abs(v)));
  if (!isFinite(x)) x = -324;
  const lo = 10n ** BigInt(n - 1);
  const hi = lo * 10n;
  for (let i = 0; i < 10; i++) {
    const q = scaled(v, n - 1 - x);
    if (q >= hi) x++;
    else if (q < lo) x--;
    else return { digits: q.toString(), x };
  }
  throw new Error('unreachable');
}

function fixed(v: number, p: number, alt: boolean): string {
  let s = scaled(v, p).toString();
  if (p > 0) {
    s = s.padStart(p + 1, '0');
    s = s.slice(0, s.length - p) + '.' + s.slice(s.length - p);
  } else if (alt) s += '.';
  return s;
}

function expo(digits: string, x: number, alt: boolean, upper: boolean): string {
  let s = digits[0];
  if (digits.length > 1) s += '.' + digits.slice(1);
  else if (alt) s += '.';
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
    let body: string;
    let numeric = true;
    let allowZero = zero && !minus;

    const signFor = (neg: boolean) => (neg ? '-' : plus ? '+' : space ? ' ' : '');

    if (conv === 'd' || conv === 'i') {
      const b = BigInt(arg as number | bigint);
      sign = signFor(b < 0n);
      body = (b < 0n ? -b : b).toString();
      if (prec === 0 && b === 0n) body = '';
      if (prec >= 0) {
        body = body.padStart(prec, '0');
        allowZero = false;
      }
    } else if (conv === 'x' || conv === 'X' || conv === 'o') {
      const b = BigInt(arg as number | bigint);
      body = b.toString(conv === 'o' ? 8 : 16);
      if (conv === 'X') body = body.toUpperCase();
      if (prec === 0 && b === 0n) body = '';
      if (prec >= 0) {
        body = body.padStart(prec, '0');
        allowZero = false;
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
        allowZero = false;
      } else {
        sign = signFor(v < 0 || Object.is(v, -0));
        if (!isFinite(v)) {
          body = upper ? 'INF' : 'inf';
          allowZero = false;
        } else {
          const lc = conv.toLowerCase();
          if (lc === 'f') {
            body = fixed(v, prec < 0 ? 6 : prec, alt);
          } else if (lc === 'e') {
            const p = prec < 0 ? 6 : prec;
            const { digits, x } = sci(v, p + 1);
            body = expo(digits, x, alt, upper);
          } else {
            let P = prec < 0 ? 6 : prec;
            if (P === 0) P = 1;
            const { digits, x } = sci(v, P);
            if (P > x && x >= -4) {
              body = fixed(v, P - 1 - x, alt);
            } else {
              body = expo(digits, x, alt, upper);
            }
            if (!alt) {
              if (body.includes('e') || body.includes('E')) {
                const m = body.search(/[eE]/);
                let mp = body.slice(0, m);
                if (mp.includes('.')) mp = mp.replace(/0+$/, '').replace(/\.$/, '');
                body = mp + body.slice(m);
              } else if (body.includes('.')) {
                body = body.replace(/0+$/, '').replace(/\.$/, '');
              }
            }
          }
        }
      }
    } else if (conv === 's') {
      numeric = false;
      body = String(arg);
      if (prec >= 0) body = body.slice(0, prec);
    } else {
      numeric = false;
      body = String(arg);
    }

    const len = sign.length + prefix.length + body.length;
    if (len < width) {
      const pad = width - len;
      if (minus) out += sign + prefix + body + ' '.repeat(pad);
      else if (numeric && allowZero) out += sign + prefix + '0'.repeat(pad) + body;
      else out += ' '.repeat(pad) + sign + prefix + body;
    } else out += sign + prefix + body;
  }
  return out;
}
