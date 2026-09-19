// Decompose a finite non-negative double into m * 2^e exactly.
function decompose(v: number): [bigint, number] {
  if (v === 0) return [0n, 0];
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, v);
  const hi = buf.getUint32(0);
  const lo = buf.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (expBits === 0) return [m, -1074];
  m |= 1n << 52n;
  return [m, expBits - 1075];
}

// round-half-even(v * 10^k) as bigint
function roundScaled(m: bigint, e: number, k: number): bigint {
  let n = m;
  let d = 1n;
  if (e >= 0) n <<= BigInt(e);
  else d <<= BigInt(-e);
  if (k >= 0) n *= 10n ** BigInt(k);
  else d *= 10n ** BigInt(-k);
  const q = n / d;
  const r = n % d;
  const c = 2n * r;
  if (c > d || (c === d && (q & 1n) === 1n)) return q + 1n;
  return q;
}

function fixedDigits(v: number, prec: number): string {
  const [m, e] = decompose(v);
  let s = roundScaled(m, e, prec).toString();
  if (s.length <= prec) s = '0'.repeat(prec - s.length + 1) + s;
  return prec === 0 ? s : s.slice(0, s.length - prec) + '.' + s.slice(s.length - prec);
}

// digits (prec+1 of them) and decimal exponent
function expDigits(v: number, prec: number): [string, number] {
  if (v === 0) return ['0'.repeat(prec + 1), 0];
  const [m, e] = decompose(v);
  let x = Math.floor(Math.log10(v));
  if (!isFinite(x)) x = -324;
  const lo = 10n ** BigInt(prec);
  const hi = lo * 10n;
  for (let i = 0; i < 20; i++) {
    const s = roundScaled(m, e, prec - x);
    if (s >= hi) x++;
    else if (s < lo) x--;
    else return [s.toString(), x];
  }
  throw new Error('exp search failed');
}

function expStyle(v: number, prec: number, alt: boolean, upper: boolean): string {
  const [d, x] = expDigits(v, prec);
  let mant = d[0] + (prec > 0 || alt ? '.' : '') + d.slice(1);
  const ax = Math.abs(x);
  return mant + (upper ? 'E' : 'e') + (x < 0 ? '-' : '+') + (ax < 10 ? '0' : '') + ax;
}

function stripZeros(s: string): string {
  if (!s.includes('.')) return s;
  return s.replace(/0+$/, '').replace(/\.$/, '');
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let ai = 0;
  return fmt.replace(/%([-+ 0#]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc%])/g, (_all, fl: string, w: string, p: string | undefined, conv: string) => {
    if (conv === '%') return '%';
    const left = fl.includes('-');
    const plus = fl.includes('+');
    const space = fl.includes(' ');
    const zero = fl.includes('0') && !left;
    const alt = fl.includes('#');
    const width = w ? parseInt(w, 10) : 0;
    const hasPrec = p !== undefined;
    const prec = hasPrec ? (p === '' ? 0 : parseInt(p, 10)) : -1;
    const arg = args[ai++];

    let sign = '';
    let prefix = '';
    let body: string;
    let zeroOk = zero;

    if (conv === 's' || conv === 'c') {
      let s = String(arg);
      if (conv === 's' && hasPrec) s = s.slice(0, prec);
      body = s;
      zeroOk = false;
    } else if ('dioxX'.includes(conv)) {
      let n = typeof arg === 'bigint' ? arg : BigInt(arg as number);
      const neg = n < 0n;
      if (neg) n = -n;
      if (conv === 'd' || conv === 'i') {
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
      }
      let digits = conv === 'o' ? n.toString(8) : conv === 'x' ? n.toString(16) : conv === 'X' ? n.toString(16).toUpperCase() : n.toString(10);
      if (hasPrec) {
        if (prec === 0 && n === 0n) digits = '';
        if (digits.length < prec) digits = '0'.repeat(prec - digits.length) + digits;
        zeroOk = false;
      }
      if (alt) {
        if (conv === 'o') {
          if (!digits.startsWith('0')) digits = '0' + digits;
        } else if (conv !== 'd' && conv !== 'i' && n !== 0n) {
          prefix = conv === 'x' ? '0x' : '0X';
        }
      }
      body = digits;
    } else {
      const v = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      const lower = conv.toLowerCase();
      const neg = !Number.isNaN(v) && (v < 0 || Object.is(v, -0));
      sign = Number.isNaN(v) ? '' : neg ? '-' : plus ? '+' : space ? ' ' : '';
      if (!isFinite(v)) {
        body = Number.isNaN(v) ? 'nan' : 'inf';
        if (upper) body = body.toUpperCase();
        zeroOk = false;
      } else {
        const a = Math.abs(v);
        const P = hasPrec ? prec : 6;
        if (lower === 'f') {
          body = fixedDigits(a, P);
          if (P === 0 && alt) body += '.';
        } else if (lower === 'e') {
          body = expStyle(a, P, alt, upper);
        } else {
          const G = P === 0 ? 1 : P;
          const X = expDigits(a, G - 1)[1];
          if (G > X && X >= -4) {
            body = fixedDigits(a, G - 1 - X);
            if (G - 1 - X === 0 && alt) body += '.';
            if (!alt) body = stripZeros(body);
          } else {
            body = expStyle(a, G - 1, alt, upper);
            if (!alt) {
              const idx = body.search(/[eE]/);
              body = stripZeros(body.slice(0, idx)) + body.slice(idx);
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
