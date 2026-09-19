function roundDiv(n: bigint, d: bigint): bigint {
  const q = n / d;
  const r2 = (n - q * d) * 2n;
  if (r2 > d || (r2 === d && (q & 1n) === 1n)) return q + 1n;
  return q;
}

const p10 = (k: number): bigint => 10n ** BigInt(k);

// exact value of |x| as num/den
function fraction(x: number): [bigint, bigint] {
  x = Math.abs(x);
  if (x === 0) return [0n, 1n];
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, x);
  const bits = buf.getBigUint64(0);
  const expBits = Number((bits >> 52n) & 0x7ffn);
  let mant = bits & ((1n << 52n) - 1n);
  let e: number;
  if (expBits === 0) {
    e = -1074;
  } else {
    mant |= 1n << 52n;
    e = expBits - 1075;
  }
  return e >= 0 ? [mant << BigInt(e), 1n] : [mant, 1n << BigInt(-e)];
}

// round num/den * 10^k to integer
function scaled(num: bigint, den: bigint, k: number): bigint {
  return k >= 0 ? roundDiv(num * p10(k), den) : roundDiv(num, den * p10(-k));
}

function fixedDigits(x: number, prec: number): string {
  const [n, d] = fraction(x);
  let s = scaled(n, d, prec).toString();
  if (prec > 0) {
    s = s.padStart(prec + 1, '0');
    return s.slice(0, s.length - prec) + '.' + s.slice(s.length - prec);
  }
  return s;
}

// returns digit string (prec+1 digits) and decimal exponent
function expDigits(x: number, prec: number): [string, number] {
  const [n, d] = fraction(x);
  if (n === 0n) return ['0'.repeat(prec + 1), 0];
  // find e with 10^e <= v < 10^(e+1)
  let e = Math.floor(Math.log10(Math.abs(x)));
  if (!Number.isFinite(e)) e = 0;
  const ge = (k: number): boolean => (k >= 0 ? n >= d * p10(k) : n * p10(-k) >= d);
  while (!ge(e)) e--;
  while (ge(e + 1)) e++;
  let m = scaled(n, d, prec - e);
  if (m >= p10(prec + 1)) {
    e++;
    m = scaled(n, d, prec - e);
  }
  return [m.toString(), e];
}

function expText(digits: string, e: number, prec: number, alt: boolean, upper: boolean): string {
  let mant = digits[0];
  if (prec > 0) mant += '.' + digits.slice(1);
  else if (alt) mant += '.';
  return mant + (upper ? 'E' : 'e') + (e < 0 ? '-' : '+') + String(Math.abs(e)).padStart(2, '0');
}

function stripZeros(s: string): string {
  if (!s.includes('.')) return s;
  return s.replace(/0+$/, '').replace(/\.$/, '');
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let ai = 0;
  return fmt.replace(/%([-+ 0#]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc%])/g, (_m, flags: string, w: string, p: string | undefined, conv: string) => {
    if (conv === '%') return '%';
    const minus = flags.includes('-');
    const plus = flags.includes('+');
    const space = flags.includes(' ');
    const zero = flags.includes('0') && !minus;
    const alt = flags.includes('#');
    const width = w ? Number(w) : 0;
    const prec = p !== undefined ? Number(p || 0) : undefined;
    const arg = args[ai++];

    const pad = (prefix: string, body: string, zeroOk: boolean): string => {
      const len = prefix.length + body.length;
      if (len >= width) return prefix + body;
      const fill = width - len;
      if (minus) return prefix + body + ' '.repeat(fill);
      if (zero && zeroOk) return prefix + '0'.repeat(fill) + body;
      return ' '.repeat(fill) + prefix + body;
    };

    if (conv === 's' || conv === 'c') {
      let s = String(arg);
      if (conv === 's' && prec !== undefined) s = s.slice(0, prec);
      return pad('', s, false);
    }

    if (conv === 'd' || conv === 'i') {
      const v = BigInt(arg as number | bigint);
      const neg = v < 0n;
      let digits = (neg ? -v : v).toString();
      if (prec !== undefined) {
        if (prec === 0 && v === 0n) digits = '';
        digits = digits.padStart(prec, '0');
      }
      const sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
      return pad(sign, digits, prec === undefined);
    }

    if (conv === 'x' || conv === 'X' || conv === 'o') {
      const v = BigInt(arg as number | bigint);
      let digits = v.toString(conv === 'o' ? 8 : 16);
      if (conv === 'X') digits = digits.toUpperCase();
      if (prec !== undefined) {
        if (prec === 0 && v === 0n) digits = '';
        digits = digits.padStart(prec, '0');
      }
      let prefix = '';
      if (alt) {
        if (conv === 'o') {
          if (digits[0] !== '0') digits = '0' + digits;
        } else if (v !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      }
      return pad(prefix, digits, prec === undefined);
    }

    // floating point
    const x = arg as number;
    const upper = conv === 'E' || conv === 'F' || conv === 'G';
    const neg = x < 0 || Object.is(x, -0);
    const sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
    if (!Number.isFinite(x)) {
      if (Number.isNaN(x)) return pad('', upper ? 'NAN' : 'nan', false);
      return pad(sign, upper ? 'INF' : 'inf', false);
    }
    const lc = conv.toLowerCase();
    let body: string;
    if (lc === 'f') {
      const pr = prec ?? 6;
      body = fixedDigits(x, pr);
      if (pr === 0 && alt) body += '.';
    } else if (lc === 'e') {
      const pr = prec ?? 6;
      const [dg, e] = expDigits(x, pr);
      body = expText(dg, e, pr, alt, upper);
    } else {
      const P = prec === undefined ? 6 : prec === 0 ? 1 : prec;
      const [dg, X] = expDigits(x, P - 1);
      if (P > X && X >= -4) {
        const pr = P - 1 - X;
        body = fixedDigits(x, pr);
        if (pr === 0 && alt) body += '.';
        if (!alt) body = stripZeros(body);
      } else {
        let mant = dg[0];
        if (P - 1 > 0) mant += '.' + dg.slice(1);
        else if (alt) mant += '.';
        if (!alt) mant = stripZeros(mant);
        body = mant + (upper ? 'E' : 'e') + (X < 0 ? '-' : '+') + String(Math.abs(X)).padStart(2, '0');
      }
    }
    return pad(sign, body, true);
  });
}
