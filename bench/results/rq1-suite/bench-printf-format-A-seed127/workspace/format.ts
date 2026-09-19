function ratio(v: number): [bigint, bigint] {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, Math.abs(v));
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const bexp = (hi >>> 20) & 0x7ff;
  let mant = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let e: number;
  if (bexp === 0) e = -1074;
  else {
    mant |= 1n << 52n;
    e = bexp - 1075;
  }
  return e >= 0 ? [mant << BigInt(e), 1n] : [mant, 1n << BigInt(-e)];
}

// round-half-even of |v| * 10^s
function scaled(v: number, s: number): bigint {
  let [n, d] = ratio(v);
  if (s >= 0) n *= 10n ** BigInt(s);
  else d *= 10n ** BigInt(-s);
  let q = n / d;
  const r2 = (n % d) * 2n;
  if (r2 > d || (r2 === d && (q & 1n) === 1n)) q += 1n;
  return q;
}

function eDigits(v: number, p: number): [string, number] {
  if (v === 0) return ['0'.repeat(p + 1), 0];
  let e = Math.floor(Math.log10(Math.abs(v)));
  if (!isFinite(e)) e = -324;
  const lo = 10n ** BigInt(p);
  const hi = lo * 10n;
  for (let i = 0; i < 20; i++) {
    const q = scaled(v, p - e);
    if (q >= hi) e++;
    else if (q < lo) e--;
    else return [q.toString(), e];
  }
  throw new Error('exp');
}

function fStr(v: number, p: number, alt: boolean): string {
  let s = scaled(v, p).toString();
  if (p === 0) return s + (alt ? '.' : '');
  s = s.padStart(p + 1, '0');
  return s.slice(0, -p) + '.' + s.slice(-p);
}

function eStr(digits: string, e: number, p: number, alt: boolean, upper: boolean): string {
  const m = digits[0] + (p > 0 || alt ? '.' + digits.slice(1) : '');
  const ae = Math.abs(e);
  return m + (upper ? 'E' : 'e') + (e < 0 ? '-' : '+') + (ae < 10 ? '0' : '') + ae;
}

function stripZeros(s: string): string {
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let ai = 0;
  const re = /%([-+ 0#]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc%])/g;
  return fmt.replace(re, (_m, flags: string, w: string, prec: string | undefined, conv: string) => {
    if (conv === '%') return '%';
    const arg = args[ai++];
    const left = flags.includes('-');
    const plus = flags.includes('+');
    const space = flags.includes(' ');
    const zero = flags.includes('0') && !left;
    const alt = flags.includes('#');
    const width = w ? parseInt(w, 10) : 0;
    const hasPrec = prec !== undefined;
    const P = hasPrec ? (prec === '' ? 0 : parseInt(prec, 10)) : -1;

    let prefix = '';
    let body = '';
    let zeroOk = zero;

    if (conv === 's' || conv === 'c') {
      body = String(arg);
      if (conv === 's' && hasPrec) body = body.slice(0, P);
      zeroOk = false;
    } else if ('diouxX'.includes(conv)) {
      const big = BigInt(arg as number | bigint);
      const neg = big < 0n;
      const mag = neg ? -big : big;
      if (conv === 'd' || conv === 'i') {
        prefix = neg ? '-' : plus ? '+' : space ? ' ' : '';
      }
      let digits = conv === 'x' ? mag.toString(16) : conv === 'X' ? mag.toString(16).toUpperCase() : conv === 'o' ? mag.toString(8) : mag.toString();
      if (hasPrec) {
        if (P === 0 && mag === 0n) digits = '';
        digits = digits.padStart(P, '0');
        zeroOk = false;
      }
      if (alt) {
        if ((conv === 'x' || conv === 'X') && mag !== 0n) prefix = conv === 'x' ? '0x' : '0X';
        if (conv === 'o' && !digits.startsWith('0')) digits = '0' + digits;
      }
      body = digits;
    } else {
      const v = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      const neg = v < 0 || Object.is(v, -0);
      if (Number.isNaN(v)) {
        body = upper ? 'NAN' : 'nan';
        zeroOk = false;
      } else {
        prefix = neg ? '-' : plus ? '+' : space ? ' ' : '';
        if (!isFinite(v)) {
          body = upper ? 'INF' : 'inf';
          zeroOk = false;
        } else {
          const p = hasPrec ? P : 6;
          const lc = conv.toLowerCase();
          if (lc === 'f') body = fStr(v, p, alt);
          else if (lc === 'e') {
            const [d, e] = eDigits(v, p);
            body = eStr(d, e, p, alt, upper);
          } else {
            const PP = p === 0 ? 1 : p;
            const [d, X] = eDigits(v, PP - 1);
            if (PP > X && X >= -4) {
              body = fStr(v, PP - 1 - X, alt);
              if (!alt) body = stripZeros(body);
            } else {
              let m = d[0] + (PP > 1 || alt ? '.' + d.slice(1) : '');
              if (!alt) m = stripZeros(m);
              const ae = Math.abs(X);
              body = m + (upper ? 'E' : 'e') + (X < 0 ? '-' : '+') + (ae < 10 ? '0' : '') + ae;
            }
          }
        }
      }
    }

    const len = prefix.length + body.length;
    if (len >= width) return prefix + body;
    const pad = width - len;
    if (left) return prefix + body + ' '.repeat(pad);
    if (zeroOk) return prefix + '0'.repeat(pad) + body;
    return ' '.repeat(pad) + prefix + body;
  });
}
