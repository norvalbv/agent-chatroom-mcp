function roundDiv(a: bigint, b: bigint): bigint {
  const q = a / b;
  const r2 = (a % b) * 2n;
  if (r2 > b || (r2 === b && (q & 1n) === 1n)) return q + 1n;
  return q;
}

function exact(x: number): [bigint, bigint] {
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, Math.abs(x));
  const bits = buf.getBigUint64(0);
  const ef = Number((bits >> 52n) & 0x7ffn);
  const frac = bits & ((1n << 52n) - 1n);
  const m = ef === 0 ? frac : frac | (1n << 52n);
  const e = ef === 0 ? -1074 : ef - 1075;
  return e >= 0 ? [m << BigInt(e), 1n] : [m, 1n << BigInt(-e)];
}

// round |x| * 10^p to an integer
function scaled(num: bigint, den: bigint, p: number): bigint {
  return p >= 0 ? roundDiv(num * 10n ** BigInt(p), den) : roundDiv(num, den * 10n ** BigInt(-p));
}

function fixedDigits(x: number, p: number, alt: boolean): string {
  const [num, den] = exact(x);
  let s = scaled(num, den, p).toString();
  if (s.length < p + 1) s = '0'.repeat(p + 1 - s.length) + s;
  const ip = s.slice(0, s.length - p);
  const fp = s.slice(s.length - p);
  return p > 0 ? ip + '.' + fp : alt ? ip + '.' : ip;
}

// returns [digits string of length p+1, decimal exponent]
function expParts(x: number, p: number): [string, number] {
  if (x === 0) return ['0'.repeat(p + 1), 0];
  const [num, den] = exact(x);
  let e = Math.floor(Math.log10(Math.abs(x)));
  if (!isFinite(e)) e = 0;
  // correct estimate: 10^e <= x < 10^(e+1)
  const ge = (k: number) => (k >= 0 ? num >= den * 10n ** BigInt(k) : num * 10n ** BigInt(-k) >= den);
  while (!ge(e)) e--;
  while (ge(e + 1)) e++;
  let n = scaled(num, den, p - e);
  if (n >= 10n ** BigInt(p + 1)) {
    e++;
    n = scaled(num, den, p - e);
  }
  return [n.toString(), e];
}

function expStr(digits: string, e: number, upper: boolean, alt: boolean): string {
  const p = digits.length - 1;
  const mant = p > 0 ? digits[0] + '.' + digits.slice(1) : alt ? digits + '.' : digits;
  const ae = Math.abs(e);
  return mant + (upper ? 'E' : 'e') + (e < 0 ? '-' : '+') + (ae < 10 ? '0' + ae : String(ae));
}

function stripZeros(s: string): string {
  if (!s.includes('.')) return s;
  return s.replace(/0+$/, '').replace(/\.$/, '');
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let ai = 0;
  return fmt.replace(/%(?:%|([-+ 0#]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc]))/g, (whole, flags, widthS, precS, conv) => {
    if (whole === '%%') return '%';
    const left = flags.includes('-');
    const plus = flags.includes('+');
    const space = flags.includes(' ');
    const zero = flags.includes('0') && !left;
    const alt = flags.includes('#');
    const width = widthS ? parseInt(widthS, 10) : 0;
    const hasPrec = precS !== undefined;
    const prec = hasPrec ? (precS === '' ? 0 : parseInt(precS, 10)) : -1;
    const arg = args[ai++];

    let prefix = '';
    let body = '';
    let zeroOk = zero;

    if (conv === 's' || conv === 'c') {
      body = String(arg);
      if (conv === 's' && hasPrec) body = body.slice(0, prec);
      zeroOk = false;
    } else if (conv === 'd' || conv === 'i' || conv === 'x' || conv === 'X' || conv === 'o') {
      const v = BigInt(arg as number | bigint);
      const neg = v < 0n;
      const mag = neg ? -v : v;
      if (conv === 'd' || conv === 'i') {
        prefix = neg ? '-' : plus ? '+' : space ? ' ' : '';
        body = mag.toString(10);
      } else if (conv === 'o') {
        body = mag.toString(8);
      } else {
        body = mag.toString(16);
        if (conv === 'X') body = body.toUpperCase();
      }
      if (hasPrec) {
        if (prec === 0 && mag === 0n) body = '';
        else if (body.length < prec) body = '0'.repeat(prec - body.length) + body;
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
      const neg = x < 0 || Object.is(x, -0);
      if (Number.isNaN(x)) {
        body = upper ? 'NAN' : 'nan';
        zeroOk = false;
      } else {
        prefix = neg ? '-' : plus ? '+' : space ? ' ' : '';
        if (!isFinite(x)) {
          body = upper ? 'INF' : 'inf';
          zeroOk = false;
        } else {
          const lc = conv.toLowerCase();
          if (lc === 'f') {
            body = fixedDigits(x, hasPrec ? prec : 6, alt);
          } else if (lc === 'e') {
            const p = hasPrec ? prec : 6;
            const [d, e] = expParts(x, p);
            body = expStr(d, e, upper, alt);
          } else {
            let P = hasPrec ? prec : 6;
            if (P === 0) P = 1;
            const [d, X] = expParts(x, P - 1);
            if (P > X && X >= -4) {
              body = fixedDigits(x, P - 1 - X, alt);
              if (!alt) body = stripZeros(body);
            } else {
              let mant = d.length > 1 ? d[0] + '.' + d.slice(1) : alt ? d + '.' : d;
              if (!alt) mant = stripZeros(mant);
              const ae = Math.abs(X);
              body = mant + (upper ? 'E' : 'e') + (X < 0 ? '-' : '+') + (ae < 10 ? '0' + ae : String(ae));
            }
          }
        }
      }
    }

    const len = prefix.length + body.length;
    if (len >= width) return prefix + body;
    const pad = width - len;
    if (left) return prefix + body + ' '.repeat(pad);
    if (zeroOk) return prefix + '0'.repeat(pad) + body;
    return ' '.repeat(pad) + prefix + body;
  });
}
