// value = m * 2^e exactly, for finite non-negative v
function decompose(v: number): [bigint, number] {
  if (v === 0) return [0n, 0];
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, v);
  const bits = dv.getBigUint64(0);
  const exp = Number((bits >> 52n) & 0x7ffn);
  const frac = bits & ((1n << 52n) - 1n);
  if (exp === 0) return [frac, -1074];
  return [frac | (1n << 52n), exp - 1075];
}

// round(m * 2^e * 10^k), half to even
function roundScaled(m: bigint, e: number, k: number): bigint {
  let num = m;
  let den = 1n;
  if (e >= 0) num <<= BigInt(e);
  else den <<= BigInt(-e);
  if (k >= 0) num *= 10n ** BigInt(k);
  else den *= 10n ** BigInt(-k);
  const q = num / den;
  const r = num - q * den;
  const twice = r * 2n;
  if (twice > den || (twice === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

function fixedDigits(v: number, prec: number): string {
  const [m, e] = decompose(v);
  let s = roundScaled(m, e, prec).toString();
  if (prec > 0) {
    s = s.padStart(prec + 1, '0');
    return s.slice(0, s.length - prec) + '.' + s.slice(s.length - prec);
  }
  return s;
}

// returns [digits (prec+1 chars), exponent]
function expDigits(v: number, prec: number): [string, number] {
  if (v === 0) return ['0'.repeat(prec + 1), 0];
  const [m, e] = decompose(v);
  let x = Math.floor(Math.log10(v));
  if (!isFinite(x)) x = -324;
  for (let i = 0; i < 20; i++) {
    const s = roundScaled(m, e, prec - x).toString();
    if (s.length > prec + 1) x++;
    else if (s.length < prec + 1) x--;
    else return [s, x];
  }
  throw new Error('exp');
}

function expStr(v: number, prec: number, alt: boolean, upper: boolean): string {
  const [d, x] = expDigits(v, prec);
  let s = d[0];
  if (prec > 0) s += '.' + d.slice(1);
  else if (alt) s += '.';
  const ax = Math.abs(x);
  s += (upper ? 'E' : 'e') + (x < 0 ? '-' : '+') + (ax < 10 ? '0' : '') + ax;
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
    for (; i < fmt.length; i++) {
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
      while (fmt[i] >= '0' && fmt[i] <= '9') width = width * 10 + Number(fmt[i++]);
    }
    let prec = -1;
    if (fmt[i] === '.') {
      i++;
      if (fmt[i] === '*') {
        prec = Number(args[ai++]);
        if (prec < 0) prec = -1;
        i++;
      } else {
        prec = 0;
        while (fmt[i] >= '0' && fmt[i] <= '9') prec = prec * 10 + Number(fmt[i++]);
      }
    }
    let bitsN = 32;
    if (fmt.startsWith('hh', i)) { bitsN = 8; i += 2; }
    else if (fmt.startsWith('ll', i)) { bitsN = 64; i += 2; }
    else if (fmt[i] === 'h') { bitsN = 16; i++; }
    else if (fmt[i] === 'l') { bitsN = 64; i++; }
    const conv = fmt[i++];
    const arg = args[ai++];

    let prefix = '';
    let body = '';
    let zeroOk = false;

    if (conv === 's' || conv === 'c') {
      body = String(arg);
      if (conv === 's' && prec >= 0) body = body.slice(0, prec);
    } else if ('diuxXo'.includes(conv)) {
      const big = BigInt(arg as number | bigint);
      let digits: string;
      let neg = false;
      let isZero: boolean;
      if (conv === 'd' || conv === 'i') {
        const v = BigInt.asIntN(bitsN, big);
        neg = v < 0n;
        digits = (neg ? -v : v).toString();
        isZero = v === 0n;
      } else {
        const v = BigInt.asUintN(bitsN, big);
        isZero = v === 0n;
        digits = v.toString(conv === 'o' ? 8 : conv === 'u' ? 10 : 16);
        if (conv === 'X') digits = digits.toUpperCase();
      }
      if (prec === 0 && isZero) digits = '';
      if (prec > 0) digits = digits.padStart(prec, '0');
      if (conv === 'd' || conv === 'i') prefix = neg ? '-' : plus ? '+' : space ? ' ' : '';
      else if (alt && conv === 'o') {
        if (digits[0] !== '0') digits = '0' + digits;
      } else if (alt && (conv === 'x' || conv === 'X') && !isZero) prefix = conv === 'x' ? '0x' : '0X';
      body = digits;
      zeroOk = prec < 0;
    } else {
      const v = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      const neg = v < 0 || Object.is(v, -0);
      if (Number.isNaN(v)) {
        body = upper ? 'NAN' : 'nan';
      } else {
        prefix = neg ? '-' : plus ? '+' : space ? ' ' : '';
        if (!isFinite(v)) {
          body = upper ? 'INF' : 'inf';
        } else {
          const a = Math.abs(v);
          zeroOk = true;
          const lc = conv.toLowerCase();
          const p = prec < 0 ? 6 : prec;
          if (lc === 'f') {
            body = fixedDigits(a, p);
            if (p === 0 && alt) body += '.';
          } else if (lc === 'e') {
            body = expStr(a, p, alt, upper);
          } else {
            const P = p === 0 ? 1 : p;
            const X = expDigits(a, P - 1)[1];
            let s: string;
            if (P > X && X >= -4) {
              s = fixedDigits(a, P - 1 - X);
              if (!alt) {
                if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
              } else if (!s.includes('.')) s += '.';
              body = s;
            } else {
              s = expStr(a, P - 1, alt, upper);
              if (!alt) {
                const k = s.search(/[eE]/);
                let mant = s.slice(0, k);
                if (mant.includes('.')) mant = mant.replace(/0+$/, '').replace(/\.$/, '');
                s = mant + s.slice(k);
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
    else if (zero && zeroOk && conv !== 's' && conv !== 'c') out += prefix + '0'.repeat(width - len) + body;
    else out += ' '.repeat(width - len) + prefix + body;
  }
  return out;
}
