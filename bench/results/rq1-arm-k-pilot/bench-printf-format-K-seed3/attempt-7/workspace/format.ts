// Exact decimal expansion of a finite non-negative double: value = ds * 10^-k.
function exact(x: number): { ds: string; k: number } {
  if (x === 0) return { ds: '0', k: 0 };
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, x);
  const hi = buf.getUint32(0);
  const lo = buf.getUint32(4);
  const be = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let e: number;
  if (be === 0) e = -1074;
  else {
    m |= 1n << 52n;
    e = be - 1075;
  }
  if (e >= 0) return { ds: (m << BigInt(e)).toString(), k: 0 };
  const k = -e;
  return { ds: (m * 5n ** BigInt(k)).toString(), k };
}

// Round the digit string dropping `drop` trailing digits, half-even.
function dropDigits(ds: string, drop: number): string {
  if (drop <= 0) return ds + '0'.repeat(-drop);
  if (drop > ds.length) {
    // value < 0.5 unit
    return '0';
  }
  const keep = ds.slice(0, ds.length - drop) || '0';
  const rest = ds.slice(ds.length - drop);
  const half = '5' + '0'.repeat(drop - 1);
  let n = BigInt(keep);
  if (rest > half || (rest === half && n % 2n === 1n)) n += 1n;
  return n.toString();
}

function fixedDigits(x: number, p: number): { int: string; frac: string } {
  const { ds, k } = exact(x);
  let r = dropDigits(ds, k - p);
  if (r.length < p + 1) r = '0'.repeat(p + 1 - r.length) + r;
  return { int: r.slice(0, r.length - p), frac: r.slice(r.length - p) };
}

function sigDigits(x: number, n: number): { digits: string; X: number } {
  if (x === 0) return { digits: '0'.repeat(n), X: 0 };
  const { ds, k } = exact(x);
  let X = ds.length - 1 - k;
  let r = dropDigits(ds, ds.length - n);
  if (r.length > n) {
    r = r.slice(0, n);
    X++;
  }
  return { digits: r, X };
}

function expStyle(x: number, p: number, upper: boolean, alt: boolean): string {
  const { digits, X } = sigDigits(x, p + 1);
  const a = Math.abs(X);
  const ex = (X < 0 ? '-' : '+') + (a < 10 ? '0' : '') + a;
  const mant = digits[0] + (p > 0 || alt ? '.' : '') + digits.slice(1);
  return mant + (upper ? 'E' : 'e') + ex;
}

function fixedStyle(x: number, p: number, alt: boolean): string {
  const { int, frac } = fixedDigits(x, p);
  return int + (p > 0 || alt ? '.' : '') + frac;
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
    let body = '';
    let canZero = true;

    if (conv === 's' || conv === 'c') {
      let s = String(arg);
      if (conv === 's' && hasPrec) s = s.slice(0, prec);
      body = s;
      canZero = false;
    } else if ('diuxXo'.includes(conv)) {
      let v = BigInt(arg as number | bigint);
      if (conv === 'd' || conv === 'i' || conv === 'u') {
        if (v < 0n) {
          sign = '-';
          v = -v;
        } else sign = plus ? '+' : space ? ' ' : '';
      }
      let digits = conv === 'x' ? v.toString(16) : conv === 'X' ? v.toString(16).toUpperCase() : conv === 'o' ? v.toString(8) : v.toString();
      if (hasPrec) {
        if (prec === 0 && v === 0n) digits = '';
        else if (digits.length < prec) digits = '0'.repeat(prec - digits.length) + digits;
        canZero = false;
      }
      if (conv === 'o' && alt && digits[0] !== '0') digits = '0' + digits;
      if ((conv === 'x' || conv === 'X') && alt && v !== 0n) sign = conv === 'x' ? '0x' : '0X';
      body = digits;
    } else {
      const x = arg as number;
      const neg = x < 0 || Object.is(x, -0);
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
      if (Number.isNaN(x)) {
        sign = '';
        body = upper ? 'NAN' : 'nan';
        canZero = false;
      } else if (!Number.isFinite(x)) {
        body = upper ? 'INF' : 'inf';
        canZero = false;
      } else {
        const ax = Math.abs(x);
        const lc = conv.toLowerCase();
        if (lc === 'e') body = expStyle(ax, hasPrec ? prec : 6, upper, alt);
        else if (lc === 'f') body = fixedStyle(ax, hasPrec ? prec : 6, alt);
        else {
          const P = hasPrec ? (prec === 0 ? 1 : prec) : 6;
          const { X } = sigDigits(ax, P);
          if (P > X && X >= -4) body = fixedStyle(ax, P - 1 - X, alt);
          else body = expStyle(ax, P - 1, upper, alt);
          if (!alt) {
            const ei = body.search(/[eE]/);
            let mant = ei < 0 ? body : body.slice(0, ei);
            const tail = ei < 0 ? '' : body.slice(ei);
            if (mant.includes('.')) mant = mant.replace(/0+$/, '').replace(/\.$/, '');
            body = mant + tail;
          }
        }
      }
    }

    const len = sign.length + body.length;
    if (len < width) {
      const pad = width - len;
      if (minus) out += sign + body + ' '.repeat(pad);
      else if (zero && canZero) out += sign + '0'.repeat(pad) + body;
      else out += ' '.repeat(pad) + sign + body;
    } else out += sign + body;
  }
  return out;
}
