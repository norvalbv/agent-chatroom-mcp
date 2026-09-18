function decompose(x: number): [bigint, number] {
  // x finite, >= 0; returns [m, e] with x = m * 2^e exactly
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (expBits === 0) return [m, -1074];
  m |= 1n << 52n;
  return [m, expBits - 1075];
}

// round(x * 10^k), ties to even, exact
function scaled(x: number, k: number): bigint {
  const [m, e] = decompose(x);
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

function fixedDigits(x: number, prec: number): string {
  let s = scaled(x, prec).toString();
  if (prec > 0) {
    s = s.padStart(prec + 1, '0');
    return s.slice(0, s.length - prec) + '.' + s.slice(s.length - prec);
  }
  return s;
}

// returns p+1 significant digits and decimal exponent
function expDigits(x: number, p: number): [string, number] {
  if (x === 0) return ['0'.repeat(p + 1), 0];
  let X = Math.floor(Math.log10(x));
  const lowB = 10n ** BigInt(p);
  const highB = lowB * 10n;
  for (let i = 0; i < 10; i++) {
    const n = scaled(x, p - X);
    if (n >= highB) X++;
    else if (n < lowB) X--;
    else return [n.toString(), X];
  }
  throw new Error('unreachable');
}

function expStr(d: string, X: number, alt: boolean, upper: boolean): string {
  let s = d[0];
  if (d.length > 1) s += '.' + d.slice(1);
  else if (alt) s += '.';
  const ax = Math.abs(X);
  s += (upper ? 'E' : 'e') + (X < 0 ? '-' : '+') + (ax < 10 ? '0' + ax : String(ax));
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
    if (fmt[i] === '*') {
      width = Number(args[ai++]);
      if (width < 0) {
        left = true;
        width = -width;
      }
      i++;
    } else {
      while (fmt[i] >= '0' && fmt[i] <= '9') width = width * 10 + (fmt.charCodeAt(i++) - 48);
    }
    let prec = -1;
    if (fmt[i] === '.') {
      i++;
      prec = 0;
      if (fmt[i] === '*') {
        prec = Number(args[ai++]);
        if (prec < 0) prec = -1;
        i++;
      } else {
        while (fmt[i] >= '0' && fmt[i] <= '9') prec = prec * 10 + (fmt.charCodeAt(i++) - 48);
      }
    }
    let bits = 32;
    if (fmt.startsWith('hh', i)) {
      bits = 8;
      i += 2;
    } else if (fmt.startsWith('ll', i)) {
      bits = 64;
      i += 2;
    } else if (fmt[i] === 'h') {
      bits = 16;
      i++;
    } else if (fmt[i] === 'l') {
      bits = 64;
      i++;
    }
    const conv = fmt[i++];
    const arg = args[ai++];

    let sign = '';
    let prefix = '';
    let body = '';
    let canZero = true;

    switch (conv) {
      case 'd':
      case 'i':
      case 'u':
      case 'x':
      case 'X':
      case 'o': {
        const big = BigInt(arg as number | bigint);
        let v: bigint;
        if (conv === 'd' || conv === 'i') v = BigInt.asIntN(bits, big);
        else v = BigInt.asUintN(bits, big);
        if (v < 0n) {
          sign = '-';
          v = -v;
        } else if (conv === 'd' || conv === 'i') {
          sign = plus ? '+' : space ? ' ' : '';
        }
        let digits =
          conv === 'x' ? v.toString(16) : conv === 'X' ? v.toString(16).toUpperCase() : conv === 'o' ? v.toString(8) : v.toString();
        if (prec === 0 && v === 0n) digits = '';
        if (prec >= 0) {
          digits = digits.padStart(prec, '0');
          canZero = false;
        }
        if (alt) {
          if ((conv === 'x' || conv === 'X') && v !== 0n) prefix = conv === 'x' ? '0x' : '0X';
          else if (conv === 'o' && digits[0] !== '0') digits = '0' + digits;
        }
        body = digits;
        break;
      }
      case 'e':
      case 'E':
      case 'f':
      case 'F':
      case 'g':
      case 'G': {
        const x = arg as number;
        const upper = conv === 'E' || conv === 'F' || conv === 'G';
        const neg = x < 0 || Object.is(x, -0);
        if (!Number.isNaN(x)) sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        if (!Number.isFinite(x)) {
          body = Number.isNaN(x) ? 'nan' : 'inf';
          if (upper) body = body.toUpperCase();
          canZero = false;
          break;
        }
        const ax = Math.abs(x);
        const lc = conv.toLowerCase();
        if (lc === 'f') {
          const p = prec < 0 ? 6 : prec;
          body = fixedDigits(ax, p);
          if (p === 0 && alt) body += '.';
        } else if (lc === 'e') {
          const p = prec < 0 ? 6 : prec;
          const [d, X] = expDigits(ax, p);
          body = expStr(d, X, alt, upper);
        } else {
          let P = prec < 0 ? 6 : prec;
          if (P === 0) P = 1;
          const [d, X] = expDigits(ax, P - 1);
          if (P > X && X >= -4) {
            body = fixedDigits(ax, P - 1 - X);
            if (alt) {
              if (!body.includes('.')) body += '.';
            } else if (body.includes('.')) {
              body = body.replace(/0+$/, '').replace(/\.$/, '');
            }
          } else {
            let mant = d[0] + (d.length > 1 ? '.' + d.slice(1) : '');
            if (!alt && mant.includes('.')) mant = mant.replace(/0+$/, '').replace(/\.$/, '');
            if (alt && !mant.includes('.')) mant += '.';
            const ax2 = Math.abs(X);
            body = mant + (upper ? 'E' : 'e') + (X < 0 ? '-' : '+') + (ax2 < 10 ? '0' + ax2 : String(ax2));
          }
        }
        break;
      }
      case 's': {
        body = String(arg);
        if (prec >= 0) body = body.slice(0, prec);
        canZero = false;
        break;
      }
      case 'c': {
        body = String(arg);
        canZero = false;
        break;
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
