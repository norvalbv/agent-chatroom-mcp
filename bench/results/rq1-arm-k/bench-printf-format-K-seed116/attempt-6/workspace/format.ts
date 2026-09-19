function decompose(v: number): { m: bigint; e: number } {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, Math.abs(v));
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const expField = (hi >>> 20) & 0x7ff;
  const frac = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (expField === 0) return { m: frac, e: -1074 };
  return { m: frac | (1n << 52n), e: expField - 1075 };
}

// round_half_even(m * 2^e * 10^s)
function roundScaled(m: bigint, e: number, s: number): bigint {
  let num = m;
  let den = 1n;
  if (e >= 0) num <<= BigInt(e);
  else den <<= BigInt(-e);
  if (s >= 0) num *= 10n ** BigInt(s);
  else den *= 10n ** BigInt(-s);
  const q = num / den;
  const r = num % den;
  const twice = r * 2n;
  if (twice > den || (twice === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

function fixedDigits(v: number, p: number): string {
  const { m, e } = decompose(v);
  let s = roundScaled(m, e, p).toString();
  if (s.length < p + 1) s = '0'.repeat(p + 1 - s.length) + s;
  return p === 0 ? s : s.slice(0, s.length - p) + '.' + s.slice(s.length - p);
}

function expParts(v: number, p: number): { digits: string; x: number } {
  if (v === 0) return { digits: '0'.repeat(p + 1), x: 0 };
  const { m, e } = decompose(v);
  let x = Math.floor(Math.log10(Math.abs(v)));
  if (!isFinite(x)) x = -324;
  const lo = 10n ** BigInt(p);
  const hi = lo * 10n;
  for (;;) {
    const n = roundScaled(m, e, p - x);
    if (n >= hi) x++;
    else if (n < lo) x--;
    else return { digits: n.toString(), x };
  }
}

function expString(v: number, p: number, alt: boolean, upper: boolean): string {
  const { digits, x } = expParts(v, p);
  let s = digits[0];
  if (p > 0) s += '.' + digits.slice(1);
  else if (alt) s += '.';
  const ax = Math.abs(x);
  s += (upper ? 'E' : 'e') + (x < 0 ? '-' : '+') + (ax < 10 ? '0' : '') + ax;
  return s;
}

function stripZeros(s: string): string {
  if (!s.includes('.')) return s;
  s = s.replace(/0+$/, '');
  return s.endsWith('.') ? s.slice(0, -1) : s;
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let out = '';
  let ai = 0;
  const re = /%(?:(%)|([-+ 0#]*)(\d*)(?:\.(\d*))?([diuxXoeEfFgGsc]))/y;
  let i = 0;
  while (i < fmt.length) {
    const pct = fmt.indexOf('%', i);
    if (pct < 0) {
      out += fmt.slice(i);
      break;
    }
    out += fmt.slice(i, pct);
    re.lastIndex = pct;
    const mt = re.exec(fmt);
    if (!mt) {
      out += '%';
      i = pct + 1;
      continue;
    }
    i = re.lastIndex;
    if (mt[1]) {
      out += '%';
      continue;
    }
    const flags = mt[2];
    const minus = flags.includes('-');
    const plus = flags.includes('+');
    const space = flags.includes(' ');
    const zero = flags.includes('0');
    const alt = flags.includes('#');
    const width = mt[3] ? parseInt(mt[3], 10) : 0;
    const hasPrec = mt[4] !== undefined;
    const prec = hasPrec ? (mt[4] === '' ? 0 : parseInt(mt[4], 10)) : -1;
    const conv = mt[5];
    const arg = args[ai++];

    let sign = '';
    let body = '';
    let zeroOk = zero && !minus;
    const signFor = (neg: boolean) => (neg ? '-' : plus ? '+' : space ? ' ' : '');

    if (conv === 's') {
      body = String(arg);
      if (hasPrec) body = body.slice(0, prec);
      zeroOk = false;
    } else if (conv === 'c') {
      body = String(arg);
      zeroOk = false;
    } else if (conv === 'd' || conv === 'i') {
      const n = BigInt(arg as number | bigint);
      sign = signFor(n < 0n);
      let d = (n < 0n ? -n : n).toString();
      if (hasPrec) {
        zeroOk = false;
        if (prec === 0 && n === 0n) d = '';
        else if (d.length < prec) d = '0'.repeat(prec - d.length) + d;
      }
      body = d;
    } else if (conv === 'x' || conv === 'X' || conv === 'o') {
      const n = BigInt(arg as number | bigint);
      let d = n.toString(conv === 'o' ? 8 : 16);
      if (conv === 'X') d = d.toUpperCase();
      if (hasPrec) {
        zeroOk = false;
        if (prec === 0 && n === 0n) d = '';
        else if (d.length < prec) d = '0'.repeat(prec - d.length) + d;
      }
      if (alt) {
        if (conv === 'o') {
          if (!d.startsWith('0')) d = '0' + d;
        } else if (n !== 0n) sign = conv === 'x' ? '0x' : '0X';
      }
      body = d;
    } else {
      const v = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      const neg = v < 0 || Object.is(v, -0);
      if (Number.isNaN(v)) {
        body = upper ? 'NAN' : 'nan';
        zeroOk = false;
      } else if (!Number.isFinite(v)) {
        sign = signFor(neg);
        body = upper ? 'INF' : 'inf';
        zeroOk = false;
      } else {
        sign = signFor(neg);
        const a = Math.abs(v);
        const p = hasPrec ? prec : 6;
        const lc = conv.toLowerCase();
        if (lc === 'f') {
          body = fixedDigits(a, p);
          if (p === 0 && alt) body += '.';
        } else if (lc === 'e') {
          body = expString(a, p, alt, upper);
        } else {
          const P = p === 0 ? 1 : p;
          const { x } = expParts(a, P - 1);
          if (P > x && x >= -4) {
            body = fixedDigits(a, P - 1 - x);
            if (!alt) body = stripZeros(body);
            else if (!body.includes('.')) body += '.';
          } else {
            body = expString(a, P - 1, alt, upper);
            if (!alt) {
              const k = body.search(/[eE]/);
              body = stripZeros(body.slice(0, k)) + body.slice(k);
            }
          }
        }
      }
    }

    const len = sign.length + body.length;
    if (len < width) {
      const pad = width - len;
      if (minus) out += sign + body + ' '.repeat(pad);
      else if (zeroOk) out += sign + '0'.repeat(pad) + body;
      else out += ' '.repeat(pad) + sign + body;
    } else out += sign + body;
  }
  return out;
}
