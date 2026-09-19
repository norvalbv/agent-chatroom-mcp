const P10 = (k: number): bigint => 10n ** BigInt(k);

// exact positive finite double as num/den (den is a power of two)
function toRational(x: number): [bigint, bigint] {
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, x);
  const hi = buf.getUint32(0);
  const lo = buf.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  let mant = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let e: number;
  if (expBits === 0) {
    e = -1074;
  } else {
    mant |= 1n << 52n;
    e = expBits - 1075;
  }
  return e >= 0 ? [mant << BigInt(e), 1n] : [mant, 1n << BigInt(-e)];
}

function roundDiv(n: bigint, d: bigint): bigint {
  const q = n / d;
  const r2 = (n % d) * 2n;
  if (r2 > d || (r2 === d && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// round(x * 10^k), half-even
function scaledRound(r: [bigint, bigint], k: number): bigint {
  return k >= 0 ? roundDiv(r[0] * P10(k), r[1]) : roundDiv(r[0], r[1] * P10(-k));
}

function geqPow(r: [bigint, bigint], X: number): boolean {
  const l = r[0] * (X < 0 ? P10(-X) : 1n);
  const rr = r[1] * (X > 0 ? P10(X) : 1n);
  return l >= rr;
}

// returns digit string of length p+1 and decimal exponent
function expDigits(x: number, p: number): [string, number] {
  if (x === 0) return ['0'.repeat(p + 1), 0];
  const r = toRational(x);
  let X = Math.floor(Math.log10(x));
  if (!isFinite(X)) X = 0;
  while (geqPow(r, X + 1)) X++;
  while (!geqPow(r, X)) X--;
  let d = scaledRound(r, p - X);
  if (d >= P10(p + 1)) {
    X++;
    d = scaledRound(r, p - X);
  }
  return [d.toString(), X];
}

function fixedDigits(x: number, p: number): string {
  const d = x === 0 ? 0n : scaledRound(toRational(x), p);
  let s = d.toString();
  if (p > 0) {
    s = s.padStart(p + 1, '0');
    return s.slice(0, s.length - p) + '.' + s.slice(s.length - p);
  }
  return s;
}

function expStr(x: number, p: number, upper: boolean, alt: boolean): string {
  const [ds, X] = expDigits(x, p);
  let s = ds[0];
  if (p > 0) s += '.' + ds.slice(1);
  else if (alt) s += '.';
  const a = Math.abs(X);
  return s + (upper ? 'E' : 'e') + (X < 0 ? '-' : '+') + (a < 10 ? '0' + a : String(a));
}

function stripZeros(s: string): string {
  if (!s.includes('.')) return s;
  return s.replace(/0+$/, '').replace(/\.$/, '');
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let ai = 0;
  const re = /%(?:(%)|([-+ 0#]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc]))/g;
  return fmt.replace(re, (_m, pct, flags: string, w: string, prec: string | undefined, conv: string) => {
    if (pct) return '%';
    const left = flags.includes('-');
    const plus = flags.includes('+');
    const space = flags.includes(' ');
    const zero = flags.includes('0') && !left;
    const alt = flags.includes('#');
    const width = w ? parseInt(w, 10) : 0;
    const hasPrec = prec !== undefined;
    const precN = hasPrec ? (prec === '' ? 0 : parseInt(prec, 10)) : -1;
    const arg = args[ai++];

    let sign = '';
    let prefix = '';
    let body = '';
    let canZero = zero;

    const signFor = (neg: boolean) => (neg ? '-' : plus ? '+' : space ? ' ' : '');

    if (conv === 's' || conv === 'c') {
      body = String(arg);
      if (conv === 's' && hasPrec) body = body.slice(0, precN);
      canZero = false;
    } else if (conv === 'd' || conv === 'i') {
      const v = BigInt(arg as number | bigint);
      sign = signFor(v < 0n);
      body = (v < 0n ? -v : v).toString();
      if (hasPrec) {
        if (precN === 0 && v === 0n) body = '';
        body = body.padStart(precN, '0');
        canZero = false;
      }
    } else if (conv === 'x' || conv === 'X' || conv === 'o') {
      const v = BigInt(arg as number | bigint);
      body = v.toString(conv === 'o' ? 8 : 16);
      if (conv === 'X') body = body.toUpperCase();
      if (hasPrec) {
        if (precN === 0 && v === 0n) body = '';
        body = body.padStart(precN, '0');
        canZero = false;
      }
      if (alt) {
        if (conv === 'o') {
          if (!body.startsWith('0')) body = '0' + body;
        } else if (v !== 0n) {
          prefix = conv === 'x' ? '0x' : '0X';
        }
      }
    } else {
      const x = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      if (Number.isNaN(x)) {
        body = upper ? 'NAN' : 'nan';
        canZero = false;
      } else {
        const neg = x < 0 || Object.is(x, -0);
        sign = signFor(neg);
        const ax = Math.abs(x);
        if (ax === Infinity) {
          body = upper ? 'INF' : 'inf';
          canZero = false;
        } else if (conv === 'f' || conv === 'F') {
          const p = hasPrec ? precN : 6;
          body = fixedDigits(ax, p);
          if (p === 0 && alt) body += '.';
        } else if (conv === 'e' || conv === 'E') {
          body = expStr(ax, hasPrec ? precN : 6, upper, alt);
        } else {
          let P = hasPrec ? precN : 6;
          if (P === 0) P = 1;
          const X = expDigits(ax, P - 1)[1];
          if (P > X && X >= -4) {
            body = fixedDigits(ax, P - 1 - X);
            if (alt && !body.includes('.')) body += '.';
            if (!alt) body = stripZeros(body);
          } else {
            body = expStr(ax, P - 1, upper, alt);
            if (!alt) {
              const ei = body.search(/[eE]/);
              body = stripZeros(body.slice(0, ei)) + body.slice(ei);
            }
          }
        }
      }
    }

    const len = sign.length + prefix.length + body.length;
    if (len >= width) return sign + prefix + body;
    const pad = width - len;
    if (left) return sign + prefix + body + ' '.repeat(pad);
    if (canZero) return sign + prefix + '0'.repeat(pad) + body;
    return ' '.repeat(pad) + sign + prefix + body;
  });
}
