function decompose(x: number): { m: bigint; e: number } {
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, x);
  const hi = buf.getUint32(0);
  const lo = buf.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let e: number;
  if (expBits === 0) {
    e = -1074;
  } else {
    m |= 1n << 52n;
    e = expBits - 1075;
  }
  return { m, e };
}

function roundDiv(num: bigint, den: bigint): bigint {
  const q = num / den;
  const r = num % den;
  const c = 2n * r - den;
  if (c > 0n || (c === 0n && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// round(x * 10^s) exactly, half-even; x > 0 finite
function scaled(x: number, s: number): bigint {
  const { m, e } = decompose(x);
  let num = m;
  let den = 1n;
  if (s >= 0) num *= 10n ** BigInt(s);
  else den *= 10n ** BigInt(-s);
  if (e >= 0) num <<= BigInt(e);
  else den <<= BigInt(-e);
  return roundDiv(num, den);
}

// digits string (prec+1 digits) and decimal exponent
function expDigits(x: number, prec: number): { digits: string; exp: number } {
  if (x === 0) return { digits: '0'.repeat(prec + 1), exp: 0 };
  let e10 = Math.floor(Math.log10(x));
  const lo = 10n ** BigInt(prec);
  const hi = lo * 10n;
  for (;;) {
    const d = scaled(x, prec - e10);
    if (d >= hi) e10++;
    else if (d < lo) e10--;
    else return { digits: d.toString(), exp: e10 };
  }
}

function fixedDigits(x: number, prec: number): string {
  // returns integer part + '.' + fraction (or without '.' when prec 0)
  let s = x === 0 ? '0' : scaled(x, prec).toString();
  if (prec === 0) return s;
  s = s.padStart(prec + 1, '0');
  return s.slice(0, s.length - prec) + '.' + s.slice(s.length - prec);
}

function expStr(digits: string, exp: number, upper: boolean, alt: boolean): string {
  let s = digits[0];
  const frac = digits.slice(1);
  if (frac.length > 0 || alt) s += '.' + frac;
  const a = Math.abs(exp);
  return s + (upper ? 'E' : 'e') + (exp < 0 ? '-' : '+') + (a < 10 ? '0' + a : String(a));
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
    let sign = '';
    let prefix = '';
    let body = '';
    let numeric = true;
    let canZero = true;

    if (conv === 'd' || conv === 'i') {
      const v = BigInt(arg as number | bigint);
      const neg = v < 0n;
      let digits = (neg ? -v : v).toString();
      if (prec === 0 && v === 0n) digits = '';
      if (prec >= 0) {
        digits = digits.padStart(prec, '0');
        canZero = false;
      }
      body = digits;
      sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
    } else if (conv === 'x' || conv === 'X' || conv === 'o') {
      const v = BigInt(arg as number | bigint);
      let digits = v.toString(conv === 'o' ? 8 : 16);
      if (conv === 'X') digits = digits.toUpperCase();
      if (prec === 0 && v === 0n) digits = '';
      if (prec >= 0) {
        digits = digits.padStart(prec, '0');
        canZero = false;
      }
      if (alt) {
        if (conv === 'o') {
          if (digits[0] !== '0') digits = '0' + digits;
        } else if (v !== 0n) {
          prefix = conv === 'x' ? '0x' : '0X';
        }
      }
      body = digits;
    } else if ('eEfFgG'.includes(conv)) {
      const x = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      if (Number.isNaN(x)) {
        body = upper ? 'NAN' : 'nan';
        canZero = false;
      } else {
        const neg = x < 0 || Object.is(x, -0);
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        const a = Math.abs(x);
        if (a === Infinity) {
          body = upper ? 'INF' : 'inf';
          canZero = false;
        } else {
          const lc = conv.toLowerCase();
          if (lc === 'e') {
            const p = prec < 0 ? 6 : prec;
            const r = expDigits(a, p);
            body = expStr(r.digits, r.exp, upper, alt);
          } else if (lc === 'f') {
            const p = prec < 0 ? 6 : prec;
            body = fixedDigits(a, p);
            if (p === 0 && alt) body += '.';
          } else {
            let P = prec < 0 ? 6 : prec;
            if (P === 0) P = 1;
            const r = expDigits(a, P - 1);
            const X = r.exp;
            if (P > X && X >= -4) {
              body = fixedDigits(a, P - 1 - X);
              if (alt) {
                if (!body.includes('.')) body += '.';
              } else body = stripZeros(body);
            } else {
              let s = expStr(r.digits, r.exp, upper, alt);
              if (!alt) {
                const k = s.search(/[eE]/);
                s = stripZeros(s.slice(0, k)) + s.slice(k);
              }
              body = s;
            }
          }
        }
      }
    } else if (conv === 's') {
      numeric = false;
      body = String(arg);
      if (prec >= 0) body = body.slice(0, prec);
    } else {
      numeric = false;
      body = String(arg);
    }

    const len = sign.length + prefix.length + body.length;
    if (len >= width) out += sign + prefix + body;
    else if (minus) out += sign + prefix + body + ' '.repeat(width - len);
    else if (zero && numeric && canZero) out += sign + prefix + '0'.repeat(width - len) + body;
    else out += ' '.repeat(width - len) + sign + prefix + body;
  }
  return out;
}
