function decompose(v: number): { m: bigint; e2: number } {
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, Math.abs(v));
  const hi = buf.getUint32(0);
  const lo = buf.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (expBits === 0) return { m, e2: -1074 };
  m |= 1n << 52n;
  return { m, e2: expBits - 1075 };
}

// round(|v| * 10^k), half to even, exact
function roundScaled(m: bigint, e2: number, k: number): bigint {
  let num = m;
  let den = 1n;
  if (e2 >= 0) num <<= BigInt(e2);
  else den <<= BigInt(-e2);
  if (k >= 0) num *= 10n ** BigInt(k);
  else den *= 10n ** BigInt(-k);
  const q = num / den;
  const r2 = (num % den) * 2n;
  if (r2 > den || (r2 === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

function fixedDigits(v: number, p: number): string {
  const { m, e2 } = decompose(v);
  let s = roundScaled(m, e2, p).toString();
  if (p > 0) {
    s = s.padStart(p + 1, '0');
    return s.slice(0, s.length - p) + '.' + s.slice(s.length - p);
  }
  return s;
}

function expParts(v: number, p: number): { digits: string; x: number } {
  if (v === 0) return { digits: '0'.repeat(p + 1), x: 0 };
  const { m, e2 } = decompose(v);
  let x = Math.floor(Math.log10(Math.abs(v)));
  if (!isFinite(x)) x = Math.floor((m.toString(2).length - 1 + e2) * Math.log10(2));
  // fix estimate: want 10^x <= |v| < 10^(x+1)
  const ge = (k: number) => {
    // |v| >= 10^k ?
    return roundFloorCmp(m, e2, k) >= 0;
  };
  while (!ge(x)) x--;
  while (ge(x + 1)) x++;
  let d = roundScaled(m, e2, p - x);
  if (d >= 10n ** BigInt(p + 1)) {
    x++;
    d = roundScaled(m, e2, p - x);
  }
  return { digits: d.toString(), x };
}

// compare |v| with 10^k: returns -1,0,1
function roundFloorCmp(m: bigint, e2: number, k: number): number {
  let a = m;
  let b = 1n;
  if (e2 >= 0) a <<= BigInt(e2);
  else b <<= BigInt(-e2);
  if (k >= 0) b *= 10n ** BigInt(k);
  else a *= 10n ** BigInt(-k);
  return a > b ? 1 : a < b ? -1 : 0;
}

function expStr(digits: string, x: number, p: number, alt: boolean, upper: boolean): string {
  let s = digits[0];
  if (p > 0 || alt) s += '.';
  s += digits.slice(1);
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
    let numeric = true;
    let canZero = true;

    if (conv === 's' || conv === 'c') {
      numeric = false;
      body = String(arg);
      if (conv === 's' && prec >= 0) body = body.slice(0, prec);
    } else if (conv === 'd' || conv === 'i' || conv === 'x' || conv === 'X' || conv === 'o') {
      const v = BigInt(arg as number | bigint);
      const neg = v < 0n;
      const mag = neg ? -v : v;
      let digits = mag.toString(conv === 'o' ? 8 : conv === 'd' || conv === 'i' ? 10 : 16);
      if (conv === 'X') digits = digits.toUpperCase();
      if (prec === 0 && mag === 0n) digits = '';
      if (prec >= 0) digits = digits.padStart(prec, '0');
      if (conv === 'd' || conv === 'i') {
        prefix = neg ? '-' : plus ? '+' : space ? ' ' : '';
      } else if (alt) {
        if (conv === 'o') {
          if (!digits.startsWith('0')) digits = '0' + digits;
        } else if (mag !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      }
      body = digits;
      if (prec >= 0) canZero = false;
    } else {
      const v = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      const neg = v < 0 || Object.is(v, -0);
      if (Number.isNaN(v)) {
        body = upper ? 'NAN' : 'nan';
        canZero = false;
      } else {
        prefix = neg ? '-' : plus ? '+' : space ? ' ' : '';
        if (!isFinite(v)) {
          body = upper ? 'INF' : 'inf';
          canZero = false;
        } else {
          const lc = conv.toLowerCase();
          if (lc === 'f') {
            const p = prec < 0 ? 6 : prec;
            body = fixedDigits(v, p);
            if (p === 0 && alt) body += '.';
          } else if (lc === 'e') {
            const p = prec < 0 ? 6 : prec;
            const { digits, x } = expParts(v, p);
            body = expStr(digits, x, p, alt, upper);
          } else {
            const P = prec < 0 ? 6 : prec === 0 ? 1 : prec;
            const { digits, x } = expParts(v, P - 1);
            if (P > x && x >= -4) {
              const p = P - 1 - x;
              body = fixedDigits(v, p);
              if (p === 0 && alt) body += '.';
              if (!alt) body = stripZeros(body);
            } else {
              let s = expStr(digits, x, P - 1, alt, upper);
              if (!alt) {
                const at = s.search(/[eE]/);
                s = stripZeros(s.slice(0, at)) + s.slice(at);
              }
              body = s;
            }
          }
        }
      }
    }

    const len = prefix.length + body.length;
    if (len >= width) out += prefix + body;
    else if (left) out += prefix + body + ' '.repeat(width - len);
    else if (zero && numeric && canZero) out += prefix + '0'.repeat(width - len) + body;
    else out += ' '.repeat(width - len) + prefix + body;
  }
  return out;
}
