function decompose(x: number): [bigint, number] {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const be = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (be === 0) return [m, -1074];
  m |= 1n << 52n;
  return [m, be - 1075];
}

// round(x * 10^k), ties to even, x = m * 2^e exactly
function roundScaled(m: bigint, e: number, k: number): bigint {
  let num = m;
  let den = 1n;
  if (k >= 0) num *= 10n ** BigInt(k);
  else den *= 10n ** BigInt(-k);
  if (e >= 0) num <<= BigInt(e);
  else den <<= BigInt(-e);
  let q = num / den;
  const r = num % den;
  const c = 2n * r;
  if (c > den || (c === den && (q & 1n) === 1n)) q += 1n;
  return q;
}

function fmtF(x: number, prec: number, alt: boolean): string {
  const [m, e] = decompose(x);
  let s = roundScaled(m, e, prec).toString();
  if (s.length < prec + 1) s = '0'.repeat(prec + 1 - s.length) + s;
  const ip = s.slice(0, s.length - prec);
  const fp = s.slice(s.length - prec);
  return ip + (prec > 0 || alt ? '.' + fp : '');
}

// returns [digits (prec+1), exponent]
function sci(x: number, prec: number): [string, number] {
  if (x === 0) return ['0'.repeat(prec + 1), 0];
  const [m, e] = decompose(x);
  let X = Math.floor(Math.log10(x));
  if (!isFinite(X)) X = -324;
  const hiB = 10n ** BigInt(prec + 1);
  const loB = 10n ** BigInt(prec);
  for (;;) {
    const N = roundScaled(m, e, prec - X);
    if (N >= hiB) X++;
    else if (N < loB) X--;
    else return [N.toString(), X];
  }
}

function fmtE(x: number, prec: number, alt: boolean, upper: boolean): string {
  const [d, X] = sci(x, prec);
  const a = Math.abs(X);
  return (
    d[0] + (prec > 0 || alt ? '.' + d.slice(1) : '') +
    (upper ? 'E' : 'e') + (X < 0 ? '-' : '+') + (a < 10 ? '0' + a : String(a))
  );
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
    let prec = -1;
    if (fmt[i] === '.') {
      i++;
      prec = 0;
      while (fmt[i] >= '0' && fmt[i] <= '9') prec = prec * 10 + Number(fmt[i++]);
    }
    const conv = fmt[i++];
    const arg = args[ai++];
    let prefix = '';
    let body = '';
    let zeroOk = zero && !minus;
    const signOf = (neg: boolean) => (neg ? '-' : plus ? '+' : space ? ' ' : '');

    if (conv === 's' || conv === 'c') {
      body = String(arg);
      if (conv === 's' && prec >= 0) body = body.slice(0, prec);
      zeroOk = false;
    } else if ('dixXo'.includes(conv)) {
      const v = BigInt(arg as number | bigint);
      const neg = v < 0n;
      const mag = neg ? -v : v;
      if (conv === 'd' || conv === 'i') {
        prefix = signOf(neg);
      }
      let digits = mag.toString(conv === 'o' ? 8 : conv === 'd' || conv === 'i' ? 10 : 16);
      if (conv === 'X') digits = digits.toUpperCase();
      if (prec === 0 && mag === 0n) digits = '';
      if (prec >= 0) {
        if (digits.length < prec) digits = '0'.repeat(prec - digits.length) + digits;
        zeroOk = false;
      }
      if (alt) {
        if (conv === 'o') {
          if (digits[0] !== '0') digits = '0' + digits;
        } else if ((conv === 'x' || conv === 'X') && mag !== 0n) {
          prefix = conv === 'x' ? '0x' : '0X';
        }
      }
      body = digits;
    } else {
      const x = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      if (Number.isNaN(x)) {
        body = upper ? 'NAN' : 'nan';
        zeroOk = false;
      } else {
        const neg = x < 0 || Object.is(x, -0);
        prefix = signOf(neg);
        const ax = Math.abs(x);
        if (!isFinite(ax)) {
          body = upper ? 'INF' : 'inf';
          zeroOk = false;
        } else if (conv === 'f' || conv === 'F') {
          body = fmtF(ax, prec < 0 ? 6 : prec, alt);
        } else if (conv === 'e' || conv === 'E') {
          body = fmtE(ax, prec < 0 ? 6 : prec, alt, upper);
        } else {
          const P = prec < 0 ? 6 : prec === 0 ? 1 : prec;
          const X = sci(ax, P - 1)[1];
          if (P > X && X >= -4) {
            body = fmtF(ax, P - 1 - X, alt);
            if (!alt) body = stripZeros(body);
          } else {
            body = fmtE(ax, P - 1, alt, upper);
            if (!alt) {
              const k = body.search(/[eE]/);
              body = stripZeros(body.slice(0, k)) + body.slice(k);
            }
          }
        }
      }
    }
    const len = prefix.length + body.length;
    if (len < width) {
      const pad = width - len;
      if (minus) body = prefix + body + ' '.repeat(pad);
      else if (zeroOk) body = prefix + '0'.repeat(pad) + body;
      else body = ' '.repeat(pad) + prefix + body;
    } else body = prefix + body;
    out += body;
  }
  return out;
}
