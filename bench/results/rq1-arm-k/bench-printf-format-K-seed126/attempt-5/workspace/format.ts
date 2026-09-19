function roundDiv(n: bigint, d: bigint): bigint {
  let q = n / d;
  const r2 = (n % d) * 2n;
  if (r2 > d || (r2 === d && (q & 1n) === 1n)) q += 1n;
  return q;
}

// Exact rational num/den for a finite non-negative double.
function toRational(x: number): [bigint, bigint] {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, x);
  const bits = dv.getBigUint64(0);
  const expBits = Number((bits >> 52n) & 0x7ffn);
  const frac = bits & ((1n << 52n) - 1n);
  let m: bigint;
  let e2: number;
  if (expBits === 0) {
    m = frac;
    e2 = -1074;
  } else {
    m = frac | (1n << 52n);
    e2 = expBits - 1075;
  }
  return e2 >= 0 ? [m << BigInt(e2), 1n] : [m, 1n << BigInt(-e2)];
}

// round(x * 10^k) half-even
function scaledRound(r: [bigint, bigint], k: number): bigint {
  const [n, d] = r;
  return k >= 0 ? roundDiv(n * 10n ** BigInt(k), d) : roundDiv(n, d * 10n ** BigInt(-k));
}

function fixedStr(x: number, p: number, alt: boolean): string {
  const q = scaledRound(toRational(x), p);
  let s = q.toString();
  if (p > 0) {
    s = s.padStart(p + 1, '0');
    return s.slice(0, s.length - p) + '.' + s.slice(s.length - p);
  }
  return alt ? s + '.' : s;
}

// digits (p+1 of them) and decimal exponent
function expParts(x: number, p: number): [string, number] {
  if (x === 0) return ['0'.repeat(p + 1), 0];
  const r = toRational(x);
  let X = Math.floor(Math.log10(x));
  if (!isFinite(X)) X = 0;
  // fix estimate: 10^X <= x < 10^(X+1)
  const ge = (e: number) =>
    e >= 0 ? r[0] >= 10n ** BigInt(e) * r[1] : r[0] * 10n ** BigInt(-e) >= r[1];
  while (!ge(X)) X--;
  while (ge(X + 1)) X++;
  let n = scaledRound(r, p - X);
  if (n >= 10n ** BigInt(p + 1)) {
    X++;
    n = scaledRound(r, p - X);
  }
  return [n.toString(), X];
}

function expStr(x: number, p: number, alt: boolean, upper: boolean, strip: boolean): string {
  const [d, X] = expParts(x, p);
  let frac = d.slice(1);
  if (strip && !alt) frac = frac.replace(/0+$/, '');
  let s = d[0];
  if (frac.length > 0 || alt) s += '.' + frac;
  const ax = Math.abs(X);
  return s + (upper ? 'E' : 'e') + (X < 0 ? '-' : '+') + (ax < 10 ? '0' : '') + ax;
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let ai = 0;
  return fmt.replace(/%(?:%|([-+ 0#]*)(\d*)(\.\d*)?([dixXoeEfFgGsc]))/g, (all, flags, wStr, pStr, conv) => {
    if (all === '%%') return '%';
    const left = flags.includes('-');
    const plus = flags.includes('+');
    const space = flags.includes(' ');
    const zero = flags.includes('0') && !left;
    const alt = flags.includes('#');
    const width = wStr ? parseInt(wStr, 10) : 0;
    const hasPrec = pStr !== undefined;
    const prec = hasPrec ? (pStr.length > 1 ? parseInt(pStr.slice(1), 10) : 0) : -1;
    const arg = args[ai++];

    let prefix = '';
    let body: string;
    let zeroOk = false;
    const signOf = (neg: boolean) => (neg ? '-' : plus ? '+' : space ? ' ' : '');

    if (conv === 's' || conv === 'c') {
      body = String(arg);
      if (conv === 's' && hasPrec) body = body.slice(0, prec);
    } else if ('dixXo'.includes(conv)) {
      const v = BigInt(arg as number | bigint);
      const neg = v < 0n;
      const mag = neg ? -v : v;
      const radix = conv === 'd' || conv === 'i' ? 10 : conv === 'o' ? 8 : 16;
      let digits = mag.toString(radix);
      if (conv === 'X') digits = digits.toUpperCase();
      if (hasPrec) {
        if (prec === 0 && mag === 0n) digits = '';
        digits = digits.padStart(prec, '0');
      }
      if (radix === 10) prefix = signOf(neg);
      else if (alt) {
        if (radix === 8) {
          if (!digits.startsWith('0')) digits = '0' + digits;
        } else if (mag !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      }
      body = digits;
      zeroOk = !hasPrec;
    } else {
      const v = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      const neg = v < 0 || Object.is(v, -0);
      if (Number.isNaN(v)) {
        body = upper ? 'NAN' : 'nan';
      } else if (!isFinite(v)) {
        prefix = signOf(neg);
        body = upper ? 'INF' : 'inf';
      } else {
        prefix = signOf(neg);
        const x = Math.abs(v);
        const p = hasPrec ? prec : 6;
        const lc = conv.toLowerCase();
        if (lc === 'f') body = fixedStr(x, p, alt);
        else if (lc === 'e') body = expStr(x, p, alt, upper, false);
        else {
          const P = p === 0 ? 1 : p;
          const X = expParts(x, P - 1)[1];
          if (P > X && X >= -4) {
            body = fixedStr(x, P - 1 - X, alt);
            if (!alt && body.includes('.')) body = body.replace(/\.?0+$/, '');
          } else body = expStr(x, P - 1, alt, upper, true);
        }
        zeroOk = true;
      }
    }

    const len = prefix.length + body.length;
    if (len >= width) return prefix + body;
    const pad = width - len;
    if (left) return prefix + body + ' '.repeat(pad);
    if (zero && zeroOk) return prefix + '0'.repeat(pad) + body;
    return ' '.repeat(pad) + prefix + body;
  });
}
