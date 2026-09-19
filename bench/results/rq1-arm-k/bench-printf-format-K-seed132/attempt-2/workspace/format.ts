function decompose(v: number): { m: bigint; e2: number } {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, Math.abs(v));
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const bexp = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (bexp === 0) return { m, e2: -1074 };
  m |= 1n << 52n;
  return { m, e2: bexp - 1075 };
}

// round(m * 2^e2 / 10^k), ties to even
function scaled(m: bigint, e2: number, k: number): bigint {
  let num = m;
  let den = 1n;
  if (e2 >= 0) num <<= BigInt(e2);
  else den <<= BigInt(-e2);
  if (k >= 0) den *= 10n ** BigInt(k);
  else num *= 10n ** BigInt(-k);
  const q = num / den;
  const r = num % den;
  const twice = r * 2n;
  if (twice > den || (twice === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// digits (no point) with fractional count prec
function fixedParts(v: number, prec: number): { i: string; f: string } {
  const { m, e2 } = decompose(v);
  let s = scaled(m, e2, -prec).toString();
  if (prec === 0) s = scaled(m, e2, 0).toString();
  else s = s.padStart(prec + 1, '0');
  return prec === 0 ? { i: s, f: '' } : { i: s.slice(0, s.length - prec), f: s.slice(s.length - prec) };
}

// returns digit string of length prec+1 and decimal exponent
function expParts(v: number, prec: number): { d: string; x: number } {
  if (v === 0) return { d: '0'.repeat(prec + 1), x: 0 };
  const { m, e2 } = decompose(v);
  let x = Math.floor(Math.log10(Math.abs(v)));
  if (!Number.isFinite(x)) x = -324;
  const lo = 10n ** BigInt(prec);
  const hi = lo * 10n;
  for (let it = 0; it < 10000; it++) {
    const n = scaled(m, e2, x - prec);
    if (n >= hi) x++;
    else if (n < lo) x--;
    else return { d: n.toString(), x };
  }
  throw new Error('exp');
}

function expStr(d: string, x: number, alt: boolean, upper: boolean): string {
  let s = d[0];
  if (d.length > 1) s += '.' + d.slice(1);
  else if (alt) s += '.';
  const ax = Math.abs(x);
  return s + (upper ? 'E' : 'e') + (x < 0 ? '-' : '+') + (ax < 10 ? '0' + ax : String(ax));
}

function stripZeros(s: string): string {
  if (!s.includes('.')) return s;
  return s.replace(/0+$/, '').replace(/\.$/, '');
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let out = '';
  let ai = 0;
  let i = 0;
  while (i < fmt.length) {
    const ch = fmt[i];
    if (ch !== '%') {
      out += ch;
      i++;
      continue;
    }
    i++;
    if (fmt[i] === '%') {
      out += '%';
      i++;
      continue;
    }
    let minus = false, plus = false, space = false, zero = false, alt = false;
    for (; i < fmt.length; i++) {
      const c = fmt[i];
      if (c === '-') minus = true;
      else if (c === '+') plus = true;
      else if (c === ' ') space = true;
      else if (c === '0') zero = true;
      else if (c === '#') alt = true;
      else break;
    }
    let width = 0;
    while (i < fmt.length && fmt[i] >= '0' && fmt[i] <= '9') width = width * 10 + Number(fmt[i++]);
    let prec = -1;
    if (fmt[i] === '.') {
      i++;
      prec = 0;
      while (i < fmt.length && fmt[i] >= '0' && fmt[i] <= '9') prec = prec * 10 + Number(fmt[i++]);
    }
    const conv = fmt[i++];
    const arg = args[ai++];

    let prefix = ''; // sign / 0x
    let body = '';
    let canZero = false;

    if (conv === 'd' || conv === 'i') {
      const b = BigInt(arg as number | bigint);
      const neg = b < 0n;
      let digits = (neg ? -b : b).toString();
      if (prec === 0 && b === 0n) digits = '';
      if (prec > digits.length) digits = digits.padStart(prec, '0');
      prefix = neg ? '-' : plus ? '+' : space ? ' ' : '';
      body = digits;
      canZero = prec < 0;
    } else if (conv === 'x' || conv === 'X' || conv === 'o') {
      const b = BigInt(arg as number | bigint);
      let digits = b.toString(conv === 'o' ? 8 : 16);
      if (conv === 'X') digits = digits.toUpperCase();
      if (prec === 0 && b === 0n) digits = '';
      if (prec > digits.length) digits = digits.padStart(prec, '0');
      if (alt) {
        if (conv === 'o') {
          if (digits[0] !== '0') digits = '0' + digits;
        } else if (b !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      }
      body = digits;
      canZero = prec < 0;
    } else if ('eEfFgG'.includes(conv)) {
      const v = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      const lc = conv.toLowerCase();
      if (Number.isNaN(v)) {
        body = upper ? 'NAN' : 'nan';
      } else {
        const neg = v < 0 || Object.is(v, -0);
        prefix = neg ? '-' : plus ? '+' : space ? ' ' : '';
        if (!Number.isFinite(v)) {
          body = upper ? 'INF' : 'inf';
        } else {
          canZero = true;
          const p = prec < 0 ? 6 : prec;
          if (lc === 'f') {
            const { i: ip, f } = fixedParts(v, p);
            body = ip + (p > 0 ? '.' + f : alt ? '.' : '');
          } else if (lc === 'e') {
            const { d, x } = expParts(v, p);
            body = expStr(d, x, alt, upper);
          } else {
            const P = prec < 0 ? 6 : prec === 0 ? 1 : prec;
            const { d, x } = expParts(v, P - 1);
            if (P > x && x >= -4) {
              const fp = P - 1 - x;
              const { i: ip, f } = fixedParts(v, fp);
              let s = ip + (fp > 0 ? '.' + f : alt ? '.' : '');
              if (!alt) s = stripZeros(s);
              body = s;
            } else {
              let mant = d[0] + (d.length > 1 ? '.' + d.slice(1) : alt ? '.' : '');
              if (!alt) mant = stripZeros(mant);
              const ax = Math.abs(x);
              body = mant + (upper ? 'E' : 'e') + (x < 0 ? '-' : '+') + (ax < 10 ? '0' + ax : String(ax));
            }
          }
        }
      }
    } else if (conv === 's') {
      let s = arg as string;
      if (prec >= 0) s = s.slice(0, prec);
      body = s;
    } else if (conv === 'c') {
      body = arg as string;
    }

    const len = prefix.length + body.length;
    if (len < width) {
      const pad = width - len;
      if (minus) out += prefix + body + ' '.repeat(pad);
      else if (zero && canZero) out += prefix + '0'.repeat(pad) + body;
      else out += ' '.repeat(pad) + prefix + body;
    } else out += prefix + body;
  }
  return out;
}
