function decompose(v: number): { m: bigint; e: number } {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, v);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (expBits === 0) return { m, e: -1074 };
  m |= 1n << 52n;
  return { m, e: expBits - 1075 };
}

// round-half-even of |v| * 10^k, exact
function roundScaled(v: number, k: number): bigint {
  const d = decompose(v);
  let num = d.m;
  let den = 1n;
  if (d.e >= 0) num <<= BigInt(d.e);
  else den <<= BigInt(-d.e);
  if (k >= 0) num *= 10n ** BigInt(k);
  else den *= 10n ** BigInt(-k);
  const q = num / den;
  const r = num % den;
  const twice = r * 2n;
  if (twice > den || (twice === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// digits (string of length p) and decimal exponent for e-style with p significant digits
function eDigits(v: number, p: number): { digits: string; x: number } {
  if (v === 0) return { digits: '0'.repeat(p), x: 0 };
  let x = Math.floor(Math.log10(v));
  if (!isFinite(x)) x = -324;
  const lim = 10n ** BigInt(p);
  const low = 10n ** BigInt(p - 1);
  for (;;) {
    const s = roundScaled(v, p - 1 - x);
    if (s >= lim) x++;
    else if (s < low) x--;
    else return { digits: s.toString(), x };
  }
}

function expStr(x: number, upper: boolean): string {
  const a = Math.abs(x);
  return (upper ? 'E' : 'e') + (x < 0 ? '-' : '+') + (a < 10 ? '0' + a : String(a));
}

function fStyle(v: number, prec: number, alt: boolean): string {
  let s = roundScaled(v, prec).toString();
  if (prec > 0) {
    s = s.padStart(prec + 1, '0');
    return s.slice(0, s.length - prec) + '.' + s.slice(s.length - prec);
  }
  return alt ? s + '.' : s;
}

function eStyle(v: number, prec: number, alt: boolean, upper: boolean): string {
  const { digits, x } = eDigits(v, prec + 1);
  let s = digits[0];
  if (prec > 0) s += '.' + digits.slice(1);
  else if (alt) s += '.';
  return s + expStr(x, upper);
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
    i = p + mt[0].length;
    if (mt[1]) {
      out += '%';
      continue;
    }
    const flags = mt[2];
    const left = flags.includes('-');
    const plus = flags.includes('+');
    const space = flags.includes(' ');
    let zero = flags.includes('0');
    const alt = flags.includes('#');
    const width = mt[3] ? parseInt(mt[3], 10) : 0;
    const hasPrec = mt[4] !== undefined;
    const prec = hasPrec ? (mt[4] === '' ? 0 : parseInt(mt[4], 10)) : -1;
    const conv = mt[5];
    const arg = args[ai++];
    let prefix = '';
    let body = '';
    if (conv === 's' || conv === 'c') {
      let s = String(arg);
      if (conv === 's' && hasPrec) s = s.slice(0, prec);
      body = s;
      zero = false;
    } else if (conv === 'd' || conv === 'i' || conv === 'x' || conv === 'X' || conv === 'o') {
      const n = BigInt(arg as number | bigint);
      const neg = n < 0n;
      const mag = neg ? -n : n;
      let digits = conv === 'x' ? mag.toString(16) : conv === 'X' ? mag.toString(16).toUpperCase() : conv === 'o' ? mag.toString(8) : mag.toString();
      if (hasPrec) {
        if (prec === 0 && mag === 0n) digits = '';
        digits = digits.padStart(prec, '0');
      }
      if (conv === 'd' || conv === 'i') {
        prefix = neg ? '-' : plus ? '+' : space ? ' ' : '';
      } else if (alt) {
        if (conv === 'o') {
          if (!digits.startsWith('0')) digits = '0' + digits;
        } else if (mag !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      }
      if (hasPrec) zero = false;
      body = digits;
    } else {
      const v = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      const neg = v < 0 || Object.is(v, -0);
      if (Number.isNaN(v)) {
        body = upper ? 'NAN' : 'nan';
        zero = false;
      } else {
        prefix = neg ? '-' : plus ? '+' : space ? ' ' : '';
        const a = Math.abs(v);
        if (a === Infinity) {
          body = upper ? 'INF' : 'inf';
          zero = false;
        } else {
          const lc = conv.toLowerCase();
          if (lc === 'f') {
            body = fStyle(a, hasPrec ? prec : 6, alt);
          } else if (lc === 'e') {
            body = eStyle(a, hasPrec ? prec : 6, alt, upper);
          } else {
            const P = hasPrec ? (prec === 0 ? 1 : prec) : 6;
            const { x } = eDigits(a, P);
            if (P > x && x >= -4) {
              body = fStyle(a, P - 1 - x, alt);
              if (!alt) body = stripZeros(body);
            } else {
              const s = eStyle(a, P - 1, alt, upper);
              if (!alt) {
                const ei = s.search(/[eE]/);
                body = stripZeros(s.slice(0, ei)) + s.slice(ei);
              } else body = s;
            }
          }
        }
      }
    }
    if (left) zero = false;
    const len = prefix.length + body.length;
    if (len < width) {
      const pad = width - len;
      if (left) body = prefix + body + ' '.repeat(pad);
      else if (zero) body = prefix + '0'.repeat(pad) + body;
      else body = ' '.repeat(pad) + prefix + body;
    } else body = prefix + body;
    out += body;
  }
  return out;
}
