function decompose(v: number): [bigint, number] {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, v);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const e = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (e === 0) return [m, -1074];
  m |= 1n << 52n;
  return [m, e - 1075];
}

// round-half-even(v * 10^k), v finite and >= 0
function scaled(v: number, k: number): bigint {
  const [m, e2] = decompose(v);
  let num = m;
  let den = 1n;
  if (e2 >= 0) num <<= BigInt(e2);
  else den <<= BigInt(-e2);
  if (k >= 0) num *= 10n ** BigInt(k);
  else den *= 10n ** BigInt(-k);
  const q = num / den;
  const r = num % den;
  const twice = r * 2n;
  if (twice > den || (twice === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

function fixedStr(v: number, prec: number, alt: boolean): string {
  let s = scaled(v, prec).toString();
  if (prec > 0) {
    s = s.padStart(prec + 1, '0');
    return s.slice(0, s.length - prec) + '.' + s.slice(s.length - prec);
  }
  return alt ? s + '.' : s;
}

// returns digits (prec+1 of them) and decimal exponent
function expParts(v: number, prec: number): [string, number] {
  if (v === 0) return ['0'.repeat(prec + 1), 0];
  let x = Math.floor(Math.log10(v));
  if (!isFinite(x)) x = -324;
  for (let i = 0; i < 10; i++) {
    const n = scaled(v, prec - x);
    const s = n.toString();
    if (s.length > prec + 1) x++;
    else if (s.length < prec + 1) x--;
    else return [s, x];
  }
  throw new Error('exponent search failed');
}

function expStr(v: number, prec: number, alt: boolean, upper: boolean): string {
  const [d, x] = expParts(v, prec);
  let s = d[0];
  if (prec > 0) s += '.' + d.slice(1);
  else if (alt) s += '.';
  const ax = Math.abs(x);
  return s + (upper ? 'E' : 'e') + (x < 0 ? '-' : '+') + (ax < 10 ? '0' : '') + ax;
}

function stripZeros(s: string): string {
  const ei = s.search(/[eE]/);
  let mant = ei < 0 ? s : s.slice(0, ei);
  const tail = ei < 0 ? '' : s.slice(ei);
  if (mant.includes('.')) mant = mant.replace(/0+$/, '').replace(/\.$/, '');
  return mant + tail;
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
      const f = fmt[i];
      if (f === '-') minus = true;
      else if (f === '+') plus = true;
      else if (f === ' ') space = true;
      else if (f === '0') zero = true;
      else if (f === '#') alt = true;
      else break;
    }
    let width = 0;
    while (i < fmt.length && fmt[i] >= '0' && fmt[i] <= '9') width = width * 10 + Number(fmt[i++]);
    let prec: number | undefined;
    if (fmt[i] === '.') {
      i++;
      prec = 0;
      while (i < fmt.length && fmt[i] >= '0' && fmt[i] <= '9') prec = prec * 10 + Number(fmt[i++]);
    }
    const conv = fmt[i++];
    const arg = args[ai++];

    let sign = '';
    let prefix = '';
    let body = '';
    let canZero = true;

    if (conv === 's' || conv === 'c') {
      body = String(arg);
      if (conv === 's' && prec !== undefined) body = body.slice(0, prec);
      canZero = false;
    } else if ('dixXo'.includes(conv)) {
      const n = BigInt(arg as number | bigint);
      const neg = n < 0n;
      const mag = neg ? -n : n;
      const base = conv === 'x' || conv === 'X' ? 16 : conv === 'o' ? 8 : 10;
      let digits = mag.toString(base);
      if (conv === 'X') digits = digits.toUpperCase();
      if (prec !== undefined) {
        if (prec === 0 && mag === 0n) digits = '';
        digits = digits.padStart(prec, '0');
        canZero = false;
      }
      if (base === 10) {
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
      } else if (alt) {
        if (conv === 'o') {
          if (!digits.startsWith('0')) digits = '0' + digits;
        } else if (mag !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      }
      body = digits;
    } else {
      const v = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      const neg = v < 0 || Object.is(v, -0);
      if (Number.isNaN(v)) {
        body = upper ? 'NAN' : 'nan';
        canZero = false;
      } else {
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        const a = Math.abs(v);
        if (a === Infinity) {
          body = upper ? 'INF' : 'inf';
          canZero = false;
        } else if (conv === 'f' || conv === 'F') {
          body = fixedStr(a, prec ?? 6, alt);
        } else if (conv === 'e' || conv === 'E') {
          body = expStr(a, prec ?? 6, alt, upper);
        } else {
          const P = prec === undefined ? 6 : prec === 0 ? 1 : prec;
          const X = expParts(a, P - 1)[1];
          if (P > X && X >= -4) body = fixedStr(a, P - 1 - X, alt);
          else body = expStr(a, P - 1, alt, upper);
          if (!alt) body = stripZeros(body);
        }
      }
    }

    let text = sign + prefix + body;
    if (text.length < width) {
      const pad = width - text.length;
      if (minus) text += ' '.repeat(pad);
      else if (zero && canZero) text = sign + prefix + '0'.repeat(pad) + body;
      else text = ' '.repeat(pad) + text;
    }
    out += text;
  }
  return out;
}
