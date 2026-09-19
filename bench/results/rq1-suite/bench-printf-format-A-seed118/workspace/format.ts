const pow10 = (n: number): bigint => 10n ** BigInt(n);

// Exact rational of |v| (finite): num/den.
function toRational(v: number): [bigint, bigint] {
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, Math.abs(v));
  const hi = buf.getUint32(0);
  const lo = buf.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  let mant = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let e: number;
  if (expBits === 0) e = -1074;
  else {
    mant |= 1n << 52n;
    e = expBits - 1075;
  }
  return e >= 0 ? [mant << BigInt(e), 1n] : [mant, 1n << BigInt(-e)];
}

// round(num/den) half-even
function divRound(num: bigint, den: bigint): bigint {
  const q = num / den;
  const r = num % den;
  const c = 2n * r;
  if (c > den || (c === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

function fixedDigits(v: number, prec: number): string {
  const [n, d] = toRational(v);
  let s = divRound(n * pow10(prec), d).toString();
  if (prec > 0) {
    s = s.padStart(prec + 1, '0');
    return s.slice(0, s.length - prec) + '.' + s.slice(s.length - prec);
  }
  return s;
}

// returns [digits string of prec+1 digits, exponent]
function sciParts(v: number, prec: number): [string, number] {
  if (v === 0) return ['0'.repeat(prec + 1), 0];
  const [n, d] = toRational(v);
  let X = Math.floor(Math.log10(Math.abs(v)));
  if (!isFinite(X)) X = 0;
  // adjust so 10^X <= v < 10^(X+1)
  const ge = (x: number) => (x >= 0 ? n >= d * pow10(x) : n * pow10(-x) >= d);
  while (!ge(X)) X--;
  while (ge(X + 1)) X++;
  const scale = (x: number) => {
    const k = x - prec;
    return k >= 0 ? divRound(n, d * pow10(k)) : divRound(n * pow10(-k), d);
  };
  let digits = scale(X);
  if (digits >= pow10(prec + 1)) {
    X++;
    digits = scale(X);
  }
  return [digits.toString(), X];
}

function expStr(X: number, upper: boolean): string {
  const a = Math.abs(X).toString().padStart(2, '0');
  return (upper ? 'E' : 'e') + (X < 0 ? '-' : '+') + a;
}

function sciStr(v: number, prec: number, alt: boolean, upper: boolean): string {
  const [dg, X] = sciParts(v, prec);
  let m = dg[0];
  if (prec > 0) m += '.' + dg.slice(1);
  else if (alt) m += '.';
  return m + expStr(X, upper);
}

function stripZeros(s: string): string {
  if (!s.includes('.')) return s;
  return s.replace(/0+$/, '').replace(/\.$/, '');
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let out = '';
  let ai = 0;
  const re = /%([-+ 0#]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc%])/y;
  let i = 0;
  while (i < fmt.length) {
    const p = fmt.indexOf('%', i);
    if (p < 0) {
      out += fmt.slice(i);
      break;
    }
    out += fmt.slice(i, p);
    re.lastIndex = p;
    const m = re.exec(fmt);
    if (!m) {
      out += '%';
      i = p + 1;
      continue;
    }
    i = re.lastIndex;
    const conv = m[4];
    if (conv === '%') {
      out += '%';
      continue;
    }
    const flags = m[1];
    const left = flags.includes('-');
    const plus = flags.includes('+');
    const space = flags.includes(' ');
    const zero = flags.includes('0');
    const alt = flags.includes('#');
    const width = m[2] ? parseInt(m[2], 10) : 0;
    const hasPrec = m[3] !== undefined;
    const prec = hasPrec ? (m[3] === '' ? 0 : parseInt(m[3], 10)) : -1;
    const arg = args[ai++];

    let sign = '';
    let prefix = '';
    let body = '';
    let canZero = false;

    if (conv === 's' || conv === 'c') {
      body = String(arg);
      if (conv === 's' && hasPrec) body = body.slice(0, prec);
    } else if ('dixXo'.includes(conv)) {
      let v = typeof arg === 'bigint' ? arg : BigInt(arg as number);
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
      }
      if (alt) {
        if (conv === 'o') {
          if (!digits.startsWith('0')) digits = '0' + digits;
        } else if ((conv === 'x' || conv === 'X') && v !== 0n) {
          prefix = conv === 'x' ? '0x' : '0X';
        }
      }
      body = digits;
      canZero = !hasPrec;
    } else {
      const v = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      const neg = v < 0 || Object.is(v, -0);
      if (Number.isNaN(v)) sign = '';
      else sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
      if (Number.isNaN(v)) body = upper ? 'NAN' : 'nan';
      else if (!Number.isFinite(v)) body = upper ? 'INF' : 'inf';
      else {
        canZero = true;
        const lc = conv.toLowerCase();
        const P = hasPrec ? prec : 6;
        if (lc === 'f') {
          body = fixedDigits(v, P);
          if (P === 0 && alt) body += '.';
        } else if (lc === 'e') {
          body = sciStr(v, P, alt, upper);
        } else {
          const PP = P === 0 ? 1 : P;
          const [, X] = sciParts(v, PP - 1);
          if (PP > X && X >= -4) {
            body = fixedDigits(v, PP - 1 - X);
            if (alt && !body.includes('.')) body += '.';
            if (!alt) body = stripZeros(body);
          } else {
            const [dg, XX] = sciParts(v, PP - 1);
            let mant = dg[0] + (PP > 1 ? '.' + dg.slice(1) : '');
            if (alt && PP === 1) mant += '.';
            if (!alt) mant = stripZeros(mant);
            body = mant + expStr(XX, upper);
          }
        }
      }
    }

    let len = sign.length + prefix.length + body.length;
    if (len < width) {
      const pad = width - len;
      if (left) body = body + ' '.repeat(pad);
      else if (zero && canZero) body = '0'.repeat(pad) + body;
      else sign = ' '.repeat(pad) + sign;
    }
    out += sign + prefix + body;
  }
  return out;
}
