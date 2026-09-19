function ratio(v: number): [bigint, bigint] {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, Math.abs(v));
  const bits = dv.getBigUint64(0);
  const ex = Number((bits >> 52n) & 0x7ffn);
  const frac = bits & 0xfffffffffffffn;
  let m: bigint;
  let e: number;
  if (ex === 0) {
    m = frac;
    e = -1074;
  } else {
    m = frac | (1n << 52n);
    e = ex - 1075;
  }
  return e >= 0 ? [m << BigInt(e), 1n] : [m, 1n << BigInt(-e)];
}

function roundDiv(a: bigint, b: bigint): bigint {
  const q = a / b;
  const r2 = (a % b) * 2n;
  if (r2 > b || (r2 === b && (q & 1n) === 1n)) return q + 1n;
  return q;
}

const pow10 = (k: number): bigint => 10n ** BigInt(k);

function fixed(n: bigint, d: bigint, p: number, alt: boolean): string {
  let s = roundDiv(n * pow10(p), d).toString();
  if (s.length < p + 1) s = '0'.repeat(p + 1 - s.length) + s;
  const ip = s.slice(0, s.length - p);
  const fp = s.slice(s.length - p);
  return p > 0 ? ip + '.' + fp : alt ? ip + '.' : ip;
}

// returns digits (p+1 of them) and decimal exponent
function expo(n: bigint, d: bigint, p: number): [string, number] {
  if (n === 0n) return ['0'.repeat(p + 1), 0];
  let e: number;
  if (n >= d) e = (n / d).toString().length - 1;
  else {
    e = -1;
    while (n * pow10(-e) < d) e--;
  }
  const scale = (ee: number): bigint => {
    const sh = p - ee;
    return sh >= 0 ? roundDiv(n * pow10(sh), d) : roundDiv(n, d * pow10(-sh));
  };
  let s = scale(e);
  if (s >= pow10(p + 1)) {
    e++;
    s = scale(e);
  }
  return [s.toString(), e];
}

function expStr(digits: string, e: number, p: number, alt: boolean, upper: boolean): string {
  let m = digits[0];
  if (p > 0) m += '.' + digits.slice(1);
  else if (alt) m += '.';
  const a = Math.abs(e);
  return m + (upper ? 'E' : 'e') + (e < 0 ? '-' : '+') + (a < 10 ? '0' + a : String(a));
}

function stripZeros(s: string): string {
  if (!s.includes('.')) return s;
  return s.replace(/0+$/, '').replace(/\.$/, '');
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let ai = 0;
  const re = /%(?:(%)|([-+ 0#]*)(\d*)(\.\d*)?([diouxXeEfFgGsc]))/g;
  return fmt.replace(re, (_m, pct, flags: string, w: string, pr: string | undefined, conv: string) => {
    if (pct) return '%';
    const arg = args[ai++];
    const left = flags.includes('-');
    const plus = flags.includes('+');
    const space = flags.includes(' ');
    const zero = flags.includes('0') && !left;
    const alt = flags.includes('#');
    const width = w ? parseInt(w, 10) : 0;
    const hasPrec = pr !== undefined;
    const prec = hasPrec ? (pr.length > 1 ? parseInt(pr.slice(1), 10) : 0) : -1;

    let sign = '';
    let body: string;
    let zeroOk = zero;

    if (conv === 's' || conv === 'c') {
      body = String(arg);
      if (conv === 's' && hasPrec) body = body.slice(0, prec);
      zeroOk = false;
    } else if ('dioxX'.includes(conv)) {
      let v = typeof arg === 'bigint' ? arg : BigInt(arg as number);
      if (conv === 'd' || conv === 'i') {
        if (v < 0n) {
          sign = '-';
          v = -v;
        } else sign = plus ? '+' : space ? ' ' : '';
      }
      const radix = conv === 'o' ? 8 : conv === 'd' || conv === 'i' ? 10 : 16;
      let digits = v.toString(radix);
      if (conv === 'X') digits = digits.toUpperCase();
      if (hasPrec) {
        if (prec === 0 && v === 0n) digits = '';
        if (digits.length < prec) digits = '0'.repeat(prec - digits.length) + digits;
        zeroOk = false;
      }
      if (alt) {
        if (conv === 'o') {
          if (digits[0] !== '0') digits = '0' + digits;
        } else if ((conv === 'x' || conv === 'X') && v !== 0n) {
          sign = conv === 'x' ? '0x' : '0X';
        }
      }
      body = digits;
    } else {
      const v = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      if (Number.isNaN(v)) {
        body = upper ? 'NAN' : 'nan';
        zeroOk = false;
      } else {
        sign = v < 0 || Object.is(v, -0) ? '-' : plus ? '+' : space ? ' ' : '';
        if (!Number.isFinite(v)) {
          body = upper ? 'INF' : 'inf';
          zeroOk = false;
        } else {
          const [n, d] = ratio(v);
          const lc = conv.toLowerCase();
          if (lc === 'f') {
            body = fixed(n, d, hasPrec ? prec : 6, alt);
          } else if (lc === 'e') {
            const p = hasPrec ? prec : 6;
            const [dg, e] = expo(n, d, p);
            body = expStr(dg, e, p, alt, upper);
          } else {
            const P = hasPrec ? Math.max(prec, 1) : 6;
            const [dg, X] = expo(n, d, P - 1);
            if (P > X && X >= -4) {
              body = fixed(n, d, P - 1 - X, alt);
              if (!alt) body = stripZeros(body);
            } else {
              let m = dg[0];
              if (P > 1) m += '.' + dg.slice(1);
              else if (alt) m += '.';
              if (!alt) m = stripZeros(m);
              const a = Math.abs(X);
              body = m + (upper ? 'E' : 'e') + (X < 0 ? '-' : '+') + (a < 10 ? '0' + a : String(a));
            }
          }
        }
      }
    }

    const len = sign.length + body.length;
    if (len >= width) return sign + body;
    const pad = width - len;
    if (left) return sign + body + ' '.repeat(pad);
    if (zeroOk) return sign + '0'.repeat(pad) + body;
    return ' '.repeat(pad) + sign + body;
  });
}
