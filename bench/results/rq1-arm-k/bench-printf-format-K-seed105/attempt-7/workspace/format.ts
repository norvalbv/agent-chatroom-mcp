function pow10(n: number): bigint {
  return 10n ** BigInt(n);
}

function roundDiv(n: bigint, d: bigint): bigint {
  const q = n / d;
  const r = n % d;
  const twice = r * 2n;
  if (twice > d || (twice === d && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// exact rational for a finite non-negative double
function ratio(x: number): [bigint, bigint] {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let e: number;
  if (expBits === 0) {
    e = -1074;
  } else {
    m |= 1n << 52n;
    e = expBits - 1075;
  }
  return e >= 0 ? [m << BigInt(e), 1n] : [m, 1n << BigInt(-e)];
}

function fixedDigits(x: number, prec: number): string {
  const [n, d] = ratio(x);
  let s = roundDiv(n * pow10(prec), d).toString();
  if (s.length < prec + 1) s = '0'.repeat(prec + 1 - s.length) + s;
  return s;
}

function fixedText(x: number, prec: number, alt: boolean): string {
  const s = fixedDigits(x, prec);
  const ip = s.slice(0, s.length - prec);
  const fp = s.slice(s.length - prec);
  return prec > 0 ? ip + '.' + fp : alt ? ip + '.' : ip;
}

// digits (prec+1 of them) and decimal exponent
function sci(x: number, prec: number): [string, number] {
  if (x === 0) return ['0'.repeat(prec + 1), 0];
  const [n, d] = ratio(x);
  let X = n.toString().length - d.toString().length;
  const ge = (k: number) => (k >= 0 ? n >= pow10(k) * d : n * pow10(-k) >= d);
  if (!ge(X)) X--;
  const round = (k: number) => {
    const s = prec - k;
    return s >= 0 ? roundDiv(n * pow10(s), d) : roundDiv(n, d * pow10(-s));
  };
  let q = round(X);
  if (q >= pow10(prec + 1)) {
    X++;
    q = round(X);
  }
  return [q.toString(), X];
}

function sciText(x: number, prec: number, alt: boolean, upper: boolean, strip: boolean): string {
  const [digits, X] = sci(x, prec);
  let m = digits[0];
  let frac = digits.slice(1);
  if (strip) frac = frac.replace(/0+$/, '');
  if (frac.length > 0) m += '.' + frac;
  else if (alt) m += '.';
  const a = Math.abs(X);
  return m + (upper ? 'E' : 'e') + (X < 0 ? '-' : '+') + (a < 10 ? '0' + a : String(a));
}

function pad(sign: string, body: string, width: number, left: boolean, zero: boolean): string {
  const len = sign.length + body.length;
  if (len >= width) return sign + body;
  if (left) return sign + body + ' '.repeat(width - len);
  if (zero) return sign + '0'.repeat(width - len) + body;
  return ' '.repeat(width - len) + sign + body;
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let ai = 0;
  return fmt.replace(/%([-+ 0#]*)(\d*)(\.\d*)?([diouxXeEfFgGsc%])/g, (_m, flags: string, w: string, p: string | undefined, conv: string) => {
    if (conv === '%') return '%';
    const left = flags.includes('-');
    const plus = flags.includes('+');
    const space = flags.includes(' ');
    const zero = flags.includes('0') && !left;
    const alt = flags.includes('#');
    const width = w ? parseInt(w, 10) : 0;
    const hasPrec = p !== undefined;
    const precN = hasPrec ? (p!.length > 1 ? parseInt(p!.slice(1), 10) : 0) : -1;
    const arg = args[ai++];

    if (conv === 's') {
      let s = String(arg);
      if (hasPrec) s = s.slice(0, precN);
      return pad('', s, width, left, false);
    }
    if (conv === 'c') return pad('', String(arg), width, left, false);

    if ('diouxX'.includes(conv)) {
      const v = BigInt(arg as number | bigint);
      const neg = v < 0n;
      const mag = neg ? -v : v;
      let digits =
        conv === 'x' ? mag.toString(16) : conv === 'X' ? mag.toString(16).toUpperCase() : conv === 'o' ? mag.toString(8) : mag.toString();
      if (hasPrec && precN === 0 && mag === 0n) digits = '';
      if (digits.length < precN) digits = '0'.repeat(precN - digits.length) + digits;
      let sign = '';
      if (conv === 'd' || conv === 'i') {
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
      } else if (conv === 'o') {
        if (alt && !digits.startsWith('0')) digits = '0' + digits;
      } else if (alt && mag !== 0n) {
        sign = conv === 'x' ? '0x' : '0X';
      }
      return pad(sign, digits, width, left, zero && !hasPrec);
    }

    const x = arg as number;
    const upper = conv === 'E' || conv === 'F' || conv === 'G';
    if (Number.isNaN(x)) return pad('', upper ? 'NAN' : 'nan', width, left, false);
    const neg = x < 0 || Object.is(x, -0);
    const sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
    if (!Number.isFinite(x)) return pad(sign, upper ? 'INF' : 'inf', width, left, false);
    const ax = Math.abs(x);
    const prec = hasPrec ? precN : 6;
    let body: string;
    const lc = conv.toLowerCase();
    if (lc === 'f') {
      body = fixedText(ax, prec, alt);
    } else if (lc === 'e') {
      body = sciText(ax, prec, alt, upper, false);
    } else {
      const P = prec === 0 ? 1 : prec;
      const X = sci(ax, P - 1)[1];
      if (P > X && X >= -4) {
        body = fixedText(ax, P - 1 - X, alt);
        if (!alt && body.includes('.')) body = body.replace(/\.?0+$/, '');
      } else {
        body = sciText(ax, P - 1, alt, upper, !alt);
      }
    }
    return pad(sign, body, width, left, zero);
  });
}
