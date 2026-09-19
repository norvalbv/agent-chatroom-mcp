function decompose(v: number): { neg: boolean; m: bigint; e: number } {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, v);
  const bits = dv.getBigUint64(0);
  const neg = (bits >> 63n) === 1n;
  const ex = Number((bits >> 52n) & 0x7ffn);
  const frac = bits & ((1n << 52n) - 1n);
  if (ex === 0) return { neg, m: frac, e: -1074 };
  return { neg, m: frac | (1n << 52n), e: ex - 1075 };
}

// round-half-even of m * 2^e * 10^k
function scaled(m: bigint, e: number, k: number): bigint {
  let num = m;
  let den = 1n;
  if (e >= 0) num <<= BigInt(e);
  else den <<= BigInt(-e);
  if (k >= 0) num *= 10n ** BigInt(k);
  else den *= 10n ** BigInt(-k);
  let q = num / den;
  const r = num % den;
  const twice = r * 2n;
  if (twice > den || (twice === den && (q & 1n) === 1n)) q++;
  return q;
}

// digits string of length p+1 and decimal exponent, for e-style
function eDigits(m: bigint, e: number, v: number, p: number): { digits: string; x: number } {
  if (m === 0n) return { digits: '0'.repeat(p + 1), x: 0 };
  let x = Math.floor(Math.log10(Math.abs(v)));
  if (!Number.isFinite(x)) x = -324;
  const lo = 10n ** BigInt(p);
  const hi = lo * 10n;
  for (let i = 0; i < 10; i++) {
    const n = scaled(m, e, p - x);
    if (n >= hi) x++;
    else if (n < lo) x--;
    else return { digits: n.toString(), x };
  }
  throw new Error('exponent search failed');
}

function fixedStr(m: bigint, e: number, p: number, alt: boolean): string {
  const s = scaled(m, e, p).toString().padStart(p + 1, '0');
  if (p === 0) return alt ? s + '.' : s;
  return s.slice(0, s.length - p) + '.' + s.slice(s.length - p);
}

function expStr(digits: string, x: number, p: number, alt: boolean, upper: boolean): string {
  let s = digits[0];
  if (p > 0) s += '.' + digits.slice(1);
  else if (alt) s += '.';
  const ax = Math.abs(x);
  s += (upper ? 'E' : 'e') + (x < 0 ? '-' : '+') + (ax < 10 ? '0' : '') + ax;
  return s;
}

function stripZeros(s: string): string {
  if (!s.includes('.')) return s;
  return s.replace(/0+$/, '').replace(/\.$/, '');
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let out = '';
  let ai = 0;
  const re = /%([-+ 0#]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc%])/y;
  let i = 0;
  while (i < fmt.length) {
    const c = fmt[i];
    if (c !== '%') {
      out += c;
      i++;
      continue;
    }
    re.lastIndex = i;
    const mt = re.exec(fmt);
    if (!mt) {
      out += c;
      i++;
      continue;
    }
    i = re.lastIndex;
    const flags = mt[1];
    const width = mt[2] ? parseInt(mt[2], 10) : 0;
    const hasPrec = mt[3] !== undefined;
    const prec = hasPrec ? (mt[3] === '' ? 0 : parseInt(mt[3], 10)) : -1;
    const conv = mt[4];
    if (conv === '%') {
      out += '%';
      continue;
    }
    const left = flags.includes('-');
    const plus = flags.includes('+');
    const space = flags.includes(' ');
    const zero = flags.includes('0') && !left;
    const alt = flags.includes('#');
    const arg = args[ai++];

    let sign = '';
    let prefix = '';
    let body = '';
    let zeroOk = true;
    const signFor = (neg: boolean) => (neg ? '-' : plus ? '+' : space ? ' ' : '');

    if (conv === 's' || conv === 'c') {
      let s = String(arg);
      if (conv === 's' && hasPrec) s = s.slice(0, prec);
      body = s;
      zeroOk = false;
    } else if (conv === 'd' || conv === 'i' || conv === 'x' || conv === 'X' || conv === 'o') {
      const b = BigInt(arg as number | bigint);
      const neg = b < 0n;
      const mag = neg ? -b : b;
      let digits = conv === 'd' || conv === 'i' ? mag.toString() : conv === 'o' ? mag.toString(8) : mag.toString(16);
      if (conv === 'X') digits = digits.toUpperCase();
      if (hasPrec) {
        if (prec === 0 && mag === 0n) digits = '';
        digits = digits.padStart(prec, '0');
        zeroOk = false;
      }
      if (conv === 'd' || conv === 'i') sign = signFor(neg);
      else if (alt) {
        if (conv === 'o') {
          if (!digits.startsWith('0')) digits = '0' + digits;
        } else if (mag !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      }
      body = digits;
    } else {
      const v = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      if (Number.isNaN(v)) {
        body = upper ? 'NAN' : 'nan';
        zeroOk = false;
      } else {
        const { neg, m, e } = decompose(v);
        sign = signFor(neg);
        if (!Number.isFinite(v)) {
          body = upper ? 'INF' : 'inf';
          zeroOk = false;
        } else {
          const lc = conv.toLowerCase();
          const p = hasPrec ? prec : 6;
          if (lc === 'f') body = fixedStr(m, e, p, alt);
          else if (lc === 'e') {
            const r = eDigits(m, e, v, p);
            body = expStr(r.digits, r.x, p, alt, upper);
          } else {
            const P = p === 0 ? 1 : p;
            const r = eDigits(m, e, v, P - 1);
            if (P > r.x && r.x >= -4) {
              body = fixedStr(m, e, P - 1 - r.x, alt);
              if (!alt) body = stripZeros(body);
            } else {
              let s = expStr(r.digits, r.x, P - 1, alt, upper);
              if (!alt) {
                const k = s.search(/[eE]/);
                s = stripZeros(s.slice(0, k)) + s.slice(k);
              }
              body = s;
            }
          }
        }
      }
    }

    const len = sign.length + prefix.length + body.length;
    if (len >= width) out += sign + prefix + body;
    else if (left) out += sign + prefix + body + ' '.repeat(width - len);
    else if (zero && zeroOk) out += sign + prefix + '0'.repeat(width - len) + body;
    else out += ' '.repeat(width - len) + sign + prefix + body;
  }
  return out;
}
