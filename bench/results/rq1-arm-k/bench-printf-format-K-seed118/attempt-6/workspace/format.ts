function decompose(v: number): { m: bigint; e: number } {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, v);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (expBits === 0) return { m, e: -1074 };
  m |= 1n << 52n;
  return { m, e: expBits - 1075 };
}

// v * 10^k as num/den
function ratio(d: { m: bigint; e: number }, k: number): [bigint, bigint] {
  let num = d.m;
  let den = 1n;
  if (d.e >= 0) num <<= BigInt(d.e);
  else den <<= BigInt(-d.e);
  if (k >= 0) num *= 10n ** BigInt(k);
  else den *= 10n ** BigInt(-k);
  return [num, den];
}

function roundScaled(d: { m: bigint; e: number }, k: number): bigint {
  const [num, den] = ratio(d, k);
  let q = num / den;
  const r2 = (num % den) * 2n;
  if (r2 > den || (r2 === den && (q & 1n) === 1n)) q += 1n;
  return q;
}

function floorScaled(d: { m: bigint; e: number }, k: number): bigint {
  const [num, den] = ratio(d, k);
  return num / den;
}

// e-style digits: returns digit string (p+1 digits) and exponent
function expDigits(v: number, p: number): { digits: string; x: number } {
  if (v === 0) return { digits: '0'.repeat(p + 1), x: 0 };
  const d = decompose(v);
  let x = Math.floor(Math.log10(v));
  if (!isFinite(x)) x = -324;
  while (floorScaled(d, -x) >= 10n) x++;
  while (floorScaled(d, -x) < 1n) x--;
  let n = roundScaled(d, p - x);
  if (n >= 10n ** BigInt(p + 1)) {
    x++;
    n = roundScaled(d, p - x);
  }
  return { digits: n.toString(), x };
}

function fixedStr(v: number, p: number, alt: boolean): string {
  const n = v === 0 ? 0n : roundScaled(decompose(v), p);
  let s = n.toString();
  if (p === 0) return alt ? s + '.' : s;
  if (s.length < p + 1) s = '0'.repeat(p + 1 - s.length) + s;
  return s.slice(0, s.length - p) + '.' + s.slice(s.length - p);
}

function expStr(v: number, p: number, alt: boolean, upper: boolean): string {
  const { digits, x } = expDigits(v, p);
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
  let ai = 0;
  const re = /%([-+ 0#]*)(\d*)(\.\d*)?([dixXoeEfFgGsc%])/g;
  return fmt.replace(re, (_m, flags: string, w: string, pr: string | undefined, conv: string) => {
    if (conv === '%') return '%';
    const arg = args[ai++];
    const left = flags.includes('-');
    const plus = flags.includes('+');
    const space = flags.includes(' ');
    const zero = flags.includes('0');
    const alt = flags.includes('#');
    const width = w ? parseInt(w, 10) : 0;
    const hasPrec = pr !== undefined;
    const prec = hasPrec ? (pr!.length > 1 ? parseInt(pr!.slice(1), 10) : 0) : -1;

    let sign = '';
    let prefix = '';
    let body: string;
    let zeroOk = zero && !left;

    if (conv === 's' || conv === 'c') {
      body = String(arg);
      if (conv === 's' && hasPrec) body = body.slice(0, prec);
      zeroOk = false;
    } else if ('dixXo'.includes(conv)) {
      let n = BigInt(arg as number | bigint);
      if (n < 0n) {
        sign = '-';
        n = -n;
      } else sign = plus ? '+' : space ? ' ' : '';
      if (conv === 'x' || conv === 'X') {
        body = n.toString(16);
        if (conv === 'X') body = body.toUpperCase();
      } else if (conv === 'o') body = n.toString(8);
      else body = n.toString();
      if (hasPrec) {
        if (prec === 0 && n === 0n) body = '';
        if (body.length < prec) body = '0'.repeat(prec - body.length) + body;
        zeroOk = false;
      }
      if (conv === 'o' && alt && body[0] !== '0') body = '0' + body;
      if ((conv === 'x' || conv === 'X') && alt && n !== 0n) prefix = conv === 'x' ? '0x' : '0X';
    } else {
      const v = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      if (Number.isNaN(v)) {
        body = upper ? 'NAN' : 'nan';
        zeroOk = false;
      } else {
        const neg = v < 0 || Object.is(v, -0);
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        const a = Math.abs(v);
        if (a === Infinity) {
          body = upper ? 'INF' : 'inf';
          zeroOk = false;
        } else {
          const lc = conv.toLowerCase();
          const p = hasPrec ? prec : 6;
          if (lc === 'f') body = fixedStr(a, p, alt);
          else if (lc === 'e') body = expStr(a, p, alt, upper);
          else {
            const P = p === 0 ? 1 : p;
            const x = expDigits(a, P - 1).x;
            if (P > x && x >= -4) {
              body = fixedStr(a, P - 1 - x, alt);
              if (!alt) body = stripZeros(body);
            } else {
              body = expStr(a, P - 1, alt, upper);
              if (!alt) {
                const i = body.search(/[eE]/);
                body = stripZeros(body.slice(0, i)) + body.slice(i);
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
    if (zeroOk) return sign + prefix + '0'.repeat(pad) + body;
    return ' '.repeat(pad) + sign + prefix + body;
  });
}
