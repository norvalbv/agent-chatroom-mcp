const P10 = (n: number): bigint => 10n ** BigInt(n);

// Exact rational num/den of |v| (v finite, nonzero or zero).
function toRat(v: number): { num: bigint; den: bigint } {
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, Math.abs(v));
  const hi = buf.getUint32(0);
  const lo = buf.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let e: number;
  if (expBits === 0) {
    e = -1074;
  } else {
    m |= 1n << 52n;
    e = expBits - 1075;
  }
  return e >= 0 ? { num: m << BigInt(e), den: 1n } : { num: m, den: 1n << BigInt(-e) };
}

// round(num/den * 10^k), half to even
function scaledRound(r: { num: bigint; den: bigint }, k: number): bigint {
  let num = r.num;
  let den = r.den;
  if (k >= 0) num *= P10(k);
  else den *= P10(-k);
  const q = num / den;
  const rem = num - q * den;
  const twice = rem * 2n;
  if (twice > den || (twice === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

function fixedDigits(v: number, p: number): string {
  const q = scaledRound(toRat(v), p).toString();
  return q;
}

function fixedText(v: number, p: number, alt: boolean): string {
  let d = fixedDigits(v, p);
  if (d.length < p + 1) d = '0'.repeat(p + 1 - d.length) + d;
  const ip = d.slice(0, d.length - p);
  const fp = d.slice(d.length - p);
  return p > 0 ? ip + '.' + fp : alt ? ip + '.' : ip;
}

// digits (p+1 significant) and decimal exponent
function expParts(v: number, p: number): { digits: string; x: number } {
  if (v === 0) return { digits: '0'.repeat(p + 1), x: 0 };
  const r = toRat(v);
  const cmp = (x: number): number => {
    // compare v with 10^x
    let a = r.num;
    let b = r.den;
    if (x >= 0) b *= P10(x);
    else a *= P10(-x);
    return a < b ? -1 : a > b ? 1 : 0;
  };
  let x = Math.floor(Math.log10(Math.abs(v)));
  if (!Number.isFinite(x)) x = -324;
  while (cmp(x) < 0) x--;
  while (cmp(x + 1) >= 0) x++;
  let q = scaledRound(r, p - x);
  if (q >= P10(p + 1)) {
    x++;
    q = scaledRound(r, p - x);
  }
  return { digits: q.toString(), x };
}

function expText(v: number, p: number, alt: boolean, upper: boolean): string {
  const { digits, x } = expParts(v, p);
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
  const re = /%(?:(%)|([-+ 0#]*)(\d*)(\.\d*)?([diouxXeEfFgGsc]))/g;
  return fmt.replace(re, (_m, pct, flags: string, w: string, pr: string | undefined, conv: string) => {
    if (pct) return '%';
    const left = flags.includes('-');
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
    let canZero = false;

    if (conv === 's' || conv === 'c') {
      body = String(arg);
      if (conv === 's' && hasPrec) body = body.slice(0, prec);
    } else if ('dixXo'.includes(conv)) {
      const big = BigInt(arg as number | bigint);
      const neg = big < 0n;
      const mag = neg ? -big : big;
      let digits = mag.toString(conv === 'x' || conv === 'X' ? 16 : conv === 'o' ? 8 : 10);
      if (conv === 'X') digits = digits.toUpperCase();
      if (hasPrec) {
        if (prec === 0 && mag === 0n) digits = '';
        else if (digits.length < prec) digits = '0'.repeat(prec - digits.length) + digits;
      }
      if (conv === 'd' || conv === 'i') {
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
      } else if (alt) {
        if (conv === 'o') {
          if (!digits.startsWith('0')) digits = '0' + digits;
        } else if (mag !== 0n) {
          prefix = conv === 'x' ? '0x' : '0X';
        }
      }
      body = digits;
      canZero = !hasPrec;
    } else {
      const v = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      const lc = conv.toLowerCase();
      if (Number.isNaN(v)) {
        body = upper ? 'NAN' : 'nan';
      } else {
        const neg = v < 0 || Object.is(v, -0);
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        if (!Number.isFinite(v)) {
          body = upper ? 'INF' : 'inf';
        } else {
          canZero = true;
          if (lc === 'f') {
            body = fixedText(v, hasPrec ? prec : 6, alt);
          } else if (lc === 'e') {
            body = expText(v, hasPrec ? prec : 6, alt, upper);
          } else {
            let P = hasPrec ? prec : 6;
            if (P === 0) P = 1;
            const { x } = expParts(v, P - 1);
            if (P > x && x >= -4) {
              body = fixedText(v, P - 1 - x, alt);
              if (!alt) body = stripZeros(body);
            } else {
              const t = expText(v, P - 1, alt, upper);
              if (alt) body = t;
              else {
                const i = t.search(/[eE]/);
                body = stripZeros(t.slice(0, i)) + t.slice(i);
              }
            }
          }
        }
        if (!Number.isFinite(v)) canZero = false;
      }
      if (Number.isNaN(v)) canZero = false;
    }

    const len = sign.length + prefix.length + body.length;
    if (len >= width) return sign + prefix + body;
    const pad = width - len;
    if (left) return sign + prefix + body + ' '.repeat(pad);
    if (zero && canZero) return sign + prefix + '0'.repeat(pad) + body;
    return ' '.repeat(pad) + sign + prefix + body;
  });
}
