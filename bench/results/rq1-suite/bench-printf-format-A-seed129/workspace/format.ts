function decompose(v: number): { m: bigint; e: number } {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, Math.abs(v));
  const bits = dv.getBigUint64(0);
  const ex = Number((bits >> 52n) & 0x7ffn);
  const frac = bits & ((1n << 52n) - 1n);
  if (ex === 0) return { m: frac, e: -1074 };
  return { m: frac | (1n << 52n), e: ex - 1075 };
}

// round(|v| * 10^k), ties to even, exact
function roundScaled(m: bigint, e: number, k: number): bigint {
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

function fixed(v: number, p: number, alt: boolean): string {
  const { m, e } = decompose(v);
  let s = roundScaled(m, e, p).toString();
  if (p > 0) {
    s = s.padStart(p + 1, '0');
    s = s.slice(0, s.length - p) + '.' + s.slice(s.length - p);
  } else if (alt) s += '.';
  return s;
}

function expDigits(v: number, p: number): { digits: string; x: number } {
  if (v === 0) return { digits: '0'.repeat(p + 1), x: 0 };
  const { m, e } = decompose(v);
  let x = Math.floor(Math.log10(Math.abs(v)));
  for (;;) {
    const q = roundScaled(m, e, p - x);
    const s = q.toString();
    if (s.length > p + 1) x++;
    else if (s.length < p + 1) x--;
    else return { digits: s, x };
  }
}

function expStr(digits: string, x: number, alt: boolean, upper: boolean): string {
  const p = digits.length - 1;
  let s = digits[0];
  if (p > 0) s += '.' + digits.slice(1);
  else if (alt) s += '.';
  const ax = Math.abs(x);
  s += (upper ? 'E' : 'e') + (x < 0 ? '-' : '+') + (ax < 10 ? '0' : '') + ax;
  return s;
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
      const c = fmt[i];
      if (c === '-') minus = true;
      else if (c === '+') plus = true;
      else if (c === ' ') space = true;
      else if (c === '0') zero = true;
      else if (c === '#') alt = true;
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
    let allowZero = true;
    const posSign = plus ? '+' : space ? ' ' : '';

    switch (conv) {
      case 'd':
      case 'i': {
        const n = BigInt(arg as number | bigint);
        sign = n < 0n ? '-' : posSign;
        body = (n < 0n ? -n : n).toString();
        if (prec === 0 && n === 0n) body = '';
        if (prec >= 0) {
          body = body.padStart(prec, '0');
          allowZero = false;
        }
        break;
      }
      case 'x':
      case 'X':
      case 'o': {
        const n = BigInt(arg as number | bigint);
        body = n.toString(conv === 'o' ? 8 : 16);
        if (conv === 'X') body = body.toUpperCase();
        if (prec === 0 && n === 0n) body = '';
        if (prec >= 0) {
          body = body.padStart(prec, '0');
          allowZero = false;
        }
        if (alt) {
          if (conv === 'o') {
            if (body[0] !== '0') body = '0' + body;
          } else if (n !== 0n) prefix = conv === 'x' ? '0x' : '0X';
        }
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
        if (Number.isNaN(v)) {
          body = upper ? 'NAN' : 'nan';
          allowZero = false;
        } else {
          sign = v < 0 || Object.is(v, -0) ? '-' : posSign;
          if (!Number.isFinite(v)) {
            body = upper ? 'INF' : 'inf';
            allowZero = false;
          } else if (conv === 'f' || conv === 'F') {
            body = fixed(v, prec < 0 ? 6 : prec, alt);
          } else if (conv === 'e' || conv === 'E') {
            const { digits, x } = expDigits(v, prec < 0 ? 6 : prec);
            body = expStr(digits, x, alt, upper);
          } else {
            let P = prec < 0 ? 6 : prec;
            if (P === 0) P = 1;
            const { digits, x } = expDigits(v, P - 1);
            if (P > x && x >= -4) {
              body = fixed(v, P - 1 - x, alt);
              if (!alt) body = stripZeros(body);
            } else {
              if (!alt) {
                const t = stripZeros(digits.length > 1 ? digits[0] + '.' + digits.slice(1) : digits);
                const dd = t.replace('.', '');
                body = expStr(dd, x, false, upper);
              } else body = expStr(digits, x, true, upper);
            }
          }
        }
        break;
      }
      case 's':
        numeric = false;
        body = String(arg);
        if (prec >= 0) body = body.slice(0, prec);
        break;
      case 'c':
        numeric = false;
        body = String(arg);
        break;
    }

    const len = sign.length + prefix.length + body.length;
    if (len >= width) out += sign + prefix + body;
    else if (minus) out += sign + prefix + body + ' '.repeat(width - len);
    else if (numeric && zero && allowZero)
      out += sign + prefix + '0'.repeat(width - len) + body;
    else out += ' '.repeat(width - len) + sign + prefix + body;
  }
  return out;
}
