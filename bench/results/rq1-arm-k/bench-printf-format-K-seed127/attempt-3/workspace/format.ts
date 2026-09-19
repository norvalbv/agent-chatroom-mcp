function decompose(v: number): [bigint, number] {
  // v >= 0 finite; returns [m, e] with v = m * 2^e
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, v);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (expBits === 0) return [m, -1074];
  m |= 1n << 52n;
  return [m, expBits - 1075];
}

// round(v * 10^k), half-even, exact
function scaledRound(m: bigint, e: number, k: number): bigint {
  let n = m;
  let d = 1n;
  if (e >= 0) n <<= BigInt(e);
  else d <<= BigInt(-e);
  if (k >= 0) n *= 10n ** BigInt(k);
  else d *= 10n ** BigInt(-k);
  const q = n / d;
  const r2 = (n % d) * 2n;
  if (r2 > d || (r2 === d && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// decimal exponent X of v in e-style with p digits after point, after rounding; and the p+1 digits
function expDigits(v: number, p: number): [number, string] {
  if (v === 0) return [0, '0'.repeat(p + 1)];
  const [m, e] = decompose(v);
  let x = Math.floor(Math.log10(v));
  if (!isFinite(x)) x = -324;
  // fix estimate exactly: want 10^x <= v < 10^(x+1)
  const ge = (xx: number) => {
    // v >= 10^xx ?
    let n = m;
    let d = 1n;
    if (e >= 0) n <<= BigInt(e);
    else d <<= BigInt(-e);
    if (xx >= 0) d *= 10n ** BigInt(xx);
    else n *= 10n ** BigInt(-xx);
    return n >= d;
  };
  while (!ge(x)) x--;
  while (ge(x + 1)) x++;
  let q = scaledRound(m, e, p - x);
  if (q >= 10n ** BigInt(p + 1)) {
    x++;
    q = scaledRound(m, e, p - x);
  }
  return [x, q.toString()];
}

function fixedStr(v: number, p: number, alt: boolean): string {
  const [m, e] = v === 0 ? [0n, 0] : decompose(v);
  let s = scaledRound(m, e, p).toString();
  if (p > 0) {
    s = s.padStart(p + 1, '0');
    s = s.slice(0, s.length - p) + '.' + s.slice(s.length - p);
  } else if (alt) s += '.';
  return s;
}

function expStr(x: number, digits: string, p: number, alt: boolean, upper: boolean): string {
  let s = digits[0];
  if (p > 0) s += '.' + digits.slice(1);
  else if (alt) s += '.';
  const ax = Math.abs(x);
  s += (upper ? 'E' : 'e') + (x < 0 ? '-' : '+') + (ax < 10 ? '0' + ax : String(ax));
  return s;
}

function stripZeros(s: string): string {
  // s has no exponent part
  if (!s.includes('.')) return s;
  s = s.replace(/0+$/, '');
  if (s.endsWith('.')) s = s.slice(0, -1);
  return s;
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let ai = 0;
  return fmt.replace(/%([-+ 0#]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc%])/g, (_all, flags: string, w: string, pr: string | undefined, conv: string) => {
    if (conv === '%') return '%';
    const minus = flags.includes('-');
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
    let zeroOk = zero && !minus;

    if (conv === 's' || conv === 'c') {
      body = String(arg);
      if (conv === 's' && hasPrec) body = body.slice(0, prec);
      zeroOk = false;
    } else if ('dioxX'.includes(conv)) {
      const bi = BigInt(arg as number | bigint);
      const neg = bi < 0n;
      const mag = neg ? -bi : bi;
      if (conv === 'd' || conv === 'i') {
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        body = mag.toString();
      } else if (conv === 'o') body = mag.toString(8);
      else if (conv === 'x') body = mag.toString(16);
      else body = mag.toString(16).toUpperCase();
      if (mag === 0n && hasPrec && prec === 0) body = '';
      if (hasPrec) {
        body = body.padStart(prec, '0');
        zeroOk = false;
      }
      if (conv === 'o' && alt && !body.startsWith('0')) body = '0' + body;
      if ((conv === 'x' || conv === 'X') && alt && mag !== 0n) prefix = conv === 'x' ? '0x' : '0X';
    } else {
      const num = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      const neg = num < 0 || Object.is(num, -0);
      if (Number.isNaN(num)) {
        body = upper ? 'NAN' : 'nan';
        zeroOk = false;
      } else {
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        const v = Math.abs(num);
        if (!isFinite(v)) {
          body = upper ? 'INF' : 'inf';
          zeroOk = false;
        } else {
          const p = hasPrec ? prec : 6;
          const lc = conv.toLowerCase();
          if (lc === 'f') body = fixedStr(v, p, alt);
          else if (lc === 'e') {
            const [x, d] = expDigits(v, p);
            body = expStr(x, d, p, alt, upper);
          } else {
            const P = p === 0 ? 1 : p;
            const [x, d] = expDigits(v, P - 1);
            if (P > x && x >= -4) {
              body = fixedStr(v, P - 1 - x, alt);
              if (!alt) body = stripZeros(body);
            } else {
              let mant = d[0] + (P - 1 > 0 ? '.' + d.slice(1) : alt ? '.' : '');
              if (!alt) mant = stripZeros(mant);
              const ax = Math.abs(x);
              body = mant + (upper ? 'E' : 'e') + (x < 0 ? '-' : '+') + (ax < 10 ? '0' + ax : String(ax));
            }
          }
        }
      }
    }

    const len = sign.length + prefix.length + body.length;
    if (len >= width) return sign + prefix + body;
    const pad = width - len;
    if (minus) return sign + prefix + body + ' '.repeat(pad);
    if (zeroOk) return sign + prefix + '0'.repeat(pad) + body;
    return ' '.repeat(pad) + sign + prefix + body;
  });
}
