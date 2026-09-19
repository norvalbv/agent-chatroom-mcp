const pow10 = (n: number): bigint => 10n ** BigInt(n);

function toRational(v: number): [bigint, bigint] {
  const f = new Float64Array(1);
  const u = new BigUint64Array(f.buffer);
  f[0] = Math.abs(v);
  const bits = u[0];
  const expBits = Number((bits >> 52n) & 0x7ffn);
  const frac = bits & ((1n << 52n) - 1n);
  let m: bigint;
  let e: number;
  if (expBits === 0) {
    m = frac;
    e = -1074;
  } else {
    m = frac | (1n << 52n);
    e = expBits - 1075;
  }
  return e >= 0 ? [m << BigInt(e), 1n] : [m, 1n << BigInt(-e)];
}

// round(num/den) half-to-even
function roundDiv(num: bigint, den: bigint): bigint {
  const q = num / den;
  const r = num % den;
  const c = 2n * r;
  if (c > den || (c === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

function fixed(num: bigint, den: bigint, p: number, alt: boolean): string {
  let s = roundDiv(num * pow10(p), den).toString();
  if (s.length < p + 1) s = '0'.repeat(p + 1 - s.length) + s;
  const ip = s.slice(0, s.length - p);
  const fp = s.slice(s.length - p);
  return p > 0 ? ip + '.' + fp : alt ? ip + '.' : ip;
}

// returns digit string of length p+1 and decimal exponent
function sci(num: bigint, den: bigint, p: number): [string, number] {
  if (num === 0n) return ['0'.repeat(p + 1), 0];
  let x = Math.floor(Math.log10(Number(num) / Number(den)));
  if (!Number.isFinite(x)) x = 0;
  // fix estimate so that 10^x <= v < 10^(x+1)
  const ge = (k: number) => (k >= 0 ? num >= den * pow10(k) : num * pow10(-k) >= den);
  while (!ge(x)) x--;
  while (ge(x + 1)) x++;
  for (;;) {
    const a = p - x;
    const d = a >= 0 ? roundDiv(num * pow10(a), den) : roundDiv(num, den * pow10(-a));
    const s = d.toString();
    if (s.length > p + 1) {
      x++;
      continue;
    }
    return [s, x];
  }
}

function expStr(x: number, upper: boolean): string {
  const a = Math.abs(x).toString().padStart(2, '0');
  return (upper ? 'E' : 'e') + (x < 0 ? '-' : '+') + a;
}

function sciText(digits: string, x: number, p: number, alt: boolean, upper: boolean): string {
  const mant = digits[0] + (p > 0 ? '.' + digits.slice(1) : alt ? '.' : '');
  return mant + expStr(x, upper);
}

function stripZeros(s: string): string {
  if (!s.includes('.')) return s;
  return s.replace(/0+$/, '').replace(/\.$/, '');
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let ai = 0;
  const re = /%([-+ 0#]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGscp%])/g;
  return fmt.replace(re, (_m, flags: string, w: string, pr: string | undefined, conv: string) => {
    if (conv === '%') return '%';
    const left = flags.includes('-');
    const plus = flags.includes('+');
    const space = flags.includes(' ');
    const zero = flags.includes('0');
    const alt = flags.includes('#');
    const width = w ? parseInt(w, 10) : 0;
    const hasPrec = pr !== undefined;
    const prec = hasPrec ? (pr === '' ? 0 : parseInt(pr, 10)) : -1;
    const arg = args[ai++];

    let sign = '';
    let prefix = '';
    let body: string;
    let canZero = zero && !left;

    if (conv === 's' || conv === 'c') {
      body = String(arg);
      if (conv === 's' && hasPrec) body = body.slice(0, prec);
      canZero = false;
    } else if ('diouxX'.includes(conv)) {
      let n = BigInt(arg as number | bigint);
      const neg = n < 0n;
      if (neg) n = -n;
      if (conv === 'd' || conv === 'i') sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
      let digits = conv === 'o' ? n.toString(8) : conv === 'x' ? n.toString(16) : conv === 'X' ? n.toString(16).toUpperCase() : n.toString();
      if (hasPrec) {
        if (prec === 0 && n === 0n) digits = '';
        if (digits.length < prec) digits = '0'.repeat(prec - digits.length) + digits;
        canZero = false;
      }
      if (alt) {
        if (conv === 'o' && digits[0] !== '0') digits = '0' + digits;
        if ((conv === 'x' || conv === 'X') && n !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      }
      body = digits;
    } else {
      const v = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      const negBit = Object.is(v, -0) || v < 0;
      if (Number.isNaN(v)) {
        body = upper ? 'NAN' : 'nan';
        canZero = false;
      } else {
        sign = negBit ? '-' : plus ? '+' : space ? ' ' : '';
        if (!Number.isFinite(v)) {
          body = upper ? 'INF' : 'inf';
          canZero = false;
        } else {
          const [num, den] = toRational(v);
          const lc = conv.toLowerCase();
          if (lc === 'f') {
            body = fixed(num, den, prec < 0 ? 6 : prec, alt);
          } else if (lc === 'e') {
            const p = prec < 0 ? 6 : prec;
            const [d, x] = sci(num, den, p);
            body = sciText(d, x, p, alt, upper);
          } else {
            let P = prec < 0 ? 6 : prec;
            if (P === 0) P = 1;
            const [d, x] = sci(num, den, P - 1);
            if (P > x && x >= -4) {
              body = fixed(num, den, P - 1 - x, alt);
              if (!alt) body = stripZeros(body);
            } else {
              let mant = d[0] + (P - 1 > 0 ? '.' + d.slice(1) : alt ? '.' : '');
              if (!alt) mant = stripZeros(mant);
              body = mant + expStr(x, upper);
            }
          }
        }
      }
    }

    const len = sign.length + prefix.length + body.length;
    if (len >= width) return sign + prefix + body;
    const pad = width - len;
    if (left) return sign + prefix + body + ' '.repeat(pad);
    if (canZero) return sign + prefix + '0'.repeat(pad) + body;
    return ' '.repeat(pad) + sign + prefix + body;
  });
}
