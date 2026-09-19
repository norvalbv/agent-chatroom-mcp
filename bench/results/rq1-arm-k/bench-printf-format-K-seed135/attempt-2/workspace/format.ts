function decompose(x: number): { m: bigint; e: number } {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, Math.abs(x));
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  const frac = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (expBits === 0) return { m: frac, e: -1074 };
  return { m: frac | (1n << 52n), e: expBits - 1075 };
}

// round-half-even(m * 2^e * 10^k)
function roundScaled(m: bigint, e: number, k: number): bigint {
  let num = m * 10n ** BigInt(Math.max(k, 0));
  let den = 10n ** BigInt(Math.max(-k, 0));
  if (e >= 0) num <<= BigInt(e);
  else den <<= BigInt(-e);
  const q = num / den;
  const r2 = (num % den) * 2n;
  if (r2 > den || (r2 === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

function fixedStr(x: number, p: number, alt: boolean): string {
  const { m, e } = decompose(x);
  let s = roundScaled(m, e, p).toString();
  if (s.length < p + 1) s = s.padStart(p + 1, '0');
  const ip = s.slice(0, s.length - p);
  const fp = s.slice(s.length - p);
  return ip + (p > 0 || alt ? '.' : '') + fp;
}

function sciParts(x: number, p: number): { d: string; X: number } {
  if (x === 0) return { d: '0'.repeat(p + 1), X: 0 };
  const { m, e } = decompose(x);
  let X = Math.floor(Math.log10(Math.abs(x)));
  if (!isFinite(X)) X = -324;
  const top = 10n ** BigInt(p + 1);
  const low = 10n ** BigInt(p);
  for (let i = 0; i < 20; i++) {
    const d = roundScaled(m, e, p - X);
    if (d === top) return { d: low.toString(), X: X + 1 };
    if (d >= top) X++;
    else if (d < low) X--;
    else return { d: d.toString(), X };
  }
  throw new Error('sci failed');
}

function sciStr(x: number, p: number, alt: boolean, upper: boolean): string {
  const { d, X } = sciParts(x, p);
  const ax = Math.abs(X);
  return (
    d[0] + (p > 0 || alt ? '.' : '') + d.slice(1) +
    (upper ? 'E' : 'e') + (X < 0 ? '-' : '+') + (ax < 10 ? '0' : '') + ax
  );
}

function stripZeros(s: string): string {
  const ei = s.search(/[eE]/);
  let mant = ei >= 0 ? s.slice(0, ei) : s;
  const exp = ei >= 0 ? s.slice(ei) : '';
  if (mant.includes('.')) mant = mant.replace(/0+$/, '').replace(/\.$/, '');
  return mant + exp;
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let ai = 0;
  const re = /%([-+ 0#]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc%])/g;
  return fmt.replace(re, (_m, flags: string, w: string, pr: string | undefined, conv: string) => {
    if (conv === '%') return '%';
    const left = flags.includes('-');
    const plus = flags.includes('+');
    const space = flags.includes(' ');
    const zero = flags.includes('0') && !left;
    const alt = flags.includes('#');
    const width = w ? parseInt(w, 10) : 0;
    const hasPrec = pr !== undefined;
    const prec = hasPrec ? (pr === '' ? 0 : parseInt(pr, 10)) : -1;
    const arg = args[ai++];

    let sign = '';
    let prefix = '';
    let body: string;
    let canZero = true;

    if (conv === 's' || conv === 'c') {
      body = String(arg);
      if (conv === 's' && hasPrec) body = body.slice(0, prec);
      canZero = false;
    } else if ('dixXo'.includes(conv)) {
      let v = BigInt(arg as number | bigint);
      if (v < 0n) {
        sign = '-';
        v = -v;
      } else sign = plus ? '+' : space ? ' ' : '';
      const isZero = v === 0n;
      let digits = conv === 'x' ? v.toString(16) : conv === 'X' ? v.toString(16).toUpperCase() : conv === 'o' ? v.toString(8) : v.toString();
      if (hasPrec) {
        if (prec === 0 && isZero) digits = '';
        digits = digits.padStart(prec, '0');
      }
      if (alt) {
        if ((conv === 'x' || conv === 'X') && !isZero) prefix = conv === 'x' ? '0x' : '0X';
        if (conv === 'o' && !digits.startsWith('0')) digits = '0' + digits;
      }
      body = digits;
      if (hasPrec) canZero = false;
    } else {
      const x = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      if (Number.isNaN(x)) {
        body = upper ? 'NAN' : 'nan';
        canZero = false;
      } else {
        const neg = x < 0 || Object.is(x, -0);
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        if (!isFinite(x)) {
          body = upper ? 'INF' : 'inf';
          canZero = false;
        } else {
          const lc = conv.toLowerCase();
          if (lc === 'f') {
            body = fixedStr(x, hasPrec ? prec : 6, alt);
          } else if (lc === 'e') {
            body = sciStr(x, hasPrec ? prec : 6, alt, upper);
          } else {
            let P = hasPrec ? prec : 6;
            if (P === 0) P = 1;
            const { X } = sciParts(x, P - 1);
            if (P > X && X >= -4) body = fixedStr(x, P - 1 - X, alt);
            else body = sciStr(x, P - 1, alt, upper);
            if (!alt) body = stripZeros(body);
          }
        }
      }
    }

    const len = sign.length + prefix.length + body.length;
    if (len >= width) return sign + prefix + body;
    const pad = width - len;
    if (left) return sign + prefix + body + ' '.repeat(pad);
    if (zero && canZero) return sign + prefix + '0'.repeat(pad) + body;
    return ' '.repeat(pad) + sign + prefix + body;
  });
}
