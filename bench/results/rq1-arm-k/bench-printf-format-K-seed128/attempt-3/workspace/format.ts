function exactParts(v: number): [bigint, bigint] {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, Math.abs(v));
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

// round(|v| * 10^k) half-even, exact
function scaledRound(v: number, k: number): bigint {
  let [num, den] = exactParts(v);
  if (k >= 0) num *= 10n ** BigInt(k);
  else den *= 10n ** BigInt(-k);
  const q = num / den;
  const r2 = (num % den) * 2n;
  if (r2 > den || (r2 === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// e-style digits: returns [digit string of length prec+1, exponent]
function eDigits(v: number, prec: number): [string, number] {
  if (v === 0) return ['0'.repeat(prec + 1), 0];
  let e = Math.floor(Math.log10(Math.abs(v)));
  if (!isFinite(e)) e = -324;
  const lim = 10n ** BigInt(prec);
  for (let i = 0; i < 20; i++) {
    const q = scaledRound(v, prec - e);
    if (q >= lim * 10n) e++;
    else if (q < lim) e--;
    else return [q.toString(), e];
  }
  throw new Error('unreachable');
}

function fDigits(v: number, prec: number): string {
  let s = scaledRound(v, prec).toString();
  if (prec === 0) return s;
  if (s.length <= prec) s = '0'.repeat(prec + 1 - s.length) + s;
  return s.slice(0, s.length - prec) + '.' + s.slice(s.length - prec);
}

function expStr(e: number, upper: boolean): string {
  const a = Math.abs(e).toString().padStart(2, '0');
  return (upper ? 'E' : 'e') + (e < 0 ? '-' : '+') + a;
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
    let prec = -1;
    if (fmt[i] === '.') {
      i++;
      prec = 0;
      while (i < fmt.length && fmt[i] >= '0' && fmt[i] <= '9') prec = prec * 10 + Number(fmt[i++]);
    }
    const conv = fmt[i++];
    const arg = args[ai++];

    let sign = '';
    let body = '';
    let canZero = false;
    const signFor = (neg: boolean) => (neg ? '-' : plus ? '+' : space ? ' ' : '');

    if (conv === 's' || conv === 'c') {
      body = String(arg);
      if (conv === 's' && prec >= 0) body = body.slice(0, prec);
    } else if (conv === 'd' || conv === 'i' || conv === 'x' || conv === 'X' || conv === 'o') {
      const n = BigInt(arg as number | bigint);
      const neg = n < 0n;
      const mag = neg ? -n : n;
      let digits = mag.toString(conv === 'o' ? 8 : conv === 'd' || conv === 'i' ? 10 : 16);
      if (conv === 'X') digits = digits.toUpperCase();
      if (prec === 0 && mag === 0n) digits = '';
      if (prec >= 0 && digits.length < prec) digits = '0'.repeat(prec - digits.length) + digits;
      if (conv === 'd' || conv === 'i') sign = signFor(neg);
      else if (alt) {
        if (conv === 'o') {
          if (!digits.startsWith('0')) digits = '0' + digits;
        } else if (mag !== 0n) sign = conv === 'x' ? '0x' : '0X';
      }
      body = digits;
      canZero = prec < 0;
    } else {
      const v = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      if (Number.isNaN(v)) {
        body = upper ? 'NAN' : 'nan';
      } else {
        const neg = v < 0 || Object.is(v, -0);
        sign = signFor(neg);
        if (!isFinite(v)) {
          body = upper ? 'INF' : 'inf';
        } else {
          canZero = true;
          const lc = conv.toLowerCase();
          const P0 = prec < 0 ? 6 : prec;
          if (lc === 'f') {
            body = fDigits(v, P0);
            if (P0 === 0 && alt) body += '.';
          } else if (lc === 'e') {
            const [d, e] = eDigits(v, P0);
            body = d[0] + (P0 > 0 ? '.' + d.slice(1) : alt ? '.' : '') + expStr(e, upper);
          } else {
            const P = P0 === 0 ? 1 : P0;
            const [d, X] = eDigits(v, P - 1);
            let expPart = '';
            if (P > X && X >= -4) {
              body = fDigits(v, P - 1 - X);
              if (P - 1 - X === 0 && alt) body += '.';
            } else {
              body = d[0] + (P - 1 > 0 ? '.' + d.slice(1) : alt ? '.' : '');
              expPart = expStr(X, upper);
            }
            if (!alt && body.includes('.')) body = body.replace(/0+$/, '').replace(/\.$/, '');
            body += expPart;
          }
        }
      }
      if (Number.isNaN(v) || !isFinite(v)) canZero = false;
    }

    let len = sign.length + body.length;
    if (len < width) {
      const pad = width - len;
      if (minus) body = body + ' '.repeat(pad);
      else if (zero && canZero) body = '0'.repeat(pad) + body;
      else sign = ' '.repeat(pad) + sign;
    }
    out += sign + body;
  }
  return out;
}
