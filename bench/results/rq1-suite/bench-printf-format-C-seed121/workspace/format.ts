// round(|x| * 10^k) half-to-even, using the exact binary value of x (x finite, > 0)
function scaledRound(x: number, k: number): bigint {
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, x);
  const hi = buf.getUint32(0);
  const lo = buf.getUint32(4);
  const bexp = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let e: number;
  if (bexp === 0) {
    e = -1074;
  } else {
    m |= 1n << 52n;
    e = bexp - 1075;
  }
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

// digits and decimal exponent for e-style with p digits after the point (x > 0)
function expDigits(x: number, p: number): { digits: string; exp: number } {
  let X = Math.floor(Math.log10(x));
  if (!Number.isFinite(X)) X = -324;
  const lowBound = 10n ** BigInt(p);
  for (;;) {
    const D = scaledRound(x, p - X);
    if (D >= lowBound * 10n) X++;
    else if (D < lowBound) X--;
    else return { digits: D.toString(), exp: X };
  }
}

function fixedStr(x: number, p: number, alt: boolean): string {
  let s = x === 0 ? '0'.repeat(p + 1) : scaledRound(x, p).toString();
  if (s.length < p + 1) s = '0'.repeat(p + 1 - s.length) + s;
  const ip = s.slice(0, s.length - p);
  const fp = s.slice(s.length - p);
  return ip + (p > 0 || alt ? '.' : '') + fp;
}

function expStr(x: number, p: number, alt: boolean, upper: boolean): string {
  let digits: string;
  let exp: number;
  if (x === 0) {
    digits = '0'.repeat(p + 1);
    exp = 0;
  } else {
    ({ digits, exp } = expDigits(x, p));
  }
  const mant = digits[0] + (p > 0 || alt ? '.' : '') + digits.slice(1);
  const ea = Math.abs(exp);
  return mant + (upper ? 'E' : 'e') + (exp < 0 ? '-' : '+') + (ea < 10 ? '0' + ea : String(ea));
}

function stripZeros(s: string): string {
  // s has a '.' possibly followed by fractional digits; optional exponent part
  const m = /^([^eE]*)([eE].*)?$/.exec(s)!;
  let mant = m[1];
  if (mant.includes('.')) {
    mant = mant.replace(/0+$/, '').replace(/\.$/, '');
  }
  return mant + (m[2] ?? '');
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let ai = 0;
  const re = /%([-+ 0#]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc%])/g;
  return fmt.replace(re, (_all, flags: string, w: string, pr: string | undefined, conv: string) => {
    if (conv === '%') return '%';
    const left = flags.includes('-');
    const plus = flags.includes('+');
    const space = flags.includes(' ');
    let zero = flags.includes('0') && !left;
    const alt = flags.includes('#');
    const width = w ? parseInt(w, 10) : 0;
    const hasPrec = pr !== undefined;
    const prec = hasPrec ? (pr === '' ? 0 : parseInt(pr, 10)) : -1;
    const arg = args[ai++];

    let sign = '';
    let prefix = '';
    let body: string;

    if (conv === 's' || conv === 'c') {
      let s = String(arg);
      if (conv === 's' && hasPrec) s = s.slice(0, prec);
      body = s;
      zero = false;
    } else if (conv === 'd' || conv === 'i' || conv === 'x' || conv === 'X' || conv === 'o') {
      const v = BigInt(arg as number | bigint);
      const neg = v < 0n;
      const mag = neg ? -v : v;
      let digits = mag.toString(conv === 'o' ? 8 : conv === 'd' || conv === 'i' ? 10 : 16);
      if (conv === 'X') digits = digits.toUpperCase();
      if (hasPrec) {
        if (prec === 0 && mag === 0n) digits = '';
        if (digits.length < prec) digits = '0'.repeat(prec - digits.length) + digits;
        zero = false;
      }
      if (conv === 'd' || conv === 'i') {
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
      } else if (alt) {
        if (conv === 'o') {
          if (digits[0] !== '0') digits = '0' + digits;
        } else if (mag !== 0n) {
          prefix = conv === 'x' ? '0x' : '0X';
        }
      }
      body = digits;
    } else {
      const x = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      if (Number.isNaN(x)) {
        body = upper ? 'NAN' : 'nan';
        zero = false;
      } else {
        const neg = x < 0 || Object.is(x, -0);
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        const ax = Math.abs(x);
        if (ax === Infinity) {
          body = upper ? 'INF' : 'inf';
          zero = false;
        } else {
          const p = hasPrec ? prec : 6;
          const lc = conv.toLowerCase();
          if (lc === 'f') {
            body = fixedStr(ax, p, alt);
          } else if (lc === 'e') {
            body = expStr(ax, p, alt, upper);
          } else {
            const P = p === 0 ? 1 : p;
            let X = 0;
            if (ax !== 0) X = expDigits(ax, P - 1).exp;
            if (P > X && X >= -4) body = fixedStr(ax, P - 1 - X, alt);
            else body = expStr(ax, P - 1, alt, upper);
            if (!alt) body = stripZeros(body);
          }
        }
      }
    }

    const len = sign.length + prefix.length + body.length;
    if (len >= width) return sign + prefix + body;
    const pad = width - len;
    if (left) return sign + prefix + body + ' '.repeat(pad);
    if (zero) return sign + prefix + '0'.repeat(pad) + body;
    return ' '.repeat(pad) + sign + prefix + body;
  });
}
