function decompose(x: number): [bigint, bigint] {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, x);
  const bits = dv.getBigUint64(0);
  const be = Number((bits >> 52n) & 0x7ffn);
  const frac = bits & ((1n << 52n) - 1n);
  let mant: bigint;
  let exp: number;
  if (be === 0) {
    mant = frac;
    exp = -1074;
  } else {
    mant = frac | (1n << 52n);
    exp = be - 1075;
  }
  return exp >= 0 ? [mant << BigInt(exp), 1n] : [mant, 1n << BigInt(-exp)];
}

function roundDiv(n: bigint, d: bigint): bigint {
  const q = n / d;
  const r2 = (n % d) * 2n;
  if (r2 > d || (r2 === d && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// x * 10^k as a fraction
function scaled(N: bigint, D: bigint, k: number): [bigint, bigint] {
  return k >= 0 ? [N * 10n ** BigInt(k), D] : [N, D * 10n ** BigInt(-k)];
}

function fixedDigits(x: number, p: number): string {
  const [N, D] = decompose(x);
  const [n, d] = scaled(N, D, p);
  let s = roundDiv(n, d).toString();
  if (s.length < p + 1) s = '0'.repeat(p + 1 - s.length) + s;
  return p === 0 ? s : s.slice(0, s.length - p) + '.' + s.slice(s.length - p);
}

// returns p+1 digits and decimal exponent
function expDigits(x: number, p: number): [string, number] {
  if (x === 0) return ['0'.repeat(p + 1), 0];
  const [N, D] = decompose(x);
  let e = Math.floor(Math.log10(x));
  if (!Number.isFinite(e)) e = -324;
  for (;;) {
    const [a, b] = scaled(N, D, -e); // x / 10^e
    if (a < b) e--;
    else if (a >= b * 10n) e++;
    else break;
  }
  const [n, d] = scaled(N, D, p - e);
  let q = roundDiv(n, d);
  if (q >= 10n ** BigInt(p + 1)) {
    e++;
    q = 10n ** BigInt(p);
  }
  return [q.toString(), e];
}

function expStyle(x: number, p: number, alt: boolean, upper: boolean): string {
  const [ds, e] = expDigits(x, p);
  let s = ds[0];
  if (p > 0) s += '.' + ds.slice(1);
  else if (alt) s += '.';
  const ae = Math.abs(e);
  return s + (upper ? 'E' : 'e') + (e < 0 ? '-' : '+') + (ae < 10 ? '0' : '') + ae;
}

function stripZeros(s: string): string {
  if (!s.includes('.')) return s;
  return s.replace(/0+$/, '').replace(/\.$/, '');
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let ai = 0;
  const re = /%(?:(%)|([-+ 0#]*)(\d*)(?:\.(\d*))?([diuxXoeEfFgGsc]))/g;
  return fmt.replace(re, (_m, pct, flags: string, w: string, pr: string | undefined, conv: string) => {
    if (pct) return '%';
    const minus = flags.includes('-');
    const plus = flags.includes('+');
    const space = flags.includes(' ');
    const zero = flags.includes('0');
    const alt = flags.includes('#');
    const width = w ? parseInt(w, 10) : 0;
    const hasPrec = pr !== undefined;
    const prec = hasPrec ? (pr === '' ? 0 : parseInt(pr, 10)) : -1;
    const arg = args[ai++];

    let prefix = '';
    let body: string;
    let zeroOk = zero && !minus;

    const signOf = (neg: boolean) => (neg ? '-' : plus ? '+' : space ? ' ' : '');

    if (conv === 's' || conv === 'c') {
      body = String(arg);
      if (conv === 's' && hasPrec) body = body.slice(0, prec);
      zeroOk = false;
    } else if ('dixXo'.includes(conv) || conv === 'u') {
      const v = BigInt(arg as number | bigint);
      const neg = v < 0n;
      const mag = neg ? -v : v;
      if (conv === 'd' || conv === 'i' || conv === 'u') {
        prefix = signOf(neg);
        body = mag.toString(10);
      } else if (conv === 'o') {
        body = mag.toString(8);
      } else {
        body = mag.toString(16);
        if (conv === 'X') body = body.toUpperCase();
      }
      if (hasPrec) {
        if (prec === 0 && mag === 0n) body = '';
        if (body.length < prec) body = '0'.repeat(prec - body.length) + body;
        zeroOk = false;
      }
      if (alt) {
        if (conv === 'o') {
          if (body[0] !== '0') body = '0' + body;
        } else if ((conv === 'x' || conv === 'X') && mag !== 0n) {
          prefix = conv === 'x' ? '0x' : '0X';
        }
      }
    } else {
      const x = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      if (Number.isNaN(x)) {
        body = upper ? 'NAN' : 'nan';
        zeroOk = false;
      } else {
        const neg = x < 0 || Object.is(x, -0);
        prefix = signOf(neg);
        const ax = Math.abs(x);
        if (ax === Infinity) {
          body = upper ? 'INF' : 'inf';
          zeroOk = false;
        } else {
          const lc = conv.toLowerCase();
          const p = hasPrec ? prec : 6;
          if (lc === 'f') {
            body = fixedDigits(ax, p);
            if (p === 0 && alt) body += '.';
          } else if (lc === 'e') {
            body = expStyle(ax, p, alt, upper);
          } else {
            const P = p === 0 ? 1 : p;
            const X = expDigits(ax, P - 1)[1];
            if (P > X && X >= -4) {
              body = fixedDigits(ax, P - 1 - X);
              if (!alt) body = stripZeros(body);
              else if (!body.includes('.')) body += '.';
            } else {
              body = expStyle(ax, P - 1, alt, upper);
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
    if (minus) return prefix + body + ' '.repeat(pad);
    if (zeroOk) return prefix + '0'.repeat(pad) + body;
    return ' '.repeat(pad) + prefix + body;
  });
}
