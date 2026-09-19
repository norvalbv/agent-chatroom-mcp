// Decompose a finite non-negative double into m * 2^e exactly.
function decompose(v: number): { m: bigint; e: number } {
  if (v === 0) return { m: 0n, e: 0 };
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

// round(v * 10^k) to nearest integer, ties to even, using the exact value.
function roundScaled(v: number, k: number): bigint {
  const { m, e } = decompose(v);
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

function fixed(v: number, p: number, alt: boolean): string {
  let s = roundScaled(v, p).toString();
  if (p > 0) {
    s = s.padStart(p + 1, '0');
    s = s.slice(0, s.length - p) + '.' + s.slice(s.length - p);
  } else if (alt) s += '.';
  return s;
}

// Returns digit string (p+1 digits) and decimal exponent.
function expoParts(v: number, p: number): { digits: string; x: number } {
  if (v === 0) return { digits: '0'.repeat(p + 1), x: 0 };
  let x = Math.floor(Math.log10(v));
  for (let i = 0; i < 20; i++) {
    const s = roundScaled(v, p - x).toString();
    if (s.length > p + 1) x++;
    else if (s.length < p + 1) x--;
    else return { digits: s, x };
  }
  throw new Error('exponent search failed');
}

function expo(v: number, p: number, alt: boolean, upper: boolean): string {
  const { digits, x } = expoParts(v, p);
  let s = digits[0];
  if (p > 0) s += '.' + digits.slice(1);
  else if (alt) s += '.';
  const ax = Math.abs(x);
  return s + (upper ? 'E' : 'e') + (x < 0 ? '-' : '+') + (ax < 10 ? '0' + ax : String(ax));
}

function stripZeros(s: string): string {
  if (!s.includes('.')) return s;
  return s.replace(/0+$/, '').replace(/\.$/, '');
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
    let body: string;
    let canZero = zero;

    if (conv === 's' || conv === 'c') {
      body = String(arg);
      if (conv === 's' && hasPrec) body = body.slice(0, prec);
      canZero = false;
    } else if ('dioxX'.includes(conv)) {
      let v = typeof arg === 'bigint' ? arg : BigInt(arg as number);
      const neg = v < 0n;
      if (neg) v = -v;
      let digits: string;
      if (conv === 'd' || conv === 'i') digits = v.toString();
      else if (conv === 'o') digits = v.toString(8);
      else digits = v.toString(16);
      if (conv === 'X') digits = digits.toUpperCase();
      if (hasPrec) {
        if (prec === 0 && v === 0n) digits = '';
        digits = digits.padStart(prec, '0');
        canZero = false;
      }
      if (conv === 'd' || conv === 'i') {
        prefix = neg ? '-' : plus ? '+' : space ? ' ' : '';
      } else if (conv === 'o') {
        if (alt && !digits.startsWith('0')) digits = '0' + digits;
      } else if (alt && v !== 0n) {
        prefix = conv === 'x' ? '0x' : '0X';
      }
      body = digits;
    } else {
      const num = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      if (Number.isNaN(num)) {
        body = upper ? 'NAN' : 'nan';
        canZero = false;
      } else {
        const neg = num < 0 || Object.is(num, -0);
        prefix = neg ? '-' : plus ? '+' : space ? ' ' : '';
        const v = Math.abs(num);
        if (v === Infinity) {
          body = upper ? 'INF' : 'inf';
          canZero = false;
        } else {
          const p = hasPrec ? prec : 6;
          const lc = conv.toLowerCase();
          if (lc === 'f') body = fixed(v, p, alt);
          else if (lc === 'e') body = expo(v, p, alt, upper);
          else {
            const P = p === 0 ? 1 : p;
            const { x } = expoParts(v, P - 1);
            if (P > x && x >= -4) {
              body = fixed(v, P - 1 - x, alt);
              if (!alt) body = stripZeros(body);
            } else {
              body = expo(v, P - 1, alt, upper);
              if (!alt) {
                const i = body.search(/[eE]/);
                body = stripZeros(body.slice(0, i)) + body.slice(i);
              }
            }
          }
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
