function decompose(x: number): { m: bigint; e: number } {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, x);
  const bits = dv.getBigUint64(0);
  const exp = Number((bits >> 52n) & 0x7ffn);
  const frac = bits & ((1n << 52n) - 1n);
  if (exp === 0) return { m: frac, e: -1074 };
  return { m: frac | (1n << 52n), e: exp - 1075 };
}

// round(m * 2^e * 10^k), ties to even
function roundScaled(m: bigint, e: number, k: number): bigint {
  let num = m;
  let den = 1n;
  if (e >= 0) num <<= BigInt(e);
  else den <<= BigInt(-e);
  if (k >= 0) num *= 10n ** BigInt(k);
  else den *= 10n ** BigInt(-k);
  const q = num / den;
  const r2 = (num % den) * 2n;
  if (r2 > den || (r2 === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

function fixedStr(ax: number, prec: number, alt: boolean): string {
  const { m, e } = decompose(ax);
  let s = roundScaled(m, e, prec).toString();
  if (prec > 0) {
    s = s.padStart(prec + 1, '0');
    return s.slice(0, s.length - prec) + '.' + s.slice(s.length - prec);
  }
  return alt ? s + '.' : s;
}

function expParts(ax: number, prec: number): { digits: string; X: number } {
  if (ax === 0) return { digits: '0'.repeat(prec + 1), X: 0 };
  const { m, e } = decompose(ax);
  let X = Math.floor(Math.log10(ax));
  if (!isFinite(X)) X = 0;
  const lo = 10n ** BigInt(prec);
  const hi = lo * 10n;
  for (;;) {
    const n = roundScaled(m, e, prec - X);
    if (n >= hi) X++;
    else if (n < lo) X--;
    else return { digits: n.toString(), X };
  }
}

function expStr(digits: string, X: number, alt: boolean, upper: boolean, stripZeros: boolean): string {
  let frac = digits.slice(1);
  if (stripZeros) frac = frac.replace(/0+$/, '');
  let s = digits[0];
  if (frac.length > 0) s += '.' + frac;
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
    if (fmt[i] === '*') {
      width = Number(args[ai++]);
      if (width < 0) {
        minus = true;
        width = -width;
      }
      i++;
    } else {
      while (fmt[i] >= '0' && fmt[i] <= '9') width = width * 10 + Number(fmt[i++]);
    }
    let prec: number | null = null;
    if (fmt[i] === '.') {
      i++;
      if (fmt[i] === '*') {
        const p = Number(args[ai++]);
        prec = p < 0 ? null : p;
        i++;
      } else {
        let p = 0;
        while (fmt[i] >= '0' && fmt[i] <= '9') p = p * 10 + Number(fmt[i++]);
        prec = p;
      }
    }
    let bitsN = 32;
    if (fmt[i] === 'h') {
      i++;
      if (fmt[i] === 'h') {
        i++;
        bitsN = 8;
      } else bitsN = 16;
    } else if (fmt[i] === 'l') {
      i++;
      if (fmt[i] === 'l') i++;
      bitsN = 64;
    }
    const conv = fmt[i++];
    const arg = args[ai++];

    let prefix = ''; // sign / 0x prefix
    let body = '';
    let canZero = true;
    const signFor = (neg: boolean) => (neg ? '-' : plus ? '+' : space ? ' ' : '');

    switch (conv) {
      case 'd': case 'i': case 'u': case 'x': case 'X': case 'o': {
        const big = BigInt(arg as number | bigint);
        let v: bigint;
        if (conv === 'd' || conv === 'i') v = BigInt.asIntN(bitsN, big);
        else v = BigInt.asUintN(bitsN, big);
        const neg = v < 0n;
        const mag = neg ? -v : v;
        let digits = mag.toString(conv === 'x' || conv === 'X' ? 16 : conv === 'o' ? 8 : 10);
        if (conv === 'X') digits = digits.toUpperCase();
        if (prec !== null) {
          if (prec === 0 && mag === 0n) digits = '';
          digits = digits.padStart(prec, '0');
          canZero = false;
        }
        if (conv === 'd' || conv === 'i') prefix = signFor(neg);
        if (alt) {
          if ((conv === 'x' || conv === 'X') && mag !== 0n) prefix = conv === 'x' ? '0x' : '0X';
          else if (conv === 'o' && digits[0] !== '0') digits = '0' + digits;
        }
        body = digits;
        break;
      }
      case 'e': case 'E': case 'f': case 'F': case 'g': case 'G': {
        const x = arg as number;
        const upper = conv === 'E' || conv === 'F' || conv === 'G';
        if (Number.isNaN(x)) {
          body = upper ? 'NAN' : 'nan';
          canZero = false;
          break;
        }
        const neg = x < 0 || Object.is(x, -0);
        prefix = signFor(neg);
        if (!isFinite(x)) {
          body = upper ? 'INF' : 'inf';
          canZero = false;
          break;
        }
        const ax = Math.abs(x);
        const lc = conv.toLowerCase();
        if (lc === 'f') {
          body = fixedStr(ax, prec ?? 6, alt);
        } else if (lc === 'e') {
          const p = prec ?? 6;
          const { digits, X } = expParts(ax, p);
          body = expStr(digits, X, alt, upper, false);
        } else {
          let P = prec ?? 6;
          if (P === 0) P = 1;
          const { digits, X } = expParts(ax, P - 1);
          if (P > X && X >= -4) {
            body = fixedStr(ax, P - 1 - X, alt);
            if (!alt && body.includes('.')) body = body.replace(/0+$/, '').replace(/\.$/, '');
          } else {
            body = expStr(digits, X, alt, upper, !alt);
          }
        }
        break;
      }
      case 's': {
        body = String(arg);
        if (prec !== null) body = body.slice(0, prec);
        canZero = false;
        break;
      }
      case 'c': {
        body = String(arg);
        canZero = false;
        break;
      }
    }

    const isNum = conv !== 's' && conv !== 'c';
    const len = prefix.length + body.length;
    if (len >= width) out += prefix + body;
    else if (minus) out += prefix + body + ' '.repeat(width - len);
    else if (zero && isNum && canZero) out += prefix + '0'.repeat(width - len) + body;
    else out += ' '.repeat(width - len) + prefix + body;
  }
  return out;
}
