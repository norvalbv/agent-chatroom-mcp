function decompose(v: number): [bigint, number] {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, v);
  const bits = dv.getBigUint64(0);
  const ex = Number((bits >> 52n) & 0x7ffn);
  const frac = bits & ((1n << 52n) - 1n);
  if (ex === 0) return [frac, -1074];
  return [frac | (1n << 52n), ex - 1075];
}

// round-half-even(v * 10^k) for finite v >= 0, exact
function scaledRound(v: number, k: number): bigint {
  const [m, e2] = decompose(v);
  let num = m;
  let den = 1n;
  if (e2 > 0) num <<= BigInt(e2);
  else den <<= BigInt(-e2);
  if (k > 0) num *= 10n ** BigInt(k);
  else if (k < 0) den *= 10n ** BigInt(-k);
  const q = num / den;
  const r = num % den;
  const twice = r * 2n;
  if (twice > den || (twice === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// digits (p+1 of them) and decimal exponent in e style
function eDigits(v: number, p: number): [string, number] {
  if (v === 0) return ['0'.repeat(p + 1), 0];
  let X = Math.floor(Math.log10(v));
  for (;;) {
    const n = scaledRound(v, p - X);
    const s = n.toString();
    if (s.length > p + 1) X++;
    else if (s.length < p + 1) X--;
    else return [s, X];
  }
}

function fixed(v: number, p: number, alt: boolean): string {
  let s = scaledRound(v, p).toString();
  if (p === 0) return alt ? s + '.' : s;
  s = s.padStart(p + 1, '0');
  return s.slice(0, -p) + '.' + s.slice(-p);
}

function expo(v: number, p: number, alt: boolean, upper: boolean): string {
  const [d, X] = eDigits(v, p);
  let m = d[0];
  if (p > 0) m += '.' + d.slice(1);
  else if (alt) m += '.';
  const ax = Math.abs(X);
  return m + (upper ? 'E' : 'e') + (X < 0 ? '-' : '+') + (ax < 10 ? '0' : '') + ax;
}

function strip(s: string): string {
  if (!s.includes('.')) return s;
  return s.replace(/0+$/, '').replace(/\.$/, '');
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  const re = /%(?:(%)|([-+ 0#]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc]))/g;
  let ai = 0;
  return fmt.replace(re, (_m, pct, flags, w, prec, conv) => {
    if (pct) return '%';
    const arg = args[ai++];
    const left = flags.includes('-');
    const plus = flags.includes('+');
    const space = flags.includes(' ');
    const zero = flags.includes('0');
    const alt = flags.includes('#');
    const width = w === '' ? 0 : parseInt(w, 10);
    const hasPrec = prec !== undefined;
    const precN = hasPrec ? (prec === '' ? 0 : parseInt(prec, 10)) : -1;

    const pad = (sign: string, body: string, zeroOk: boolean): string => {
      const len = sign.length + body.length;
      if (len >= width) return sign + body;
      const fill = width - len;
      if (left) return sign + body + ' '.repeat(fill);
      if (zero && zeroOk) {
        // body may begin with 0x prefix handled by caller via sign
        return sign + '0'.repeat(fill) + body;
      }
      return ' '.repeat(fill) + sign + body;
    };

    if (conv === 's' || conv === 'c') {
      let s = String(arg);
      if (conv === 's' && hasPrec) s = s.slice(0, precN);
      return pad('', s, false);
    }

    if ('dioxX'.includes(conv)) {
      let n = typeof arg === 'bigint' ? arg : BigInt(arg as number);
      let sign = '';
      if (conv === 'd' || conv === 'i') {
        if (n < 0n) {
          sign = '-';
          n = -n;
        } else sign = plus ? '+' : space ? ' ' : '';
      }
      let digits =
        conv === 'o' ? n.toString(8) : conv === 'd' || conv === 'i' ? n.toString() : n.toString(16);
      if (conv === 'X') digits = digits.toUpperCase();
      if (hasPrec) {
        if (precN === 0 && n === 0n) digits = '';
        digits = digits.padStart(precN, '0');
      }
      if (alt) {
        if (conv === 'o') {
          if (digits[0] !== '0') digits = '0' + digits;
        } else if ((conv === 'x' || conv === 'X') && n !== 0n) {
          sign += conv === 'x' ? '0x' : '0X';
        }
      }
      return pad(sign, digits, !hasPrec);
    }

    // floating
    const v = arg as number;
    const upper = conv === 'E' || conv === 'F' || conv === 'G';
    const neg = v < 0 || Object.is(v, -0);
    let sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
    if (Number.isNaN(v)) {
      return pad('', upper ? 'NAN' : 'nan', false);
    }
    if (!Number.isFinite(v)) {
      return pad(sign, upper ? 'INF' : 'inf', false);
    }
    const a = Math.abs(v);
    const lc = conv.toLowerCase();
    let p = hasPrec ? precN : 6;
    let body: string;
    if (lc === 'f') body = fixed(a, p, alt);
    else if (lc === 'e') body = expo(a, p, alt, upper);
    else {
      const P = p === 0 ? 1 : p;
      const [, X] = eDigits(a, P - 1);
      if (P > X && X >= -4) {
        body = fixed(a, P - 1 - X, alt);
        if (!alt) body = strip(body);
      } else {
        body = expo(a, P - 1, alt, upper);
        if (!alt) {
          const idx = body.search(/[eE]/);
          body = strip(body.slice(0, idx)) + body.slice(idx);
        }
      }
    }
    return pad(sign, body, true);
  });
}
