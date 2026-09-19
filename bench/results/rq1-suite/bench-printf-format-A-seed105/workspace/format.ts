function decompose(x: number): [bigint, bigint] {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, Math.abs(x));
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let e2: number;
  if (expBits === 0) {
    e2 = -1074;
  } else {
    m |= 1n << 52n;
    e2 = expBits - 1075;
  }
  return e2 >= 0 ? [m << BigInt(e2), 1n] : [m, 1n << BigInt(-e2)];
}

// round(N * 10^k / D), half to even
function scaleRound(N: bigint, D: bigint, k: number): bigint {
  let n = N;
  let d = D;
  if (k >= 0) n *= 10n ** BigInt(k);
  else d *= 10n ** BigInt(-k);
  const q = n / d;
  const r = n - q * d;
  const twice = r * 2n;
  if (twice > d || (twice === d && (q & 1n) === 1n)) return q + 1n;
  return q;
}

function gePow10(N: bigint, D: bigint, e: number): boolean {
  return e >= 0 ? N >= 10n ** BigInt(e) * D : N * 10n ** BigInt(-e) >= D;
}

// returns digit string (prec+1 digits) and decimal exponent
function expDigits(x: number, prec: number): [string, number] {
  if (x === 0) return ['0'.repeat(prec + 1), 0];
  const [N, D] = decompose(x);
  let e = Math.floor(Math.log10(Math.abs(x)));
  if (!isFinite(e)) e = -320;
  while (!gePow10(N, D, e)) e--;
  while (gePow10(N, D, e + 1)) e++;
  let q = scaleRound(N, D, prec - e);
  if (q >= 10n ** BigInt(prec + 1)) {
    e++;
    q = scaleRound(N, D, prec - e);
  }
  return [q.toString(), e];
}

function fixedStr(x: number, prec: number, alt: boolean): string {
  let s: string;
  if (x === 0) s = '0'.repeat(prec + 1);
  else {
    const [N, D] = decompose(x);
    s = scaleRound(N, D, prec).toString().padStart(prec + 1, '0');
  }
  const ip = s.slice(0, s.length - prec);
  const fp = s.slice(s.length - prec);
  return ip + (prec > 0 || alt ? '.' : '') + fp;
}

function expStr(x: number, prec: number, alt: boolean, upper: boolean): string {
  const [d, e] = expDigits(x, prec);
  const mant = d[0] + (prec > 0 || alt ? '.' : '') + d.slice(1);
  return mant + expSuffix(e, upper);
}

function expSuffix(e: number, upper: boolean): string {
  const a = Math.abs(e).toString().padStart(2, '0');
  return (upper ? 'E' : 'e') + (e < 0 ? '-' : '+') + a;
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
    let prec: number | undefined;
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
    let canZero = zero && !minus;

    if (conv === 's' || conv === 'c') {
      body = String(arg);
      if (conv === 's' && prec !== undefined) body = body.slice(0, prec);
      canZero = false;
    } else if (conv === 'd' || conv === 'i') {
      const v = BigInt(arg as number | bigint);
      sign = v < 0n ? '-' : plus ? '+' : space ? ' ' : '';
      body = (v < 0n ? -v : v).toString();
      if (prec !== undefined) {
        if (prec === 0 && v === 0n) body = '';
        body = body.padStart(prec, '0');
        canZero = false;
      }
    } else if (conv === 'x' || conv === 'X' || conv === 'o') {
      const v = BigInt(arg as number | bigint);
      body = v.toString(conv === 'o' ? 8 : 16);
      if (conv === 'X') body = body.toUpperCase();
      if (prec !== undefined) {
        if (prec === 0 && v === 0n) body = '';
        body = body.padStart(prec, '0');
        canZero = false;
      }
      if (alt) {
        if (conv === 'o') {
          if (body[0] !== '0') body = '0' + body;
        } else if (v !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      }
    } else {
      const x = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      const neg = x < 0 || Object.is(x, -0);
      if (Number.isNaN(x)) {
        body = upper ? 'NAN' : 'nan';
        canZero = false;
      } else {
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        if (!isFinite(x)) {
          body = upper ? 'INF' : 'inf';
          canZero = false;
        } else {
          const lc = conv.toLowerCase();
          if (lc === 'f') body = fixedStr(x, prec ?? 6, alt);
          else if (lc === 'e') body = expStr(x, prec ?? 6, alt, upper);
          else {
            const P = prec === undefined ? 6 : prec === 0 ? 1 : prec;
            const [, X] = expDigits(x, P - 1);
            if (P > X && X >= -4) {
              body = fixedStr(x, P - 1 - X, alt);
              if (!alt) body = stripZeros(body);
            } else {
              const [d, e] = expDigits(x, P - 1);
              let mant = d[0] + (P > 1 || alt ? '.' : '') + d.slice(1);
              if (!alt) mant = stripZeros(mant);
              body = mant + expSuffix(e, upper);
            }
          }
        }
      }
    }

    const len = sign.length + prefix.length + body.length;
    if (len >= width) out += sign + prefix + body;
    else if (minus) out += sign + prefix + body + ' '.repeat(width - len);
    else if (canZero) out += sign + prefix + '0'.repeat(width - len) + body;
    else out += ' '.repeat(width - len) + sign + prefix + body;
  }
  return out;
}
