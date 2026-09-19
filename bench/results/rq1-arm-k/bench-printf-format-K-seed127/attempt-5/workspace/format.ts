function pow10(n: number): bigint {
  return 10n ** BigInt(n);
}

// exact rational for a finite non-negative double
function exact(x: number): { num: bigint; den: bigint } {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const eb = (hi >>> 20) & 0x7ff;
  const frac = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let m: bigint;
  let k: number;
  if (eb === 0) {
    m = frac;
    k = -1074;
  } else {
    m = frac | (1n << 52n);
    k = eb - 1075;
  }
  return k >= 0 ? { num: m << BigInt(k), den: 1n } : { num: m, den: 1n << BigInt(-k) };
}

function roundDiv(n: bigint, d: bigint): bigint {
  const q = n / d;
  const r2 = (n - q * d) * 2n;
  if (r2 > d || (r2 === d && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// round(x * 10^s) half-even
function scaled(r: { num: bigint; den: bigint }, s: number): bigint {
  return s >= 0 ? roundDiv(r.num * pow10(s), r.den) : roundDiv(r.num, r.den * pow10(-s));
}

function fixedDigits(x: number, prec: number, alt: boolean): string {
  const N = scaled(exact(x), prec);
  let s = N.toString();
  if (prec > 0) {
    s = s.padStart(prec + 1, '0');
    return s.slice(0, s.length - prec) + '.' + s.slice(s.length - prec);
  }
  return alt ? s + '.' : s;
}

// returns digit string of prec+1 digits and decimal exponent
function expParts(x: number, prec: number): { digits: string; e: number } {
  if (x === 0) return { digits: '0'.repeat(prec + 1), e: 0 };
  const r = exact(x);
  let e = Math.floor(Math.log10(x));
  if (!isFinite(e)) e = 0;
  // adjust so that 10^e <= x < 10^(e+1)
  const ge = (ex: number) =>
    ex >= 0 ? r.num >= r.den * pow10(ex) : r.num * pow10(-ex) >= r.den;
  while (!ge(e)) e--;
  while (ge(e + 1)) e++;
  let N = scaled(r, prec - e);
  if (N === pow10(prec + 1)) {
    e++;
    N = pow10(prec);
  }
  return { digits: N.toString(), e };
}

function expStr(digits: string, e: number, upper: boolean, alt: boolean): string {
  let s = digits[0];
  if (digits.length > 1) s += '.' + digits.slice(1);
  else if (alt) s += '.';
  const ae = Math.abs(e);
  return s + (upper ? 'E' : 'e') + (e < 0 ? '-' : '+') + (ae < 10 ? '0' : '') + ae;
}

function stripZeros(s: string): string {
  if (!s.includes('.')) return s;
  return s.replace(/0+$/, '').replace(/\.$/, '');
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let ai = 0;
  const re = /%([-+ 0#]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc%])/g;
  return fmt.replace(re, (_m, flags: string, w: string, p: string | undefined, conv: string) => {
    if (conv === '%') return '%';
    const left = flags.includes('-');
    const plus = flags.includes('+');
    const space = flags.includes(' ');
    const zero = flags.includes('0') && !left;
    const alt = flags.includes('#');
    const width = w ? parseInt(w, 10) : 0;
    const hasPrec = p !== undefined;
    const prec = hasPrec ? (p === '' ? 0 : parseInt(p, 10)) : -1;
    const arg = args[ai++];

    const pad = (text: string): string =>
      text.length >= width ? text : left ? text.padEnd(width) : text.padStart(width);
    const padNum = (sign: string, digits: string, allowZero: boolean): string => {
      const len = sign.length + digits.length;
      if (len >= width) return sign + digits;
      if (left) return (sign + digits).padEnd(width);
      if (zero && allowZero) return sign + '0'.repeat(width - len) + digits;
      return (sign + digits).padStart(width);
    };

    if (conv === 's') {
      let s = String(arg);
      if (hasPrec) s = s.slice(0, prec);
      return pad(s);
    }
    if (conv === 'c') return pad(String(arg));

    if ('diouxX'.includes(conv)) {
      let v = BigInt(arg as number | bigint);
      let sign = '';
      if (conv === 'd' || conv === 'i') {
        if (v < 0n) {
          sign = '-';
          v = -v;
        } else sign = plus ? '+' : space ? ' ' : '';
      }
      let digits = conv === 'o' ? v.toString(8) : conv === 'x' ? v.toString(16) : conv === 'X' ? v.toString(16).toUpperCase() : v.toString();
      if (hasPrec) {
        if (prec === 0 && v === 0n) digits = '';
        digits = digits.padStart(prec, '0');
      }
      if (alt) {
        if (conv === 'o') {
          if (digits[0] !== '0') digits = '0' + digits;
        } else if ((conv === 'x' || conv === 'X') && v !== 0n) {
          sign += conv === 'x' ? '0x' : '0X';
        }
      }
      return padNum(sign, digits, !hasPrec);
    }

    // floating point
    const x = arg as number;
    const upper = conv === 'E' || conv === 'F' || conv === 'G';
    const neg = x < 0 || Object.is(x, -0);
    let sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
    if (Number.isNaN(x)) {
      return pad(upper ? 'NAN' : 'nan');
    }
    if (!isFinite(x)) {
      const t = upper ? 'INF' : 'inf';
      return pad(sign + t);
    }
    const ax = Math.abs(x);
    const P = hasPrec ? prec : 6;
    const lc = conv.toLowerCase();
    let body: string;
    if (lc === 'f') {
      body = fixedDigits(ax, P, alt);
    } else if (lc === 'e') {
      const { digits, e } = expParts(ax, P);
      body = expStr(digits, e, upper, alt);
    } else {
      const G = P === 0 ? 1 : P;
      const { digits, e } = expParts(ax, G - 1);
      if (G > e && e >= -4) {
        body = fixedDigits(ax, G - 1 - e, alt);
        if (!alt) body = stripZeros(body);
      } else {
        let s = expStr(digits, e, upper, alt);
        if (!alt) {
          const idx = s.search(/[eE]/);
          s = stripZeros(s.slice(0, idx)) + s.slice(idx);
        }
        body = s;
      }
    }
    return padNum(sign, body, true);
  });
}
