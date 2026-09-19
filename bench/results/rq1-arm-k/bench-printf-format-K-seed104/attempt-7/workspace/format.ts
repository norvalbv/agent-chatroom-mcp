const pow10 = (n: number): bigint => 10n ** BigInt(n);

// Exact rational num/den for a positive finite double.
function toRational(v: number): { num: bigint; den: bigint } {
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, v);
  const hi = buf.getUint32(0);
  const lo = buf.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  let mant = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let e: number;
  if (expBits === 0) {
    e = -1074;
  } else {
    mant |= 1n << 52n;
    e = expBits - 1075;
  }
  return e >= 0 ? { num: mant << BigInt(e), den: 1n } : { num: mant, den: 1n << BigInt(-e) };
}

// round-half-even(v * 10^s)
function scaled(r: { num: bigint; den: bigint }, s: number): bigint {
  let num = r.num;
  let den = r.den;
  if (s >= 0) num *= pow10(s);
  else den *= pow10(-s);
  const q = num / den;
  const rem = num % den;
  const twice = rem * 2n;
  if (twice > den || (twice === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// floor(log10(v)) exactly
function exp10(r: { num: bigint; den: bigint }, v: number): number {
  let x = Math.floor(Math.log10(v));
  const geq = (k: number): boolean =>
    k >= 0 ? r.num >= pow10(k) * r.den : r.num * pow10(-k) >= r.den;
  while (!geq(x)) x--;
  while (geq(x + 1)) x++;
  return x;
}

function fixed(r: { num: bigint; den: bigint } | null, p: number, alt: boolean): string {
  const n = r ? scaled(r, p) : 0n;
  let s = n.toString();
  if (s.length < p + 1) s = '0'.repeat(p + 1 - s.length) + s;
  const ip = s.slice(0, s.length - p);
  const fp = s.slice(s.length - p);
  return p > 0 ? ip + '.' + fp : alt ? ip + '.' : ip;
}

// digits with p decimals in e-style, returns [digits (d + p decimals), exponent]
function sci(r: { num: bigint; den: bigint } | null, v: number, p: number): [string, number] {
  if (!r) return ['0'.repeat(p + 1), 0];
  let x = exp10(r, v);
  let n = scaled(r, p - x);
  if (n >= pow10(p + 1)) {
    x++;
    n = scaled(r, p - x);
  }
  return [n.toString(), x];
}

function expStr(digits: string, x: number, alt: boolean, upper: boolean): string {
  const m = digits.length > 1 ? digits[0] + '.' + digits.slice(1) : alt ? digits + '.' : digits;
  const ax = Math.abs(x);
  return m + (upper ? 'E' : 'e') + (x < 0 ? '-' : '+') + (ax < 10 ? '0' + ax : String(ax));
}

function stripZeros(s: string): string {
  if (!s.includes('.')) return s;
  return s.replace(/0+$/, '').replace(/\.$/, '');
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let ai = 0;
  return fmt.replace(
    /%([-+ 0#]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc%])/g,
    (_m, flags: string, w: string, p: string | undefined, conv: string) => {
      if (conv === '%') return '%';
      const arg = args[ai++];
      const left = flags.includes('-');
      const plus = flags.includes('+');
      const space = flags.includes(' ');
      const zero = flags.includes('0') && !left;
      const alt = flags.includes('#');
      const width = w ? parseInt(w, 10) : 0;
      const hasPrec = p !== undefined;
      const prec = hasPrec ? (p === '' ? 0 : parseInt(p, 10)) : -1;

      let sign = '';
      let prefix = '';
      let body: string;
      let zeroOk = zero;

      if (conv === 's' || conv === 'c') {
        body = String(arg);
        if (conv === 's' && hasPrec) body = body.slice(0, prec);
        zeroOk = false;
      } else if ('dioxX'.includes(conv)) {
        let n = BigInt(arg as number | bigint);
        if (conv === 'd' || conv === 'i') {
          if (n < 0n) {
            sign = '-';
            n = -n;
          } else sign = plus ? '+' : space ? ' ' : '';
        }
        const base = conv === 'o' ? 8 : conv === 'd' || conv === 'i' ? 10 : 16;
        let digits = n.toString(base);
        if (conv === 'X') digits = digits.toUpperCase();
        if (hasPrec) {
          if (prec === 0 && n === 0n) digits = '';
          if (digits.length < prec) digits = '0'.repeat(prec - digits.length) + digits;
          zeroOk = false;
        }
        if (alt) {
          if (conv === 'o') {
            if (!digits.startsWith('0')) digits = '0' + digits;
          } else if ((conv === 'x' || conv === 'X') && n !== 0n) {
            prefix = conv === 'x' ? '0x' : '0X';
          }
        }
        body = digits;
      } else {
        const v = arg as number;
        const upper = conv === 'E' || conv === 'F' || conv === 'G';
        const neg = v < 0 || Object.is(v, -0);
        if (Number.isNaN(v)) {
          body = upper ? 'NAN' : 'nan';
          zeroOk = false;
        } else {
          sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
          if (!Number.isFinite(v)) {
            body = upper ? 'INF' : 'inf';
            zeroOk = false;
          } else {
            const av = Math.abs(v);
            const r = av === 0 ? null : toRational(av);
            const lc = conv.toLowerCase();
            if (lc === 'f') {
              body = fixed(r, hasPrec ? prec : 6, alt);
            } else if (lc === 'e') {
              const pp = hasPrec ? prec : 6;
              const [d, x] = sci(r, av, pp);
              body = expStr(d, x, alt, upper);
            } else {
              const P = hasPrec ? Math.max(prec, 1) : 6;
              const [d, x] = sci(r, av, P - 1);
              if (P > x && x >= -4) {
                body = fixed(r, P - 1 - x, alt);
                if (!alt) body = stripZeros(body);
              } else {
                let dd = d;
                if (!alt && dd.length > 1) dd = dd.replace(/0+$/, '') || '0';
                body = expStr(dd, x, alt, upper);
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
    },
  );
}
