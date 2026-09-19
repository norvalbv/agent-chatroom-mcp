function ratio(v: number): [bigint, bigint] {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, v);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const be = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let e: number;
  if (be === 0) e = -1074;
  else {
    m |= 1n << 52n;
    e = be - 1075;
  }
  return e >= 0 ? [m << BigInt(e), 1n] : [m, 1n << BigInt(-e)];
}

// round(|v| * 10^k), half-even, exact
function roundScaled(v: number, k: number): bigint {
  let [n, d] = ratio(Math.abs(v));
  if (k >= 0) n *= 10n ** BigInt(k);
  else d *= 10n ** BigInt(-k);
  let q = n / d;
  const r2 = (n % d) * 2n;
  if (r2 > d || (r2 === d && (q & 1n) === 1n)) q += 1n;
  return q;
}

function fixedBody(v: number, p: number, alt: boolean): string {
  let s = roundScaled(v, p).toString();
  if (p > 0) {
    s = s.padStart(p + 1, '0');
    return s.slice(0, s.length - p) + '.' + s.slice(s.length - p);
  }
  return alt ? s + '.' : s;
}

// returns digits (p+1 of them) and exponent
function expParts(v: number, p: number): [string, number] {
  if (v === 0) return ['0'.repeat(p + 1), 0];
  let x = Math.floor(Math.log10(Math.abs(v)));
  if (!isFinite(x)) x = -324;
  for (let i = 0; i < 10; i++) {
    const n = roundScaled(v, p - x);
    const s = n.toString();
    if (s.length > p + 1) x++;
    else if (s.length < p + 1) x--;
    else return [s, x];
  }
  throw new Error('unreachable');
}

function expStr(digits: string, x: number, upper: boolean, alt: boolean): string {
  const p = digits.length - 1;
  let s = digits[0] + (p > 0 ? '.' + digits.slice(1) : alt ? '.' : '');
  const ax = Math.abs(x);
  s += (upper ? 'E' : 'e') + (x < 0 ? '-' : '+') + (ax < 10 ? '0' : '') + ax;
  return s;
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let ai = 0;
  return fmt.replace(
    /%(?:(%)|([-+ 0#]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc]))/g,
    (_m, pct, flags: string, w: string, pr: string | undefined, conv: string) => {
      if (pct) return '%';
      const left = flags.includes('-');
      const plus = flags.includes('+');
      const space = flags.includes(' ');
      const zero = flags.includes('0') && !left;
      const alt = flags.includes('#');
      const width = w ? parseInt(w, 10) : 0;
      const hasPrec = pr !== undefined;
      const prec = hasPrec ? (pr === '' ? 0 : parseInt(pr, 10)) : -1;
      const arg = args[ai++];
      let sign = '';
      let prefix = '';
      let body = '';
      let canZero = true;
      const pad = () => {
        const len = sign.length + prefix.length + body.length;
        if (len >= width) return sign + prefix + body;
        const n = width - len;
        if (left) return sign + prefix + body + ' '.repeat(n);
        if (zero && canZero) return sign + prefix + '0'.repeat(n) + body;
        return ' '.repeat(n) + sign + prefix + body;
      };
      const posSign = plus ? '+' : space ? ' ' : '';
      switch (conv) {
        case 's':
          canZero = false;
          body = String(arg);
          if (hasPrec) body = body.slice(0, prec);
          return pad();
        case 'c':
          canZero = false;
          body = String(arg);
          return pad();
        case 'd':
        case 'i': {
          const b = BigInt(arg as number | bigint);
          sign = b < 0n ? '-' : posSign;
          body = (b < 0n ? -b : b).toString();
          if (hasPrec) {
            if (prec === 0 && b === 0n) body = '';
            body = body.padStart(prec, '0');
            canZero = false;
          }
          return pad();
        }
        case 'x':
        case 'X':
        case 'o': {
          const b = BigInt(arg as number | bigint);
          body = b.toString(conv === 'o' ? 8 : 16);
          if (conv === 'X') body = body.toUpperCase();
          if (hasPrec) {
            if (prec === 0 && b === 0n) body = '';
            body = body.padStart(prec, '0');
            canZero = false;
          }
          if (alt) {
            if (conv === 'o') {
              if (body[0] !== '0') body = '0' + body;
            } else if (b !== 0n) prefix = conv === 'x' ? '0x' : '0X';
          }
          return pad();
        }
        default: {
          const v = arg as number;
          const upper = conv === 'E' || conv === 'F' || conv === 'G';
          if (Number.isNaN(v)) {
            body = upper ? 'NAN' : 'nan';
            canZero = false;
            return pad();
          }
          const neg = v < 0 || Object.is(v, -0);
          sign = neg ? '-' : posSign;
          if (!isFinite(v)) {
            body = upper ? 'INF' : 'inf';
            canZero = false;
            return pad();
          }
          const lc = conv.toLowerCase();
          if (lc === 'f') {
            body = fixedBody(v, hasPrec ? prec : 6, alt);
          } else if (lc === 'e') {
            const p = hasPrec ? prec : 6;
            const [d, x] = expParts(v, p);
            body = expStr(d, x, upper, alt);
          } else {
            let P = hasPrec ? prec : 6;
            if (P === 0) P = 1;
            const [d, x] = expParts(v, P - 1);
            if (P > x && x >= -4) {
              body = fixedBody(v, P - 1 - x, alt);
              if (!alt && body.includes('.')) body = body.replace(/\.?0+$/, '');
            } else {
              let dd = d;
              if (!alt) dd = d[0] + d.slice(1).replace(/0+$/, '');
              body = expStr(dd, x, upper, alt);
            }
          }
          return pad();
        }
      }
    },
  );
}
