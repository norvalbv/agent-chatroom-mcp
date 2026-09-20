// round(abs * 10^k) with exact binary value, ties to even. abs finite, >= 0.
function scaledRound(abs: number, k: number): bigint {
  if (abs === 0) return 0n;
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, abs);
  const hi = buf.getUint32(0);
  const lo = buf.getUint32(4);
  const bexp = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let e: number;
  if (bexp === 0) e = -1074;
  else {
    m |= 1n << 52n;
    e = bexp - 1075;
  }
  let num = m;
  let den = 1n;
  if (e >= 0) num <<= BigInt(e);
  else den <<= BigInt(-e);
  if (k >= 0) num *= 10n ** BigInt(k);
  else den *= 10n ** BigInt(-k);
  let q = num / den;
  const r2 = (num % den) * 2n;
  if (r2 > den || (r2 === den && (q & 1n) === 1n)) q += 1n;
  return q;
}

function fixedStr(abs: number, p: number, alt: boolean): string {
  let s = scaledRound(abs, p).toString();
  if (p > 0) {
    s = s.padStart(p + 1, '0');
    s = s.slice(0, s.length - p) + '.' + s.slice(s.length - p);
  } else if (alt) s += '.';
  return s;
}

// returns digit string (p+1 digits) and decimal exponent
function expParts(abs: number, p: number): [string, number] {
  if (abs === 0) return ['0'.repeat(p + 1), 0];
  let x = Math.floor(Math.log10(abs));
  if (!isFinite(x)) x = Number(abs.toExponential().split('e')[1]);
  const lim = 10n ** BigInt(p);
  for (let i = 0; i < 8; i++) {
    const d = scaledRound(abs, p - x);
    if (d >= lim * 10n) x++;
    else if (d < lim) x--;
    else return [d.toString(), x];
  }
  return [scaledRound(abs, p - x).toString(), x];
}

function expStr(abs: number, p: number, alt: boolean, upper: boolean): string {
  const [d, x] = expParts(abs, p);
  let s = d[0];
  if (p > 0) s += '.' + d.slice(1);
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
    for (;; i++) {
      const f = fmt[i];
      if (f === '-') minus = true;
      else if (f === '+') plus = true;
      else if (f === ' ') space = true;
      else if (f === '0') zero = true;
      else if (f === '#') alt = true;
      else break;
    }
    let width = 0;
    while (fmt[i] >= '0' && fmt[i] <= '9') width = width * 10 + Number(fmt[i++]);
    let prec = -1;
    if (fmt[i] === '.') {
      i++;
      prec = 0;
      while (fmt[i] >= '0' && fmt[i] <= '9') prec = prec * 10 + Number(fmt[i++]);
    }
    const conv = fmt[i++];
    const arg = args[ai++];
    let sign = '';
    let prefix = '';
    let body = '';
    let numeric = true;
    let zeroOk = zero && !minus;

    if (conv === 's' || conv === 'c') {
      numeric = false;
      body = String(arg);
      if (conv === 's' && prec >= 0) body = body.slice(0, prec);
    } else if ('dixXo'.includes(conv)) {
      const v = typeof arg === 'bigint' ? arg : BigInt(arg as number);
      const neg = v < 0n;
      const mag = neg ? -v : v;
      if (conv === 'd' || conv === 'i') {
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        body = mag.toString(10);
      } else {
        body = mag.toString(conv === 'o' ? 8 : 16);
        if (conv === 'X') body = body.toUpperCase();
      }
      if (prec === 0 && mag === 0n) body = '';
      if (prec >= 0) {
        body = body.padStart(prec, '0');
        zeroOk = false;
      }
      if (alt) {
        if (conv === 'o') {
          if (body[0] !== '0') body = '0' + body;
        } else if (conv === 'x' || conv === 'X') {
          if (mag !== 0n) prefix = conv === 'x' ? '0x' : '0X';
        }
      }
    } else {
      const v = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      if (Number.isNaN(v)) {
        body = upper ? 'NAN' : 'nan';
        zeroOk = false;
      } else {
        const neg = v < 0 || Object.is(v, -0);
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        const abs = Math.abs(v);
        if (abs === Infinity) {
          body = upper ? 'INF' : 'inf';
          zeroOk = false;
        } else {
          const lc = conv.toLowerCase();
          if (lc === 'f') body = fixedStr(abs, prec < 0 ? 6 : prec, alt);
          else if (lc === 'e') body = expStr(abs, prec < 0 ? 6 : prec, alt, upper);
          else {
            const P = prec < 0 ? 6 : prec === 0 ? 1 : prec;
            const X = expParts(abs, P - 1)[1];
            if (P > X && X >= -4) {
              body = fixedStr(abs, P - 1 - X, alt);
            } else {
              body = expStr(abs, P - 1, alt, upper);
            }
            if (!alt) {
              const ei = body.search(/[eE]/);
              if (ei >= 0) body = stripZeros(body.slice(0, ei)) + body.slice(ei);
              else body = stripZeros(body);
            }
          }
        }
      }
    }

    const len = sign.length + prefix.length + body.length;
    if (len < width) {
      const pad = width - len;
      if (minus) out += sign + prefix + body + ' '.repeat(pad);
      else if (numeric && zeroOk) out += sign + prefix + '0'.repeat(pad) + body;
      else out += ' '.repeat(pad) + sign + prefix + body;
    } else out += sign + prefix + body;
  }
  return out;
}
