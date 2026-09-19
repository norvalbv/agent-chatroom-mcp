function roundDiv(n: bigint, d: bigint): bigint {
  const q = n / d;
  const r = n % d;
  const t = r * 2n;
  if (t > d || (t === d && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// exact value of positive finite double as num/den
function toFraction(v: number): [bigint, bigint] {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, v);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const be = (hi >>> 20) & 0x7ff;
  let mant = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let exp: number;
  if (be === 0) {
    exp = -1074;
  } else {
    mant |= 1n << 52n;
    exp = be - 1075;
  }
  return exp >= 0 ? [mant << BigInt(exp), 1n] : [mant, 1n << BigInt(-exp)];
}

// round(v * 10^k), half-even, exact
function scaled(v: number, k: number): bigint {
  if (v === 0) return 0n;
  let [n, d] = toFraction(v);
  if (k >= 0) n *= 10n ** BigInt(k);
  else d *= 10n ** BigInt(-k);
  return roundDiv(n, d);
}

function fixedDigits(v: number, prec: number, alt: boolean): string {
  let s = scaled(v, prec).toString();
  if (prec > 0) {
    s = s.padStart(prec + 1, '0');
    s = s.slice(0, s.length - prec) + '.' + s.slice(s.length - prec);
  } else if (alt) s += '.';
  return s;
}

function expParts(v: number, prec: number): { digits: string; exp: number } {
  if (v === 0) return { digits: '0'.repeat(prec + 1), exp: 0 };
  let e = Math.floor(Math.log10(v));
  if (!Number.isFinite(e)) e = 0;
  for (let i = 0; i < 4; i++) {
    const q = scaled(v, prec - e);
    const s = q.toString();
    if (s.length > prec + 1) {
      e++;
    } else if (s.length < prec + 1) {
      e--;
    } else {
      return { digits: s, exp: e };
    }
  }
  // fallback loop (should not be reached)
  for (;;) {
    const s = scaled(v, prec - e).toString();
    if (s.length > prec + 1) e++;
    else if (s.length < prec + 1) e--;
    else return { digits: s, exp: e };
  }
}

function expStr(v: number, prec: number, alt: boolean, upper: boolean): string {
  const { digits, exp } = expParts(v, prec);
  let s = digits[0];
  if (prec > 0) s += '.' + digits.slice(1);
  else if (alt) s += '.';
  const ea = Math.abs(exp).toString().padStart(2, '0');
  return s + (upper ? 'E' : 'e') + (exp < 0 ? '-' : '+') + ea;
}

function stripZeros(s: string): string {
  // s has no exponent
  if (!s.includes('.')) return s;
  return s.replace(/0+$/, '').replace(/\.$/, '');
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let ai = 0;
  const re = /%([-+ 0#]*)(\d*)(\.\d*)?([diouxXeEfFgGsc%])/g;
  return fmt.replace(re, (_m, flags: string, w: string, p: string | undefined, conv: string) => {
    if (conv === '%') return '%';
    const left = flags.includes('-');
    const plus = flags.includes('+');
    const space = flags.includes(' ');
    const zero = flags.includes('0');
    const alt = flags.includes('#');
    const width = w ? parseInt(w, 10) : 0;
    const hasPrec = p !== undefined;
    const prec = hasPrec ? (p!.length > 1 ? parseInt(p!.slice(1), 10) : 0) : -1;
    const arg = args[ai++];

    let sign = '';
    let prefix = '';
    let body = '';
    let zeroOk = zero && !left;

    if (conv === 's' || conv === 'c') {
      let s = String(arg);
      if (conv === 's' && hasPrec) s = s.slice(0, prec);
      body = s;
      zeroOk = false;
    } else if (conv === 'd' || conv === 'i' || conv === 'x' || conv === 'X' || conv === 'o') {
      const b = BigInt(arg as number | bigint);
      const neg = b < 0n;
      const mag = neg ? -b : b;
      let digits: string;
      if (conv === 'd' || conv === 'i') digits = mag.toString();
      else if (conv === 'o') digits = mag.toString(8);
      else digits = mag.toString(16);
      if (conv === 'X') digits = digits.toUpperCase();
      if (hasPrec) {
        if (prec === 0 && mag === 0n) digits = '';
        digits = digits.padStart(prec, '0');
        zeroOk = false;
      }
      if (conv === 'd' || conv === 'i') {
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
      } else if (alt) {
        if (conv === 'o') {
          if (!digits.startsWith('0')) digits = '0' + digits;
        } else if (mag !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      }
      body = digits;
    } else {
      const x = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      if (Number.isNaN(x)) {
        body = upper ? 'NAN' : 'nan';
        zeroOk = false;
      } else {
        const neg = x < 0 || Object.is(x, -0);
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        const v = Math.abs(x);
        if (v === Infinity) {
          body = upper ? 'INF' : 'inf';
          zeroOk = false;
        } else {
          const P = hasPrec ? prec : 6;
          const lc = conv.toLowerCase();
          if (lc === 'f') body = fixedDigits(v, P, alt);
          else if (lc === 'e') body = expStr(v, P, alt, upper);
          else {
            const PP = P === 0 ? 1 : P;
            const X = expParts(v, PP - 1).exp;
            if (PP > X && X >= -4) {
              body = fixedDigits(v, PP - 1 - X, alt);
              if (!alt) body = stripZeros(body);
            } else {
              body = expStr(v, PP - 1, alt, upper);
              if (!alt) {
                const i = body.search(/[eE]/);
                body = stripZeros(body.slice(0, i)) + body.slice(i);
              }
            }
          }
        }
      }
    }

    const len = sign.length + prefix.length + body.length;
    if (len >= width) return sign + prefix + body;
    const pad = width - len;
    if (left) return sign + prefix + body + ' '.repeat(pad);
    if (zeroOk) return sign + prefix + '0'.repeat(pad) + body;
    return ' '.repeat(pad) + sign + prefix + body;
  });
}
