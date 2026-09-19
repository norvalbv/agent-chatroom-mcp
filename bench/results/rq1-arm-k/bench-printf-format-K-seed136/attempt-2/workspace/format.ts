function roundDiv(n: bigint, d: bigint): bigint {
  const q = n / d;
  const r2 = (n % d) * 2n;
  if (r2 > d || (r2 === d && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// |x| as an exact fraction num/den
function toFrac(x: number): [bigint, bigint] {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, Math.abs(x));
  const bits = dv.getBigUint64(0);
  const ex = Number((bits >> 52n) & 0x7ffn);
  const frac = bits & ((1n << 52n) - 1n);
  let m: bigint;
  let e: number;
  if (ex === 0) {
    m = frac;
    e = -1074;
  } else {
    m = frac | (1n << 52n);
    e = ex - 1075;
  }
  return e >= 0 ? [m << BigInt(e), 1n] : [m, 1n << BigInt(-e)];
}

function fixedDigits(num: bigint, den: bigint, prec: number): [string, string] {
  let s = roundDiv(num * 10n ** BigInt(prec), den).toString();
  s = s.padStart(prec + 1, '0');
  return [s.slice(0, s.length - prec), s.slice(s.length - prec)];
}

function expDigits(num: bigint, den: bigint, prec: number): [string, number] {
  if (num === 0n) return ['0'.repeat(prec + 1), 0];
  let e10 = Math.floor(Math.log10(Number(num) / Number(den)));
  if (!Number.isFinite(e10)) e10 = 0;
  const lo = 10n ** BigInt(prec);
  const hi = lo * 10n;
  for (let i = 0; i < 2000; i++) {
    const scale = prec - e10;
    const n =
      scale >= 0
        ? roundDiv(num * 10n ** BigInt(scale), den)
        : roundDiv(num, den * 10n ** BigInt(-scale));
    if (n >= hi) e10++;
    else if (n < lo) e10--;
    else return [n.toString(), e10];
  }
  throw new Error('exp');
}

function expStr(digits: string, e10: number, alt: boolean, upper: boolean): string {
  let s = digits[0];
  if (digits.length > 1) s += '.' + digits.slice(1);
  else if (alt) s += '.';
  const a = Math.abs(e10);
  s += (upper ? 'E' : 'e') + (e10 < 0 ? '-' : '+') + (a < 10 ? '0' + a : String(a));
  return s;
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let ai = 0;
  const re = /%([-+ 0#]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc%])/g;
  return fmt.replace(re, (_m, flags: string, w: string, p: string | undefined, conv: string) => {
    if (conv === '%') return '%';
    const left = flags.includes('-');
    const plus = flags.includes('+');
    const space = flags.includes(' ');
    const zero = flags.includes('0');
    const alt = flags.includes('#');
    const width = w ? parseInt(w, 10) : 0;
    const hasPrec = p !== undefined;
    const prec = hasPrec ? (p === '' ? 0 : parseInt(p!, 10)) : -1;
    const arg = args[ai++];

    let sign = '';
    let body = '';
    let canZero = !left && zero;

    if (conv === 's' || conv === 'c') {
      body = String(arg);
      if (conv === 's' && hasPrec) body = body.slice(0, prec);
      canZero = false;
    } else if ('dioxXuc'.includes(conv)) {
      const v = BigInt(arg as number | bigint);
      const neg = v < 0n;
      const mag = neg ? -v : v;
      let digits: string;
      if (conv === 'x' || conv === 'X') digits = mag.toString(16);
      else if (conv === 'o') digits = mag.toString(8);
      else digits = mag.toString(10);
      if (conv === 'X') digits = digits.toUpperCase();
      if (hasPrec) {
        if (prec === 0 && mag === 0n) digits = '';
        digits = digits.padStart(prec, '0');
        canZero = false;
      }
      if (conv === 'd' || conv === 'i' || conv === 'u') {
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
      } else if (alt) {
        if (conv === 'o') {
          if (!digits.startsWith('0')) digits = '0' + digits;
        } else if (mag !== 0n) sign = conv === 'x' ? '0x' : '0X';
      }
      body = digits;
    } else {
      const x = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      const neg = x < 0 || Object.is(x, -0);
      if (Number.isNaN(x)) {
        body = upper ? 'NAN' : 'nan';
        canZero = false;
      } else {
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        if (!Number.isFinite(x)) {
          body = upper ? 'INF' : 'inf';
          canZero = false;
        } else {
          const [num, den] = toFrac(x);
          const lc = conv.toLowerCase();
          const P = prec < 0 ? 6 : prec;
          if (lc === 'f') {
            const [ip, fp] = fixedDigits(num, den, P);
            body = ip + (P > 0 ? '.' + fp : alt ? '.' : '');
          } else if (lc === 'e') {
            const [d, e10] = expDigits(num, den, P);
            body = expStr(d, e10, alt, upper);
          } else {
            const PP = P === 0 ? 1 : P;
            const [d, X] = expDigits(num, den, PP - 1);
            if (PP > X && X >= -4) {
              const [ip, fp0] = fixedDigits(num, den, PP - 1 - X);
              let fp = fp0;
              if (!alt) fp = fp.replace(/0+$/, '');
              body = ip + (fp.length > 0 ? '.' + fp : alt ? '.' : '');
            } else {
              let dd = d;
              if (!alt) dd = dd[0] + dd.slice(1).replace(/0+$/, '');
              body = expStr(dd, X, alt, upper);
            }
          }
        }
      }
    }

    const len = sign.length + body.length;
    if (len >= width) return sign + body;
    const pad = width - len;
    if (left) return sign + body + ' '.repeat(pad);
    if (canZero) return sign + '0'.repeat(pad) + body;
    return ' '.repeat(pad) + sign + body;
  });
}
