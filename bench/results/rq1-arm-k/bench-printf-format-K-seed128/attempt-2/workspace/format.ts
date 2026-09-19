const f64 = new Float64Array(1);
const u64 = new BigUint64Array(f64.buffer);

// round-half-even(|x| * 10^k) computed exactly
function roundScaled(x: number, k: number): bigint {
  f64[0] = Math.abs(x);
  const bits = u64[0];
  const ex = Number((bits >> 52n) & 0x7ffn);
  const frac = bits & ((1n << 52n) - 1n);
  let m: bigint;
  let e: number;
  if (ex === 0) {
    m = frac;
    e = -1074;
  } else {
    m = frac | (1n << 52n);
    e = ex - 1075;
  }
  let num = m;
  let den = 1n;
  if (e >= 0) num <<= BigInt(e);
  else den <<= BigInt(-e);
  if (k >= 0) num *= 10n ** BigInt(k);
  else den *= 10n ** BigInt(-k);
  let q = num / den;
  const r = num % den;
  const twice = r * 2n;
  if (twice > den || (twice === den && (q & 1n) === 1n)) q++;
  return q;
}

function fixed(x: number, prec: number, alt: boolean): string {
  const s = roundScaled(x, prec).toString().padStart(prec + 1, '0');
  if (prec === 0) return alt ? s + '.' : s;
  return s.slice(0, -prec) + '.' + s.slice(-prec);
}

// returns digits (p+1 of them) and decimal exponent
function expParts(x: number, p: number): { digits: string; exp: number } {
  if (x === 0) return { digits: '0'.repeat(p + 1), exp: 0 };
  let E = Math.floor(Math.log10(Math.abs(x)));
  if (!isFinite(E)) E = -324;
  const lo = 10n ** BigInt(p);
  const hi = lo * 10n;
  for (let i = 0; i < 10; i++) {
    const q = roundScaled(x, p - E);
    if (q >= hi) E++;
    else if (q < lo) E--;
    else return { digits: q.toString(), exp: E };
  }
  throw new Error('exponent search failed');
}

function expStr(digits: string, exp: number, p: number, alt: boolean, upper: boolean): string {
  let m = digits[0];
  if (p > 0) m += '.' + digits.slice(1);
  else if (alt) m += '.';
  const a = Math.abs(exp);
  return m + (upper ? 'E' : 'e') + (exp < 0 ? '-' : '+') + (a < 10 ? '0' + a : String(a));
}

function stripZeros(s: string): string {
  if (!s.includes('.')) return s;
  return s.replace(/0+$/, '').replace(/\.$/, '');
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let ai = 0;
  const re = /%([-+ 0#]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc%])/g;
  return fmt.replace(re, (_m, flags: string, w: string, pr: string | undefined, conv: string) => {
    if (conv === '%') return '%';
    const left = flags.includes('-');
    const plus = flags.includes('+');
    const space = flags.includes(' ');
    const zero = flags.includes('0');
    const alt = flags.includes('#');
    const width = w ? parseInt(w, 10) : 0;
    const hasPrec = pr !== undefined;
    const prec = hasPrec ? (pr === '' ? 0 : parseInt(pr, 10)) : -1;
    const arg = args[ai++];

    let sign = '';
    let prefix = '';
    let body: string;
    let canZero = false;

    if (conv === 's' || conv === 'c') {
      body = String(arg);
      if (conv === 's' && hasPrec) body = body.slice(0, prec);
    } else if ('dioxX'.includes(conv)) {
      const v = BigInt(arg as number | bigint);
      const neg = v < 0n;
      const mag = neg ? -v : v;
      if (conv === 'd' || conv === 'i') {
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
      }
      let digits = conv === 'o' ? mag.toString(8) : conv === 'x' ? mag.toString(16) : conv === 'X' ? mag.toString(16).toUpperCase() : mag.toString();
      if (hasPrec) {
        if (prec === 0 && mag === 0n) digits = '';
        digits = digits.padStart(prec, '0');
      }
      if (alt) {
        if (conv === 'o') {
          if (!digits.startsWith('0')) digits = '0' + digits;
        } else if (conv !== 'd' && conv !== 'i' && mag !== 0n) {
          prefix = conv === 'x' ? '0x' : '0X';
        }
      }
      body = digits;
      canZero = !hasPrec;
    } else {
      const x = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      const neg = x < 0 || Object.is(x, -0);
      if (!Number.isNaN(x)) sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
      if (Number.isNaN(x)) body = upper ? 'NAN' : 'nan';
      else if (!isFinite(x)) body = upper ? 'INF' : 'inf';
      else {
        canZero = true;
        const lc = conv.toLowerCase();
        if (lc === 'f') {
          body = fixed(x, hasPrec ? prec : 6, alt);
        } else if (lc === 'e') {
          const p = hasPrec ? prec : 6;
          const { digits, exp } = expParts(x, p);
          body = expStr(digits, exp, p, alt, upper);
        } else {
          const P = hasPrec ? prec || 1 : 6;
          const { digits, exp: X } = expParts(x, P - 1);
          if (P > X && X >= -4) {
            body = fixed(x, P - 1 - X, alt);
            if (!alt) body = stripZeros(body);
          } else {
            let mant = digits[0] + (P > 1 ? '.' + digits.slice(1) : alt ? '.' : '');
            if (!alt) mant = stripZeros(mant);
            const a = Math.abs(X);
            body = mant + (upper ? 'E' : 'e') + (X < 0 ? '-' : '+') + (a < 10 ? '0' + a : String(a));
          }
        }
      }
    }

    const len = sign.length + prefix.length + body.length;
    if (len >= width) return sign + prefix + body;
    const pad = width - len;
    if (left) return sign + prefix + body + ' '.repeat(pad);
    if (zero && canZero) return sign + prefix + '0'.repeat(pad) + body;
    return ' '.repeat(pad) + sign + prefix + body;
  });
}
