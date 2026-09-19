function roundDiv(n: bigint, d: bigint): bigint {
  const q = n / d;
  const r = n % d;
  const t = 2n * r;
  if (t > d || (t === d && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// exact decomposition of a finite non-negative double: x = m * 2^e
function decompose(x: number): [bigint, number] {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const bexp = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (bexp === 0) return [m, -1074];
  m |= 1n << 52n;
  return [m, bexp - 1075];
}

// round(x * 10^k), half-even, exact
function scaled(x: number, k: number): bigint {
  const [m, e] = decompose(x);
  let num = m;
  let den = 1n;
  if (e >= 0) num <<= BigInt(e);
  else den <<= BigInt(-e);
  if (k >= 0) num *= 10n ** BigInt(k);
  else den *= 10n ** BigInt(-k);
  return roundDiv(num, den);
}

function fixedStr(x: number, prec: number, alt: boolean): string {
  let s = scaled(x, prec).toString();
  if (prec > 0) {
    s = s.padStart(prec + 1, '0');
    return s.slice(0, s.length - prec) + '.' + s.slice(s.length - prec);
  }
  return alt ? s + '.' : s;
}

// returns [digits string of length prec+1, exponent]
function expDigits(x: number, prec: number): [string, number] {
  if (x === 0) return ['0'.repeat(prec + 1), 0];
  const P = prec + 1;
  let X = Math.floor(Math.log10(x));
  if (!Number.isFinite(X)) X = -324;
  const lo = 10n ** BigInt(P - 1);
  const hi = lo * 10n;
  for (let i = 0; i < 10; i++) {
    const d = scaled(x, P - 1 - X);
    if (d >= hi) X++;
    else if (d < lo) X--;
    else return [d.toString(), X];
  }
  throw new Error('exp');
}

function expStr(digits: string, X: number, alt: boolean, upper: boolean): string {
  const prec = digits.length - 1;
  let s = digits[0];
  if (prec > 0) s += '.' + digits.slice(1);
  else if (alt) s += '.';
  const ax = Math.abs(X);
  s += (upper ? 'E' : 'e') + (X < 0 ? '-' : '+') + (ax < 10 ? '0' : '') + ax;
  return s;
}

function stripZeros(s: string): string {
  if (!s.includes('.')) return s;
  return s.replace(/0+$/, '').replace(/\.$/, '');
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let ai = 0;
  const re = /%(?:(%)|([-+ 0#]*)(\d*)(\.\d*)?([diouxXeEfFgGsc]))/g;
  return fmt.replace(re, (_m, pct, flags: string, w: string, p: string | undefined, conv: string) => {
    if (pct) return '%';
    const arg = args[ai++];
    const left = flags.includes('-');
    const plus = flags.includes('+');
    const space = flags.includes(' ');
    const zero = flags.includes('0') && !left;
    const alt = flags.includes('#');
    const width = w ? parseInt(w, 10) : 0;
    const hasPrec = p !== undefined;
    const prec = hasPrec ? (p!.length > 1 ? parseInt(p!.slice(1), 10) : 0) : -1;

    let sign = '';
    let body = '';
    let zeroPad = false;

    if (conv === 's' || conv === 'c') {
      body = String(arg);
      if (conv === 's' && hasPrec) body = body.slice(0, prec);
    } else if ('dixXo'.includes(conv) || conv === 'i') {
      const v = typeof arg === 'bigint' ? arg : BigInt(arg as number);
      const neg = v < 0n;
      const mag = neg ? -v : v;
      sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
      let digits = conv === 'x' ? mag.toString(16) : conv === 'X' ? mag.toString(16).toUpperCase() : conv === 'o' ? mag.toString(8) : mag.toString(10);
      if (hasPrec && prec === 0 && mag === 0n) digits = '';
      if (hasPrec) digits = digits.padStart(prec, '0');
      if (alt) {
        if (conv === 'o') {
          if (digits[0] !== '0') digits = '0' + digits;
        } else if ((conv === 'x' || conv === 'X') && mag !== 0n) {
          sign += conv === 'x' ? '0x' : '0X';
        }
      }
      body = digits;
      zeroPad = zero && !hasPrec;
    } else {
      const x = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      if (Number.isNaN(x)) {
        body = upper ? 'NAN' : 'nan';
      } else {
        const neg = x < 0 || Object.is(x, -0);
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        const ax = Math.abs(x);
        if (ax === Infinity) {
          body = upper ? 'INF' : 'inf';
        } else {
          const lc = conv.toLowerCase();
          if (lc === 'f') {
            body = fixedStr(ax, hasPrec ? prec : 6, alt);
          } else if (lc === 'e') {
            const [d, X] = expDigits(ax, hasPrec ? prec : 6);
            body = expStr(d, X, alt, upper);
          } else {
            const P = hasPrec ? (prec === 0 ? 1 : prec) : 6;
            const [d, X] = expDigits(ax, P - 1);
            if (P > X && X >= -4) {
              body = fixedStr(ax, P - 1 - X, alt);
              if (!alt) body = stripZeros(body);
            } else {
              let mant = d[0] + (P > 1 ? '.' + d.slice(1) : alt ? '.' : '');
              if (!alt) mant = stripZeros(mant);
              const aX = Math.abs(X);
              body = mant + (upper ? 'E' : 'e') + (X < 0 ? '-' : '+') + (aX < 10 ? '0' : '') + aX;
            }
          }
          zeroPad = zero;
        }
      }
    }

    const len = sign.length + body.length;
    if (len >= width) return sign + body;
    const pad = width - len;
    if (left) return sign + body + ' '.repeat(pad);
    if (zeroPad) return sign + '0'.repeat(pad) + body;
    return ' '.repeat(pad) + sign + body;
  });
}
