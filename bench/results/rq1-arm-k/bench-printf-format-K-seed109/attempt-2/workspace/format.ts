function roundDiv(n: bigint, d: bigint): bigint {
  const q = n / d;
  const r = n % d;
  const t = r * 2n;
  if (t > d || (t === d && (q & 1n) === 1n)) return q + 1n;
  return q;
}

function pow10(n: number): bigint {
  return 10n ** BigInt(n);
}

// Exact rational N/D of a finite non-negative double.
function ratio(v: number): [bigint, bigint] {
  if (v === 0) return [0n, 1n];
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, v);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const be = (hi >>> 20) & 0x7ff;
  let mant = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let exp: number;
  if (be === 0) {
    exp = -1074;
  } else {
    mant |= 1n << 52n;
    exp = be - 1075;
  }
  if (exp >= 0) return [mant << BigInt(exp), 1n];
  return [mant, 1n << BigInt(-exp)];
}

// Fixed notation digits of v (non-negative) with p fraction digits.
function fixed(v: number, p: number, alt: boolean): string {
  const [n, d] = ratio(v);
  const s = roundDiv(n * pow10(p), d).toString().padStart(p + 1, '0');
  const ip = s.slice(0, s.length - p);
  const fp = s.slice(s.length - p);
  return p > 0 ? ip + '.' + fp : alt ? ip + '.' : ip;
}

// Scientific digits: returns [digit string of length p+1, exponent].
function sci(v: number, p: number): [string, number] {
  if (v === 0) return ['0'.repeat(p + 1), 0];
  const [n, d] = ratio(v);
  let x = Math.floor(Math.log10(v));
  if (!isFinite(x)) x = -324;
  const ge = (e: number) => (e >= 0 ? n >= d * pow10(e) : n * pow10(-e) >= d);
  while (!ge(x)) x--;
  while (ge(x + 1)) x++;
  const shift = x - p;
  let digits =
    shift >= 0 ? roundDiv(n, d * pow10(shift)) : roundDiv(n * pow10(-shift), d);
  if (digits >= pow10(p + 1)) {
    digits /= 10n;
    x++;
  }
  return [digits.toString(), x];
}

function expStr(x: number, upper: boolean): string {
  const a = Math.abs(x).toString().padStart(2, '0');
  return (upper ? 'E' : 'e') + (x < 0 ? '-' : '+') + a;
}

function sciStr(v: number, p: number, alt: boolean, upper: boolean): string {
  const [ds, x] = sci(v, p);
  const mant = p > 0 ? ds[0] + '.' + ds.slice(1) : alt ? ds + '.' : ds;
  return mant + expStr(x, upper);
}

function stripZeros(s: string): string {
  if (!s.includes('.')) return s;
  return s.replace(/0+$/, '').replace(/\.$/, '');
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let ai = 0;
  const re = /%(?:(%)|([-+ 0#]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc]))/g;
  return fmt.replace(
    re,
    (_m, pct: string | undefined, flags: string, w: string, pr: string | undefined, conv: string) => {
      if (pct) return '%';
      const left = flags.includes('-');
      const plus = flags.includes('+');
      const space = flags.includes(' ');
      const zero = flags.includes('0');
      const alt = flags.includes('#');
      const width = w ? parseInt(w, 10) : 0;
      const prec = pr === undefined ? -1 : pr === '' ? 0 : parseInt(pr, 10);
      const arg = args[ai++];

      let sign = '';
      let prefix = '';
      let body = '';
      let zeroOk = zero && !left;

      if (conv === 's' || conv === 'c') {
        body = String(arg);
        if (conv === 's' && prec >= 0) body = body.slice(0, prec);
        zeroOk = false;
      } else if ('dioxX'.includes(conv)) {
        let big = BigInt(arg as number | bigint);
        if (conv === 'd' || conv === 'i') {
          if (big < 0n) {
            sign = '-';
            big = -big;
          } else sign = plus ? '+' : space ? ' ' : '';
        }
        const isZero = big === 0n;
        let digits =
          conv === 'o' ? big.toString(8) : conv === 'x' ? big.toString(16) : conv === 'X' ? big.toString(16).toUpperCase() : big.toString(10);
        if (prec === 0 && isZero) digits = '';
        if (prec >= 0) digits = digits.padStart(prec, '0');
        if (alt) {
          if (conv === 'o') {
            if (!digits.startsWith('0')) digits = '0' + digits;
          } else if ((conv === 'x' || conv === 'X') && !isZero) {
            prefix = conv === 'x' ? '0x' : '0X';
          }
        }
        if (prec >= 0) zeroOk = false;
        body = digits;
      } else {
        const v = arg as number;
        const upper = conv === 'E' || conv === 'F' || conv === 'G';
        if (Number.isNaN(v)) {
          body = upper ? 'NAN' : 'nan';
          zeroOk = false;
        } else {
          const neg = v < 0 || Object.is(v, -0);
          sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
          const a = Math.abs(v);
          if (a === Infinity) {
            body = upper ? 'INF' : 'inf';
            zeroOk = false;
          } else {
            const p = prec < 0 ? 6 : prec;
            const lc = conv.toLowerCase();
            if (lc === 'f') body = fixed(a, p, alt);
            else if (lc === 'e') body = sciStr(a, p, alt, upper);
            else {
              const P = p === 0 ? 1 : p;
              const x = sci(a, P - 1)[1];
              if (P > x && x >= -4) {
                body = fixed(a, P - 1 - x, alt);
                if (!alt) body = stripZeros(body);
              } else {
                const [ds, xx] = sci(a, P - 1);
                let mant = P - 1 > 0 ? ds[0] + '.' + ds.slice(1) : alt ? ds + '.' : ds;
                if (!alt) mant = stripZeros(mant);
                body = mant + expStr(xx, upper);
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
