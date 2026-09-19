function roundDiv(num: bigint, den: bigint): bigint {
  const q = num / den;
  const r = num % den;
  const twice = r * 2n;
  if (twice > den || (twice === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// positive finite a -> [mantissa, exp2] with a = m * 2^e
function decompose(a: number): [bigint, number] {
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, a);
  const hi = buf.getUint32(0);
  const lo = buf.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let e: number;
  if (expBits === 0) {
    e = -1074;
  } else {
    m |= 1n << 52n;
    e = expBits - 1075;
  }
  return [m, e];
}

// round(a / 10^k) exactly, half-even
function scaled(a: number, k: number): bigint {
  if (a === 0) return 0n;
  const [m, e] = decompose(a);
  let num = m;
  let den = 1n;
  if (e >= 0) num <<= BigInt(e);
  else den <<= BigInt(-e);
  if (k >= 0) den *= 10n ** BigInt(k);
  else num *= 10n ** BigInt(-k);
  return roundDiv(num, den);
}

function fixedStr(a: number, prec: number, alt: boolean): string {
  let s = scaled(a, -prec).toString();
  if (prec > 0) {
    s = s.padStart(prec + 1, '0');
    return s.slice(0, s.length - prec) + '.' + s.slice(s.length - prec);
  }
  return alt ? s + '.' : s;
}

function expParts(a: number, prec: number): [string, number] {
  if (a === 0) return ['0'.repeat(prec + 1), 0];
  let e10 = Math.floor(Math.log10(a));
  const lo = 10n ** BigInt(prec);
  const hi = lo * 10n;
  for (let i = 0; i < 10; i++) {
    const d = scaled(a, e10 - prec);
    if (d < lo) e10--;
    else if (d >= hi) e10++;
    else return [d.toString(), e10];
  }
  throw new Error('exp');
}

function expStr(a: number, prec: number, alt: boolean, upper: boolean): string {
  const [d, x] = expParts(a, prec);
  let s = d[0];
  if (prec > 0) s += '.' + d.slice(1);
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
    const precN = hasPrec ? (mt[4] === '' ? 0 : parseInt(mt[4], 10)) : -1;
    const conv = mt[5];
    const arg = args[ai++];
    let sign = '';
    let prefix = '';
    let body = '';
    if (conv === 's') {
      body = String(arg);
      if (hasPrec) body = body.slice(0, precN);
      zero = false;
    } else if (conv === 'c') {
      body = String(arg);
      zero = false;
    } else if (conv === 'd' || conv === 'i') {
      let v = typeof arg === 'bigint' ? arg : BigInt(arg as number);
      const neg = v < 0n;
      if (neg) v = -v;
      body = v.toString();
      if (hasPrec) {
        if (precN === 0 && v === 0n) body = '';
        body = body.padStart(precN, '0');
        zero = false;
      }
      sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
    } else if (conv === 'x' || conv === 'X' || conv === 'o') {
      const v = typeof arg === 'bigint' ? arg : BigInt(arg as number);
      body = v.toString(conv === 'o' ? 8 : 16);
      if (conv === 'X') body = body.toUpperCase();
      if (hasPrec) {
        if (precN === 0 && v === 0n) body = '';
        body = body.padStart(precN, '0');
        zero = false;
      }
      if (alt) {
        if (conv === 'o') {
          if (body[0] !== '0') body = '0' + body;
        } else if (v !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      }
    } else {
      const v = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      const neg = v < 0 || Object.is(v, -0);
      if (Number.isNaN(v)) {
        body = upper ? 'NAN' : 'nan';
        zero = false;
      } else {
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        const a = Math.abs(v);
        if (a === Infinity) {
          body = upper ? 'INF' : 'inf';
          zero = false;
        } else {
          const P = hasPrec ? precN : 6;
          const lc = conv.toLowerCase();
          if (lc === 'f') body = fixedStr(a, P, alt);
          else if (lc === 'e') body = expStr(a, P, alt, upper);
          else {
            const G = P === 0 ? 1 : P;
            const x = expParts(a, G - 1)[1];
            if (G > x && x >= -4) {
              body = fixedStr(a, G - 1 - x, alt);
              if (!alt) body = stripZeros(body);
            } else {
              body = expStr(a, G - 1, alt, upper);
              if (!alt) {
                const k = body.search(/[eE]/);
                body = stripZeros(body.slice(0, k)) + body.slice(k);
              }
            }
          }
        }
      }
    }
    const len = sign.length + prefix.length + body.length;
    if (len >= width) out += sign + prefix + body;
    else if (left) out += sign + prefix + body + ' '.repeat(width - len);
    else if (zero) out += sign + prefix + '0'.repeat(width - len) + body;
    else out += ' '.repeat(width - len) + sign + prefix + body;
  }
  return out;
}
