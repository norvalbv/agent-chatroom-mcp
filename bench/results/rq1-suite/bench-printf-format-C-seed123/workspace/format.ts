function pow10(n: number): bigint {
  return 10n ** BigInt(n);
}

// Decompose a finite non-negative double into m * 2^e (m, e integers).
function decompose(v: number): { m: bigint; e: number } {
  if (v === 0) return { m: 0n, e: 0 };
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, v);
  const hi = buf.getUint32(0);
  const lo = buf.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (expBits === 0) return { m, e: -1074 };
  m |= 1n << 52n;
  return { m, e: expBits - 1075 };
}

// round-half-even of v * 10^k as an integer
function scaled(v: number, k: number): bigint {
  const { m, e } = decompose(v);
  let num = m;
  let den = 1n;
  if (e >= 0) num <<= BigInt(e);
  else den <<= BigInt(-e);
  if (k >= 0) num *= pow10(k);
  else den *= pow10(-k);
  let q = num / den;
  const r = num - q * den;
  const twice = r * 2n;
  if (twice > den || (twice === den && (q & 1n) === 1n)) q += 1n;
  return q;
}

function fixedDigits(v: number, p: number, alt: boolean): string {
  let s = scaled(v, p).toString();
  if (p === 0) return alt ? s + '.' : s;
  if (s.length <= p) s = '0'.repeat(p - s.length + 1) + s;
  return s.slice(0, s.length - p) + '.' + s.slice(s.length - p);
}

// returns digit string (p+1 digits) and decimal exponent
function expParts(v: number, p: number): { digits: string; x: number } {
  if (v === 0) return { digits: '0'.repeat(p + 1), x: 0 };
  let x = Math.floor(Math.log10(v));
  if (!isFinite(x)) x = 0;
  for (let i = 0; i < 10; i++) {
    const n = scaled(v, p - x);
    if (n >= pow10(p + 1)) x++;
    else if (n < pow10(p)) x--;
    else return { digits: n.toString(), x };
  }
  throw new Error('exp failed');
}

function expText(digits: string, x: number, alt: boolean, upper: boolean): string {
  let s = digits[0];
  if (digits.length > 1) s += '.' + digits.slice(1);
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
  const re = /%(?:(%)|([-+ 0#]*)(\d*)(?:\.(\d*))?([diuxXoeEfFgGsc]))/y;
  let i = 0;
  while (i < fmt.length) {
    const c = fmt[i];
    if (c !== '%') {
      out += c;
      i++;
      continue;
    }
    re.lastIndex = i;
    const mt = re.exec(fmt);
    if (!mt) {
      out += c;
      i++;
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
    let prefix = '';
    let body = '';
    let canZero = true;

    if (conv === 's' || conv === 'c') {
      body = String(arg);
      if (conv === 's' && hasPrec) body = body.slice(0, prec);
      canZero = false;
    } else if ('dixXo'.includes(conv) || conv === 'u') {
      let n = BigInt(arg as number | bigint);
      if (conv === 'd' || conv === 'i') {
        if (n < 0n) {
          sign = '-';
          n = -n;
        } else sign = plus ? '+' : space ? ' ' : '';
      }
      let d = conv === 'x' ? n.toString(16) : conv === 'X' ? n.toString(16).toUpperCase() : conv === 'o' ? n.toString(8) : n.toString();
      if (hasPrec) {
        if (prec === 0 && n === 0n) d = '';
        else if (d.length < prec) d = '0'.repeat(prec - d.length) + d;
        canZero = false;
      }
      if (alt) {
        if ((conv === 'x' || conv === 'X') && n !== 0n) prefix = conv === 'x' ? '0x' : '0X';
        if (conv === 'o' && !d.startsWith('0')) d = '0' + d;
      }
      body = d;
    } else {
      const v = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      if (Number.isNaN(v)) {
        body = upper ? 'NAN' : 'nan';
        canZero = false;
      } else {
        const neg = v < 0 || Object.is(v, -0);
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        const a = Math.abs(v);
        if (a === Infinity) {
          body = upper ? 'INF' : 'inf';
          canZero = false;
        } else if (conv === 'f' || conv === 'F') {
          body = fixedDigits(a, hasPrec ? prec : 6, alt);
        } else if (conv === 'e' || conv === 'E') {
          const p = hasPrec ? prec : 6;
          const { digits, x } = expParts(a, p);
          body = expText(digits, x, alt, upper);
        } else {
          let P = hasPrec ? prec : 6;
          if (P === 0) P = 1;
          const { digits, x } = expParts(a, P - 1);
          if (P > x && x >= -4) {
            body = fixedDigits(a, P - 1 - x, alt);
            if (!alt) body = stripZeros(body);
          } else {
            if (!alt) {
              const stripped = stripZeros(digits[0] + '.' + digits.slice(1));
              body = expText(stripped.replace('.', ''), x, false, upper);
            } else body = expText(digits, x, true, upper);
          }
        }
      }
    }

    let len = sign.length + prefix.length + body.length;
    if (len < width) {
      const pad = width - len;
      if (minus) body += ' '.repeat(pad);
      else if (zero && canZero) body = '0'.repeat(pad) + body;
      else sign = ' '.repeat(pad) + sign;
    }
    out += sign + prefix + body;
  }
  return out;
}
