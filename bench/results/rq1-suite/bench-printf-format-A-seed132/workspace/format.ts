const TEN = 10n;
const pow10 = (n: number): bigint => TEN ** BigInt(n);

function roundDiv(a: bigint, b: bigint): bigint {
  const q = a / b;
  const r2 = (a % b) * 2n;
  if (r2 > b || (r2 === b && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// exact fraction num/den of a finite non-negative double
function fraction(x: number): [bigint, bigint] {
  if (x === 0) return [0n, 1n];
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, x);
  const bits = buf.getBigUint64(0);
  const expBits = Number((bits >> 52n) & 0x7ffn);
  let mant = bits & ((1n << 52n) - 1n);
  let e: number;
  if (expBits === 0) e = -1074;
  else {
    mant |= 1n << 52n;
    e = expBits - 1075;
  }
  return e >= 0 ? [mant << BigInt(e), 1n] : [mant, 1n << BigInt(-e)];
}

// digits after rounding x to p decimals: returns [intPart, frac]
function fixed(x: number, p: number): [string, string] {
  const [num, den] = fraction(x);
  const n = roundDiv(num * pow10(p), den);
  const s = n.toString().padStart(p + 1, '0');
  return [s.slice(0, s.length - p), s.slice(s.length - p)];
}

// scientific: returns [digits (p+1 chars), exponent]
function sci(x: number, p: number): [string, number] {
  if (x === 0) return ['0'.repeat(p + 1), 0];
  const [num, den] = fraction(x);
  let e = Math.floor(Math.log10(x));
  if (!Number.isFinite(e)) e = -324;
  const ge = (k: number) => num * pow10(Math.max(0, -k)) >= den * pow10(Math.max(0, k));
  while (!ge(e)) e--;
  while (ge(e + 1)) e++;
  const sh = p - e;
  let n = roundDiv(num * pow10(Math.max(0, sh)), den * pow10(Math.max(0, -sh)));
  if (n >= pow10(p + 1)) {
    e++;
    n /= TEN;
  }
  return [n.toString(), e];
}

function expStr(e: number, upper: boolean): string {
  const a = Math.abs(e).toString().padStart(2, '0');
  return (upper ? 'E' : 'e') + (e < 0 ? '-' : '+') + a;
}

function stripZeros(s: string): string {
  if (!s.includes('.')) return s;
  return s.replace(/0+$/, '').replace(/\.$/, '');
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let out = '';
  let ai = 0;
  const re = /%(?:(%)|([-+ 0#]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc]))/y;
  let i = 0;
  while (i < fmt.length) {
    const c = fmt[i];
    if (c !== '%') {
      out += c;
      i++;
      continue;
    }
    re.lastIndex = i;
    const m = re.exec(fmt);
    if (!m) {
      out += c;
      i++;
      continue;
    }
    i = re.lastIndex;
    if (m[1]) {
      out += '%';
      continue;
    }
    const flags = m[2];
    const left = flags.includes('-');
    const plus = flags.includes('+');
    const space = flags.includes(' ');
    const zero = flags.includes('0');
    const alt = flags.includes('#');
    const width = m[3] ? parseInt(m[3], 10) : 0;
    const hasPrec = m[4] !== undefined;
    const prec = hasPrec ? (m[4] === '' ? 0 : parseInt(m[4], 10)) : -1;
    const conv = m[5];
    const arg = args[ai++];

    let sign = '';
    let prefix = '';
    let body = '';
    let canZero = zero && !left;

    if (conv === 's' || conv === 'c') {
      body = String(arg);
      if (conv === 's' && hasPrec) body = body.slice(0, prec);
      canZero = false;
    } else if ('diouxX'.includes(conv)) {
      const v = BigInt(arg as number | bigint);
      const neg = v < 0n;
      const mag = neg ? -v : v;
      let digits: string;
      if (conv === 'd' || conv === 'i') digits = mag.toString();
      else if (conv === 'o') digits = mag.toString(8);
      else digits = mag.toString(16);
      if (conv === 'X') digits = digits.toUpperCase();
      if (hasPrec && prec === 0 && mag === 0n) digits = '';
      if (hasPrec && digits.length < prec) digits = digits.padStart(prec, '0');
      if (conv === 'd' || conv === 'i') {
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
      } else if (alt) {
        if (conv === 'o') {
          if (!digits.startsWith('0')) digits = '0' + digits;
        } else if (mag !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      }
      if (hasPrec) canZero = false;
      body = digits;
    } else {
      const v = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      const neg = v < 0 || Object.is(v, -0);
      if (Number.isNaN(v)) {
        body = upper ? 'NAN' : 'nan';
        canZero = false;
      } else {
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        const x = Math.abs(v);
        if (x === Infinity) {
          body = upper ? 'INF' : 'inf';
          canZero = false;
        } else {
          const lc = conv.toLowerCase();
          const p = hasPrec ? prec : 6;
          if (lc === 'f') {
            const [ip, fp] = fixed(x, p);
            body = ip + (p > 0 || alt ? '.' : '') + fp;
          } else if (lc === 'e') {
            const [d, e] = sci(x, p);
            body = d[0] + (p > 0 || alt ? '.' : '') + d.slice(1) + expStr(e, upper);
          } else {
            const P = p === 0 ? 1 : p;
            const [d, X] = sci(x, P - 1);
            if (P > X && X >= -4) {
              const [ip, fp] = fixed(x, P - 1 - X);
              body = ip + (fp.length > 0 || alt ? '.' : '') + fp;
              if (!alt) body = stripZeros(body);
            } else {
              let mant = d[0] + (P - 1 > 0 || alt ? '.' : '') + d.slice(1);
              if (!alt) mant = stripZeros(mant);
              body = mant + expStr(X, upper);
            }
          }
        }
      }
    }

    const len = sign.length + prefix.length + body.length;
    if (len >= width) out += sign + prefix + body;
    else if (left) out += sign + prefix + body + ' '.repeat(width - len);
    else if (canZero) out += sign + prefix + '0'.repeat(width - len) + body;
    else out += ' '.repeat(width - len) + sign + prefix + body;
  }
  return out;
}
