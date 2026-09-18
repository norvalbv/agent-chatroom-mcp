// Decompose a finite non-negative double into m * 2^e exactly.
function decompose(v: number): [bigint, number] {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, v);
  const bits = dv.getBigUint64(0);
  const expBits = Number((bits >> 52n) & 0x7ffn);
  const frac = bits & ((1n << 52n) - 1n);
  if (expBits === 0) return [frac, -1074];
  return [frac | (1n << 52n), expBits - 1075];
}

// round-half-even(m * 2^e * 10^k)
function scaledRound(m: bigint, e: number, k: number): bigint {
  let num = m;
  let den = 1n;
  if (e >= 0) num <<= BigInt(e);
  else den <<= BigInt(-e);
  if (k >= 0) num *= 10n ** BigInt(k);
  else den *= 10n ** BigInt(-k);
  const q = num / den;
  const r = num % den;
  const twice = r * 2n;
  if (twice > den || (twice === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

function fixed(v: number, prec: number, alt: boolean): string {
  const [m, e] = decompose(v);
  const s = scaledRound(m, e, prec).toString().padStart(prec + 1, '0');
  const ip = s.slice(0, s.length - prec);
  const fp = s.slice(s.length - prec);
  return prec > 0 ? ip + '.' + fp : alt ? ip + '.' : ip;
}

// returns digit string (prec+1 digits) and decimal exponent
function expDigits(v: number, prec: number): [string, number] {
  if (v === 0) return ['0'.repeat(prec + 1), 0];
  const [m, e] = decompose(v);
  let X = Math.floor(Math.log10(v));
  if (!isFinite(X)) X = 0;
  for (;;) {
    const N = scaledRound(m, e, prec - X);
    const s = N.toString();
    if (s.length > prec + 1) X++;
    else if (s.length < prec + 1) X--;
    else return [s, X];
  }
}

function expo(digits: string, X: number, prec: number, alt: boolean, upper: boolean): string {
  let r = digits[0];
  if (prec > 0) r += '.' + digits.slice(1);
  else if (alt) r += '.';
  const ax = Math.abs(X);
  r += (upper ? 'E' : 'e') + (X < 0 ? '-' : '+') + (ax < 10 ? '0' + ax : String(ax));
  return r;
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
      const c = fmt[i];
      if (c === '-') minus = true;
      else if (c === '+') plus = true;
      else if (c === ' ') space = true;
      else if (c === '0') zero = true;
      else if (c === '#') alt = true;
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
    let prefix = '';
    let body = '';
    let canZero = true;
    const signFor = (neg: boolean) => (neg ? '-' : plus ? '+' : space ? ' ' : '');

    if (conv === 's' || conv === 'c') {
      let s = String(arg);
      if (conv === 's' && prec >= 0) s = s.slice(0, prec);
      body = s;
      canZero = false;
    } else if (conv === 'd' || conv === 'i' || conv === 'x' || conv === 'X' || conv === 'o') {
      const big = BigInt(arg as number | bigint);
      const neg = big < 0n;
      const mag = neg ? -big : big;
      let digits: string;
      if (conv === 'd' || conv === 'i') {
        sign = signFor(neg);
        digits = mag.toString();
      } else if (conv === 'o') {
        digits = mag.toString(8);
      } else {
        digits = mag.toString(16);
        if (conv === 'X') digits = digits.toUpperCase();
      }
      if (prec >= 0) {
        if (prec === 0 && mag === 0n) digits = '';
        digits = digits.padStart(prec, '0');
        canZero = false;
      }
      if (alt) {
        if (conv === 'o') {
          if (digits[0] !== '0') digits = '0' + digits;
        } else if (conv !== 'd' && conv !== 'i' && mag !== 0n) {
          prefix = conv === 'x' ? '0x' : '0X';
        }
      }
      body = digits;
    } else {
      const v = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      const neg = v < 0 || Object.is(v, -0);
      if (Number.isNaN(v)) {
        body = upper ? 'NAN' : 'nan';
        canZero = false;
      } else {
        sign = signFor(neg);
        if (!isFinite(v)) {
          body = upper ? 'INF' : 'inf';
          canZero = false;
        } else {
          const a = Math.abs(v);
          const lc = conv.toLowerCase();
          if (lc === 'f') {
            body = fixed(a, prec < 0 ? 6 : prec, alt);
          } else if (lc === 'e') {
            const p = prec < 0 ? 6 : prec;
            const [d, X] = expDigits(a, p);
            body = expo(d, X, p, alt, upper);
          } else {
            let P = prec < 0 ? 6 : prec;
            if (P === 0) P = 1;
            const [d, X] = expDigits(a, P - 1);
            if (P > X && X >= -4) {
              body = fixed(a, P - 1 - X, alt);
              if (!alt && body.includes('.')) body = body.replace(/0+$/, '').replace(/\.$/, '');
            } else {
              let dd = d;
              if (!alt) dd = d[0] + d.slice(1).replace(/0+$/, '');
              body = expo(dd, X, dd.length - 1, alt, upper);
            }
          }
        }
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
