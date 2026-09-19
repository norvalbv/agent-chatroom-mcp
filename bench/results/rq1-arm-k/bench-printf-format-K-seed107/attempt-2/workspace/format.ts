function decompose(v: number): { m: bigint; e: number } {
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, v);
  const hi = buf.getUint32(0);
  const lo = buf.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (expBits === 0) return { m, e: -1074 };
  m |= 1n << 52n;
  return { m, e: expBits - 1075 };
}

// round_half_even(|v| * 10^k)
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

function expStyle(v: number, p: number): { digits: string; x: number } {
  if (v === 0) return { digits: '0'.repeat(p + 1), x: 0 };
  const { m, e } = decompose(v);
  let x = Math.floor(Math.log10(v));
  if (!Number.isFinite(x)) x = 0;
  for (let i = 0; i < 10; i++) {
    const d = roundScaled(m, e, p - x).toString();
    if (d.length > p + 1) x++;
    else if (d.length < p + 1) x--;
    else return { digits: d, x };
  }
  throw new Error('exp');
}

function fixedStyle(v: number, p: number, alt: boolean): string {
  let s: string;
  if (v === 0) s = '0'.repeat(p + 1);
  else {
    const { m, e } = decompose(v);
    s = roundScaled(m, e, p).toString();
  }
  if (s.length < p + 1) s = '0'.repeat(p + 1 - s.length) + s;
  const ip = s.slice(0, s.length - p);
  const fp = s.slice(s.length - p);
  return ip + (p > 0 || alt ? '.' : '') + fp;
}

function eText(digits: string, x: number, p: number, alt: boolean, upper: boolean): string {
  let s = digits[0] + (p > 0 || alt ? '.' : '') + digits.slice(1);
  const ax = Math.abs(x);
  s += (upper ? 'E' : 'e') + (x < 0 ? '-' : '+') + (ax < 10 ? '0' : '') + ax;
  return s;
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let ai = 0;
  const re = /%([-+ 0#]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGscp%])/g;
  return fmt.replace(re, (_all, flags: string, w: string, pr: string | undefined, conv: string) => {
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
      body = String(arg);
      if (conv === 's' && hasPrec) body = body.slice(0, prec);
      canZero = false;
    } else if (conv === 'd' || conv === 'i') {
      const b = BigInt(arg as number | bigint);
      prefix = b < 0n ? '-' : plus ? '+' : space ? ' ' : '';
      let d = (b < 0n ? -b : b).toString();
      if (hasPrec) {
        if (prec === 0 && b === 0n) d = '';
        if (d.length < prec) d = '0'.repeat(prec - d.length) + d;
        canZero = false;
      }
      body = d;
    } else if (conv === 'x' || conv === 'X' || conv === 'o') {
      const b = BigInt(arg as number | bigint);
      let d = b.toString(conv === 'o' ? 8 : 16);
      if (conv === 'X') d = d.toUpperCase();
      if (hasPrec) {
        if (prec === 0 && b === 0n) d = '';
        if (d.length < prec) d = '0'.repeat(prec - d.length) + d;
        canZero = false;
      }
      if (alt) {
        if (conv === 'o') {
          if (!d.startsWith('0')) d = '0' + d;
        } else if (b !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      }
      body = d;
    } else {
      const v = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      const lower = conv.toLowerCase();
      if (Number.isNaN(v)) {
        body = upper ? 'NAN' : 'nan';
        canZero = false;
      } else {
        const neg = v < 0 || Object.is(v, -0);
        prefix = neg ? '-' : plus ? '+' : space ? ' ' : '';
        const a = Math.abs(v);
        if (a === Infinity) {
          body = upper ? 'INF' : 'inf';
          canZero = false;
        } else if (lower === 'f') {
          body = fixedStyle(a, hasPrec ? prec : 6, alt);
        } else if (lower === 'e') {
          const p = hasPrec ? prec : 6;
          const { digits, x } = expStyle(a, p);
          body = eText(digits, x, p, alt, upper);
        } else {
          let P = hasPrec ? prec : 6;
          if (P === 0) P = 1;
          const { digits, x } = expStyle(a, P - 1);
          let s: string;
          if (P > x && x >= -4) {
            s = fixedStyle(a, P - 1 - x, alt);
            if (!alt && s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
          } else {
            let mant = digits[0] + (P - 1 > 0 || alt ? '.' : '') + digits.slice(1);
            if (!alt && mant.includes('.')) mant = mant.replace(/0+$/, '').replace(/\.$/, '');
            const ax = Math.abs(x);
            s = mant + (upper ? 'E' : 'e') + (x < 0 ? '-' : '+') + (ax < 10 ? '0' : '') + ax;
          }
          body = s;
        }
      }
    }

    const len = prefix.length + body.length;
    if (len >= width) return prefix + body;
    const pad = width - len;
    if (left) return prefix + body + ' '.repeat(pad);
    if (canZero) return prefix + '0'.repeat(pad) + body;
    return ' '.repeat(pad) + prefix + body;
  });
}
