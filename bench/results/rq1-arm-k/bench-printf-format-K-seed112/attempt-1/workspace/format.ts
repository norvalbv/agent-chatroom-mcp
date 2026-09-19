function roundDiv(a: bigint, b: bigint): bigint {
  const q = a / b;
  const r2 = (a - q * b) * 2n;
  if (r2 > b || (r2 === b && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// abs(v) as num/den, v finite and nonzero
function ratio(v: number): [bigint, bigint] {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, Math.abs(v));
  const bits = dv.getBigUint64(0);
  const ex = Number((bits >> 52n) & 0x7ffn);
  let mant = bits & ((1n << 52n) - 1n);
  let e: number;
  if (ex === 0) e = -1074;
  else {
    mant |= 1n << 52n;
    e = ex - 1075;
  }
  return e >= 0 ? [mant << BigInt(e), 1n] : [mant, 1n << BigInt(-e)];
}

// round(abs(v) * 10^s) half-even
function scaled(v: number, s: number): bigint {
  if (v === 0) return 0n;
  let [n, d] = ratio(v);
  if (s >= 0) n *= 10n ** BigInt(s);
  else d *= 10n ** BigInt(-s);
  return roundDiv(n, d);
}

function fixedDigits(v: number, prec: number): [string, string] {
  let s = scaled(v, prec).toString();
  if (s.length < prec + 1) s = '0'.repeat(prec + 1 - s.length) + s;
  return [s.slice(0, s.length - prec), s.slice(s.length - prec)];
}

// returns digit string of length prec+1 and exponent
function expDigits(v: number, prec: number): [string, number] {
  if (v === 0) return ['0'.repeat(prec + 1), 0];
  const [n, d] = ratio(v);
  let X = Math.floor(Math.log10(Math.abs(v)));
  if (!isFinite(X)) X = 0;
  const cmp = (x: number) => {
    // is 10^x <= v ?
    return x >= 0 ? n >= 10n ** BigInt(x) * d : n * 10n ** BigInt(-x) >= d;
  };
  while (!cmp(X)) X--;
  while (cmp(X + 1)) X++;
  let digs = scaled(v, prec - X);
  if (digs >= 10n ** BigInt(prec + 1)) {
    X++;
    digs = scaled(v, prec - X);
  }
  return [digs.toString(), X];
}

function expStr(digs: string, X: number, upper: boolean, alt: boolean, strip: boolean): string {
  let frac = digs.slice(1);
  if (strip) frac = frac.replace(/0+$/, '');
  const a = Math.abs(X);
  return (
    digs[0] +
    (frac.length > 0 || alt ? '.' : '') +
    frac +
    (upper ? 'E' : 'e') +
    (X < 0 ? '-' : '+') +
    (a < 10 ? '0' : '') +
    a
  );
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let out = '';
  let ai = 0;
  let i = 0;
  while (i < fmt.length) {
    const ch = fmt[i++];
    if (ch !== '%') {
      out += ch;
      continue;
    }
    if (fmt[i] === '%') {
      out += '%';
      i++;
      continue;
    }
    let minus = false,
      plus = false,
      space = false,
      zero = false,
      alt = false;
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
    let allowZero = zero && !minus;

    const signFor = (neg: boolean) => (neg ? '-' : plus ? '+' : space ? ' ' : '');

    if (conv === 's' || conv === 'c') {
      numeric = false;
      body = String(arg);
      if (conv === 's' && prec >= 0) body = body.slice(0, prec);
    } else if (conv === 'd' || conv === 'i' || conv === 'x' || conv === 'X' || conv === 'o') {
      const b = BigInt(arg as number | bigint);
      const neg = b < 0n;
      const mag = neg ? -b : b;
      if (conv === 'd' || conv === 'i') {
        sign = signFor(neg);
        body = mag.toString();
      } else {
        body = mag.toString(conv === 'o' ? 8 : 16);
        if (conv === 'X') body = body.toUpperCase();
      }
      if (prec >= 0) {
        if (prec === 0 && mag === 0n) body = '';
        if (body.length < prec) body = '0'.repeat(prec - body.length) + body;
        allowZero = false;
      }
      if (alt) {
        if (conv === 'o') {
          if (body[0] !== '0') body = '0' + body;
        } else if ((conv === 'x' || conv === 'X') && mag !== 0n) {
          prefix = conv === 'x' ? '0x' : '0X';
        }
      }
    } else {
      const v = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      if (Number.isNaN(v)) {
        body = upper ? 'NAN' : 'nan';
        allowZero = false;
      } else {
        const neg = v < 0 || Object.is(v, -0);
        sign = signFor(neg);
        if (!isFinite(v)) {
          body = upper ? 'INF' : 'inf';
          allowZero = false;
        } else {
          const lc = conv.toLowerCase();
          if (lc === 'f') {
            const p = prec < 0 ? 6 : prec;
            const [ip, fp] = fixedDigits(v, p);
            body = ip + (p > 0 || alt ? '.' : '') + fp;
          } else if (lc === 'e') {
            const p = prec < 0 ? 6 : prec;
            const [digs, X] = expDigits(v, p);
            body = expStr(digs, X, upper, alt, false);
          } else {
            let P = prec < 0 ? 6 : prec;
            if (P === 0) P = 1;
            const [digs, X] = expDigits(v, P - 1);
            if (P > X && X >= -4) {
              const p = P - 1 - X;
              const [ip, fp0] = fixedDigits(v, p);
              let fp = fp0;
              if (!alt) fp = fp.replace(/0+$/, '');
              body = ip + (fp.length > 0 || alt ? '.' : '') + fp;
            } else {
              body = expStr(digs, X, upper, alt, !alt);
            }
          }
        }
      }
    }
    let len = sign.length + prefix.length + body.length;
    if (len < width) {
      const pad = width - len;
      if (minus) body = sign + prefix + body + ' '.repeat(pad);
      else if (numeric && allowZero) body = sign + prefix + '0'.repeat(pad) + body;
      else body = ' '.repeat(pad) + sign + prefix + body;
    } else body = sign + prefix + body;
    out += body;
  }
  return out;
}
