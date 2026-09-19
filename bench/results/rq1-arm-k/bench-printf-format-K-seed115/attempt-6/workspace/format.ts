function decompose(x: number): [bigint, number] {
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, x);
  const hi = buf.getUint32(0);
  const lo = buf.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  let mant = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let e2: number;
  if (expBits === 0) {
    e2 = -1074;
  } else {
    mant |= 1n << 52n;
    e2 = expBits - 1075;
  }
  return [mant, e2];
}

// x * 10^k as [quotient, remainder, denominator]
function scaled(x: number, k: number): [bigint, bigint, bigint] {
  const [mant, e2] = decompose(x);
  let num = mant;
  let den = 1n;
  if (e2 >= 0) num <<= BigInt(e2);
  else den <<= BigInt(-e2);
  if (k >= 0) num *= 10n ** BigInt(k);
  else den *= 10n ** BigInt(-k);
  return [num / den, num % den, den];
}

function roundScaled(x: number, k: number): bigint {
  const [q, r, den] = scaled(x, k);
  const twice = r * 2n;
  if (twice > den || (twice === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// x > 0 or 0: returns digit string of length p+1 and decimal exponent
function sci(x: number, p: number): [string, number] {
  if (x === 0) return ['0'.repeat(p + 1), 0];
  let X = Math.floor(Math.log10(x));
  if (!isFinite(X)) X = -324;
  for (;;) {
    const [q] = scaled(x, -X);
    if (q === 0n) X--;
    else if (q >= 10n) X++;
    else break;
  }
  let d = roundScaled(x, p - X);
  if (d >= 10n ** BigInt(p + 1)) {
    X++;
    d = 10n ** BigInt(p);
  }
  return [d.toString(), X];
}

function fixed(x: number, p: number, alt: boolean): string {
  let s = roundScaled(x, p).toString();
  if (s.length < p + 1) s = '0'.repeat(p + 1 - s.length) + s;
  const ip = s.slice(0, s.length - p);
  const fp = s.slice(s.length - p);
  return ip + (p > 0 || alt ? '.' : '') + fp;
}

function expStyle(digits: string, X: number, p: number, alt: boolean, upper: boolean): string {
  const m = digits[0] + (p > 0 || alt ? '.' : '') + digits.slice(1);
  const ea = Math.abs(X).toString().padStart(2, '0');
  return m + (upper ? 'E' : 'e') + (X < 0 ? '-' : '+') + ea;
}

function stripZeros(m: string): string {
  if (!m.includes('.')) return m;
  return m.replace(/0+$/, '').replace(/\.$/, '');
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let out = '';
  let ai = 0;
  let i = 0;
  const re = /%([-+ 0#]*)(\d*)(?:(\.)(\d*))?([diouxXeEfFgGsc%])/y;
  while (i < fmt.length) {
    const pct = fmt.indexOf('%', i);
    if (pct < 0) {
      out += fmt.slice(i);
      break;
    }
    out += fmt.slice(i, pct);
    re.lastIndex = pct;
    const m = re.exec(fmt);
    if (!m) {
      out += '%';
      i = pct + 1;
      continue;
    }
    i = re.lastIndex;
    const flags = m[1];
    const width = m[2] ? parseInt(m[2], 10) : 0;
    const hasPrec = m[3] !== undefined;
    const prec = hasPrec ? (m[4] ? parseInt(m[4], 10) : 0) : -1;
    const conv = m[5];
    if (conv === '%') {
      out += '%';
      continue;
    }
    const left = flags.includes('-');
    const plus = flags.includes('+');
    const space = flags.includes(' ');
    const zero = flags.includes('0') && !left;
    const alt = flags.includes('#');
    const arg = args[ai++];

    let prefix = '';
    let body = '';
    let zeroOk = true;
    const signFor = (neg: boolean) => (neg ? '-' : plus ? '+' : space ? ' ' : '');

    if (conv === 's' || conv === 'c') {
      let s = String(arg);
      if (conv === 's' && hasPrec) s = s.slice(0, prec);
      body = s;
      zeroOk = false;
    } else if (conv === 'd' || conv === 'i') {
      const v = typeof arg === 'bigint' ? arg : BigInt(arg as number);
      prefix = signFor(v < 0n);
      let d = (v < 0n ? -v : v).toString();
      if (hasPrec) {
        if (prec === 0 && v === 0n) d = '';
        d = d.padStart(prec, '0');
        zeroOk = false;
      }
      body = d;
    } else if (conv === 'x' || conv === 'X' || conv === 'o') {
      const v = typeof arg === 'bigint' ? arg : BigInt(arg as number);
      let d = v.toString(conv === 'o' ? 8 : 16);
      if (conv === 'X') d = d.toUpperCase();
      if (hasPrec) {
        if (prec === 0 && v === 0n) d = '';
        d = d.padStart(prec, '0');
        zeroOk = false;
      }
      if (alt) {
        if (conv === 'o') {
          if (!d.startsWith('0')) d = '0' + d;
        } else if (v !== 0n) {
          prefix = conv === 'x' ? '0x' : '0X';
        }
      }
      body = d;
    } else {
      const x = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      if (Number.isNaN(x)) {
        body = upper ? 'NAN' : 'nan';
        zeroOk = false;
      } else {
        const neg = x < 0 || Object.is(x, -0);
        prefix = signFor(neg);
        const ax = Math.abs(x);
        if (!isFinite(ax)) {
          body = upper ? 'INF' : 'inf';
          zeroOk = false;
        } else if (conv === 'f' || conv === 'F') {
          body = fixed(ax, hasPrec ? prec : 6, alt);
        } else if (conv === 'e' || conv === 'E') {
          const p = hasPrec ? prec : 6;
          const [d, X] = sci(ax, p);
          body = expStyle(d, X, p, alt, upper);
        } else {
          let P = hasPrec ? prec : 6;
          if (P === 0) P = 1;
          const [d, X] = sci(ax, P - 1);
          if (P > X && X >= -4) {
            body = fixed(ax, P - 1 - X, alt);
            if (!alt) body = stripZeros(body);
          } else {
            let mant = d[0] + (P - 1 > 0 || alt ? '.' : '') + d.slice(1);
            if (!alt) mant = stripZeros(mant);
            body = mant + (upper ? 'E' : 'e') + (X < 0 ? '-' : '+') + Math.abs(X).toString().padStart(2, '0');
          }
        }
      }
    }

    const len = prefix.length + body.length;
    if (len < width) {
      const pad = width - len;
      if (left) body = prefix + body + ' '.repeat(pad);
      else if (zero && zeroOk) body = prefix + '0'.repeat(pad) + body;
      else body = ' '.repeat(pad) + prefix + body;
    } else {
      body = prefix + body;
    }
    out += body;
  }
  return out;
}
