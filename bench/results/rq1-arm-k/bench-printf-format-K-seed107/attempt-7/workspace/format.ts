const TEN = 10n;

function pow10(n: number): bigint {
  return TEN ** BigInt(n);
}

// Round n/d to nearest integer, ties to even (n >= 0, d > 0).
function roundDiv(n: bigint, d: bigint): bigint {
  let q = n / d;
  const r2 = (n % d) * 2n;
  if (r2 > d || (r2 === d && (q & 1n) === 1n)) q += 1n;
  return q;
}

// Exact value of a positive finite double as num/den.
function toRational(x: number): [bigint, bigint] {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, x);
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

// round(x * 10^k) for rational x = n/d, k may be negative.
function scaledRound(n: bigint, d: bigint, k: number): bigint {
  return k >= 0 ? roundDiv(n * pow10(k), d) : roundDiv(n, d * pow10(-k));
}

function fixedDigits(x: number, p: number, alt: boolean): string {
  let s: string;
  if (x === 0) s = '0'.repeat(p + 1);
  else {
    const [n, d] = toRational(x);
    s = scaledRound(n, d, p).toString();
    if (s.length < p + 1) s = '0'.repeat(p + 1 - s.length) + s;
  }
  const ip = s.slice(0, s.length - p);
  const fp = s.slice(s.length - p);
  return p > 0 ? ip + '.' + fp : alt ? ip + '.' : ip;
}

// Returns digits string (p+1 digits) and decimal exponent.
function expParts(x: number, p: number): [string, number] {
  if (x === 0) return ['0'.repeat(p + 1), 0];
  const [n, d] = toRational(x);
  let e = Math.floor(Math.log10(x));
  if (!isFinite(e)) e = 0;
  // adjust so that 10^e <= x < 10^(e+1)
  const ge = (k: number) => (k >= 0 ? n >= d * pow10(k) : n * pow10(-k) >= d);
  while (!ge(e)) e--;
  while (ge(e + 1)) e++;
  let digits = scaledRound(n, d, p - e);
  if (digits >= pow10(p + 1)) {
    e++;
    digits = scaledRound(n, d, p - e);
  }
  return [digits.toString(), e];
}

function expStyle(x: number, p: number, alt: boolean, upper: boolean): string {
  const [ds, e] = expParts(x, p);
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
  const re = /%([-+ 0#]*)(\d*)(\.\d*)?([diouxXeEfFgGsc%])/g;
  return fmt.replace(re, (_m, flags: string, w: string, pr: string | undefined, conv: string) => {
    if (conv === '%') return '%';
    const arg = args[ai++];
    const left = flags.includes('-');
    const plus = flags.includes('+');
    const space = flags.includes(' ');
    const zero = flags.includes('0');
    const alt = flags.includes('#');
    const width = w ? parseInt(w, 10) : 0;
    const prec = pr === undefined ? undefined : pr.length > 1 ? parseInt(pr.slice(1), 10) : 0;

    const pad = (sign: string, body: string, zeroOk: boolean): string => {
      const len = sign.length + body.length;
      if (len >= width) return sign + body;
      const fill = width - len;
      if (left) return sign + body + ' '.repeat(fill);
      if (zero && zeroOk) return sign + '0'.repeat(fill) + body;
      return ' '.repeat(fill) + sign + body;
    };

    if (conv === 's') {
      let s = String(arg);
      if (prec !== undefined) s = s.slice(0, prec);
      return pad('', s, false);
    }
    if (conv === 'c') return pad('', String(arg), false);

    if ('diouxX'.includes(conv)) {
      const v = BigInt(arg as number | bigint);
      const neg = v < 0n;
      const mag = neg ? -v : v;
      let digits: string;
      if (conv === 'd' || conv === 'i') digits = mag.toString();
      else if (conv === 'o') digits = mag.toString(8);
      else digits = mag.toString(16);
      if (conv === 'X') digits = digits.toUpperCase();
      if (prec !== undefined) {
        if (prec === 0 && mag === 0n) digits = '';
        else if (digits.length < prec) digits = '0'.repeat(prec - digits.length) + digits;
      }
      let sign = '';
      if (conv === 'd' || conv === 'i') sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
      else if (conv === 'o') {
        if (alt && !digits.startsWith('0')) digits = '0' + digits;
      } else if (alt && mag !== 0n) sign = conv === 'x' ? '0x' : '0X';
      return pad(sign, digits, prec === undefined);
    }

    // floating point
    const x = arg as number;
    const upper = conv === 'E' || conv === 'F' || conv === 'G';
    const neg = x < 0 || Object.is(x, -0);
    if (Number.isNaN(x)) return pad('', upper ? 'NAN' : 'nan', false);
    const sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
    if (!isFinite(x)) return pad(sign, upper ? 'INF' : 'inf', false);
    const ax = Math.abs(x);
    const lc = conv.toLowerCase();
    let body: string;
    if (lc === 'f') body = fixedDigits(ax, prec ?? 6, alt);
    else if (lc === 'e') body = expStyle(ax, prec ?? 6, alt, upper);
    else {
      let P = prec ?? 6;
      if (P === 0) P = 1;
      const X = expParts(ax, P - 1)[1];
      if (P > X && X >= -4) {
        body = fixedDigits(ax, P - 1 - X, alt);
        if (!alt) body = stripZeros(body);
      } else {
        body = expStyle(ax, P - 1, alt, upper);
        if (!alt) {
          const idx = body.search(/[eE]/);
          body = stripZeros(body.slice(0, idx)) + body.slice(idx);
        }
      }
    }
    return pad(sign, body, true);
  });
}
