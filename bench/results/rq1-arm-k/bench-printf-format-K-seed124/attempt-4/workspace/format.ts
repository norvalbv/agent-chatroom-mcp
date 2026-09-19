function decompose(v: number): [bigint, number] {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, v);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  const frac = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (expBits === 0) return [frac, -1074];
  return [frac | (1n << 52n), expBits - 1075];
}

// round-half-even(|v| * 10^k) computed exactly
function roundScaled(v: number, k: number): bigint {
  const [m, e] = decompose(v);
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

function expDigits(v: number, p: number): { digits: string; x: number } {
  if (v === 0) return { digits: '0'.repeat(p + 1), x: 0 };
  let x = Math.floor(Math.log10(v));
  if (!isFinite(x)) x = -324;
  for (let i = 0; i < 20; i++) {
    const s = roundScaled(v, p - x).toString();
    if (s.length > p + 1) x++;
    else if (s.length < p + 1) x--;
    else return { digits: s, x };
  }
  throw new Error('exp');
}

function fixed(v: number, p: number, alt: boolean): string {
  let s = roundScaled(v, p).toString();
  if (s.length < p + 1) s = '0'.repeat(p + 1 - s.length) + s;
  const ip = s.slice(0, s.length - p);
  const fp = s.slice(s.length - p);
  return p > 0 ? ip + '.' + fp : alt ? ip + '.' : ip;
}

function expo(v: number, p: number, alt: boolean): string {
  const { digits, x } = expDigits(v, p);
  let m = digits[0];
  if (p > 0) m += '.' + digits.slice(1);
  else if (alt) m += '.';
  const ax = Math.abs(x);
  return m + 'e' + (x < 0 ? '-' : '+') + (ax < 10 ? '0' : '') + ax;
}

function stripZeros(s: string): string {
  const ei = s.indexOf('e');
  let mant = ei >= 0 ? s.slice(0, ei) : s;
  const rest = ei >= 0 ? s.slice(ei) : '';
  if (mant.includes('.')) mant = mant.replace(/0+$/, '').replace(/\.$/, '');
  return mant + rest;
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let ai = 0;
  return fmt.replace(/%([-+ 0#]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc%])/g, (_m, flags: string, w: string, pr: string | undefined, conv: string) => {
    if (conv === '%') return '%';
    const arg = args[ai++];
    const left = flags.includes('-');
    const plus = flags.includes('+');
    const space = flags.includes(' ');
    const zero = flags.includes('0') && !left;
    const alt = flags.includes('#');
    const width = w ? parseInt(w, 10) : 0;
    const hasPrec = pr !== undefined;
    const prec = hasPrec ? (pr === '' ? 0 : parseInt(pr, 10)) : -1;

    let prefix = '';
    let body = '';
    let canZero = zero;

    if (conv === 's' || conv === 'c') {
      let s = String(arg);
      if (conv === 's' && hasPrec) s = s.slice(0, prec);
      body = s;
      canZero = false;
    } else if ('dioxX'.includes(conv)) {
      const n = BigInt(arg as number | bigint);
      const neg = n < 0n;
      const mag = neg ? -n : n;
      const base = conv === 'x' || conv === 'X' ? 16 : conv === 'o' ? 8 : 10;
      let digits = mag.toString(base);
      if (conv === 'X') digits = digits.toUpperCase();
      if (hasPrec) {
        if (prec === 0 && mag === 0n) digits = '';
        else if (digits.length < prec) digits = '0'.repeat(prec - digits.length) + digits;
      }
      if (conv === 'd' || conv === 'i') {
        prefix = neg ? '-' : plus ? '+' : space ? ' ' : '';
      } else if (alt) {
        if (conv === 'o') {
          if (!digits.startsWith('0')) digits = '0' + digits;
        } else if (mag !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      }
      body = digits;
      if (hasPrec) canZero = false;
    } else {
      const v = arg as number;
      const neg = v < 0 || Object.is(v, -0);
      const isNaNv = Number.isNaN(v);
      const sign = isNaNv ? '' : neg ? '-' : plus ? '+' : space ? ' ' : '';
      const lc = conv.toLowerCase();
      let text: string;
      if (isNaNv) {
        text = 'nan';
        canZero = false;
      } else if (!isFinite(v)) {
        text = 'inf';
        canZero = false;
      } else {
        const a = Math.abs(v);
        const p = hasPrec ? prec : 6;
        if (lc === 'f') text = fixed(a, p, alt);
        else if (lc === 'e') text = expo(a, p, alt);
        else {
          const P = p === 0 ? 1 : p;
          const X = expDigits(a, P - 1).x;
          if (P > X && X >= -4) text = fixed(a, P - 1 - X, alt);
          else text = expo(a, P - 1, alt);
          if (!alt) text = stripZeros(text);
        }
      }
      if (conv === 'E' || conv === 'F' || conv === 'G') text = text.toUpperCase();
      prefix = sign;
      body = text;
    }

    const len = prefix.length + body.length;
    if (len >= width) return prefix + body;
    const pad = width - len;
    if (left) return prefix + body + ' '.repeat(pad);
    if (canZero) return prefix + '0'.repeat(pad) + body;
    return ' '.repeat(pad) + prefix + body;
  });
}
