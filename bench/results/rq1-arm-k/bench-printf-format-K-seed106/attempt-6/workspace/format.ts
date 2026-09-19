function roundDiv(n: bigint, d: bigint): bigint {
  const q = n / d;
  const r2 = (n % d) * 2n;
  if (r2 > d || (r2 === d && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// abs finite, >= 0. Returns [num, den] with abs = num/den exactly.
function rational(abs: number): [bigint, bigint] {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, abs);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const eb = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let e: number;
  if (eb === 0) e = -1074;
  else {
    m |= 1n << 52n;
    e = eb - 1075;
  }
  return e >= 0 ? [m << BigInt(e), 1n] : [m, 1n << BigInt(-e)];
}

// round(abs * 10^k), half-even
function scaled(r: [bigint, bigint], k: number): bigint {
  const [n, d] = r;
  return k >= 0 ? roundDiv(n * 10n ** BigInt(k), d) : roundDiv(n, d * 10n ** BigInt(-k));
}

// compare abs with 10^k
function cmp10(r: [bigint, bigint], k: number): number {
  const [n, d] = r;
  const a = k >= 0 ? n : n * 10n ** BigInt(-k);
  const b = k >= 0 ? d * 10n ** BigInt(k) : d;
  return a < b ? -1 : a > b ? 1 : 0;
}

function fixedDigits(abs: number, prec: number): string {
  let s = scaled(rational(abs), prec).toString();
  if (prec > 0) {
    s = s.padStart(prec + 1, '0');
    return s.slice(0, s.length - prec) + '.' + s.slice(s.length - prec);
  }
  return s;
}

// returns [digit string of prec+1 digits, exponent]
function expDigits(abs: number, prec: number): [string, number] {
  if (abs === 0) return ['0'.repeat(prec + 1), 0];
  const r = rational(abs);
  let x = Math.floor(Math.log10(abs));
  if (!Number.isFinite(x)) x = -324;
  while (cmp10(r, x) < 0) x--;
  while (cmp10(r, x + 1) >= 0) x++;
  let n = scaled(r, prec - x);
  if (n >= 10n ** BigInt(prec + 1)) {
    x++;
    n = scaled(r, prec - x);
  }
  return [n.toString(), x];
}

function expText(ds: string, x: number, prec: number, alt: boolean, upper: boolean): string {
  let s = ds[0];
  if (prec > 0 || alt) s += '.';
  s += ds.slice(1);
  const ax = Math.abs(x);
  s += (upper ? 'E' : 'e') + (x < 0 ? '-' : '+') + (ax < 10 ? '0' + ax : String(ax));
  return s;
}

function stripZeros(s: string): string {
  if (!s.includes('.')) return s;
  return s.replace(/0+$/, '').replace(/\.$/, '');
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let ai = 0;
  return fmt.replace(/%([-+ 0#]*)(\d*)(\.\d*)?([diouxXeEfFgGscdi%])/g, (_m, flags: string, w: string, p: string | undefined, conv: string) => {
    if (conv === '%') return '%';
    const left = flags.includes('-');
    const plus = flags.includes('+');
    const space = flags.includes(' ');
    const zero = flags.includes('0') && !left;
    const alt = flags.includes('#');
    const width = w ? parseInt(w, 10) : 0;
    const hasPrec = p !== undefined;
    const prec = hasPrec ? (p.length > 1 ? parseInt(p.slice(1), 10) : 0) : -1;
    const arg = args[ai++];

    let prefix = '';
    let body = '';
    let zeroOk = true;

    if (conv === 's' || conv === 'c') {
      body = String(arg);
      if (conv === 's' && hasPrec) body = body.slice(0, prec);
      zeroOk = false;
    } else if ('diuxXo'.includes(conv)) {
      const v = BigInt(arg as number | bigint);
      const neg = v < 0n;
      const a = neg ? -v : v;
      let digits = conv === 'x' ? a.toString(16) : conv === 'X' ? a.toString(16).toUpperCase() : conv === 'o' ? a.toString(8) : a.toString();
      if (hasPrec) {
        if (prec === 0 && a === 0n) digits = '';
        digits = digits.padStart(prec, '0');
        zeroOk = false;
      }
      if (conv === 'd' || conv === 'i' || conv === 'u') {
        prefix = neg ? '-' : plus ? '+' : space ? ' ' : '';
      } else if (alt) {
        if (conv === 'o') {
          if (!digits.startsWith('0')) digits = '0' + digits;
        } else if (a !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      }
      body = digits;
    } else {
      const v = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      const neg = v < 0 || Object.is(v, -0);
      prefix = Number.isNaN(v) ? '' : neg ? '-' : plus ? '+' : space ? ' ' : '';
      if (!Number.isFinite(v)) {
        body = Number.isNaN(v) ? 'nan' : 'inf';
        if (upper) body = body.toUpperCase();
        zeroOk = false;
      } else {
        const abs = Math.abs(v);
        const lc = conv.toLowerCase();
        if (lc === 'f') {
          const pr = hasPrec ? prec : 6;
          body = fixedDigits(abs, pr);
          if (pr === 0 && alt) body += '.';
        } else if (lc === 'e') {
          const pr = hasPrec ? prec : 6;
          const [ds, x] = expDigits(abs, pr);
          body = expText(ds, x, pr, alt, upper);
        } else {
          let P = hasPrec ? prec : 6;
          if (P === 0) P = 1;
          const [ds, x] = expDigits(abs, P - 1);
          if (P > x && x >= -4) {
            body = fixedDigits(abs, P - 1 - x);
            if (P - 1 - x === 0 && alt) body += '.';
            if (!alt) body = stripZeros(body);
          } else {
            let t = expText(ds, x, P - 1, alt, upper);
            if (!alt) {
              const i = t.search(/[eE]/);
              t = stripZeros(t.slice(0, i)) + t.slice(i);
            }
            body = t;
          }
        }
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
