// value = N / 10^k exactly, for finite x >= 0
function exact(x: number): { N: bigint; k: number } {
  if (x === 0) return { N: 0n, k: 0 };
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, x);
  const hi = buf.getUint32(0);
  const lo = buf.getUint32(4);
  const be = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let e: number;
  if (be === 0) e = -1074;
  else {
    m |= 1n << 52n;
    e = be - 1075;
  }
  if (e >= 0) return { N: m << BigInt(e), k: 0 };
  return { N: m * 5n ** BigInt(-e), k: -e };
}

// round N / 10^d (d > 0) half-even
function divRound(N: bigint, d: number): bigint {
  const p = 10n ** BigInt(d);
  const q = N / p;
  const r = N % p;
  const twice = r * 2n;
  if (twice > p || (twice === p && (q & 1n) === 1n)) return q + 1n;
  return q;
}

function fixedDigits(x: number, p: number, alt: boolean): string {
  const { N, k } = exact(x);
  const R = p >= k ? N * 10n ** BigInt(p - k) : divRound(N, k - p);
  let s = R.toString();
  if (s.length < p + 1) s = '0'.repeat(p + 1 - s.length) + s;
  if (p === 0) return alt ? s + '.' : s;
  return s.slice(0, s.length - p) + '.' + s.slice(s.length - p);
}

// returns significant digits (p+1 of them) and decimal exponent
function expParts(x: number, p: number): { digits: string; exp: number } {
  const { N, k } = exact(x);
  if (N === 0n) return { digits: '0'.repeat(p + 1), exp: 0 };
  const D = N.toString().length;
  let exp = D - 1 - k;
  let R: bigint;
  if (D > p + 1) {
    R = divRound(N, D - p - 1);
    if (R.toString().length > p + 1) {
      R /= 10n;
      exp++;
    }
  } else R = N * 10n ** BigInt(p + 1 - D);
  return { digits: R.toString(), exp };
}

function expStr(digits: string, exp: number, upper: boolean, alt: boolean, strip: boolean): string {
  let frac = digits.slice(1);
  if (strip) frac = frac.replace(/0+$/, '');
  let m = digits[0] + (frac.length > 0 || alt ? '.' + frac : '');
  const a = Math.abs(exp);
  const es = (exp < 0 ? '-' : '+') + (a < 10 ? '0' + a : String(a));
  return m + (upper ? 'E' : 'e') + es;
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let ai = 0;
  const re = /%([-+ 0#]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc%])/g;
  return fmt.replace(re, (_m, flags: string, w: string, pr: string | undefined, conv: string) => {
    if (conv === '%') return '%';
    const arg = args[ai++];
    const left = flags.includes('-');
    const plus = flags.includes('+');
    const space = flags.includes(' ');
    const zero = flags.includes('0') && !left;
    const alt = flags.includes('#');
    const width = w === '' ? 0 : parseInt(w, 10);
    const hasPrec = pr !== undefined;
    const prec = hasPrec ? (pr === '' ? 0 : parseInt(pr, 10)) : -1;

    let sign = '';
    let prefix = '';
    let body: string;
    let canZero = true;

    if (conv === 's' || conv === 'c') {
      let s = String(arg);
      if (conv === 's' && hasPrec) s = s.slice(0, prec);
      body = s;
      canZero = false;
    } else if ('dioxX'.includes(conv)) {
      let v = BigInt(arg as number | bigint);
      if (conv === 'd' || conv === 'i') {
        if (v < 0n) {
          sign = '-';
          v = -v;
        } else sign = plus ? '+' : space ? ' ' : '';
      }
      let digits = conv === 'o' ? v.toString(8) : conv === 'x' ? v.toString(16) : conv === 'X' ? v.toString(16).toUpperCase() : v.toString();
      if (hasPrec) {
        if (v === 0n && prec === 0) digits = '';
        if (digits.length < prec) digits = '0'.repeat(prec - digits.length) + digits;
        canZero = false;
      }
      if (alt) {
        if (conv === 'o') {
          if (digits[0] !== '0') digits = '0' + digits;
        } else if ((conv === 'x' || conv === 'X') && v !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      }
      body = digits;
    } else {
      const x = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      if (Number.isNaN(x)) {
        body = upper ? 'NAN' : 'nan';
        canZero = false;
      } else {
        if (x < 0 || Object.is(x, -0)) sign = '-';
        else sign = plus ? '+' : space ? ' ' : '';
        const a = Math.abs(x);
        if (a === Infinity) {
          body = upper ? 'INF' : 'inf';
          canZero = false;
        } else {
          const lc = conv.toLowerCase();
          if (lc === 'f') {
            body = fixedDigits(a, hasPrec ? prec : 6, alt);
          } else if (lc === 'e') {
            const p = hasPrec ? prec : 6;
            const { digits, exp } = expParts(a, p);
            body = expStr(digits, exp, upper, alt, false);
          } else {
            const P = hasPrec ? (prec === 0 ? 1 : prec) : 6;
            const { digits, exp } = expParts(a, P - 1);
            if (P > exp && exp >= -4) {
              let s = fixedDigits(a, P - 1 - exp, alt);
              if (!alt && s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
              body = s;
            } else {
              body = expStr(digits, exp, upper, alt, !alt);
            }
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
