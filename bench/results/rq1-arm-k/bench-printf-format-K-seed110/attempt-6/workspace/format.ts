function decompose(v: number): { num: bigint; den: bigint } {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, v);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const ex = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let e: number;
  if (ex === 0) e = -1074;
  else {
    m |= 1n << 52n;
    e = ex - 1075;
  }
  return e >= 0 ? { num: m << BigInt(e), den: 1n } : { num: m, den: 1n << BigInt(-e) };
}

// round-half-even of (num/den) * 10^k
function roundScaled(num: bigint, den: bigint, k: number): bigint {
  if (k >= 0) num *= 10n ** BigInt(k);
  else den *= 10n ** BigInt(-k);
  const q = num / den;
  const r = num - q * den;
  const twice = r * 2n;
  if (twice > den || (twice === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

function fixedDigits(v: number, prec: number): { int: string; frac: string } {
  const { num, den } = decompose(v);
  let s = roundScaled(num, den, prec).toString();
  if (s.length < prec + 1) s = '0'.repeat(prec + 1 - s.length) + s;
  return { int: s.slice(0, s.length - prec), frac: s.slice(s.length - prec) };
}

// v >= 0 finite; returns digits string of length prec+1 and exponent
function expDigits(v: number, prec: number): { digits: string; exp: number } {
  if (v === 0) return { digits: '0'.repeat(prec + 1), exp: 0 };
  const { num, den } = decompose(v);
  const ge = (x: number) => (x >= 0 ? num >= den * 10n ** BigInt(x) : num * 10n ** BigInt(-x) >= den);
  let x = Math.floor(Math.log10(v));
  if (!Number.isFinite(x)) x = -324;
  while (!ge(x)) x--;
  while (ge(x + 1)) x++;
  let n = roundScaled(num, den, prec - x);
  if (n >= 10n ** BigInt(prec + 1)) {
    x++;
    n = roundScaled(num, den, prec - x);
  }
  return { digits: n.toString(), exp: x };
}

function expStr(digits: string, exp: number, prec: number, alt: boolean, upper: boolean): string {
  let s = digits[0];
  if (prec > 0 || alt) s += '.';
  s += digits.slice(1);
  const a = Math.abs(exp);
  s += (upper ? 'E' : 'e') + (exp < 0 ? '-' : '+') + (a < 10 ? '0' + a : String(a));
  return s;
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let out = '';
  let ai = 0;
  const re = /%([-+ 0#]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc%])/y;
  let i = 0;
  while (i < fmt.length) {
    const p = fmt.indexOf('%', i);
    if (p < 0) {
      out += fmt.slice(i);
      break;
    }
    out += fmt.slice(i, p);
    re.lastIndex = p;
    const m = re.exec(fmt);
    if (!m) {
      out += '%';
      i = p + 1;
      continue;
    }
    i = re.lastIndex;
    const conv = m[4];
    if (conv === '%') {
      out += '%';
      continue;
    }
    const flags = m[1];
    const left = flags.includes('-');
    const plus = flags.includes('+');
    const space = flags.includes(' ');
    const zero = flags.includes('0');
    const alt = flags.includes('#');
    const width = m[2] ? parseInt(m[2], 10) : 0;
    const hasPrec = m[3] !== undefined;
    const prec = hasPrec ? (m[3] === '' ? 0 : parseInt(m[3], 10)) : -1;
    const arg = args[ai++];

    let prefix = '';
    let body = '';
    let zeroOk = false;

    if (conv === 's' || conv === 'c') {
      body = String(arg);
      if (conv === 's' && hasPrec) body = body.slice(0, prec);
    } else if ('diouxX'.includes(conv)) {
      let n = BigInt(arg as number | bigint);
      const neg = n < 0n;
      if (neg) n = -n;
      let digits: string;
      if (conv === 'd' || conv === 'i') digits = n.toString();
      else if (conv === 'o') digits = n.toString(8);
      else digits = n.toString(16);
      if (conv === 'X') digits = digits.toUpperCase();
      if (hasPrec) {
        if (prec === 0 && n === 0n) digits = '';
        else if (digits.length < prec) digits = '0'.repeat(prec - digits.length) + digits;
      }
      if (conv === 'd' || conv === 'i') {
        prefix = neg ? '-' : plus ? '+' : space ? ' ' : '';
      } else if (alt) {
        if (conv === 'o') {
          if (!digits.startsWith('0')) digits = '0' + digits;
        } else if (n !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      }
      body = digits;
      zeroOk = !hasPrec;
    } else {
      const v = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      const neg = v < 0 || Object.is(v, -0);
      if (Number.isNaN(v)) {
        body = upper ? 'NAN' : 'nan';
      } else {
        prefix = neg ? '-' : plus ? '+' : space ? ' ' : '';
        const a = Math.abs(v);
        if (a === Infinity) {
          body = upper ? 'INF' : 'inf';
        } else {
          zeroOk = true;
          const lc = conv.toLowerCase();
          if (lc === 'f') {
            const P = hasPrec ? prec : 6;
            const { int, frac } = fixedDigits(a, P);
            body = int + (P > 0 || alt ? '.' : '') + frac;
          } else if (lc === 'e') {
            const P = hasPrec ? prec : 6;
            const { digits, exp } = expDigits(a, P);
            body = expStr(digits, exp, P, alt, upper);
          } else {
            let P = hasPrec ? prec : 6;
            if (P === 0) P = 1;
            const { digits, exp } = expDigits(a, P - 1);
            if (P > exp && exp >= -4) {
              const Q = P - 1 - exp;
              const { int, frac } = fixedDigits(a, Q);
              let f = frac;
              if (!alt) f = f.replace(/0+$/, '');
              body = int + (f.length > 0 || alt ? '.' : '') + f;
            } else {
              let d = digits.slice(1);
              if (!alt) d = d.replace(/0+$/, '');
              const a2 = Math.abs(exp);
              body =
                digits[0] +
                (d.length > 0 || alt ? '.' : '') +
                d +
                (upper ? 'E' : 'e') +
                (exp < 0 ? '-' : '+') +
                (a2 < 10 ? '0' + a2 : String(a2));
            }
          }
        }
      }
    }

    const len = prefix.length + body.length;
    if (len < width) {
      const pad = width - len;
      if (left) body = prefix + body + ' '.repeat(pad);
      else if (zero && zeroOk && conv !== 's' && conv !== 'c') body = prefix + '0'.repeat(pad) + body;
      else body = ' '.repeat(pad) + prefix + body;
    } else body = prefix + body;
    out += body;
  }
  return out;
}
