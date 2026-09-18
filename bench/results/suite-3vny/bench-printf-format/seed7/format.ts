function rational(x: number): [bigint, bigint] {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, Math.abs(x));
  const bits = dv.getBigUint64(0);
  const ex = Number((bits >> 52n) & 0x7ffn);
  const frac = bits & 0xfffffffffffffn;
  if (ex === 0) return [frac, 1n << 1074n];
  const m = frac | (1n << 52n);
  const e = ex - 1075;
  return e >= 0 ? [m << BigInt(e), 1n] : [m, 1n << BigInt(-e)];
}

function roundDiv(n: bigint, d: bigint): bigint {
  const q = n / d;
  const r2 = (n % d) * 2n;
  if (r2 > d || (r2 === d && (q & 1n) === 1n)) return q + 1n;
  return q;
}

const p10 = (k: number) => 10n ** BigInt(k);

// digits of |x| rounded to p fractional digits, as [intPart, fracPart]
function fixedParts(x: number, p: number): [string, string] {
  const [n, d] = rational(x);
  let s = roundDiv(n * p10(p), d).toString();
  if (s.length <= p) s = '0'.repeat(p + 1 - s.length) + s;
  return [s.slice(0, s.length - p), s.slice(s.length - p)];
}

// p+1 significant digits and decimal exponent
function expParts(x: number, p: number): [string, number] {
  if (x === 0) return ['0'.repeat(p + 1), 0];
  const [n, d] = rational(x);
  let e = Math.floor(Math.log10(Math.abs(x)));
  if (!isFinite(e)) e = 0;
  // adjust exactly so 10^e <= n/d < 10^(e+1)
  const ge = (k: number) => (k >= 0 ? n >= d * p10(k) : n * p10(-k) >= d);
  while (!ge(e)) e--;
  while (ge(e + 1)) e++;
  const digits = (ee: number) => {
    const k = ee - p;
    return k >= 0 ? roundDiv(n, d * p10(k)) : roundDiv(n * p10(-k), d);
  };
  let q = digits(e);
  if (q >= p10(p + 1)) {
    e++;
    q = digits(e);
  }
  return [q.toString(), e];
}

function expStr(e: number, upper: boolean): string {
  const a = Math.abs(e);
  return (upper ? 'E' : 'e') + (e < 0 ? '-' : '+') + (a < 10 ? '0' : '') + a;
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let out = '';
  let ai = 0;
  const re = /%(?:(%)|([-+ 0#]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc]))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(fmt))) {
    out += fmt.slice(last, m.index);
    last = m.index + m[0].length;
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
    } else if ('dixXo'.includes(conv)) {
      const v = BigInt(arg as number | bigint);
      const neg = v < 0n;
      const mag = neg ? -v : v;
      sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
      if (conv === 'd' || conv === 'i') body = mag.toString();
      else if (conv === 'o') body = mag.toString(8);
      else body = mag.toString(16);
      if (conv === 'X') body = body.toUpperCase();
      if (mag === 0n && hasPrec && prec === 0) body = '';
      if (hasPrec && body.length < prec) body = '0'.repeat(prec - body.length) + body;
      if (alt) {
        if (conv === 'o') {
          if (!body.startsWith('0')) body = '0' + body;
        } else if ((conv === 'x' || conv === 'X') && mag !== 0n) {
          prefix = conv === 'x' ? '0x' : '0X';
        }
      }
      if (hasPrec) canZero = false;
    } else {
      const x = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      const lc = conv.toLowerCase();
      if (Number.isNaN(x)) {
        body = upper ? 'NAN' : 'nan';
        canZero = false;
      } else {
        const neg = x < 0 || Object.is(x, -0);
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        if (!isFinite(x)) {
          body = upper ? 'INF' : 'inf';
          canZero = false;
        } else {
          const fixed = (p: number) => {
            const [i, f] = fixedParts(x, p);
            return i + (p > 0 || alt ? '.' : '') + f;
          };
          const expo = (p: number) => {
            const [ds, e] = expParts(x, p);
            return ds[0] + (p > 0 || alt ? '.' : '') + ds.slice(1) + expStr(e, upper);
          };
          const strip = (s: string) => {
            if (alt) return s;
            const ei = s.search(/[eE]/);
            let mant = ei >= 0 ? s.slice(0, ei) : s;
            const rest = ei >= 0 ? s.slice(ei) : '';
            if (mant.includes('.')) mant = mant.replace(/0+$/, '').replace(/\.$/, '');
            return mant + rest;
          };
          if (lc === 'f') body = fixed(prec < 0 ? 6 : prec);
          else if (lc === 'e') body = expo(prec < 0 ? 6 : prec);
          else {
            let P = prec < 0 ? 6 : prec;
            if (P === 0) P = 1;
            const X = expParts(x, P - 1)[1];
            if (P > X && X >= -4) body = strip(fixed(P - 1 - X));
            else body = strip(expo(P - 1));
          }
        }
      }
    }

    const len = sign.length + prefix.length + body.length;
    if (len < width) {
      const pad = width - len;
      if (left) body = sign + prefix + body + ' '.repeat(pad);
      else if (canZero) body = sign + prefix + '0'.repeat(pad) + body;
      else body = ' '.repeat(pad) + sign + prefix + body;
    } else body = sign + prefix + body;
    out += body;
  }
  return out + fmt.slice(last);
}
