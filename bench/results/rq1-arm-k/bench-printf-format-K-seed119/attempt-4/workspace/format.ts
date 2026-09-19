function decompose(v: number): [bigint, number] {
  // v finite, >= 0 ; returns [m, e] with v = m * 2^e
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, v);
  const hi = buf.getUint32(0);
  const lo = buf.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (expBits === 0) return [m, -1074];
  m |= 1n << 52n;
  return [m, expBits - 1075];
}

function divRound(num: bigint, den: bigint): bigint {
  const q = num / den;
  const r2 = (num % den) * 2n;
  if (r2 > den || (r2 === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// round(v * 10^k) exactly, half-even
function scaled(v: number, k: number): bigint {
  const [m, e] = decompose(v);
  let num = m;
  let den = 1n;
  if (e >= 0) num <<= BigInt(e);
  else den <<= BigInt(-e);
  if (k >= 0) num *= 10n ** BigInt(k);
  else den *= 10n ** BigInt(-k);
  return divRound(num, den);
}

function fixedDigits(v: number, prec: number): [string, string] {
  let s = scaled(v, prec).toString();
  if (prec === 0) return [s, ''];
  s = s.padStart(prec + 1, '0');
  return [s.slice(0, s.length - prec), s.slice(s.length - prec)];
}

// returns digit string of length p+1 and decimal exponent
function expDigits(v: number, p: number): [string, number] {
  if (v === 0) return ['0'.repeat(p + 1), 0];
  let X = Math.floor(Math.log10(v));
  if (!isFinite(X)) X = -324;
  for (let i = 0; i < 6; i++) {
    const n = scaled(v, p - X);
    const s = n.toString();
    if (s.length > p + 1) X++;
    else if (s.length < p + 1) X--;
    else return [s, X];
  }
  throw new Error('exp');
}

function expStr(digits: string, X: number, prec: number, alt: boolean, upper: boolean): string {
  let s = digits[0];
  if (prec > 0) s += '.' + digits.slice(1);
  else if (alt) s += '.';
  const ax = Math.abs(X);
  s += (upper ? 'E' : 'e') + (X < 0 ? '-' : '+') + (ax < 10 ? '0' : '') + ax;
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
    let canZero = false;

    if (conv === 's' || conv === 'c') {
      body = String(arg);
      if (conv === 's' && prec >= 0) body = body.slice(0, prec);
    } else if ('dixXo'.includes(conv)) {
      const n = BigInt(arg as number | bigint);
      const neg = n < 0n;
      const mag = neg ? -n : n;
      let digits = conv === 'x' ? mag.toString(16) : conv === 'X' ? mag.toString(16).toUpperCase() : conv === 'o' ? mag.toString(8) : mag.toString();
      if (prec >= 0) {
        if (prec === 0 && mag === 0n) digits = '';
        digits = digits.padStart(prec, '0');
      }
      if (conv === 'd' || conv === 'i') {
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
      } else if (alt) {
        if (conv === 'o') {
          if (digits[0] !== '0') digits = '0' + digits;
        } else if (mag !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      }
      body = digits;
      canZero = prec < 0;
    } else {
      const v = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      const neg = v < 0 || Object.is(v, -0);
      if (Number.isNaN(v)) {
        body = upper ? 'NAN' : 'nan';
      } else {
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        const a = Math.abs(v);
        if (a === Infinity) {
          body = upper ? 'INF' : 'inf';
        } else {
          canZero = true;
          const lc = conv.toLowerCase();
          if (lc === 'f') {
            const p = prec < 0 ? 6 : prec;
            const [ip, fp] = fixedDigits(a, p);
            body = ip + (p > 0 ? '.' + fp : alt ? '.' : '');
          } else if (lc === 'e') {
            const p = prec < 0 ? 6 : prec;
            const [d, X] = expDigits(a, p);
            body = expStr(d, X, p, alt, upper);
          } else {
            let P = prec < 0 ? 6 : prec === 0 ? 1 : prec;
            const [d, X] = expDigits(a, P - 1);
            let s: string;
            if (P > X && X >= -4) {
              const p = P - 1 - X;
              const [ip, fp] = fixedDigits(a, p);
              s = ip + (p > 0 ? '.' + fp : alt ? '.' : '');
              if (!alt && s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
            } else {
              let m = d[0] + (P - 1 > 0 ? '.' + d.slice(1) : alt ? '.' : '');
              if (!alt && m.includes('.')) m = m.replace(/0+$/, '').replace(/\.$/, '');
              const ax = Math.abs(X);
              s = m + (upper ? 'E' : 'e') + (X < 0 ? '-' : '+') + (ax < 10 ? '0' : '') + ax;
            }
            body = s;
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
