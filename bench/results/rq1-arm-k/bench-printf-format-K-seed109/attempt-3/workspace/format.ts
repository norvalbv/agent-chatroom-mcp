function divRound(a: bigint, b: bigint): bigint {
  const q = a / b;
  const r2 = (a % b) * 2n;
  if (r2 > b || (r2 === b && (q & 1n) === 1n)) return q + 1n;
  return q;
}

function ratio(x: number): [bigint, bigint] {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const bexp = (hi >>> 20) & 0x7ff;
  let mant = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let e: number;
  if (bexp === 0) {
    e = -1074;
  } else {
    mant |= 1n << 52n;
    e = bexp - 1075;
  }
  return e >= 0 ? [mant << BigInt(e), 1n] : [mant, 1n << BigInt(-e)];
}

const p10 = (k: number): bigint => 10n ** BigInt(k);

// x >= 0 finite. Returns digit string with fractional `prec` digits.
function fixed(x: number, prec: number, alt: boolean): string {
  const [n, d] = ratio(x);
  let s = divRound(n * p10(prec), d).toString();
  if (s.length < prec + 1) s = '0'.repeat(prec + 1 - s.length) + s;
  const ip = s.slice(0, s.length - prec);
  const fp = s.slice(s.length - prec);
  return prec > 0 ? ip + '.' + fp : alt ? ip + '.' : ip;
}

// Returns [digits (prec+1 chars), exponent]
function expo(x: number, prec: number): [string, number] {
  if (x === 0) return ['0'.repeat(prec + 1), 0];
  const [n, d] = ratio(x);
  let e = Math.floor(Math.log10(x));
  if (!isFinite(e)) e = 0;
  const scaled = (k: number): [bigint, bigint] => (k >= 0 ? [n, d * p10(k)] : [n * p10(-k), d]);
  for (;;) {
    const [a, b] = scaled(e);
    if (a < b) e--;
    else if (a >= b * 10n) e++;
    else break;
  }
  const k = e - prec;
  const [a, b] = k >= 0 ? [n, d * p10(k)] : [n * p10(-k), d];
  let digits = divRound(a, b);
  if (digits >= p10(prec + 1)) {
    e++;
    digits = divRound(a, b * 10n);
  }
  return [digits.toString(), e];
}

function expStr(x: number, prec: number, alt: boolean, upper: boolean): string {
  const [ds, e] = expo(x, prec);
  let m = ds[0];
  if (prec > 0) m += '.' + ds.slice(1);
  else if (alt) m += '.';
  const ae = Math.abs(e);
  return m + (upper ? 'E' : 'e') + (e < 0 ? '-' : '+') + (ae < 10 ? '0' : '') + ae;
}

function stripZeros(s: string): string {
  if (!s.includes('.')) return s;
  return s.replace(/0+$/, '').replace(/\.$/, '');
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
    const zero = flags.includes('0') && !left;
    const alt = flags.includes('#');
    const width = w ? parseInt(w, 10) : 0;
    const hasPrec = p !== undefined;
    const prec = hasPrec ? (p === '' ? 0 : parseInt(p!, 10)) : -1;

    let sign = '';
    let prefix = '';
    let body: string;
    let canZero = zero;
    const signFor = (neg: boolean) => (neg ? '-' : plus ? '+' : space ? ' ' : '');

    if (conv === 's' || conv === 'c') {
      let s = String(arg);
      if (conv === 's' && hasPrec) s = s.slice(0, prec);
      return s.length >= width ? s : left ? s + ' '.repeat(width - s.length) : ' '.repeat(width - s.length) + s;
    }

    if ('diouxX'.includes(conv)) {
      const v = BigInt(arg as number | bigint);
      if (conv === 'd' || conv === 'i') sign = signFor(v < 0n);
      const mag = v < 0n ? -v : v;
      const base = conv === 'o' ? 8 : conv === 'd' || conv === 'i' ? 10 : 16;
      let digits = mag === 0n && hasPrec && prec === 0 ? '' : mag.toString(base);
      if (conv === 'X') digits = digits.toUpperCase();
      if (hasPrec && digits.length < prec) digits = '0'.repeat(prec - digits.length) + digits;
      if (alt) {
        if (conv === 'o' && !digits.startsWith('0')) digits = '0' + digits;
        if ((conv === 'x' || conv === 'X') && mag !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      }
      if (hasPrec) canZero = false;
      body = digits;
    } else {
      const x = arg as number;
      const neg = x < 0 || Object.is(x, -0);
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      if (Number.isNaN(x)) {
        body = upper ? 'NAN' : 'nan';
        canZero = false;
      } else {
        sign = signFor(neg);
        const ax = Math.abs(x);
        if (!isFinite(ax)) {
          body = upper ? 'INF' : 'inf';
          canZero = false;
        } else {
          const P = hasPrec ? prec : 6;
          const lc = conv.toLowerCase();
          if (lc === 'f') body = fixed(ax, P, alt);
          else if (lc === 'e') body = expStr(ax, P, alt, upper);
          else {
            const G = P === 0 ? 1 : P;
            const X = expo(ax, G - 1)[1];
            if (G > X && X >= -4) {
              body = fixed(ax, G - 1 - X, alt);
              if (!alt) body = stripZeros(body);
            } else {
              body = expStr(ax, G - 1, alt, upper);
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
    if (canZero) return sign + prefix + '0'.repeat(pad) + body;
    return ' '.repeat(pad) + sign + prefix + body;
  });
}
