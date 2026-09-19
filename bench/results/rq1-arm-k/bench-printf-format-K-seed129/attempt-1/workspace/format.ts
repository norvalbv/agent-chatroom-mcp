function decompose(v: number): [bigint, number] {
  // v finite, >= 0; returns [m, e] with v = m * 2^e
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, v);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (expBits === 0) return [m, -1074];
  m |= 1n << 52n;
  return [m, expBits - 1075];
}

function fraction(v: number): [bigint, bigint] {
  const [m, e] = decompose(v);
  return e >= 0 ? [m << BigInt(e), 1n] : [m, 1n << BigInt(-e)];
}

function roundDiv(num: bigint, den: bigint): bigint {
  const q = num / den;
  const r = num % den;
  const c = 2n * r;
  if (c > den || (c === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

const pow10 = (k: number): bigint => 10n ** BigInt(k);

// round(v * 10^k) exactly, k may be negative
function scaled(v: number, k: number): bigint {
  const [n, d] = fraction(v);
  return k >= 0 ? roundDiv(n * pow10(k), d) : roundDiv(n, d * pow10(-k));
}

function fixedDigits(v: number, prec: number): string {
  let s = scaled(v, prec).toString();
  if (prec > 0) {
    s = s.padStart(prec + 1, '0');
    return s.slice(0, s.length - prec) + '.' + s.slice(s.length - prec);
  }
  return s;
}

// returns [digits (p+1 chars), exponent]
function sciDigits(v: number, p: number): [string, number] {
  if (v === 0) return ['0'.repeat(p + 1), 0];
  const [n, d] = fraction(v);
  let X = Math.floor(Math.log10(v));
  if (!isFinite(X)) X = -324;
  const ge = (x: number) => (x >= 0 ? n >= pow10(x) * d : n * pow10(-x) >= d);
  while (!ge(X)) X--;
  while (ge(X + 1)) X++;
  let dg = scaled(v, p - X);
  if (dg >= pow10(p + 1)) {
    X++;
    dg = scaled(v, p - X);
  }
  return [dg.toString(), X];
}

function sciString(digits: string, X: number, upper: boolean, alt: boolean, strip: boolean): string {
  let frac = digits.slice(1);
  if (strip) frac = frac.replace(/0+$/, '');
  let s = digits[0] + (frac.length > 0 || alt ? '.' : '') + frac;
  const ax = Math.abs(X);
  s += (upper ? 'E' : 'e') + (X < 0 ? '-' : '+') + (ax < 10 ? '0' + ax : String(ax));
  return s;
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let out = '';
  let ai = 0;
  const re = /%([-+ 0#]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc%])/y;
  let i = 0;
  while (i < fmt.length) {
    const pct = fmt.indexOf('%', i);
    if (pct < 0) {
      out += fmt.slice(i);
      break;
    }
    out += fmt.slice(i, pct);
    re.lastIndex = pct;
    const mt = re.exec(fmt);
    if (!mt) {
      out += '%';
      i = pct + 1;
      continue;
    }
    i = re.lastIndex;
    const conv = mt[4];
    if (conv === '%') {
      out += '%';
      continue;
    }
    const flags = mt[1];
    const minus = flags.includes('-');
    const plus = flags.includes('+');
    const space = flags.includes(' ');
    const zero = flags.includes('0') && !minus;
    const alt = flags.includes('#');
    const width = mt[2] ? parseInt(mt[2], 10) : 0;
    const hasPrec = mt[3] !== undefined;
    const prec = hasPrec ? (mt[3] === '' ? 0 : parseInt(mt[3], 10)) : -1;
    const arg = args[ai++];

    let sign = '';
    let body = '';
    let canZero = true;

    if (conv === 's' || conv === 'c') {
      body = String(arg);
      if (conv === 's' && hasPrec) body = body.slice(0, prec);
      canZero = false;
    } else if ('diouxX'.includes(conv)) {
      let v = BigInt(arg as number | bigint);
      if (conv === 'd' || conv === 'i') {
        if (v < 0n) {
          sign = '-';
          v = -v;
        } else sign = plus ? '+' : space ? ' ' : '';
      }
      const radix = conv === 'o' ? 8 : conv === 'd' || conv === 'i' ? 10 : 16;
      let digits = v.toString(radix);
      if (conv === 'X') digits = digits.toUpperCase();
      if (hasPrec) {
        if (prec === 0 && v === 0n) digits = '';
        digits = digits.padStart(prec, '0');
        canZero = false;
      }
      if (alt) {
        if (conv === 'o') {
          if (!digits.startsWith('0')) digits = '0' + digits;
        } else if ((conv === 'x' || conv === 'X') && v !== 0n) {
          sign = conv === 'x' ? '0x' : '0X';
        }
      }
      body = digits;
    } else {
      const num = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      const neg = num < 0 || Object.is(num, -0);
      if (Number.isNaN(num)) {
        body = upper ? 'NAN' : 'nan';
        canZero = false;
      } else {
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        const v = Math.abs(num);
        if (v === Infinity) {
          body = upper ? 'INF' : 'inf';
          canZero = false;
        } else if (conv === 'f' || conv === 'F') {
          const p = hasPrec ? prec : 6;
          body = fixedDigits(v, p);
          if (p === 0 && alt) body += '.';
        } else if (conv === 'e' || conv === 'E') {
          const p = hasPrec ? prec : 6;
          const [dg, X] = sciDigits(v, p);
          body = sciString(dg, X, upper, alt, false);
        } else {
          let P = hasPrec ? prec : 6;
          if (P === 0) P = 1;
          const [dg, X] = sciDigits(v, P - 1);
          if (P > X && X >= -4) {
            body = fixedDigits(v, P - 1 - X);
            if (!alt) {
              if (body.includes('.')) body = body.replace(/0+$/, '').replace(/\.$/, '');
            } else if (!body.includes('.')) body += '.';
          } else {
            body = sciString(dg, X, upper, alt, !alt);
          }
        }
      }
    }

    const len = sign.length + body.length;
    if (len >= width) out += sign + body;
    else if (minus) out += sign + body + ' '.repeat(width - len);
    else if (zero && canZero) out += sign + '0'.repeat(width - len) + body;
    else out += ' '.repeat(width - len) + sign + body;
  }
  return out;
}
