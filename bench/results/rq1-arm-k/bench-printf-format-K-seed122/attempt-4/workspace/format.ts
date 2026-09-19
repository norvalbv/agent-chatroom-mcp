function decompose(v: number): [bigint, number] {
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

// round(|v| * 10^k) to nearest integer, ties to even, exactly.
function scaledRound(m: bigint, e2: number, k: number): bigint {
  let num = m;
  let den = 1n;
  if (e2 >= 0) num <<= BigInt(e2);
  else den <<= BigInt(-e2);
  if (k >= 0) num *= 10n ** BigInt(k);
  else den *= 10n ** BigInt(-k);
  const q = num / den;
  const r = num - q * den;
  const twice = r * 2n;
  if (twice > den || (twice === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

function fixedDigits(v: number, prec: number): { int: string; frac: string } {
  const [m, e2] = decompose(v);
  let s = scaledRound(m, e2, prec).toString();
  if (s.length < prec + 1) s = '0'.repeat(prec + 1 - s.length) + s;
  return { int: s.slice(0, s.length - prec), frac: s.slice(s.length - prec) };
}

function expDigits(v: number, prec: number): { digits: string; exp: number } {
  if (v === 0) return { digits: '0'.repeat(prec + 1), exp: 0 };
  const [m, e2] = decompose(v);
  let X = Math.floor(Math.log10(v));
  if (!isFinite(X)) X = -324;
  const lowB = 10n ** BigInt(prec);
  for (;;) {
    const q = scaledRound(m, e2, prec - X);
    if (q >= lowB * 10n) X++;
    else if (q < lowB) X--;
    else return { digits: q.toString(), exp: X };
  }
}

function fmtExp(digits: string, exp: number, alt: boolean, upper: boolean): string {
  let s = digits[0];
  if (digits.length > 1) s += '.' + digits.slice(1);
  else if (alt) s += '.';
  const a = Math.abs(exp);
  s += (upper ? 'E' : 'e') + (exp < 0 ? '-' : '+') + (a < 10 ? '0' : '') + a;
  return s;
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let ai = 0;
  return fmt.replace(/%([-+ 0#]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc%])/g, (_m, flags: string, w: string, p: string | undefined, conv: string) => {
    if (conv === '%') return '%';
    const arg = args[ai++];
    const left = flags.includes('-');
    const plus = flags.includes('+');
    const space = flags.includes(' ');
    const zero = flags.includes('0') && !left;
    const alt = flags.includes('#');
    const width = w ? parseInt(w, 10) : 0;
    const hasPrec = p !== undefined;
    const prec = hasPrec ? (p === '' ? 0 : parseInt(p, 10)) : -1;

    let sign = '';
    let prefix = '';
    let body: string;
    let canZero = zero;

    if (conv === 's' || conv === 'c') {
      let s = String(arg);
      if (conv === 's' && hasPrec) s = s.slice(0, prec);
      body = s;
      canZero = false;
    } else if ('diouxX'.includes(conv)) {
      const n = typeof arg === 'bigint' ? arg : BigInt(arg as number);
      const neg = n < 0n;
      const mag = neg ? -n : n;
      let digits = conv === 'x' || conv === 'X' ? mag.toString(16) : conv === 'o' ? mag.toString(8) : mag.toString();
      if (conv === 'X') digits = digits.toUpperCase();
      if (hasPrec) {
        if (prec === 0 && mag === 0n) digits = '';
        if (digits.length < prec) digits = '0'.repeat(prec - digits.length) + digits;
      }
      if (conv === 'd' || conv === 'i') {
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
      } else if (alt) {
        if (conv === 'o') {
          if (digits[0] !== '0') digits = '0' + digits;
        } else if (mag !== 0n) {
          prefix = conv === 'x' ? '0x' : '0X';
        }
      }
      if (hasPrec) canZero = false;
      body = digits;
    } else {
      const v = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      if (Number.isNaN(v)) {
        body = upper ? 'NAN' : 'nan';
        canZero = false;
      } else {
        const neg = v < 0 || Object.is(v, -0);
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        const a = Math.abs(v);
        if (a === Infinity) {
          body = upper ? 'INF' : 'inf';
          canZero = false;
        } else {
          const P = hasPrec ? prec : 6;
          const lc = conv.toLowerCase();
          if (lc === 'f') {
            const { int, frac } = fixedDigits(a, P);
            body = int + (P > 0 ? '.' + frac : alt ? '.' : '');
          } else if (lc === 'e') {
            const { digits, exp } = expDigits(a, P);
            body = fmtExp(digits, exp, alt, upper);
          } else {
            const PP = P === 0 ? 1 : P;
            const { digits, exp: X } = expDigits(a, PP - 1);
            if (PP > X && X >= -4) {
              const { int, frac } = fixedDigits(a, PP - 1 - X);
              let f = frac;
              if (!alt) f = f.replace(/0+$/, '');
              body = int + (f.length > 0 ? '.' + f : alt ? '.' : '');
            } else {
              let d = digits;
              let mant = d[0];
              let f = d.slice(1);
              if (!alt) f = f.replace(/0+$/, '');
              mant += f.length > 0 ? '.' + f : alt ? '.' : '';
              const ax = Math.abs(X);
              body = mant + (upper ? 'E' : 'e') + (X < 0 ? '-' : '+') + (ax < 10 ? '0' : '') + ax;
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
