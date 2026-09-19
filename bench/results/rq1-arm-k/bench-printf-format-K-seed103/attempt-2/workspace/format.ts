function roundDiv(n: bigint, d: bigint): bigint {
  const q = n / d;
  const r = n % d;
  const t = 2n * r;
  if (t > d || (t === d && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// exact rational of a finite positive double
function toRational(v: number): [bigint, bigint] {
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, v);
  const bits = buf.getBigUint64(0);
  const expBits = Number((bits >> 52n) & 0x7ffn);
  const frac = bits & ((1n << 52n) - 1n);
  let m: bigint;
  let e: number;
  if (expBits === 0) {
    m = frac;
    e = -1074;
  } else {
    m = frac | (1n << 52n);
    e = expBits - 1075;
  }
  return e >= 0 ? [m << BigInt(e), 1n] : [m, 1n << BigInt(-e)];
}

// round(v * 10^k) half-even
function scaledRound(v: number, k: number): bigint {
  const [n, d] = toRational(v);
  if (k >= 0) return roundDiv(n * 10n ** BigInt(k), d);
  return roundDiv(n, d * 10n ** BigInt(-k));
}

function fixedDigits(v: number, p: number): string {
  // returns integer part + '.' + p digits (dot omitted handled by caller)
  let s = v === 0 ? '0'.repeat(p + 1) : scaledRound(v, p).toString();
  if (s.length < p + 1) s = '0'.repeat(p + 1 - s.length) + s;
  const ip = s.slice(0, s.length - p);
  const fp = s.slice(s.length - p);
  return p > 0 ? ip + '.' + fp : ip;
}

function expParts(v: number, p: number): { mant: string; X: number } {
  if (v === 0) return { mant: '0'.repeat(p + 1), X: 0 };
  let X = Math.floor(Math.log10(v));
  if (!Number.isFinite(X)) X = 0;
  for (;;) {
    const [n, d] = toRational(v);
    // check 10^X <= v < 10^(X+1)
    const lo = X >= 0 ? n >= 10n ** BigInt(X) * d : n * 10n ** BigInt(-X) >= d;
    const hi = X + 1 >= 0 ? n < 10n ** BigInt(X + 1) * d : n * 10n ** BigInt(-X - 1) < d;
    if (!lo) X--;
    else if (!hi) X++;
    else break;
  }
  let digits = scaledRound(v, p - X);
  if (digits >= 10n ** BigInt(p + 1)) {
    X++;
    digits = scaledRound(v, p - X);
  }
  return { mant: digits.toString(), X };
}

function expStr(mant: string, X: number, upper: boolean, alt: boolean): string {
  const p = mant.length - 1;
  let s = mant[0] + (p > 0 ? '.' + mant.slice(1) : alt ? '.' : '');
  const ax = Math.abs(X);
  s += (upper ? 'E' : 'e') + (X < 0 ? '-' : '+') + (ax < 10 ? '0' + ax : String(ax));
  return s;
}

function stripZeros(s: string): string {
  if (!s.includes('.')) return s;
  return s.replace(/0+$/, '').replace(/\.$/, '');
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let ai = 0;
  return fmt.replace(
    /%([-+ 0#]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc%])/g,
    (_m, flags: string, w: string, pr: string | undefined, conv: string) => {
      if (conv === '%') return '%';
      const arg = args[ai++];
      const left = flags.includes('-');
      const plus = flags.includes('+');
      const space = flags.includes(' ');
      const zero = flags.includes('0') && !left;
      const alt = flags.includes('#');
      const width = w ? parseInt(w, 10) : 0;
      const hasPrec = pr !== undefined;
      const prec = hasPrec ? (pr === '' ? 0 : parseInt(pr!, 10)) : undefined;

      let sign = '';
      let prefix = '';
      let body: string;
      let canZero = zero;

      if (conv === 's' || conv === 'c') {
        body = String(arg);
        if (conv === 's' && prec !== undefined) body = body.slice(0, prec);
        canZero = false;
      } else if ('diouxX'.includes(conv)) {
        let b = typeof arg === 'bigint' ? arg : BigInt(arg as number);
        const neg = b < 0n;
        if (neg) b = -b;
        let digits: string;
        if (conv === 'd' || conv === 'i') digits = b.toString();
        else if (conv === 'o') digits = b.toString(8);
        else digits = b.toString(16);
        if (conv === 'X') digits = digits.toUpperCase();
        if (prec !== undefined) {
          if (prec === 0 && b === 0n) digits = '';
          if (digits.length < prec) digits = '0'.repeat(prec - digits.length) + digits;
          canZero = false;
        }
        if (conv === 'd' || conv === 'i') {
          sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        } else if (alt) {
          if (conv === 'o') {
            if (!digits.startsWith('0')) digits = '0' + digits;
          } else if (b !== 0n) {
            prefix = conv === 'x' ? '0x' : '0X';
          }
        }
        body = digits;
      } else {
        const v = arg as number;
        const upper = conv === 'E' || conv === 'F' || conv === 'G';
        const neg = !Number.isNaN(v) && (v < 0 || Object.is(v, -0));
        if (!Number.isNaN(v)) sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        if (!Number.isFinite(v)) {
          body = Number.isNaN(v) ? 'nan' : 'inf';
          if (upper) body = body.toUpperCase();
          canZero = false;
        } else {
          const a = Math.abs(v);
          const lc = conv.toLowerCase();
          if (lc === 'f') {
            body = fixedDigits(a, prec ?? 6);
            if (alt && !body.includes('.')) body += '.';
          } else if (lc === 'e') {
            const { mant, X } = expParts(a, prec ?? 6);
            body = expStr(mant, X, upper, alt);
          } else {
            const P = prec === undefined ? 6 : Math.max(prec, 1);
            const { mant, X } = expParts(a, P - 1);
            if (P > X && X >= -4) {
              body = fixedDigits(a, P - 1 - X);
              if (!alt) body = stripZeros(body);
              else if (!body.includes('.')) body += '.';
            } else {
              let m = mant[0] + (P > 1 ? '.' + mant.slice(1) : '');
              if (!alt) m = stripZeros(m);
              else if (!m.includes('.')) m += '.';
              body = m + (upper ? 'E' : 'e') + (X < 0 ? '-' : '+') + (Math.abs(X) < 10 ? '0' : '') + Math.abs(X);
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
    },
  );
}
