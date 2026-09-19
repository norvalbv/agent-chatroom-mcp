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

// round(v * 10^k) as a BigInt, ties to even, exact.
function roundScaled(m: bigint, e2: number, k: number): bigint {
  let num = m;
  let den = 1n;
  if (k >= 0) num *= 10n ** BigInt(k);
  else den *= 10n ** BigInt(-k);
  if (e2 >= 0) num <<= BigInt(e2);
  else den <<= BigInt(-e2);
  const q = num / den;
  const r = num % den;
  const twice = r * 2n;
  if (twice > den || (twice === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

function fixedDigits(v: number, prec: number, alt: boolean): string {
  const [m, e2] = decompose(v);
  let s = roundScaled(m, e2, prec).toString();
  if (s.length < prec + 1) s = '0'.repeat(prec + 1 - s.length) + s;
  const ip = s.slice(0, s.length - prec);
  const fp = s.slice(s.length - prec);
  return prec > 0 ? ip + '.' + fp : alt ? ip + '.' : ip;
}

// Returns digit string (prec+1 digits) and decimal exponent.
function expDigits(v: number, prec: number): [string, number] {
  if (v === 0) return ['0'.repeat(prec + 1), 0];
  const [m, e2] = decompose(v);
  let X = Math.floor(Math.log10(v));
  if (!isFinite(X)) X = -324;
  const hi = 10n ** BigInt(prec + 1);
  const lo = 10n ** BigInt(prec);
  for (;;) {
    const s = roundScaled(m, e2, prec - X);
    if (s >= hi) X++;
    else if (s < lo) X--;
    else return [s.toString(), X];
  }
}

function expStyle(v: number, prec: number, alt: boolean, upper: boolean): string {
  const [d, X] = expDigits(v, prec);
  let out = d[0];
  if (prec > 0) out += '.' + d.slice(1);
  else if (alt) out += '.';
  const ax = Math.abs(X);
  out += (upper ? 'E' : 'e') + (X < 0 ? '-' : '+') + (ax < 10 ? '0' + ax : String(ax));
  return out;
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  const re = /%(?:(%)|([-+ 0#]*)(\d*)(?:\.(\d*))?([diuxXoeEfFgGsc]))/g;
  let ai = 0;
  return fmt.replace(re, (_all, pct, flags, widthS, precS, conv) => {
    if (pct) return '%';
    const arg = args[ai++];
    const left = flags.includes('-');
    const plus = flags.includes('+');
    const space = flags.includes(' ');
    const zero = flags.includes('0') && !left;
    const alt = flags.includes('#');
    const width = widthS ? parseInt(widthS, 10) : 0;
    const hasPrec = precS !== undefined;
    const prec = hasPrec ? (precS === '' ? 0 : parseInt(precS, 10)) : -1;

    let sign = '';
    let prefix = '';
    let body: string;
    let zeroOk = zero;

    if (conv === 's' || conv === 'c') {
      let s = String(arg);
      if (conv === 's' && hasPrec) s = s.slice(0, prec);
      body = s;
      zeroOk = false;
    } else if ('dixXo'.includes(conv)) {
      let n = BigInt(arg as number | bigint);
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
        if (digits.length < prec) digits = '0'.repeat(prec - digits.length) + digits;
        zeroOk = false;
      }
      if (alt) {
        if (conv === 'o' && !digits.startsWith('0')) digits = '0' + digits;
        if ((conv === 'x' || conv === 'X') && n !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      }
      body = digits;
    } else {
      const v = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      if (Number.isNaN(v)) {
        body = upper ? 'NAN' : 'nan';
        zeroOk = false;
      } else {
        const neg = v < 0 || Object.is(v, -0);
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        const a = Math.abs(v);
        if (a === Infinity) {
          body = upper ? 'INF' : 'inf';
          zeroOk = false;
        } else {
          const p = hasPrec ? prec : 6;
          const lc = conv.toLowerCase();
          if (lc === 'f') body = fixedDigits(a, p, alt);
          else if (lc === 'e') body = expStyle(a, p, alt, upper);
          else {
            const P = p === 0 ? 1 : p;
            const X = expDigits(a, P - 1)[1];
            if (P > X && X >= -4) {
              body = fixedDigits(a, P - 1 - X, alt);
              if (!alt && body.includes('.')) body = body.replace(/\.?0+$/, '');
            } else {
              body = expStyle(a, P - 1, alt, upper);
              if (!alt) {
                const ei = body.search(/[eE]/);
                let mant = body.slice(0, ei);
                if (mant.includes('.')) mant = mant.replace(/\.?0+$/, '');
                body = mant + body.slice(ei);
              }
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
