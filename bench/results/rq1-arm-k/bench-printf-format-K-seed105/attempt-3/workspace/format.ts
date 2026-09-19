// Exact decimal expansion of a finite non-negative double: value = D / 10^k.
function exactDecimal(v: number): { D: string; k: number } {
  if (v === 0) return { D: '0', k: 0 };
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, v);
  const hi = buf.getUint32(0);
  const lo = buf.getUint32(4);
  const be = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let e: number;
  if (be === 0) {
    e = -1074;
  } else {
    m |= 1n << 52n;
    e = be - 1075;
  }
  if (e >= 0) return { D: (m << BigInt(e)).toString(), k: 0 };
  const k = -e;
  return { D: (m * 5n ** BigInt(k)).toString(), k };
}

// Keep the first `cut` digits of D, rounding half to even on the exact remainder.
function roundDigits(D: string, cut: number): string {
  if (cut < 0) return '';
  if (cut >= D.length) return D + '0'.repeat(cut - D.length);
  const kept = D.slice(0, cut);
  const rest = D.slice(cut);
  const first = rest.charCodeAt(0) - 48;
  let up = false;
  if (first > 5) up = true;
  else if (first === 5) {
    if (/[1-9]/.test(rest.slice(1))) up = true;
    else {
      const prev = cut === 0 ? 0 : kept.charCodeAt(cut - 1) - 48;
      up = prev % 2 === 1;
    }
  }
  if (!up) return kept;
  if (cut === 0) return '1';
  return (BigInt(kept) + 1n).toString().padStart(cut, '0');
}

function fixedDigits(v: number, prec: number, alt: boolean): string {
  const { D, k } = exactDecimal(v);
  let R = roundDigits(D, D.length - k + prec);
  if (D === '0') R = '0'.repeat(prec + 1);
  R = R.padStart(prec + 1, '0');
  const ip = R.slice(0, R.length - prec);
  const fp = R.slice(R.length - prec);
  return prec > 0 ? ip + '.' + fp : alt ? ip + '.' : ip;
}

function expParts(v: number, prec: number): { digits: string; exp: number } {
  const { D, k } = exactDecimal(v);
  if (D === '0') return { digits: '0'.repeat(prec + 1), exp: 0 };
  let exp = D.length - 1 - k;
  let R = roundDigits(D, prec + 1);
  if (R.length > prec + 1) {
    R = R.slice(0, prec + 1);
    exp += 1;
  }
  return { digits: R, exp };
}

function expStr(digits: string, exp: number, prec: number, alt: boolean, upper: boolean): string {
  let s = digits[0];
  if (prec > 0) s += '.' + digits.slice(1);
  else if (alt) s += '.';
  const a = Math.abs(exp);
  return s + (upper ? 'E' : 'e') + (exp < 0 ? '-' : '+') + (a < 10 ? '0' + a : String(a));
}

function stripZeros(s: string): string {
  // s is either mantissa only, or mantissa+exponent
  const m = /^([0-9]*\.[0-9]*)(.*)$/.exec(s);
  if (!m) return s;
  let body = m[1].replace(/0+$/, '');
  if (body.endsWith('.')) body = body.slice(0, -1);
  return body + m[2];
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
    while (i < fmt.length && fmt[i] >= '0' && fmt[i] <= '9') width = width * 10 + (fmt.charCodeAt(i++) - 48);
    let prec = -1;
    if (fmt[i] === '.') {
      i++;
      prec = 0;
      while (i < fmt.length && fmt[i] >= '0' && fmt[i] <= '9') prec = prec * 10 + (fmt.charCodeAt(i++) - 48);
    }
    const conv = fmt[i++];
    const arg = args[ai++];

    let sign = '';
    let prefix = '';
    let body = '';
    let canZero = zero && !minus;

    if (conv === 's' || conv === 'c') {
      let s = String(arg);
      if (conv === 's' && prec >= 0) s = s.slice(0, prec);
      body = s;
      canZero = false;
    } else if ('dixXo'.includes(conv)) {
      const n = BigInt(arg as number | bigint);
      const neg = n < 0n;
      const mag = neg ? -n : n;
      let digits = conv === 'd' || conv === 'i' ? mag.toString() : conv === 'o' ? mag.toString(8) : mag.toString(16);
      if (conv === 'X') digits = digits.toUpperCase();
      if (prec >= 0) {
        if (prec === 0 && mag === 0n) digits = '';
        digits = digits.padStart(prec, '0');
        canZero = false;
      }
      if (conv === 'd' || conv === 'i') {
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
      } else if (alt) {
        if (conv === 'o') {
          if (!digits.startsWith('0')) digits = '0' + digits;
        } else if (mag !== 0n) {
          prefix = conv === 'x' ? '0x' : '0X';
        }
      }
      body = digits;
    } else {
      const v = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      if (Number.isNaN(v)) {
        body = upper ? 'NAN' : 'nan';
        canZero = false;
      } else {
        const neg = v < 0 || Object.is(v, -0);
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        const a = Math.abs(v);
        if (a === Infinity) {
          body = upper ? 'INF' : 'inf';
          canZero = false;
        } else {
          const lc = conv.toLowerCase();
          if (lc === 'f') {
            body = fixedDigits(a, prec < 0 ? 6 : prec, alt);
          } else if (lc === 'e') {
            const p = prec < 0 ? 6 : prec;
            const { digits, exp } = expParts(a, p);
            body = expStr(digits, exp, p, alt, upper);
          } else {
            let P = prec < 0 ? 6 : prec;
            if (P === 0) P = 1;
            const { digits, exp } = expParts(a, P - 1);
            if (P > exp && exp >= -4) {
              body = fixedDigits(a, P - 1 - exp, alt);
            } else {
              body = expStr(digits, exp, P - 1, alt, upper);
            }
            if (!alt) body = stripZeros(body);
          }
        }
      }
    }

    const len = sign.length + prefix.length + body.length;
    if (len >= width) {
      out += sign + prefix + body;
    } else if (minus) {
      out += sign + prefix + body + ' '.repeat(width - len);
    } else if (canZero) {
      out += sign + prefix + '0'.repeat(width - len) + body;
    } else {
      out += ' '.repeat(width - len) + sign + prefix + body;
    }
  }
  return out;
}
