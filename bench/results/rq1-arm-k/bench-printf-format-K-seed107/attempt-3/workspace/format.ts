function roundDiv(n: bigint, d: bigint): bigint {
  const q = n / d;
  const r2 = (n % d) * 2n;
  if (r2 > d || (r2 === d && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// exact |x| as num/den
function ratio(x: number): [bigint, bigint] {
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, Math.abs(x));
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

// round(|x| * 10^k) half-even
function scaled(x: number, k: number): bigint {
  const [n, d] = ratio(x);
  if (k >= 0) return roundDiv(n * 10n ** BigInt(k), d);
  return roundDiv(n, d * 10n ** BigInt(-k));
}

function sci(x: number, p: number): { digits: string; exp: number } {
  if (x === 0) return { digits: '0'.repeat(p + 1), exp: 0 };
  let X = Math.floor(Math.log10(Math.abs(x)));
  if (!isFinite(X)) X = -324;
  const hi = 10n ** BigInt(p + 1);
  const lo = 10n ** BigInt(p);
  for (;;) {
    const d = scaled(x, p - X);
    if (d >= hi) X++;
    else if (d < lo) X--;
    else return { digits: d.toString(), exp: X };
  }
}

function fixed(x: number, p: number, alt: boolean): string {
  let s = scaled(x, p).toString();
  if (s.length < p + 1) s = '0'.repeat(p + 1 - s.length) + s;
  const ip = s.slice(0, s.length - p);
  const fp = s.slice(s.length - p);
  return p > 0 ? ip + '.' + fp : alt ? ip + '.' : ip;
}

function expStyle(x: number, p: number, alt: boolean, upper: boolean): string {
  const { digits, exp } = sci(x, p);
  let m = digits[0];
  if (p > 0) m += '.' + digits.slice(1);
  else if (alt) m += '.';
  const ae = Math.abs(exp);
  return m + (upper ? 'E' : 'e') + (exp < 0 ? '-' : '+') + (ae < 10 ? '0' : '') + ae;
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
      const left = flags.includes('-');
      const plus = flags.includes('+');
      const space = flags.includes(' ');
      const zero = flags.includes('0') && !left;
      const alt = flags.includes('#');
      const width = w ? parseInt(w, 10) : 0;
      const hasPrec = pr !== undefined;
      const prec = hasPrec ? (pr === '' ? 0 : parseInt(pr, 10)) : -1;
      const arg = args[ai++];

      let sign = '';
      let prefix = '';
      let body: string;
      let canZero = true;

      if (conv === 's' || conv === 'c') {
        let s = String(arg);
        if (conv === 's' && hasPrec) s = s.slice(0, prec);
        body = s;
        canZero = false;
      } else if ('dioxX'.includes(conv)) {
        const v = BigInt(arg as number | bigint);
        const neg = v < 0n;
        const mag = neg ? -v : v;
        if (conv === 'd' || conv === 'i') {
          sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
          body = mag.toString();
        } else if (conv === 'o') {
          body = mag.toString(8);
        } else {
          body = mag.toString(16);
          if (conv === 'X') body = body.toUpperCase();
        }
        if (hasPrec) {
          if (prec === 0 && mag === 0n) body = '';
          if (body.length < prec) body = '0'.repeat(prec - body.length) + body;
          canZero = false;
        }
        if (conv === 'o' && alt && body[0] !== '0') body = '0' + body;
        if ((conv === 'x' || conv === 'X') && alt && mag !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      } else {
        const x = arg as number;
        const upper = conv === 'E' || conv === 'F' || conv === 'G';
        const neg = x < 0 || Object.is(x, -0);
        if (Number.isNaN(x)) {
          body = upper ? 'NAN' : 'nan';
          canZero = false;
        } else {
          sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
          if (!isFinite(x)) {
            body = upper ? 'INF' : 'inf';
            canZero = false;
          } else {
            const lc = conv.toLowerCase();
            if (lc === 'f') {
              body = fixed(x, hasPrec ? prec : 6, alt);
            } else if (lc === 'e') {
              body = expStyle(x, hasPrec ? prec : 6, alt, upper);
            } else {
              let P = hasPrec ? prec : 6;
              if (P === 0) P = 1;
              const X = sci(x, P - 1).exp;
              if (P > X && X >= -4) {
                body = fixed(x, P - 1 - X, alt);
                if (!alt) body = stripZeros(body);
              } else {
                body = expStyle(x, P - 1, alt, upper);
                if (!alt) {
                  const i = body.search(/[eE]/);
                  body = stripZeros(body.slice(0, i)) + body.slice(i);
                }
              }
              if (alt && !body.includes('.')) {
                const i = body.search(/[eE]/);
                body = i < 0 ? body + '.' : body.slice(0, i) + '.' + body.slice(i);
              }
            }
          }
        }
      }

      const len = sign.length + prefix.length + body.length;
      if (len >= width) return sign + prefix + body;
      const pad = width - len;
      if (left) return sign + prefix + body + ' '.repeat(pad);
      if (zero && canZero) return sign + prefix + '0'.repeat(pad) + body;
      return ' '.repeat(pad) + sign + prefix + body;
    },
  );
}
