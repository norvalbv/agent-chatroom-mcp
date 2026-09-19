function roundDiv(n: bigint, d: bigint): bigint {
  const q = n / d;
  const r2 = (n % d) * 2n;
  if (r2 > d || (r2 === d && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// exact rational of |x| (x finite, nonzero)
function toRational(x: number): [bigint, bigint] {
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, Math.abs(x));
  const bits = buf.getBigUint64(0);
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

function scaledRound(x: number, k: number): bigint {
  let [n, d] = toRational(x);
  if (k >= 0) n *= 10n ** BigInt(k);
  else d *= 10n ** BigInt(-k);
  return roundDiv(n, d);
}

function fixedStr(x: number, p: number, alt: boolean): string {
  let s: string;
  if (x === 0) s = '0' + (p > 0 ? '.' + '0'.repeat(p) : '');
  else {
    const r = scaledRound(x, p).toString().padStart(p + 1, '0');
    s = p > 0 ? r.slice(0, r.length - p) + '.' + r.slice(r.length - p) : r;
  }
  if (p === 0 && alt) s += '.';
  return s;
}

// returns [digits (P of them), exponent]
function sciParts(x: number, P: number): [string, number] {
  if (x === 0) return ['0'.repeat(P), 0];
  let x0 = Math.floor(Math.log10(Math.abs(x)));
  const lo = 10n ** BigInt(P - 1);
  const hi = lo * 10n;
  for (;;) {
    const r = scaledRound(x, P - 1 - x0);
    if (r >= hi) x0++;
    else if (r < lo) x0--;
    else return [r.toString(), x0];
  }
}

function sciStr(digits: string, exp: number, p: number, alt: boolean, upper: boolean): string {
  let s = digits[0];
  if (p > 0) s += '.' + digits.slice(1);
  else if (alt) s += '.';
  const a = Math.abs(exp);
  s += (upper ? 'E' : 'e') + (exp < 0 ? '-' : '+') + (a < 10 ? '0' + a : String(a));
  return s;
}

function stripZeros(s: string): string {
  const ei = s.search(/[eE]/);
  let mant = ei >= 0 ? s.slice(0, ei) : s;
  const tail = ei >= 0 ? s.slice(ei) : '';
  if (mant.includes('.')) mant = mant.replace(/0+$/, '').replace(/\.$/, '');
  return mant + tail;
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let ai = 0;
  return fmt.replace(/%([-+ 0#]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc%])/g, (_m, flags: string, w: string, pr: string | undefined, conv: string) => {
    if (conv === '%') return '%';
    const left = flags.includes('-');
    const plus = flags.includes('+');
    const space = flags.includes(' ');
    const zero = flags.includes('0') && !left;
    const alt = flags.includes('#');
    const width = w ? parseInt(w, 10) : 0;
    const hasPrec = pr !== undefined;
    const prec = hasPrec ? (pr === '' ? 0 : parseInt(pr, 10)) : -1;
    const arg = args[ai++];

    const pad = (sign: string, body: string, zeroOk: boolean): string => {
      const len = sign.length + body.length;
      if (len >= width) return sign + body;
      if (left) return sign + body + ' '.repeat(width - len);
      if (zero && zeroOk) {
        // body may carry a 0x prefix
        let prefix = '';
        if (/^0[xX]/.test(body) && (conv === 'x' || conv === 'X')) {
          prefix = body.slice(0, 2);
          body = body.slice(2);
        }
        return sign + prefix + '0'.repeat(width - len) + body;
      }
      return ' '.repeat(width - len) + sign + body;
    };

    if (conv === 's' || conv === 'c') {
      let s = String(arg);
      if (conv === 's' && hasPrec) s = s.slice(0, prec);
      return pad('', s, false);
    }

    if ('dioxX'.includes(conv)) {
      const v = BigInt(arg as number | bigint);
      const neg = v < 0n;
      const mag = neg ? -v : v;
      const radix = conv === 'o' ? 8 : conv === 'd' || conv === 'i' ? 10 : 16;
      let digits = mag === 0n && hasPrec && prec === 0 ? '' : mag.toString(radix);
      if (conv === 'X') digits = digits.toUpperCase();
      if (hasPrec && digits.length < prec) digits = digits.padStart(prec, '0');
      let sign = '';
      if (conv === 'd' || conv === 'i') sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
      if (alt) {
        if (conv === 'o') {
          if (!digits.startsWith('0')) digits = '0' + digits;
        } else if (conv !== 'd' && conv !== 'i' && mag !== 0n) {
          digits = (conv === 'x' ? '0x' : '0X') + digits;
        }
      }
      return pad(sign, digits, !hasPrec);
    }

    // floating point
    const x = arg as number;
    const upper = conv === 'E' || conv === 'F' || conv === 'G';
    const neg = x < 0 || Object.is(x, -0);
    const sign = Number.isNaN(x) ? '' : neg ? '-' : plus ? '+' : space ? ' ' : '';
    if (!Number.isFinite(x)) {
      const t = Number.isNaN(x) ? 'nan' : 'inf';
      return pad(sign, upper ? t.toUpperCase() : t, false);
    }
    const p = hasPrec ? prec : 6;
    let body: string;
    const lc = conv.toLowerCase();
    if (lc === 'f') body = fixedStr(x, p, alt);
    else if (lc === 'e') {
      const [d, e] = sciParts(x, p + 1);
      body = sciStr(d, e, p, alt, upper);
    } else {
      const P = p === 0 ? 1 : p;
      const [d, X] = sciParts(x, P);
      if (P > X && X >= -4) body = fixedStr(x, P - 1 - X, alt);
      else body = sciStr(d, X, P - 1, alt, upper);
      if (!alt) body = stripZeros(body);
    }
    return pad(sign, body, true);
  });
}
