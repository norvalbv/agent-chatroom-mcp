function roundDiv(a: bigint, b: bigint): bigint {
  const q = a / b;
  const r = a - q * b;
  const t = r * 2n;
  if (t > b || (t === b && (q & 1n) === 1n)) return q + 1n;
  return q;
}

const pow10 = (n: number): bigint => 10n ** BigInt(n);

// exact |v| = num/den
function toRational(v: number): [bigint, bigint] {
  v = Math.abs(v);
  if (v === 0) return [0n, 1n];
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, v);
  const bits = dv.getBigUint64(0);
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

function scaled(num: bigint, den: bigint, p: number): bigint {
  return p >= 0 ? roundDiv(num * pow10(p), den) : roundDiv(num, den * pow10(-p));
}

// digits (prec+1 of them) and decimal exponent, after rounding
function eDigits(v: number, prec: number): [string, number] {
  const [num, den] = toRational(v);
  if (num === 0n) return ['0'.repeat(prec + 1), 0];
  let x = Math.floor(Math.log10(Math.abs(v)));
  if (!Number.isFinite(x)) x = 0;
  const ge = (n: number) => (n >= 0 ? num >= pow10(n) * den : num * pow10(-n) >= den);
  while (!ge(x)) x--;
  while (ge(x + 1)) x++;
  let n = scaled(num, den, prec - x);
  if (n >= pow10(prec + 1)) {
    x++;
    n = scaled(num, den, prec - x);
  }
  return [n.toString(), x];
}

function fBody(v: number, prec: number, alt: boolean): string {
  const [num, den] = toRational(v);
  const s = scaled(num, den, prec).toString().padStart(prec + 1, '0');
  const ip = s.slice(0, s.length - prec);
  const fp = s.slice(s.length - prec);
  return ip + (prec > 0 || alt ? '.' : '') + fp;
}

function eBody(v: number, prec: number, alt: boolean, upper: boolean): string {
  const [d, x] = eDigits(v, prec);
  const ax = Math.abs(x);
  return (
    d[0] + (prec > 0 || alt ? '.' : '') + d.slice(1) +
    (upper ? 'E' : 'e') + (x < 0 ? '-' : '+') + (ax < 10 ? '0' + ax : String(ax))
  );
}

function stripZeros(s: string): string {
  if (!s.includes('.')) return s;
  return s.replace(/0+$/, '').replace(/\.$/, '');
}

function gBody(v: number, precIn: number, alt: boolean, upper: boolean): string {
  const P = precIn === 0 ? 1 : precIn;
  const [, x] = eDigits(v, P - 1);
  if (P > x && x >= -4) {
    let s = fBody(v, P - 1 - x, alt);
    if (!alt) s = stripZeros(s);
    return s;
  }
  let s = eBody(v, P - 1, alt, upper);
  if (!alt) {
    const i = s.search(/[eE]/);
    s = stripZeros(s.slice(0, i)) + s.slice(i);
  }
  return s;
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let ai = 0;
  const re = /%([-+ 0#]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc%])/g;
  return fmt.replace(re, (_m, flags: string, w: string, p: string | undefined, conv: string) => {
    if (conv === '%') return '%';
    const minus = flags.includes('-');
    const plus = flags.includes('+');
    const space = flags.includes(' ');
    const zero = flags.includes('0');
    const alt = flags.includes('#');
    const width = w === '' ? 0 : parseInt(w, 10);
    const hasPrec = p !== undefined;
    const prec = hasPrec ? (p === '' ? 0 : parseInt(p, 10)) : -1;
    const arg = args[ai++];

    let sign = '';
    let prefix = '';
    let body: string;
    let canZero = false;

    if (conv === 's' || conv === 'c') {
      body = String(arg);
      if (conv === 's' && hasPrec) body = body.slice(0, prec);
    } else if ('dioxX'.includes(conv)) {
      let n = typeof arg === 'bigint' ? arg : BigInt(arg as number);
      if (conv === 'd' || conv === 'i') {
        if (n < 0n) {
          sign = '-';
          n = -n;
        } else sign = plus ? '+' : space ? ' ' : '';
      }
      let digits = conv === 'o' ? n.toString(8) : conv === 'd' || conv === 'i' ? n.toString() : n.toString(16);
      if (conv === 'X') digits = digits.toUpperCase();
      if (hasPrec) {
        if (prec === 0 && n === 0n) digits = '';
        digits = digits.padStart(prec, '0');
      }
      if (alt) {
        if (conv === 'o') {
          if (digits[0] !== '0') digits = '0' + digits;
        } else if ((conv === 'x' || conv === 'X') && n !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      }
      body = digits;
      canZero = !hasPrec;
    } else {
      const v = arg as number;
      const neg = v < 0 || Object.is(v, -0);
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      if (Number.isNaN(v)) {
        body = upper ? 'NAN' : 'nan';
      } else {
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        if (!Number.isFinite(v)) {
          body = upper ? 'INF' : 'inf';
        } else {
          const pr = hasPrec ? prec : 6;
          const lc = conv.toLowerCase();
          body = lc === 'f' ? fBody(v, pr, alt) : lc === 'e' ? eBody(v, pr, alt, upper) : gBody(v, pr, alt, upper);
          canZero = true;
        }
      }
    }

    const len = sign.length + prefix.length + body.length;
    if (len >= width) return sign + prefix + body;
    const pad = width - len;
    if (minus) return sign + prefix + body + ' '.repeat(pad);
    if (zero && canZero) return sign + prefix + '0'.repeat(pad) + body;
    return ' '.repeat(pad) + sign + prefix + body;
  });
}
