function decompose(x: number): [bigint, number] {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const be = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (be === 0) return [m, -1074];
  m |= 1n << 52n;
  return [m, be - 1075];
}

// round-half-even of m * 2^e * 10^k
function roundScaled(m: bigint, e: number, k: number): bigint {
  let num = m;
  let den = 1n;
  if (e >= 0) num <<= BigInt(e);
  else den <<= BigInt(-e);
  if (k >= 0) num *= 10n ** BigInt(k);
  else den *= 10n ** BigInt(-k);
  const q = num / den;
  const r = num % den;
  const c = 2n * r;
  if (c > den || (c === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

function fixed(ax: number, p: number, alt: boolean): string {
  const [m, e] = decompose(ax);
  let s = roundScaled(m, e, p).toString();
  if (p > 0) {
    s = s.padStart(p + 1, '0');
    return s.slice(0, s.length - p) + '.' + s.slice(s.length - p);
  }
  return alt ? s + '.' : s;
}

// digits (p+1 of them) and decimal exponent
function expParts(ax: number, p: number): [string, number] {
  if (ax === 0) return ['0'.repeat(p + 1), 0];
  const [m, e] = decompose(ax);
  let e10 = Math.floor(Math.log10(ax));
  for (let i = 0; i < 20; i++) {
    const s = roundScaled(m, e, p - e10).toString();
    if (s.length > p + 1) e10++;
    else if (s.length < p + 1) e10--;
    else return [s, e10];
  }
  throw new Error('exp');
}

function expStr(ax: number, p: number, alt: boolean, upper: boolean): string {
  const [d, x] = expParts(ax, p);
  let s = d[0];
  if (p > 0) s += '.' + d.slice(1);
  else if (alt) s += '.';
  const ax2 = Math.abs(x);
  return s + (upper ? 'E' : 'e') + (x < 0 ? '-' : '+') + (ax2 < 10 ? '0' : '') + ax2;
}

function stripZeros(s: string): string {
  if (!s.includes('.')) return s;
  return s.replace(/0+$/, '').replace(/\.$/, '');
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let ai = 0;
  return fmt.replace(/%([-+ 0#]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc%])/g, (_m, fl: string, w: string, pr: string | undefined, conv: string) => {
    if (conv === '%') return '%';
    const left = fl.includes('-');
    const plus = fl.includes('+');
    const space = fl.includes(' ');
    const zero = fl.includes('0');
    const alt = fl.includes('#');
    const width = w ? parseInt(w, 10) : 0;
    const hasPrec = pr !== undefined;
    const prec = hasPrec ? (pr === '' ? 0 : parseInt(pr, 10)) : -1;
    const arg = args[ai++];

    const pad = (sign: string, body: string, zeroOk: boolean): string => {
      const len = sign.length + body.length;
      if (len >= width) return sign + body;
      const n = width - len;
      if (left) return sign + body + ' '.repeat(n);
      if (zero && zeroOk) return sign + '0'.repeat(n) + body;
      return ' '.repeat(n) + sign + body;
    };

    if (conv === 's' || conv === 'c') {
      let s = String(arg);
      if (conv === 's' && hasPrec) s = s.slice(0, prec);
      return pad('', s, false);
    }

    if ('dioxX'.includes(conv)) {
      const v = BigInt(arg as number | bigint);
      let sign = '';
      let mag = v;
      if (conv === 'd' || conv === 'i') {
        if (v < 0n) { sign = '-'; mag = -v; }
        else if (plus) sign = '+';
        else if (space) sign = ' ';
      }
      const radix = conv === 'o' ? 8 : conv === 'd' || conv === 'i' ? 10 : 16;
      let digits = mag.toString(radix);
      if (conv === 'X') digits = digits.toUpperCase();
      if (hasPrec) {
        if (prec === 0 && mag === 0n) digits = '';
        else digits = digits.padStart(prec, '0');
      }
      if (alt) {
        if (conv === 'o') {
          if (!digits.startsWith('0')) digits = '0' + digits;
        } else if (conv === 'x' && mag !== 0n) sign += '0x';
        else if (conv === 'X' && mag !== 0n) sign += '0X';
      }
      return pad(sign, digits, !hasPrec);
    }

    // floating
    const x = arg as number;
    const upper = conv === 'E' || conv === 'F' || conv === 'G';
    if (Number.isNaN(x)) return pad('', upper ? 'NAN' : 'nan', false);
    const neg = x < 0 || Object.is(x, -0);
    const sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
    if (!Number.isFinite(x)) return pad(sign, upper ? 'INF' : 'inf', false);
    const ax = Math.abs(x);
    const lc = conv.toLowerCase();
    let body: string;
    if (lc === 'f') {
      body = fixed(ax, hasPrec ? prec : 6, alt);
    } else if (lc === 'e') {
      body = expStr(ax, hasPrec ? prec : 6, alt, upper);
    } else {
      let P = hasPrec ? prec : 6;
      if (P === 0) P = 1;
      const X = expParts(ax, P - 1)[1];
      if (P > X && X >= -4) {
        body = fixed(ax, P - 1 - X, alt);
        if (!alt) body = stripZeros(body);
      } else {
        body = expStr(ax, P - 1, alt, upper);
        if (!alt) {
          const idx = body.search(/[eE]/);
          body = stripZeros(body.slice(0, idx)) + body.slice(idx);
        }
      }
    }
    return pad(sign, body, true);
  });
}
