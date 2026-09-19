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

// v * 10^k as an exact fraction
function ratio(d: { m: bigint; e: number }, k: number): [bigint, bigint] {
  let num = d.m;
  let den = 1n;
  if (d.e >= 0) num <<= BigInt(d.e);
  else den <<= BigInt(-d.e);
  if (k >= 0) num *= 10n ** BigInt(k);
  else den *= 10n ** BigInt(-k);
  return [num, den];
}

function scaled(d: { m: bigint; e: number }, k: number): bigint {
  const [num, den] = ratio(d, k);
  let q = num / den;
  const r2 = (num % den) * 2n;
  if (r2 > den || (r2 === den && (q & 1n) === 1n)) q += 1n;
  return q;
}

function floorLog10(d: { m: bigint; e: number }, v: number): number {
  let x = Math.floor(Math.log10(v));
  if (!isFinite(x)) x = -324;
  const fl = (k: number) => {
    const [n, dd] = ratio(d, k);
    return n / dd;
  };
  while (fl(-x) < 1n) x--;
  while (fl(-(x + 1)) >= 1n) x++;
  return x;
}

// returns e-style digits (P digits) and exponent
function eDigits(v: number, p: number): { digits: string; x: number } {
  if (v === 0) return { digits: '0'.repeat(p + 1), x: 0 };
  const d = decompose(v);
  let x = floorLog10(d, v);
  let n = scaled(d, p - x);
  if (n >= 10n ** BigInt(p + 1)) {
    x++;
    n = scaled(d, p - x);
  }
  return { digits: n.toString(), x };
}

function fDigits(v: number, p: number): { int: string; frac: string } {
  if (v === 0) return { int: '0', frac: '0'.repeat(p) };
  const s = scaled(decompose(v), p).toString().padStart(p + 1, '0');
  return { int: s.slice(0, s.length - p), frac: s.slice(s.length - p) };
}

function expStr(x: number, upper: boolean): string {
  const a = Math.abs(x);
  return (upper ? 'E' : 'e') + (x < 0 ? '-' : '+') + (a < 10 ? '0' + a : String(a));
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let ai = 0;
  const re = /%(?:(%)|([-+ 0#]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc]))/g;
  return fmt.replace(re, (_m, pct, flags: string, w: string, prec: string | undefined, conv: string) => {
    if (pct) return '%';
    const arg = args[ai++];
    const left = flags.includes('-');
    const plus = flags.includes('+');
    const space = flags.includes(' ');
    const zero = flags.includes('0');
    const alt = flags.includes('#');
    const width = w ? parseInt(w, 10) : 0;
    const hasPrec = prec !== undefined;
    const precN = hasPrec ? (prec === '' ? 0 : parseInt(prec, 10)) : -1;

    const pad = (sign: string, digits: string, allowZero: boolean): string => {
      const len = sign.length + digits.length;
      if (len >= width) return sign + digits;
      if (left) return sign + digits + ' '.repeat(width - len);
      if (zero && allowZero) return sign + '0'.repeat(width - len) + digits;
      return ' '.repeat(width - len) + sign + digits;
    };

    if (conv === 's' || conv === 'c') {
      let s = String(arg);
      if (conv === 's' && hasPrec) s = s.slice(0, precN);
      return pad('', s, false);
    }

    if ('diouxX'.includes(conv)) {
      const big = BigInt(arg as number | bigint);
      const neg = big < 0n;
      const mag = neg ? -big : big;
      let digits: string;
      if (conv === 'd' || conv === 'i') digits = mag.toString(10);
      else if (conv === 'o') digits = mag.toString(8);
      else digits = mag.toString(16);
      if (conv === 'X') digits = digits.toUpperCase();
      if (hasPrec) {
        if (precN === 0 && mag === 0n) digits = '';
        else digits = digits.padStart(precN, '0');
      }
      let sign = '';
      if (conv === 'd' || conv === 'i') sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
      else if (alt) {
        if (conv === 'o') {
          if (digits[0] !== '0') digits = '0' + digits;
        } else if (mag !== 0n) sign = conv === 'x' ? '0x' : '0X';
      }
      return pad(sign, digits, !hasPrec);
    }

    const v = arg as number;
    const upper = conv === 'E' || conv === 'F' || conv === 'G';
    if (Number.isNaN(v)) return pad('', upper ? 'NAN' : 'nan', false);
    const neg = v < 0 || Object.is(v, -0);
    const sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
    if (!isFinite(v)) return pad(sign, upper ? 'INF' : 'inf', false);
    const a = Math.abs(v);
    const lc = conv.toLowerCase();
    let body: string;
    if (lc === 'f') {
      const p = hasPrec ? precN : 6;
      const { int, frac } = fDigits(a, p);
      body = int + (p > 0 || alt ? '.' : '') + frac;
    } else if (lc === 'e') {
      const p = hasPrec ? precN : 6;
      const { digits, x } = eDigits(a, p);
      body = digits[0] + (p > 0 || alt ? '.' : '') + digits.slice(1) + expStr(x, upper);
    } else {
      const P = hasPrec ? (precN === 0 ? 1 : precN) : 6;
      const { digits, x } = eDigits(a, P - 1);
      let int: string, frac: string, suffix = '';
      if (P > x && x >= -4) {
        ({ int, frac } = fDigits(a, P - 1 - x));
      } else {
        int = digits[0];
        frac = digits.slice(1);
        suffix = expStr(x, upper);
      }
      if (!alt) frac = frac.replace(/0+$/, '');
      body = int + (frac.length > 0 || alt ? '.' : '') + frac + suffix;
    }
    return pad(sign, body, true);
  });
}
