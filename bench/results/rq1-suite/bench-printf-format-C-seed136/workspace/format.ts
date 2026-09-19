function decompose(v: number): { m: bigint; e: number } {
  const f = new Float64Array(1);
  const u = new BigUint64Array(f.buffer);
  f[0] = Math.abs(v);
  const bits = u[0];
  const ex = Number((bits >> 52n) & 0x7ffn);
  const frac = bits & 0xfffffffffffffn;
  if (ex === 0) return { m: frac, e: -1074 };
  return { m: frac | (1n << 52n), e: ex - 1075 };
}

function divRound(num: bigint, den: bigint): bigint {
  const q = num / den;
  const r = num - q * den;
  const twice = r * 2n;
  if (twice > den || (twice === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// round(|v| * 10^s) half-even, exactly
function scaled(v: number, s: number): bigint {
  const { m, e } = decompose(v);
  let num = m;
  let den = 1n;
  if (e >= 0) num <<= BigInt(e);
  else den <<= BigInt(-e);
  if (s >= 0) num *= 10n ** BigInt(s);
  else den *= 10n ** BigInt(-s);
  return divRound(num, den);
}

function fixedStr(v: number, prec: number, alt: boolean): string {
  let d = scaled(v, prec).toString();
  if (prec > 0) {
    d = d.padStart(prec + 1, '0');
    return d.slice(0, d.length - prec) + '.' + d.slice(d.length - prec);
  }
  return alt ? d + '.' : d;
}

// digits (prec+1 of them) and decimal exponent, correctly rounded
function expParts(v: number, prec: number): { digits: string; x: number } {
  if (v === 0) return { digits: '0'.repeat(prec + 1), x: 0 };
  let x = Math.floor(Math.log10(Math.abs(v)));
  if (!isFinite(x)) x = -324;
  for (;;) {
    const d = scaled(v, prec - x);
    const lo = 10n ** BigInt(prec);
    if (d >= lo * 10n) x++;
    else if (d < lo) x--;
    else return { digits: d.toString(), x };
  }
}

function expStr(v: number, prec: number, alt: boolean, upper: boolean): string {
  const { digits, x } = expParts(v, prec);
  let s = digits[0];
  if (prec > 0) s += '.' + digits.slice(1);
  else if (alt) s += '.';
  const ax = Math.abs(x);
  s += (upper ? 'E' : 'e') + (x < 0 ? '-' : '+') + (ax < 10 ? '0' + ax : String(ax));
  return s;
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
    let left = false, plus = false, space = false, zero = false, alt = false;
    for (;; i++) {
      const c = fmt[i];
      if (c === '-') left = true;
      else if (c === '+') plus = true;
      else if (c === ' ') space = true;
      else if (c === '0') zero = true;
      else if (c === '#') alt = true;
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
    let canZero = true;

    if (conv === 's' || conv === 'c') {
      let s = String(arg);
      if (conv === 's' && prec >= 0) s = s.slice(0, prec);
      body = s;
      canZero = false;
    } else if (conv === 'd' || conv === 'i' || conv === 'x' || conv === 'X' || conv === 'o') {
      const n = BigInt(arg as number | bigint);
      const neg = n < 0n;
      const mag = neg ? -n : n;
      const radix = conv === 'o' ? 8 : conv === 'd' || conv === 'i' ? 10 : 16;
      let digits = mag.toString(radix);
      if (conv === 'X') digits = digits.toUpperCase();
      if (prec === 0 && mag === 0n) digits = '';
      if (prec > 0) digits = digits.padStart(prec, '0');
      if (conv === 'd' || conv === 'i') {
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
      } else if (alt) {
        if (conv === 'o') {
          if (digits[0] !== '0') digits = '0' + digits;
        } else if (mag !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      }
      body = digits;
      if (prec >= 0) canZero = false;
    } else {
      const v = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      const neg = v < 0 || Object.is(v, -0);
      if (!Number.isNaN(v)) sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
      if (Number.isNaN(v)) {
        body = upper ? 'NAN' : 'nan';
        canZero = false;
      } else if (!isFinite(v)) {
        body = upper ? 'INF' : 'inf';
        canZero = false;
      } else if (conv === 'f' || conv === 'F') {
        body = fixedStr(v, prec < 0 ? 6 : prec, alt);
      } else if (conv === 'e' || conv === 'E') {
        body = expStr(v, prec < 0 ? 6 : prec, alt, upper);
      } else {
        let P = prec < 0 ? 6 : prec;
        if (P === 0) P = 1;
        const x = expParts(v, P - 1).x;
        if (P > x && x >= -4) {
          body = fixedStr(v, P - 1 - x, alt);
          if (!alt) body = stripZeros(body);
        } else {
          let s = expStr(v, P - 1, alt, upper);
          if (!alt) {
            const k = s.search(/[eE]/);
            s = stripZeros(s.slice(0, k)) + s.slice(k);
          }
          body = s;
        }
      }
    }

    const len = sign.length + prefix.length + body.length;
    if (len >= width) out += sign + prefix + body;
    else if (left) out += sign + prefix + body + ' '.repeat(width - len);
    else if (zero && canZero) out += sign + prefix + '0'.repeat(width - len) + body;
    else out += ' '.repeat(width - len) + sign + prefix + body;
  }
  return out;
}
