function divRound(n: bigint, d: bigint): bigint {
  const q = n / d;
  const r = n % d;
  const twice = r * 2n;
  if (twice > d || (twice === d && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// abs of a finite double as num/den
function toRational(x: number): [bigint, bigint] {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, Math.abs(x));
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
  return e >= 0 ? [mant << BigInt(e), 1n] : [mant, 1n << BigInt(-e)];
}

const pow10 = (n: number): bigint => 10n ** BigInt(n);

// digits of abs(x) rounded to prec fractional digits: [intPart, fracPart]
function fixed(x: number, prec: number): [string, string] {
  const [n, d] = toRational(x);
  let s = divRound(n * pow10(prec), d).toString();
  if (s.length < prec + 1) s = '0'.repeat(prec + 1 - s.length) + s;
  return [s.slice(0, s.length - prec), s.slice(s.length - prec)];
}

// e-style: digit string of p+1 digits and decimal exponent
function expo(x: number, p: number): [string, number] {
  if (x === 0) return ['0'.repeat(p + 1), 0];
  const [n, d] = toRational(x);
  let X = Math.floor(Math.log10(Math.abs(x)));
  if (!isFinite(X)) X = -324;
  for (let i = 0; i < 10; i++) {
    const s = p - X;
    const q = s >= 0 ? divRound(n * pow10(s), d) : divRound(n, d * pow10(-s));
    if (q >= pow10(p + 1)) {
      X++;
    } else if (q < pow10(p)) {
      X--;
    } else {
      return [q.toString(), X];
    }
  }
  throw new Error('exponent search failed');
}

function expStr(X: number, upper: boolean): string {
  const a = Math.abs(X).toString().padStart(2, '0');
  return (upper ? 'E' : 'e') + (X < 0 ? '-' : '+') + a;
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
    while (fmt[i] >= '0' && fmt[i] <= '9') width = width * 10 + (fmt.charCodeAt(i++) - 48);
    let prec = -1;
    if (fmt[i] === '.') {
      i++;
      prec = 0;
      while (fmt[i] >= '0' && fmt[i] <= '9') prec = prec * 10 + (fmt.charCodeAt(i++) - 48);
    }
    const conv = fmt[i++];
    const arg = args[ai++];

    let sign = '';
    let prefix = '';
    let body = '';
    let zeroOk = zero && !minus;

    const signFor = (neg: boolean) => (neg ? '-' : plus ? '+' : space ? ' ' : '');

    switch (conv) {
      case 'd':
      case 'i': {
        const v = BigInt(arg as number | bigint);
        sign = signFor(v < 0n);
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
          } else if (v !== 0n) {
            prefix = conv === 'x' ? '0x' : '0X';
          }
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
        if (Number.isNaN(x)) {
          body = upper ? 'NAN' : 'nan';
          zeroOk = false;
          break;
        }
        const neg = x < 0 || Object.is(x, -0);
        sign = signFor(neg);
        if (!isFinite(x)) {
          body = upper ? 'INF' : 'inf';
          zeroOk = false;
          break;
        }
        const lc = conv.toLowerCase();
        if (lc === 'f') {
          const p = prec < 0 ? 6 : prec;
          const [ip, fp] = fixed(x, p);
          body = ip + (p > 0 || alt ? '.' : '') + fp;
        } else if (lc === 'e') {
          const p = prec < 0 ? 6 : prec;
          const [ds, X] = expo(x, p);
          body = ds[0] + (p > 0 || alt ? '.' : '') + ds.slice(1) + expStr(X, upper);
        } else {
          const P = prec < 0 ? 6 : prec === 0 ? 1 : prec;
          const [ds, X] = expo(x, P - 1);
          let ip: string, fp: string, tail = '';
          if (P > X && X >= -4) {
            [ip, fp] = fixed(x, P - 1 - X);
          } else {
            ip = ds[0];
            fp = ds.slice(1);
            tail = expStr(X, upper);
          }
          if (!alt) fp = fp.replace(/0+$/, '');
          body = ip + (fp.length > 0 || alt ? '.' : '') + fp + tail;
        }
        break;
      }
      case 's': {
        body = String(arg);
        if (prec >= 0) body = body.slice(0, prec);
        zeroOk = false;
        break;
      }
      case 'c': {
        body = String(arg);
        zeroOk = false;
        break;
      }
      default:
        throw new Error('bad conversion');
    }

    const len = sign.length + prefix.length + body.length;
    if (len >= width) {
      out += sign + prefix + body;
    } else if (minus) {
      out += sign + prefix + body + ' '.repeat(width - len);
    } else if (zeroOk) {
      out += sign + prefix + '0'.repeat(width - len) + body;
    } else {
      out += ' '.repeat(width - len) + sign + prefix + body;
    }
  }
  return out;
}
