function decompose(v: number): { m: bigint; e2: number } {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, v);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const exp = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (exp === 0) return { m, e2: -1074 };
  m |= 1n << 52n;
  return { m, e2: exp - 1075 };
}

function roundDiv(num: bigint, den: bigint): bigint {
  const q = num / den;
  const r2 = (num % den) * 2n;
  if (r2 > den || (r2 === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// round(|v| * 10^k) exactly, half-even
function scaled(v: number, k: number): bigint {
  const { m, e2 } = decompose(v);
  let num = m;
  let den = 1n;
  if (e2 >= 0) num <<= BigInt(e2);
  else den <<= BigInt(-e2);
  if (k >= 0) num *= 10n ** BigInt(k);
  else den *= 10n ** BigInt(-k);
  return roundDiv(num, den);
}

function fixedStr(v: number, prec: number, alt: boolean): string {
  let s = scaled(v, prec).toString();
  if (prec > 0) {
    s = s.padStart(prec + 1, '0');
    return s.slice(0, s.length - prec) + '.' + s.slice(s.length - prec);
  }
  return alt ? s + '.' : s;
}

// returns digits (prec+1 of them) and decimal exponent
function expParts(v: number, prec: number): { digits: string; x: number } {
  if (v === 0) return { digits: '0'.repeat(prec + 1), x: 0 };
  let e10 = Math.floor(Math.log10(v));
  for (let i = 0; i < 10; i++) {
    const q = scaled(v, prec - e10);
    const s = q.toString();
    if (s.length > prec + 1) e10++;
    else if (s.length < prec + 1) e10--;
    else return { digits: s, x: e10 };
  }
  throw new Error('exp');
}

function expStr(v: number, prec: number, alt: boolean, upper: boolean): string {
  const { digits, x } = expParts(v, prec);
  let s = digits[0];
  if (prec > 0) s += '.' + digits.slice(1);
  else if (alt) s += '.';
  const ax = Math.abs(x);
  s += (upper ? 'E' : 'e') + (x < 0 ? '-' : '+') + (ax < 10 ? '0' + ax : String(ax));
  return s;
}

function stripZeros(s: string): string {
  if (!s.includes('.')) return s;
  return s.replace(/\.?0+$/, '');
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let ai = 0;
  const re = /%(?:(%)|([-+ 0#]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc]))/g;
  return fmt.replace(re, (_m, pct, flags, w, p, conv) => {
    if (pct) return '%';
    const arg = args[ai++];
    const left = flags.includes('-');
    let zero = flags.includes('0') && !left;
    const plus = flags.includes('+');
    const space = flags.includes(' ');
    const alt = flags.includes('#');
    const width = w ? parseInt(w, 10) : 0;
    const hasPrec = p !== undefined;
    const prec = hasPrec ? (p === '' ? 0 : parseInt(p, 10)) : -1;

    let prefix = '';
    let body = '';
    const signOf = (neg: boolean) => (neg ? '-' : plus ? '+' : space ? ' ' : '');

    if (conv === 's' || conv === 'c') {
      body = String(arg);
      if (conv === 's' && hasPrec) body = body.slice(0, prec);
      zero = false;
    } else if ('dioxX'.includes(conv)) {
      let n = typeof arg === 'bigint' ? arg : BigInt(arg as number);
      const neg = n < 0n;
      if (neg) n = -n;
      if (conv === 'd' || conv === 'i') {
        prefix = signOf(neg);
        body = n.toString();
      } else if (conv === 'o') {
        body = n.toString(8);
      } else {
        body = n.toString(16);
        if (conv === 'X') body = body.toUpperCase();
      }
      if (hasPrec) {
        zero = false;
        if (prec === 0 && n === 0n) body = '';
        body = body.padStart(prec, '0');
      }
      if (conv === 'o' && alt && !body.startsWith('0')) body = '0' + body;
      if ((conv === 'x' || conv === 'X') && alt && n !== 0n) prefix = conv === 'x' ? '0x' : '0X';
    } else {
      const v = arg as number;
      const lower = conv.toLowerCase();
      const upper = conv !== lower;
      if (Number.isNaN(v)) {
        body = upper ? 'NAN' : 'nan';
        zero = false;
      } else {
        const neg = v < 0 || Object.is(v, -0);
        prefix = signOf(neg);
        const a = Math.abs(v);
        if (a === Infinity) {
          body = upper ? 'INF' : 'inf';
          zero = false;
        } else if (lower === 'f') {
          body = fixedStr(a, hasPrec ? prec : 6, alt);
        } else if (lower === 'e') {
          body = expStr(a, hasPrec ? prec : 6, alt, upper);
        } else {
          let P = hasPrec ? prec : 6;
          if (P === 0) P = 1;
          const { x } = expParts(a, P - 1);
          if (P > x && x >= -4) {
            body = fixedStr(a, P - 1 - x, alt);
            if (!alt) body = stripZeros(body);
          } else {
            body = expStr(a, P - 1, alt, upper);
            if (!alt) {
              const i = body.search(/[eE]/);
              body = stripZeros(body.slice(0, i)) + body.slice(i);
            }
          }
        }
      }
    }

    const len = prefix.length + body.length;
    if (len >= width) return prefix + body;
    const pad = width - len;
    if (left) return prefix + body + ' '.repeat(pad);
    if (zero) return prefix + '0'.repeat(pad) + body;
    return ' '.repeat(pad) + prefix + body;
  });
}
