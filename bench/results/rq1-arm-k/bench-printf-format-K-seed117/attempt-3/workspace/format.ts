function decompose(x: number): { m: bigint; e2: number } {
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, x);
  const hi = buf.getUint32(0);
  const lo = buf.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (expBits === 0) return { m, e2: -1074 };
  m |= 1n << 52n;
  return { m, e2: expBits - 1075 };
}

// round-half-even of |value| * 10^k
function roundScaled(m: bigint, e2: number, k: number): bigint {
  let num = m;
  let den = 1n;
  if (e2 >= 0) num <<= BigInt(e2);
  else den <<= BigInt(-e2);
  if (k >= 0) num *= 10n ** BigInt(k);
  else den *= 10n ** BigInt(-k);
  const q = num / den;
  const r = num % den;
  const twice = r * 2n;
  if (twice > den || (twice === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

function fixedStr(ax: number, p: number, alt: boolean): string {
  let q: bigint;
  if (ax === 0) q = 0n;
  else {
    const { m, e2 } = decompose(ax);
    q = roundScaled(m, e2, p);
  }
  let s = q.toString();
  if (s.length < p + 1) s = '0'.repeat(p + 1 - s.length) + s;
  const ip = s.slice(0, s.length - p);
  const fp = s.slice(s.length - p);
  return p > 0 ? ip + '.' + fp : alt ? ip + '.' : ip;
}

function expParts(ax: number, p: number): { digits: string; x: number } {
  if (ax === 0) return { digits: '0'.repeat(p + 1), x: 0 };
  const { m, e2 } = decompose(ax);
  let e10 = Math.floor(Math.log10(ax));
  const lowB = 10n ** BigInt(p);
  const highB = lowB * 10n;
  for (let i = 0; i < 50; i++) {
    const n = roundScaled(m, e2, p - e10);
    if (n >= highB) e10++;
    else if (n < lowB) e10--;
    else return { digits: n.toString(), x: e10 };
  }
  throw new Error('exp');
}

function expStr(ax: number, p: number, alt: boolean, upper: boolean): string {
  const { digits, x } = expParts(ax, p);
  let s = digits[0];
  if (p > 0) s += '.' + digits.slice(1);
  else if (alt) s += '.';
  const ax2 = Math.abs(x);
  s += (upper ? 'E' : 'e') + (x < 0 ? '-' : '+') + (ax2 < 10 ? '0' : '') + ax2;
  return s;
}

function stripZeros(s: string): string {
  if (!s.includes('.')) return s;
  return s.replace(/0+$/, '').replace(/\.$/, '');
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let ai = 0;
  const re = /%([-+ 0#]*)(\d*)(\.\d*)?([diouxXeEfFgGsc%])/g;
  return fmt.replace(re, (_all, flags: string, w: string, pr: string | undefined, conv: string) => {
    if (conv === '%') return '%';
    const minus = flags.includes('-');
    const plus = flags.includes('+');
    const space = flags.includes(' ');
    const zero = flags.includes('0');
    const alt = flags.includes('#');
    const width = w ? parseInt(w, 10) : 0;
    const hasPrec = pr !== undefined;
    const prec = hasPrec ? (pr!.length > 1 ? parseInt(pr!.slice(1), 10) : 0) : -1;
    const arg = args[ai++];

    let sign = '';
    let prefix = '';
    let body: string;
    let canZero = zero && !minus;

    if (conv === 's' || conv === 'c') {
      let s = String(arg);
      if (conv === 's' && hasPrec) s = s.slice(0, prec);
      body = s;
      canZero = false;
    } else if ('diouxX'.includes(conv)) {
      let v = BigInt(arg as number | bigint);
      const signStr = conv === 'd' || conv === 'i'
        ? (v < 0n ? '-' : plus ? '+' : space ? ' ' : '')
        : '';
      if (v < 0n) v = -v;
      sign = signStr;
      let digits = conv === 'o' ? v.toString(8) : conv === 'x' ? v.toString(16)
        : conv === 'X' ? v.toString(16).toUpperCase() : v.toString();
      if (hasPrec) {
        if (prec === 0 && v === 0n) digits = '';
        else if (digits.length < prec) digits = '0'.repeat(prec - digits.length) + digits;
        canZero = false;
      }
      if (alt) {
        if (conv === 'o') {
          if (digits[0] !== '0') digits = '0' + digits;
        } else if ((conv === 'x' || conv === 'X') && v !== 0n) {
          prefix = conv === 'x' ? '0x' : '0X';
        }
      }
      body = digits;
    } else {
      const x = arg as number;
      const neg = x < 0 || Object.is(x, -0);
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      if (Number.isNaN(x)) {
        body = upper ? 'NAN' : 'nan';
        canZero = false;
      } else {
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        if (!Number.isFinite(x)) {
          body = upper ? 'INF' : 'inf';
          canZero = false;
        } else {
          const ax = Math.abs(x);
          const lc = conv.toLowerCase();
          const p = hasPrec ? prec : 6;
          if (lc === 'f') body = fixedStr(ax, p, alt);
          else if (lc === 'e') body = expStr(ax, p, alt, upper);
          else {
            const P = p === 0 ? 1 : p;
            const X = expParts(ax, P - 1).x;
            if (P > X && X >= -4) {
              body = fixedStr(ax, P - 1 - X, alt);
              if (!alt) body = stripZeros(body);
            } else {
              body = expStr(ax, P - 1, alt, upper);
              if (!alt) {
                const idx = body.search(/[eE]/);
                body = stripZeros(body.slice(0, idx)) + body.slice(idx);
              }
            }
          }
        }
      }
    }

    const len = sign.length + prefix.length + body.length;
    if (len >= width) return sign + prefix + body;
    const pad = width - len;
    if (minus) return sign + prefix + body + ' '.repeat(pad);
    if (canZero) return sign + prefix + '0'.repeat(pad) + body;
    return ' '.repeat(pad) + sign + prefix + body;
  });
}
