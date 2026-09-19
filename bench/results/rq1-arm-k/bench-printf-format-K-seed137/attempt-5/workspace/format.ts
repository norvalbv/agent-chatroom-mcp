function decompose(x: number): [bigint, bigint] {
  // |x| = num / den exactly
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, Math.abs(x));
  const bits = buf.getBigUint64(0);
  const expBits = Number((bits >> 52n) & 0x7ffn);
  const frac = bits & ((1n << 52n) - 1n);
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

function divRoundEven(n: bigint, d: bigint): bigint {
  const q = n / d;
  const r = n - q * d;
  const twice = r * 2n;
  if (twice > d || (twice === d && (q & 1n) === 1n)) return q + 1n;
  return q;
}

function pow10(n: number): bigint {
  return 10n ** BigInt(n);
}

function fixedDigits(x: number, p: number, alt: boolean): string {
  const [num, den] = decompose(x);
  const q = divRoundEven(num * pow10(p), den);
  let s = q.toString();
  if (s.length < p + 1) s = '0'.repeat(p + 1 - s.length) + s;
  const ip = s.slice(0, s.length - p);
  const fp = s.slice(s.length - p);
  return p > 0 ? ip + '.' + fp : alt ? ip + '.' : ip;
}

// returns digit string of length p+1 and decimal exponent
function expDigits(x: number, p: number): [string, number] {
  if (x === 0) return ['0'.repeat(p + 1), 0];
  const [num, den] = decompose(x);
  let E = Math.floor(Math.log10(Math.abs(x)));
  if (!isFinite(E)) E = 0;
  // adjust so that 10^E <= x < 10^(E+1)
  const ge = (e: number) => (e >= 0 ? num >= pow10(e) * den : num * pow10(-e) >= den);
  while (!ge(E)) E--;
  while (ge(E + 1)) E++;
  const scaled = (e: number): bigint => {
    const k = p - e;
    return k >= 0 ? divRoundEven(num * pow10(k), den) : divRoundEven(num, den * pow10(-k));
  };
  let q = scaled(E);
  if (q >= pow10(p + 1)) {
    E++;
    q = scaled(E);
  }
  return [q.toString(), E];
}

function expStyle(x: number, p: number, alt: boolean, upper: boolean, strip: boolean): string {
  const [d, E] = expDigits(x, p);
  let frac = d.slice(1);
  if (strip) frac = frac.replace(/0+$/, '');
  let mant = d[0];
  if (frac.length > 0) mant += '.' + frac;
  else if (alt) mant += '.';
  const ae = Math.abs(E);
  const es = (E < 0 ? '-' : '+') + (ae < 10 ? '0' + ae : String(ae));
  return mant + (upper ? 'E' : 'e') + es;
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
    let body = '';
    let canZero = true;

    switch (conv) {
      case 'd':
      case 'i': {
        const v = typeof arg === 'bigint' ? arg : BigInt(arg as number);
        const neg = v < 0n;
        body = (neg ? -v : v).toString();
        if (prec !== undefined) {
          if (prec === 0 && v === 0n) body = '';
          else if (body.length < prec) body = '0'.repeat(prec - body.length) + body;
          canZero = false;
        }
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        break;
      }
      case 'x':
      case 'X':
      case 'o': {
        const v = typeof arg === 'bigint' ? arg : BigInt(arg as number);
        body = v.toString(conv === 'o' ? 8 : 16);
        if (conv === 'X') body = body.toUpperCase();
        if (prec !== undefined) {
          if (prec === 0 && v === 0n) body = '';
          else if (body.length < prec) body = '0'.repeat(prec - body.length) + body;
          canZero = false;
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
        const x = arg as number;
        const upper = conv === 'E' || conv === 'F' || conv === 'G';
        const negBit = x < 0 || Object.is(x, -0);
        if (Number.isNaN(x)) {
          sign = '';
          body = upper ? 'NAN' : 'nan';
          canZero = false;
        } else {
          sign = negBit ? '-' : plus ? '+' : space ? ' ' : '';
          if (!isFinite(x)) {
            body = upper ? 'INF' : 'inf';
            canZero = false;
          } else {
            const lc = conv.toLowerCase();
            if (lc === 'f') body = fixedDigits(x, prec ?? 6, alt);
            else if (lc === 'e') body = expStyle(x, prec ?? 6, alt, upper, false);
            else {
              let P = prec ?? 6;
              if (P === 0) P = 1;
              const X = expDigits(x, P - 1)[1];
              if (P > X && X >= -4) {
                body = fixedDigits(x, P - 1 - X, alt);
                if (!alt && body.includes('.')) body = body.replace(/0+$/, '').replace(/\.$/, '');
              } else body = expStyle(x, P - 1, alt, upper, !alt);
            }
          }
        }
        break;
      }
      case 's': {
        body = String(arg);
        if (prec !== undefined) body = body.slice(0, prec);
        canZero = false;
        break;
      }
      case 'c': {
        body = String(arg);
        canZero = false;
        break;
      }
    }

    const len = sign.length + prefix.length + body.length;
    if (len >= width) out += sign + prefix + body;
    else if (minus) out += sign + prefix + body + ' '.repeat(width - len);
    else if (zero && canZero) out += sign + prefix + '0'.repeat(width - len) + body;
    else out += ' '.repeat(width - len) + sign + prefix + body;
  }
  return out;
}
