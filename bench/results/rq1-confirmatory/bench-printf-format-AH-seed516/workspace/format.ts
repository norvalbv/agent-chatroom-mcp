function decompose(abs: number): [bigint, number] {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, abs);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (expBits === 0) return [m, -1074];
  m |= 1n << 52n;
  return [m, expBits - 1075];
}

// round(abs * 10^k) with ties to even, exact
function scaledRound(abs: number, k: number): bigint {
  const [m, e] = decompose(abs);
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

function fixedStr(abs: number, prec: number, alt: boolean): string {
  let d = scaledRound(abs, prec).toString();
  if (d.length < prec + 1) d = '0'.repeat(prec + 1 - d.length) + d;
  const ip = d.slice(0, d.length - prec);
  const fp = d.slice(d.length - prec);
  return prec > 0 ? ip + '.' + fp : alt ? ip + '.' : ip;
}

// returns [digits (prec+1 chars), exponent]
function expDigits(abs: number, prec: number): [string, number] {
  if (abs === 0) return ['0'.repeat(prec + 1), 0];
  let x = Math.floor(Math.log10(abs));
  if (!isFinite(x)) x = -324;
  const lo = 10n ** BigInt(prec);
  const hi = lo * 10n;
  for (;;) {
    const d = scaledRound(abs, prec - x);
    if (d < lo) x--;
    else if (d >= hi) x++;
    else return [d.toString(), x];
  }
}

function expStr(abs: number, prec: number, alt: boolean, upper: boolean): string {
  const [d, x] = expDigits(abs, prec);
  let s = d[0];
  if (prec > 0) s += '.' + d.slice(1);
  else if (alt) s += '.';
  const ax = Math.abs(x);
  return s + (upper ? 'E' : 'e') + (x < 0 ? '-' : '+') + (ax < 10 ? '0' : '') + ax;
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

    let prefix = '';
    let body = '';
    let numeric = true;
    let allowZero = zero && !minus;

    switch (conv) {
      case 'd':
      case 'i': {
        const v = BigInt(arg as number | bigint);
        const neg = v < 0n;
        let digits = (neg ? -v : v).toString();
        if (prec === 0 && v === 0n) digits = '';
        if (prec > digits.length) digits = '0'.repeat(prec - digits.length) + digits;
        prefix = neg ? '-' : plus ? '+' : space ? ' ' : '';
        body = digits;
        if (prec >= 0) allowZero = false;
        break;
      }
      case 'x':
      case 'X':
      case 'o': {
        const v = BigInt(arg as number | bigint);
        let digits = v.toString(conv === 'o' ? 8 : 16);
        if (conv === 'X') digits = digits.toUpperCase();
        if (prec === 0 && v === 0n) digits = '';
        if (prec > digits.length) digits = '0'.repeat(prec - digits.length) + digits;
        if (alt) {
          if (conv === 'o') {
            if (digits[0] !== '0') digits = '0' + digits;
          } else if (v !== 0n) prefix = conv === 'x' ? '0x' : '0X';
        }
        body = digits;
        if (prec >= 0) allowZero = false;
        break;
      }
      case 'e':
      case 'E':
      case 'f':
      case 'F':
      case 'g':
      case 'G': {
        const v = arg as number;
        const upper = conv === 'E' || conv === 'F' || conv === 'G';
        const neg = v < 0 || Object.is(v, -0);
        if (Number.isNaN(v)) {
          prefix = '';
          body = upper ? 'NAN' : 'nan';
          allowZero = false;
          break;
        }
        prefix = neg ? '-' : plus ? '+' : space ? ' ' : '';
        if (!isFinite(v)) {
          body = upper ? 'INF' : 'inf';
          allowZero = false;
          break;
        }
        const abs = Math.abs(v);
        const lc = conv.toLowerCase();
        if (lc === 'f') {
          body = fixedStr(abs, prec < 0 ? 6 : prec, alt);
        } else if (lc === 'e') {
          body = expStr(abs, prec < 0 ? 6 : prec, alt, upper);
        } else {
          let P = prec < 0 ? 6 : prec;
          if (P === 0) P = 1;
          const [, x] = expDigits(abs, P - 1);
          if (P > x && x >= -4) {
            body = fixedStr(abs, P - 1 - x, alt);
            if (!alt) body = stripZeros(body);
          } else {
            let s = expStr(abs, P - 1, alt, upper);
            if (!alt) {
              const k = s.search(/[eE]/);
              s = stripZeros(s.slice(0, k)) + s.slice(k);
            }
            body = s;
          }
        }
        break;
      }
      case 's': {
        numeric = false;
        body = String(arg);
        if (prec >= 0) body = body.slice(0, prec);
        break;
      }
      case 'c': {
        numeric = false;
        body = String(arg);
        break;
      }
    }

    const len = prefix.length + body.length;
    if (len >= width) out += prefix + body;
    else if (minus) out += prefix + body + ' '.repeat(width - len);
    else if (numeric && allowZero) out += prefix + '0'.repeat(width - len) + body;
    else out += ' '.repeat(width - len) + prefix + body;
  }
  return out;
}
