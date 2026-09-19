function decompose(ax: number): { m: bigint; e: number } {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, ax);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const bexp = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (bexp === 0) return { m, e: -1074 };
  m |= 1n << 52n;
  return { m, e: bexp - 1075 };
}

// round-half-even of ax * 10^k, exactly
function scaled(ax: number, k: number): bigint {
  if (ax === 0) return 0n;
  const { m, e } = decompose(ax);
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

function fixedStr(ax: number, prec: number, alt: boolean): string {
  let s = scaled(ax, prec).toString();
  if (s.length < prec + 1) s = '0'.repeat(prec + 1 - s.length) + s;
  const ip = s.slice(0, s.length - prec);
  const fp = s.slice(s.length - prec);
  return prec > 0 ? ip + '.' + fp : alt ? ip + '.' : ip;
}

function sciParts(ax: number, prec: number): { digits: string; exp: number } {
  if (ax === 0) return { digits: '0'.repeat(prec + 1), exp: 0 };
  let E = Math.floor(Math.log10(ax));
  const lo = 10n ** BigInt(prec);
  const hi = lo * 10n;
  for (let i = 0; i < 10; i++) {
    const q = scaled(ax, prec - E);
    if (q >= hi) E++;
    else if (q < lo) E--;
    else return { digits: q.toString(), exp: E };
  }
  throw new Error('sci');
}

function expStr(exp: number, upper: boolean): string {
  const a = Math.abs(exp);
  return (upper ? 'E' : 'e') + (exp < 0 ? '-' : '+') + (a < 10 ? '0' + a : String(a));
}

function sciStr(ax: number, prec: number, alt: boolean, upper: boolean): string {
  const { digits, exp } = sciParts(ax, prec);
  const mant = digits[0] + (prec > 0 ? '.' + digits.slice(1) : alt ? '.' : '');
  return mant + expStr(exp, upper);
}

function stripZeros(s: string): string {
  if (!s.includes('.')) return s;
  return s.replace(/\.?0+$/, '');
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let ai = 0;
  const re = /%(?:(%)|([-+ 0#]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc]))/g;
  return fmt.replace(re, (_m, pct, flags: string, w: string, p: string | undefined, conv: string) => {
    if (pct) return '%';
    const arg = args[ai++];
    const left = flags.includes('-');
    const plus = flags.includes('+');
    const space = flags.includes(' ');
    const zero = flags.includes('0');
    const alt = flags.includes('#');
    const width = w ? parseInt(w, 10) : 0;
    const hasPrec = p !== undefined;
    const prec = hasPrec ? (p === '' ? 0 : parseInt(p, 10)) : -1;

    let sign = '';
    let prefix = '';
    let body: string;
    let canZero = zero && !left;

    if (conv === 's' || conv === 'c') {
      body = String(arg);
      if (conv === 's' && hasPrec) body = body.slice(0, prec);
      canZero = false;
    } else if ('diouxX'.includes(conv)) {
      let v = BigInt(arg as number | bigint);
      if (conv === 'd' || conv === 'i') {
        if (v < 0n) {
          sign = '-';
          v = -v;
        } else sign = plus ? '+' : space ? ' ' : '';
      }
      const radix = conv === 'o' ? 8 : conv === 'd' || conv === 'i' ? 10 : 16;
      let digits = v.toString(radix);
      if (conv === 'X') digits = digits.toUpperCase();
      if (hasPrec) {
        if (prec === 0 && v === 0n) digits = '';
        else if (digits.length < prec) digits = '0'.repeat(prec - digits.length) + digits;
        canZero = false;
      }
      if (alt) {
        if (conv === 'o') {
          if (!digits.startsWith('0')) digits = '0' + digits;
        } else if ((conv === 'x' || conv === 'X') && v !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      }
      body = digits;
    } else {
      const x = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      if (Number.isNaN(x)) {
        body = upper ? 'NAN' : 'nan';
        canZero = false;
      } else {
        const neg = x < 0 || Object.is(x, -0);
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        const ax = Math.abs(x);
        if (ax === Infinity) {
          body = upper ? 'INF' : 'inf';
          canZero = false;
        } else {
          const P = hasPrec ? prec : 6;
          const lc = conv.toLowerCase();
          if (lc === 'f') body = fixedStr(ax, P, alt);
          else if (lc === 'e') body = sciStr(ax, P, alt, upper);
          else {
            const PP = P === 0 ? 1 : P;
            const X = sciParts(ax, PP - 1).exp;
            if (PP > X && X >= -4) {
              body = fixedStr(ax, PP - 1 - X, alt);
              if (!alt) body = stripZeros(body);
            } else {
              const full = sciStr(ax, PP - 1, alt, upper);
              if (alt) body = full;
              else {
                const i = full.search(/[eE]/);
                body = stripZeros(full.slice(0, i)) + full.slice(i);
              }
            }
          }
        }
      }
    }

    const len = sign.length + prefix.length + body.length;
    if (len >= width) return sign + prefix + body;
    const pad = width - len;
    if (left) return sign + prefix + body + ' '.repeat(pad);
    if (canZero) return sign + prefix + '0'.repeat(pad) + body;
    return ' '.repeat(pad) + sign + prefix + body;
  });
}
