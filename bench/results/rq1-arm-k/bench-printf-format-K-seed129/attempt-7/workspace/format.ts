function decompose(v: number): { m: bigint; e: number } {
  // v finite, >= 0. v = m * 2^e
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, v);
  const hi = buf.getUint32(0);
  const lo = buf.getUint32(4);
  const be = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (be === 0) return { m, e: -1074 };
  m |= 1n << 52n;
  return { m, e: be - 1075 };
}

// round(m * 2^e * 10^s), half to even
function roundScaled(m: bigint, e: number, s: number): bigint {
  let num = m;
  let den = 1n;
  if (e >= 0) num <<= BigInt(e);
  else den <<= BigInt(-e);
  if (s >= 0) num *= 10n ** BigInt(s);
  else den *= 10n ** BigInt(-s);
  const q = num / den;
  const r = num % den;
  const twice = r * 2n;
  if (twice > den || (twice === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// exact floor(log10(v)) for v > 0
function floorLog10(m: bigint, e: number, v: number): number {
  let x = Math.floor(Math.log10(v));
  if (!Number.isFinite(x)) x = -324;
  const ge = (k: number): boolean => {
    // m*2^e >= 10^k
    let l = m;
    let r = 1n;
    if (e >= 0) l <<= BigInt(e);
    else r <<= BigInt(-e);
    if (k >= 0) r *= 10n ** BigInt(k);
    else l *= 10n ** BigInt(-k);
    return l >= r;
  };
  while (!ge(x)) x--;
  while (ge(x + 1)) x++;
  return x;
}

function fixed(v: number, prec: number, alt: boolean): string {
  const { m, e } = decompose(v);
  let s = roundScaled(m, e, prec).toString();
  if (s.length < prec + 1) s = '0'.repeat(prec + 1 - s.length) + s;
  const ip = s.slice(0, s.length - prec);
  const fp = s.slice(s.length - prec);
  return ip + (prec > 0 || alt ? '.' : '') + fp;
}

// returns digits (prec+1 of them) and exponent
function expDigits(v: number, prec: number): { d: string; x: number } {
  if (v === 0) return { d: '0'.repeat(prec + 1), x: 0 };
  const { m, e } = decompose(v);
  let x = floorLog10(m, e, v);
  let q = roundScaled(m, e, prec - x);
  if (q >= 10n ** BigInt(prec + 1)) {
    x++;
    q = roundScaled(m, e, prec - x);
  }
  return { d: q.toString(), x };
}

function expStyle(v: number, prec: number, alt: boolean, upper: boolean): string {
  const { d, x } = expDigits(v, prec);
  const mant = d[0] + (prec > 0 || alt ? '.' : '') + d.slice(1);
  const ax = Math.abs(x);
  return mant + (upper ? 'E' : 'e') + (x < 0 ? '-' : '+') + (ax < 10 ? '0' + ax : String(ax));
}

function stripZeros(s: string): string {
  if (!s.includes('.')) return s;
  return s.replace(/0+$/, '').replace(/\.$/, '');
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let ai = 0;
  const re = /%([-+ 0#]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc%])/g;
  return fmt.replace(re, (_all, flags: string, w: string, p: string | undefined, conv: string) => {
    if (conv === '%') return '%';
    const arg = args[ai++];
    const left = flags.includes('-');
    const plus = flags.includes('+');
    const space = flags.includes(' ');
    const zero = flags.includes('0') && !left;
    const alt = flags.includes('#');
    const width = w ? parseInt(w, 10) : 0;
    const hasPrec = p !== undefined;
    const prec = hasPrec ? (p === '' ? 0 : parseInt(p!, 10)) : -1;

    const pad = (sign: string, body: string, allowZero: boolean): string => {
      const len = sign.length + body.length;
      if (len >= width) return sign + body;
      if (allowZero && zero) return sign + '0'.repeat(width - len) + body;
      const sp = ' '.repeat(width - len);
      return left ? sign + body + sp : sp + sign + body;
    };

    if (conv === 's' || conv === 'c') {
      let str = String(arg);
      if (conv === 's' && hasPrec) str = str.slice(0, prec);
      return pad('', str, false);
    }

    if (conv === 'd' || conv === 'i' || conv === 'x' || conv === 'X' || conv === 'o') {
      let n = BigInt(arg as number | bigint);
      const neg = n < 0n;
      if (neg) n = -n;
      let digits: string;
      if (conv === 'd' || conv === 'i') digits = n.toString();
      else if (conv === 'o') digits = n.toString(8);
      else digits = n.toString(16);
      if (conv === 'X') digits = digits.toUpperCase();
      if (hasPrec) {
        if (prec === 0 && n === 0n) digits = '';
        else if (digits.length < prec) digits = '0'.repeat(prec - digits.length) + digits;
      }
      let sign = '';
      if (conv === 'd' || conv === 'i') sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
      else if (alt) {
        if (conv === 'o') {
          if (digits[0] !== '0') digits = '0' + digits;
        } else if (n !== 0n) sign = conv === 'x' ? '0x' : '0X';
      }
      return pad(sign, digits, !hasPrec);
    }

    // floating point
    const v = arg as number;
    const upper = conv === 'E' || conv === 'F' || conv === 'G';
    const neg = v < 0 || Object.is(v, -0);
    let sign = '';
    if (!Number.isNaN(v)) sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
    if (!Number.isFinite(v)) {
      const t = Number.isNaN(v) ? 'nan' : 'inf';
      return pad(sign, upper ? t.toUpperCase() : t, false);
    }
    const a = Math.abs(v);
    const P = hasPrec ? prec : 6;
    let body: string;
    const lc = conv.toLowerCase();
    if (lc === 'f') body = fixed(a, P, alt);
    else if (lc === 'e') body = expStyle(a, P, alt, upper);
    else {
      const PP = P === 0 ? 1 : P;
      const { x } = expDigits(a, PP - 1);
      if (PP > x && x >= -4) {
        body = fixed(a, PP - 1 - x, alt);
        if (!alt) body = stripZeros(body);
      } else {
        body = expStyle(a, PP - 1, alt, upper);
        if (!alt) {
          const idx = body.search(/[eE]/);
          body = stripZeros(body.slice(0, idx)) + body.slice(idx);
        }
      }
    }
    return pad(sign, body, true);
  });
}
