const pow10 = (n: number): bigint => 10n ** BigInt(n);

// Decompose a finite positive double into m * 2^e exactly.
function decompose(x: number): [bigint, number] {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (expBits === 0) return [m, -1074];
  m |= 1n << 52n;
  return [m, expBits - 1075];
}

// x * 10^s as [num, den]
function scaled(x: number, s: number): [bigint, bigint] {
  let [num, e] = decompose(x);
  let den = 1n;
  if (e >= 0) num <<= BigInt(e);
  else den <<= BigInt(-e);
  if (s >= 0) num *= pow10(s);
  else den *= pow10(-s);
  return [num, den];
}

function roundEven(x: number, s: number): bigint {
  const [num, den] = scaled(x, s);
  const q = num / den;
  const r2 = (num % den) * 2n;
  if (r2 > den || (r2 === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// x >= 0 finite. Fixed notation with p decimals.
function fixedStr(x: number, p: number, alt: boolean): string {
  const q = x === 0 ? 0n : roundEven(x, p);
  let s = q.toString();
  if (s.length < p + 1) s = '0'.repeat(p + 1 - s.length) + s;
  const ip = s.slice(0, s.length - p);
  const fp = s.slice(s.length - p);
  return ip + (p > 0 || alt ? '.' : '') + fp;
}

// x >= 0 finite. Returns digits (p+1 of them) and decimal exponent.
function sciParts(x: number, p: number): [string, number] {
  if (x === 0) return ['0'.repeat(p + 1), 0];
  let E = Math.floor(Math.log10(x));
  if (!isFinite(E)) E = -324;
  for (;;) {
    const [num, den] = scaled(x, -E);
    const f = num / den;
    if (f < 1n) E--;
    else if (f >= 10n) E++;
    else break;
  }
  let q = roundEven(x, p - E);
  if (q >= pow10(p + 1)) {
    E++;
    q = roundEven(x, p - E);
  }
  return [q.toString(), E];
}

function sciStr(x: number, p: number, alt: boolean, upper: boolean): string {
  const [d, E] = sciParts(x, p);
  const mant = d[0] + (p > 0 || alt ? '.' : '') + d.slice(1);
  const ae = Math.abs(E);
  return mant + (upper ? 'E' : 'e') + (E < 0 ? '-' : '+') + (ae < 10 ? '0' : '') + ae;
}

function stripZeros(s: string): string {
  if (!s.includes('.')) return s;
  return s.replace(/0+$/, '').replace(/\.$/, '');
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let ai = 0;
  const re = /%([-+ 0#]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc%])/g;
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
    let body = '';
    let zeroOk = false;

    if (conv === 's' || conv === 'c') {
      body = String(arg);
      if (conv === 's' && hasPrec) body = body.slice(0, prec);
    } else if ('diouxX'.includes(conv)) {
      let v = BigInt(arg as number | bigint);
      if (v < 0n) {
        sign = '-';
        v = -v;
      } else if (conv === 'd' || conv === 'i') {
        sign = plus ? '+' : space ? ' ' : '';
      }
      const radix = conv === 'o' ? 8 : conv === 'd' || conv === 'i' ? 10 : 16;
      let digits = v.toString(radix);
      if (conv === 'X') digits = digits.toUpperCase();
      if (hasPrec && prec === 0 && v === 0n) digits = '';
      if (hasPrec && digits.length < prec) digits = '0'.repeat(prec - digits.length) + digits;
      if (alt) {
        if (conv === 'o') {
          if (!digits.startsWith('0')) digits = '0' + digits;
        } else if ((conv === 'x' || conv === 'X') && v !== 0n) {
          prefix = conv === 'x' ? '0x' : '0X';
        }
      }
      body = digits;
      zeroOk = !hasPrec;
    } else {
      const v = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      const neg = v < 0 || Object.is(v, -0);
      if (Number.isNaN(v)) {
        body = upper ? 'NAN' : 'nan';
      } else {
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        const x = Math.abs(v);
        if (x === Infinity) {
          body = upper ? 'INF' : 'inf';
        } else {
          zeroOk = true;
          const p = hasPrec ? prec : 6;
          const lc = conv.toLowerCase();
          if (lc === 'f') body = fixedStr(x, p, alt);
          else if (lc === 'e') body = sciStr(x, p, alt, upper);
          else {
            const P = p === 0 ? 1 : p;
            const X = sciParts(x, P - 1)[1];
            if (P > X && X >= -4) {
              body = fixedStr(x, P - 1 - X, alt);
              if (!alt) body = stripZeros(body);
            } else {
              const s = sciStr(x, P - 1, alt, upper);
              if (!alt) {
                const i = s.search(/[eE]/);
                body = stripZeros(s.slice(0, i)) + s.slice(i);
              } else body = s;
            }
          }
        }
      }
    }

    const len = sign.length + prefix.length + body.length;
    if (len >= width) return sign + prefix + body;
    const pad = width - len;
    if (left) return sign + prefix + body + ' '.repeat(pad);
    if (zero && zeroOk && conv !== 's' && conv !== 'c') return sign + prefix + '0'.repeat(pad) + body;
    return ' '.repeat(pad) + sign + prefix + body;
  });
}
