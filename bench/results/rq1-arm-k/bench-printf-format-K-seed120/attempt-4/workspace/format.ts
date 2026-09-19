function decompose(x: number): [bigint, bigint] {
  // |x| = num / den exactly
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, Math.abs(x));
  const bits = dv.getBigUint64(0);
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

function roundDiv(n: bigint, d: bigint): bigint {
  const q = n / d;
  const r = n % d;
  const t = 2n * r;
  if (t > d || (t === d && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// round(|x| * 10^k) half-even
function scaled(x: number, k: number): bigint {
  const [n, d] = decompose(x);
  const p = 10n ** BigInt(Math.abs(k));
  return k >= 0 ? roundDiv(n * p, d) : roundDiv(n, d * p);
}

function fixedStr(x: number, p: number, alt: boolean): string {
  let s = scaled(x, p).toString();
  if (p === 0) return alt ? s + '.' : s;
  s = s.padStart(p + 1, '0');
  return s.slice(0, s.length - p) + '.' + s.slice(s.length - p);
}

// returns [digits string of length p+1, exponent]
function expParts(x: number, p: number): [string, number] {
  if (x === 0) return ['0'.repeat(p + 1), 0];
  const [n, d] = decompose(x);
  let X = Math.floor(Math.log10(Math.abs(x)));
  if (!isFinite(X)) X = 0;
  // adjust so 10^X <= x < 10^(X+1)
  const ge = (k: number) => (k >= 0 ? n >= d * 10n ** BigInt(k) : n * 10n ** BigInt(-k) >= d);
  while (!ge(X)) X--;
  while (ge(X + 1)) X++;
  let N = scaled(x, p - X);
  if (N >= 10n ** BigInt(p + 1)) {
    X++;
    N = scaled(x, p - X);
  }
  return [N.toString(), X];
}

function expStr(x: number, p: number, alt: boolean, upper: boolean): string {
  const [dg, X] = expParts(x, p);
  return expFmt(dg, X, p, alt, upper);
}

function expFmt(dg: string, X: number, p: number, alt: boolean, upper: boolean, strip = false): string {
  let mant = dg[0];
  let fr = dg.slice(1);
  if (strip) fr = fr.replace(/0+$/, '');
  if (fr.length > 0) mant += '.' + fr;
  else if (alt) mant += '.';
  const ax = Math.abs(X);
  return mant + (upper ? 'E' : 'e') + (X < 0 ? '-' : '+') + (ax < 10 ? '0' + ax : String(ax));
}

function stripFixed(s: string): string {
  if (!s.includes('.')) return s;
  return s.replace(/0+$/, '').replace(/\.$/, '');
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let out = '';
  let ai = 0;
  let i = 0;
  while (i < fmt.length) {
    const ch = fmt[i];
    if (ch !== '%') {
      out += ch;
      i++;
      continue;
    }
    i++;
    if (fmt[i] === '%') {
      out += '%';
      i++;
      continue;
    }
    let minus = false, plus = false, space = false, zero = false, alt = false;
    for (; i < fmt.length; i++) {
      const f = fmt[i];
      if (f === '-') minus = true;
      else if (f === '+') plus = true;
      else if (f === ' ') space = true;
      else if (f === '0') zero = true;
      else if (f === '#') alt = true;
      else break;
    }
    let width = 0;
    while (i < fmt.length && fmt[i] >= '0' && fmt[i] <= '9') width = width * 10 + Number(fmt[i++]);
    let prec = -1;
    if (fmt[i] === '.') {
      i++;
      prec = 0;
      while (i < fmt.length && fmt[i] >= '0' && fmt[i] <= '9') prec = prec * 10 + Number(fmt[i++]);
    }
    const conv = fmt[i++];
    const arg = args[ai++];

    let sign = '';
    let prefix = '';
    let body = '';
    let canZero = zero && !minus;

    if (conv === 'd' || conv === 'i') {
      const v = BigInt(arg as number | bigint);
      sign = v < 0n ? '-' : plus ? '+' : space ? ' ' : '';
      body = (v < 0n ? -v : v).toString();
      if (prec === 0 && v === 0n) body = '';
      if (prec >= 0) {
        body = body.padStart(prec, '0');
        canZero = false;
      }
    } else if (conv === 'x' || conv === 'X' || conv === 'o') {
      const v = BigInt(arg as number | bigint);
      body = v.toString(conv === 'o' ? 8 : 16);
      if (conv === 'X') body = body.toUpperCase();
      if (prec === 0 && v === 0n) body = '';
      if (prec >= 0) {
        body = body.padStart(prec, '0');
        canZero = false;
      }
      if (alt) {
        if (conv === 'o') {
          if (!body.startsWith('0')) body = '0' + body;
        } else if (v !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      }
    } else if ('eEfFgG'.includes(conv)) {
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
          if (lc === 'f') body = fixedStr(x, prec < 0 ? 6 : prec, alt);
          else if (lc === 'e') body = expStr(x, prec < 0 ? 6 : prec, alt, upper);
          else {
            let P = prec < 0 ? 6 : prec;
            if (P === 0) P = 1;
            const [dg, X] = expParts(x, P - 1);
            if (P > X && X >= -4) {
              body = fixedStr(x, P - 1 - X, alt);
              if (!alt) body = stripFixed(body);
            } else {
              body = expFmt(dg, X, P - 1, alt, upper, !alt);
            }
          }
        }
      }
    } else if (conv === 's') {
      body = String(arg);
      if (prec >= 0) body = body.slice(0, prec);
      canZero = false;
    } else if (conv === 'c') {
      body = String(arg);
      canZero = false;
    }

    const len = sign.length + prefix.length + body.length;
    if (len < width) {
      const pad = width - len;
      if (minus) body = sign + prefix + body + ' '.repeat(pad);
      else if (canZero) body = sign + prefix + '0'.repeat(pad) + body;
      else body = ' '.repeat(pad) + sign + prefix + body;
    } else body = sign + prefix + body;
    out += body;
  }
  return out;
}
