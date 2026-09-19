function decompose(x: number): { m: bigint; e2: number } {
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, Math.abs(x));
  const hi = buf.getUint32(0);
  const lo = buf.getUint32(4);
  const be = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (be === 0) return { m, e2: -1074 };
  m |= 1n << 52n;
  return { m, e2: be - 1075 };
}

// round_half_even(|x| * 10^k)
function scaled(x: number, k: number): bigint {
  const { m, e2 } = decompose(x);
  let num = m;
  let den = 1n;
  if (e2 >= 0) num <<= BigInt(e2);
  else den <<= BigInt(-e2);
  if (k >= 0) num *= 10n ** BigInt(k);
  else den *= 10n ** BigInt(-k);
  let q = num / den;
  const r2 = (num % den) * 2n;
  if (r2 > den || (r2 === den && (q & 1n) === 1n)) q += 1n;
  return q;
}

function fixed(x: number, prec: number, alt: boolean): string {
  let s = scaled(x, prec).toString();
  if (prec > 0) {
    s = s.padStart(prec + 1, '0');
    return s.slice(0, s.length - prec) + '.' + s.slice(s.length - prec);
  }
  return alt ? s + '.' : s;
}

function expDigits(x: number, prec: number): { digits: string; X: number } {
  if (x === 0) return { digits: '0'.repeat(prec + 1), X: 0 };
  let X = Math.floor(Math.log10(Math.abs(x)));
  if (!isFinite(X)) X = -324;
  for (;;) {
    const d = scaled(x, prec - X);
    const s = d.toString();
    if (s.length > prec + 1) X++;
    else if (s.length < prec + 1) X--;
    else return { digits: s, X };
  }
}

function expStyle(digits: string, X: number, prec: number, alt: boolean, upper: boolean): string {
  let s = digits[0];
  if (prec > 0) s += '.' + digits.slice(1);
  else if (alt) s += '.';
  const a = Math.abs(X);
  return s + (upper ? 'E' : 'e') + (X < 0 ? '-' : '+') + (a < 10 ? '0' + a : String(a));
}

function stripZeros(s: string): string {
  if (!s.includes('.')) return s;
  return s.replace(/0+$/, '').replace(/\.$/, '');
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let out = '';
  let ai = 0;
  const re = /%(?:(%)|([-+ 0#]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc]))/y;
  let i = 0;
  while (i < fmt.length) {
    const p = fmt.indexOf('%', i);
    if (p < 0) {
      out += fmt.slice(i);
      break;
    }
    out += fmt.slice(i, p);
    re.lastIndex = p;
    const mt = re.exec(fmt);
    if (!mt) {
      out += '%';
      i = p + 1;
      continue;
    }
    i = re.lastIndex;
    if (mt[1]) {
      out += '%';
      continue;
    }
    const flags = mt[2];
    const left = flags.includes('-');
    const plus = flags.includes('+');
    const space = flags.includes(' ');
    let zero = flags.includes('0') && !left;
    const alt = flags.includes('#');
    const width = mt[3] ? parseInt(mt[3], 10) : 0;
    const hasPrec = mt[4] !== undefined;
    const prec = hasPrec ? (mt[4] === '' ? 0 : parseInt(mt[4], 10)) : -1;
    const conv = mt[5];
    const arg = args[ai++];
    let sign = '';
    let prefix = '';
    let body = '';
    const signFor = (neg: boolean) => (neg ? '-' : plus ? '+' : space ? ' ' : '');

    if (conv === 's' || conv === 'c') {
      zero = false;
      body = String(arg);
      if (conv === 's' && hasPrec) body = body.slice(0, prec);
    } else if ('dioxX'.includes(conv)) {
      const v = BigInt(arg as number | bigint);
      if (conv === 'd' || conv === 'i') sign = signFor(v < 0n);
      const mag = v < 0n ? -v : v;
      let digits = mag.toString(conv === 'o' ? 8 : conv === 'd' || conv === 'i' ? 10 : 16);
      if (conv === 'X') digits = digits.toUpperCase();
      if (hasPrec) {
        zero = false;
        if (prec === 0 && mag === 0n) digits = '';
        digits = digits.padStart(prec, '0');
      }
      if (alt) {
        if (conv === 'o') {
          if (digits[0] !== '0') digits = '0' + digits;
        } else if ((conv === 'x' || conv === 'X') && mag !== 0n) {
          prefix = conv === 'x' ? '0x' : '0X';
        }
      }
      body = digits;
    } else {
      const x = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      if (Number.isNaN(x)) {
        body = upper ? 'NAN' : 'nan';
        zero = false;
      } else {
        const neg = x < 0 || Object.is(x, -0);
        sign = signFor(neg);
        if (!isFinite(x)) {
          body = upper ? 'INF' : 'inf';
          zero = false;
        } else {
          const lc = conv.toLowerCase();
          if (lc === 'f') {
            body = fixed(x, hasPrec ? prec : 6, alt);
          } else if (lc === 'e') {
            const pr = hasPrec ? prec : 6;
            const { digits, X } = expDigits(x, pr);
            body = expStyle(digits, X, pr, alt, upper);
          } else {
            let P = hasPrec ? prec : 6;
            if (P === 0) P = 1;
            const { digits, X } = expDigits(x, P - 1);
            if (P > X && X >= -4) {
              body = fixed(x, P - 1 - X, alt);
              if (!alt) body = stripZeros(body);
            } else {
              let m = digits[0];
              if (P > 1) m += '.' + digits.slice(1);
              else if (alt) m += '.';
              if (!alt) m = stripZeros(m);
              const a = Math.abs(X);
              body = m + (upper ? 'E' : 'e') + (X < 0 ? '-' : '+') + (a < 10 ? '0' + a : String(a));
            }
          }
        }
      }
    }
    const len = sign.length + prefix.length + body.length;
    if (len < width) {
      const pad = width - len;
      if (left) body = sign + prefix + body + ' '.repeat(pad);
      else if (zero) body = sign + prefix + '0'.repeat(pad) + body;
      else body = ' '.repeat(pad) + sign + prefix + body;
    } else body = sign + prefix + body;
    out += body;
  }
  return out;
}
