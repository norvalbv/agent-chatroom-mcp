function decompose(x: number): { num: bigint; den: bigint } {
  // x finite, >= 0. Exact value = num/den.
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  let mant = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let e: number;
  if (expBits === 0) {
    e = -1074;
  } else {
    mant |= 1n << 52n;
    e = expBits - 1075;
  }
  return e >= 0 ? { num: mant << BigInt(e), den: 1n } : { num: mant, den: 1n << BigInt(-e) };
}

// round(num/den) half-even
function divRound(num: bigint, den: bigint): bigint {
  const q = num / den;
  const r = num - q * den;
  const twice = r * 2n;
  if (twice > den || (twice === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

const pow10 = (n: number): bigint => 10n ** BigInt(n);

// round(x * 10^n) for n possibly negative
function scaledRound(x: number, n: number): bigint {
  const { num, den } = decompose(x);
  return n >= 0 ? divRound(num * pow10(n), den) : divRound(num, den * pow10(-n));
}

// Returns fixed digits: integer part string and fraction string
function fixedParts(x: number, prec: number): { ip: string; fp: string } {
  let s = scaledRound(x, prec).toString();
  if (prec > 0) {
    s = s.padStart(prec + 1, '0');
    return { ip: s.slice(0, s.length - prec), fp: s.slice(s.length - prec) };
  }
  return { ip: s, fp: '' };
}

// digits (prec+1 of them) and decimal exponent
function expParts(x: number, prec: number): { digits: string; exp: number } {
  if (x === 0) return { digits: '0'.repeat(prec + 1), exp: 0 };
  let E = Math.floor(Math.log10(x));
  if (!Number.isFinite(E)) E = -324;
  for (let i = 0; i < 4; i++) {
    const d = scaledRound(x, prec - E);
    const s = d.toString();
    if (s.length > prec + 1) {
      E++;
    } else if (s.length < prec + 1) {
      E--;
    } else {
      return { digits: s, exp: E };
    }
  }
  // fallback (should not happen)
  const s = scaledRound(x, prec - E).toString();
  return { digits: s.slice(0, prec + 1).padEnd(prec + 1, '0'), exp: E };
}

function expStr(exp: number, upper: boolean): string {
  const a = Math.abs(exp).toString().padStart(2, '0');
  return (upper ? 'E' : 'e') + (exp < 0 ? '-' : '+') + a;
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
    while (i < fmt.length && fmt[i] >= '0' && fmt[i] <= '9') {
      width = width * 10 + (fmt.charCodeAt(i) - 48);
      i++;
    }
    let prec = -1;
    if (fmt[i] === '.') {
      i++;
      prec = 0;
      while (i < fmt.length && fmt[i] >= '0' && fmt[i] <= '9') {
        prec = prec * 10 + (fmt.charCodeAt(i) - 48);
        i++;
      }
    }
    const conv = fmt[i++];
    const arg = args[ai++];

    let sign = '';
    let prefix = '';
    let body = '';
    let canZero = false;

    const signFor = (neg: boolean) => (neg ? '-' : plus ? '+' : space ? ' ' : '');

    switch (conv) {
      case 'd':
      case 'i': {
        const v = typeof arg === 'bigint' ? arg : BigInt(arg as number);
        sign = signFor(v < 0n);
        body = (v < 0n ? -v : v).toString();
        if (prec >= 0) {
          if (prec === 0 && v === 0n) body = '';
          body = body.padStart(prec, '0');
        }
        canZero = prec < 0;
        break;
      }
      case 'x':
      case 'X':
      case 'o': {
        const v = typeof arg === 'bigint' ? arg : BigInt(arg as number);
        body = v.toString(conv === 'o' ? 8 : 16);
        if (conv === 'X') body = body.toUpperCase();
        if (prec >= 0) {
          if (prec === 0 && v === 0n) body = '';
          body = body.padStart(prec, '0');
        }
        if (alt) {
          if (conv === 'o') {
            if (body[0] !== '0') body = '0' + body;
          } else if (v !== 0n) {
            prefix = conv === 'x' ? '0x' : '0X';
          }
        }
        canZero = prec < 0;
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
          body = upper ? 'NAN' : 'nan';
          break;
        }
        const neg = x < 0 || Object.is(x, -0);
        sign = signFor(neg);
        const a = Math.abs(x);
        if (a === Infinity) {
          body = upper ? 'INF' : 'inf';
          break;
        }
        canZero = true;
        const lc = conv.toLowerCase();
        if (lc === 'f') {
          const p = prec < 0 ? 6 : prec;
          const { ip, fp } = fixedParts(a, p);
          body = ip + (p > 0 || alt ? '.' : '') + fp;
        } else if (lc === 'e') {
          const p = prec < 0 ? 6 : prec;
          const { digits, exp } = expParts(a, p);
          body = digits[0] + (p > 0 || alt ? '.' : '') + digits.slice(1) + expStr(exp, upper);
        } else {
          let P = prec < 0 ? 6 : prec === 0 ? 1 : prec;
          const { exp: X } = expParts(a, P - 1);
          if (P > X && X >= -4) {
            const p = P - 1 - X;
            const { ip, fp } = fixedParts(a, p);
            let f = fp;
            if (!alt) f = f.replace(/0+$/, '');
            body = ip + (f.length > 0 || alt ? '.' : '') + f;
          } else {
            const { digits, exp } = expParts(a, P - 1);
            let f = digits.slice(1);
            if (!alt) f = f.replace(/0+$/, '');
            body = digits[0] + (f.length > 0 || alt ? '.' : '') + f + expStr(exp, upper);
          }
        }
        break;
      }
      case 's': {
        body = String(arg);
        if (prec >= 0) body = body.slice(0, prec);
        break;
      }
      case 'c': {
        body = String(arg);
        break;
      }
    }

    const len = sign.length + prefix.length + body.length;
    if (len >= width) {
      out += sign + prefix + body;
    } else if (minus) {
      out += sign + prefix + body + ' '.repeat(width - len);
    } else if (zero && canZero) {
      out += sign + prefix + '0'.repeat(width - len) + body;
    } else {
      out += ' '.repeat(width - len) + sign + prefix + body;
    }
  }
  return out;
}
