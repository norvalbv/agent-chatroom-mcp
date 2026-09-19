const P10 = (n: number): bigint => 10n ** BigInt(n);

// decompose a finite non-negative double into mant * 2^exp2 exactly
function decompose(v: number): [bigint, number] {
  if (v === 0) return [0n, 0];
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, v);
  const hi = buf.getUint32(0);
  const lo = buf.getUint32(4);
  const bexp = (hi >>> 20) & 0x7ff;
  let mant = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (bexp === 0) return [mant, -1074];
  mant |= 1n << 52n;
  return [mant, bexp - 1075];
}

// round(v * 10^k) to nearest, ties to even, exactly
function roundScaled(mant: bigint, exp2: number, k: number): bigint {
  let num = mant;
  let den = 1n;
  if (exp2 >= 0) num <<= BigInt(exp2);
  else den <<= BigInt(-exp2);
  if (k >= 0) num *= P10(k);
  else den *= P10(-k);
  const q = num / den;
  const r = num % den;
  const twice = r * 2n;
  if (twice > den || (twice === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// returns [intPart, fracDigits]
function fixedDigits(v: number, prec: number): [string, string] {
  const [m, e] = decompose(v);
  let s = roundScaled(m, e, prec).toString();
  if (s.length < prec + 1) s = '0'.repeat(prec + 1 - s.length) + s;
  return [s.slice(0, s.length - prec), s.slice(s.length - prec)];
}

// returns [digits (prec+1 of them), exponent]
function expDigits(v: number, prec: number): [string, number] {
  if (v === 0) return ['0'.repeat(prec + 1), 0];
  const [m, e] = decompose(v);
  let x = Math.floor(Math.log10(v));
  if (!isFinite(x)) x = -324;
  for (let i = 0; i < 10; i++) {
    const q = roundScaled(m, e, prec - x);
    if (q >= P10(prec + 1)) x++;
    else if (q < P10(prec)) x--;
    else return [q.toString(), x];
  }
  throw new Error('exp');
}

function expStr(x: number, upper: boolean): string {
  const a = Math.abs(x);
  return (upper ? 'E' : 'e') + (x < 0 ? '-' : '+') + (a < 10 ? '0' + a : String(a));
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
    let prefix = '';
    let body = '';
    let canZero = false;

    if (conv === 's' || conv === 'c') {
      body = String(arg);
      if (conv === 's' && prec >= 0) body = body.slice(0, prec);
    } else if (conv === 'd' || conv === 'i' || conv === 'x' || conv === 'X' || conv === 'o') {
      const n = typeof arg === 'bigint' ? arg : BigInt(arg as number);
      const neg = n < 0n;
      const mag = neg ? -n : n;
      let digits: string;
      if (conv === 'd' || conv === 'i') digits = mag.toString();
      else if (conv === 'o') digits = mag.toString(8);
      else digits = conv === 'x' ? mag.toString(16) : mag.toString(16).toUpperCase();
      if (prec === 0 && mag === 0n) digits = '';
      if (prec > digits.length) digits = '0'.repeat(prec - digits.length) + digits;
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
            body = ip + (p > 0 || alt ? '.' : '') + fp;
          } else if (lc === 'e') {
            const p = prec < 0 ? 6 : prec;
            const [d, x] = expDigits(a, p);
            body = d[0] + (p > 0 || alt ? '.' : '') + d.slice(1) + expStr(x, upper);
          } else {
            let p = prec < 0 ? 6 : prec;
            if (p === 0) p = 1;
            const [d, x] = expDigits(a, p - 1);
            let s: string;
            if (p > x && x >= -4) {
              const q = p - 1 - x;
              const [ip, fp] = fixedDigits(a, q);
              s = ip + (q > 0 || alt ? '.' : '') + fp;
              if (!alt && q > 0) s = s.replace(/0+$/, '').replace(/\.$/, '');
            } else {
              let mantS = d[0] + (p - 1 > 0 || alt ? '.' : '') + d.slice(1);
              if (!alt && p - 1 > 0) mantS = mantS.replace(/0+$/, '').replace(/\.$/, '');
              s = mantS + expStr(x, upper);
            }
            body = s;
          }
        }
      }
      if (Number.isNaN(v) || a_isInf(v)) canZero = false;
    }

    const len = sign.length + prefix.length + body.length;
    if (len >= width) out += sign + prefix + body;
    else if (minus) out += sign + prefix + body + ' '.repeat(width - len);
    else if (zero && canZero && conv !== 's' && conv !== 'c')
      out += sign + prefix + '0'.repeat(width - len) + body;
    else out += ' '.repeat(width - len) + sign + prefix + body;
  }
  return out;
}

function a_isInf(v: number): boolean {
  return v === Infinity || v === -Infinity;
}
