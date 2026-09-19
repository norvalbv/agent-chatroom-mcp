function decompose(x: number): { m: bigint; e: number } {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, Math.abs(x));
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const exp = (hi >>> 20) & 0x7ff;
  const frac = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (exp === 0) return { m: frac, e: -1074 };
  return { m: frac | (1n << 52n), e: exp - 1075 };
}

// round-half-even of m * 2^e * 10^k
function roundScaled(m: bigint, e: number, k: number): bigint {
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

function fixedDigits(x: number, prec: number): { int: string; frac: string } {
  const { m, e } = decompose(x);
  let s = roundScaled(m, e, prec).toString();
  if (s.length <= prec) s = '0'.repeat(prec - s.length + 1) + s;
  return { int: s.slice(0, s.length - prec), frac: s.slice(s.length - prec) };
}

// digits: prec+1 digits string and decimal exponent
function expDigits(x: number, prec: number): { digits: string; exp: number } {
  if (x === 0) return { digits: '0'.repeat(prec + 1), exp: 0 };
  const { m, e } = decompose(x);
  const P = prec + 1;
  let X = Math.floor(Math.log10(Math.abs(x)));
  if (!isFinite(X)) X = -324;
  const lo = 10n ** BigInt(P - 1);
  const hi = 10n ** BigInt(P);
  for (;;) {
    const N = roundScaled(m, e, prec - X);
    if (N >= hi) X++;
    else if (N < lo) X--;
    else return { digits: N.toString(), exp: X };
  }
}

function expText(digits: string, exp: number, upper: boolean, alt: boolean): string {
  let s = digits[0];
  if (digits.length > 1 || alt) s += '.';
  s += digits.slice(1);
  const a = Math.abs(exp);
  s += (upper ? 'E' : 'e') + (exp < 0 ? '-' : '+') + (a < 10 ? '0' + a : String(a));
  return s;
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let out = '';
  let ai = 0;
  const re = /%(?:(%)|([-+ 0#]*)(\d*)(\.\d*)?([dixXoeEfFgGsc]))/y;
  let i = 0;
  while (i < fmt.length) {
    const p = fmt.indexOf('%', i);
    if (p < 0) {
      out += fmt.slice(i);
      break;
    }
    out += fmt.slice(i, p);
    re.lastIndex = p;
    const mt = re.exec(fmt);
    if (!mt) {
      out += '%';
      i = p + 1;
      continue;
    }
    i = re.lastIndex;
    if (mt[1]) {
      out += '%';
      continue;
    }
    const flags = mt[2];
    const minus = flags.includes('-');
    const plus = flags.includes('+');
    const space = flags.includes(' ');
    const zero = flags.includes('0');
    const alt = flags.includes('#');
    const width = mt[3] ? parseInt(mt[3], 10) : 0;
    const hasPrec = mt[4] !== undefined;
    const precVal = hasPrec ? (mt[4].length > 1 ? parseInt(mt[4].slice(1), 10) : 0) : 0;
    const conv = mt[5];
    const arg = args[ai++];

    let sign = '';
    let prefix = '';
    let body = '';
    let canZero = true;
    const signFor = (neg: boolean) => (neg ? '-' : plus ? '+' : space ? ' ' : '');

    if (conv === 's' || conv === 'c') {
      body = String(arg);
      if (conv === 's' && hasPrec) body = body.slice(0, precVal);
      canZero = false;
    } else if (conv === 'd' || conv === 'i') {
      const v = BigInt(arg as number | bigint);
      sign = signFor(v < 0n);
      let d = (v < 0n ? -v : v).toString();
      if (hasPrec) {
        if (precVal === 0 && v === 0n) d = '';
        d = d.padStart(precVal, '0');
        canZero = false;
      }
      body = d;
    } else if (conv === 'x' || conv === 'X' || conv === 'o') {
      const v = BigInt(arg as number | bigint);
      let d = v.toString(conv === 'o' ? 8 : 16);
      if (conv === 'X') d = d.toUpperCase();
      if (hasPrec) {
        if (precVal === 0 && v === 0n) d = '';
        d = d.padStart(precVal, '0');
        canZero = false;
      }
      if (alt) {
        if (conv === 'o') {
          if (!d.startsWith('0')) d = '0' + d;
        } else if (v !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      }
      body = d;
    } else {
      const x = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      if (Number.isNaN(x)) {
        body = upper ? 'NAN' : 'nan';
        canZero = false;
      } else {
        const neg = x < 0 || Object.is(x, -0);
        sign = signFor(neg);
        if (!isFinite(x)) {
          body = upper ? 'INF' : 'inf';
          canZero = false;
        } else {
          const lc = conv.toLowerCase();
          if (lc === 'f') {
            const prec = hasPrec ? precVal : 6;
            const { int, frac } = fixedDigits(x, prec);
            body = int + (prec > 0 || alt ? '.' : '') + frac;
          } else if (lc === 'e') {
            const prec = hasPrec ? precVal : 6;
            const { digits, exp } = expDigits(x, prec);
            body = expText(digits, exp, upper, alt);
          } else {
            let P = hasPrec ? precVal : 6;
            if (P === 0) P = 1;
            const { digits, exp: X } = expDigits(x, P - 1);
            if (P > X && X >= -4) {
              const prec = P - 1 - X;
              const { int, frac } = fixedDigits(x, prec);
              let f = frac;
              if (!alt) f = f.replace(/0+$/, '');
              body = int + (f.length > 0 || alt ? '.' : '') + f;
            } else {
              let d = digits;
              if (!alt) d = d[0] + d.slice(1).replace(/0+$/, '');
              body = expText(d, X, upper, alt);
            }
          }
        }
      }
    }

    const len = sign.length + prefix.length + body.length;
    if (len >= width) out += sign + prefix + body;
    else if (minus) out += sign + prefix + body + ' '.repeat(width - len);
    else if (zero && canZero) out += sign + prefix + '0'.repeat(width - len) + body;
    else out += ' '.repeat(width - len) + sign + prefix + body;
  }
  return out;
}
