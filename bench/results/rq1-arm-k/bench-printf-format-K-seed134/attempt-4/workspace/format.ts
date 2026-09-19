// round(m * 2^e2 * 10^k) to nearest integer, ties to even, exactly.
function scaledRound(m: bigint, e2: number, k: number): bigint {
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

function decompose(v: number): { m: bigint; e2: number } {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, v);
  const bits = dv.getBigUint64(0);
  const expBits = Number((bits >> 52n) & 0x7ffn);
  const frac = bits & ((1n << 52n) - 1n);
  if (expBits === 0) return { m: frac, e2: -1074 };
  return { m: frac | (1n << 52n), e2: expBits - 1075 };
}

// digits (string of length P) and decimal exponent for e-style with P significant digits
function sci(v: number, P: number): { digits: string; x: number } {
  if (v === 0) return { digits: '0'.repeat(P), x: 0 };
  const { m, e2 } = decompose(v);
  let x = Math.floor(Math.log10(v));
  const lo = 10n ** BigInt(P - 1);
  const hi = lo * 10n;
  for (let i = 0; i < 10; i++) {
    const n = scaledRound(m, e2, P - 1 - x);
    if (n >= hi) x++;
    else if (n < lo) x--;
    else return { digits: n.toString(), x };
  }
  throw new Error('sci failed');
}

function fixed(v: number, p: number, alt: boolean): string {
  const { m, e2 } = decompose(v);
  let s = scaledRound(m, e2, p).toString();
  if (s.length < p + 1) s = '0'.repeat(p + 1 - s.length) + s;
  const ip = s.slice(0, s.length - p);
  const fp = s.slice(s.length - p);
  return p > 0 ? ip + '.' + fp : alt ? ip + '.' : ip;
}

function expStr(x: number, upper: boolean): string {
  const a = Math.abs(x).toString().padStart(2, '0');
  return (upper ? 'E' : 'e') + (x < 0 ? '-' : '+') + a;
}

function sciStr(v: number, p: number, alt: boolean, upper: boolean, strip: boolean): string {
  const { digits, x } = sci(v, p + 1);
  let frac = digits.slice(1);
  if (strip) frac = frac.replace(/0+$/, '');
  const mant = digits[0] + (frac.length > 0 ? '.' + frac : alt ? '.' : '');
  return mant + expStr(x, upper);
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let ai = 0;
  const re = /%(?:(%)|([-+ 0#]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc]))/g;
  return fmt.replace(re, (_m, pct, flags: string, w: string, pr: string | undefined, conv: string) => {
    if (pct) return '%';
    const left = flags.includes('-');
    const plus = flags.includes('+');
    const space = flags.includes(' ');
    const zero = flags.includes('0') && !left;
    const alt = flags.includes('#');
    const width = w ? parseInt(w, 10) : 0;
    const prec = pr === undefined ? undefined : pr === '' ? 0 : parseInt(pr, 10);
    const arg = args[ai++];

    let sign = '';
    let prefix = '';
    let body: string;
    let zeroOk = zero;

    if (conv === 's' || conv === 'c') {
      body = String(arg);
      if (conv === 's' && prec !== undefined) body = body.slice(0, prec);
      zeroOk = false;
    } else if ('dioxX'.includes(conv)) {
      let n = BigInt(arg as number | bigint);
      if (conv === 'd' || conv === 'i') {
        if (n < 0n) {
          sign = '-';
          n = -n;
        } else sign = plus ? '+' : space ? ' ' : '';
        body = n.toString(10);
      } else {
        body = n.toString(conv === 'o' ? 8 : 16);
        if (conv === 'X') body = body.toUpperCase();
        if (conv !== 'o' && alt && n !== 0n) prefix = conv === 'X' ? '0X' : '0x';
      }
      if (prec !== undefined) {
        zeroOk = false;
        if (prec === 0 && n === 0n) body = '';
        else if (body.length < prec) body = '0'.repeat(prec - body.length) + body;
      }
      if (conv === 'o' && alt && !body.startsWith('0')) body = '0' + body;
    } else {
      const v = arg as number;
      const neg = v < 0 || Object.is(v, -0);
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      if (Number.isNaN(v)) {
        body = upper ? 'NAN' : 'nan';
        zeroOk = false;
      } else {
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        const a = Math.abs(v);
        if (a === Infinity) {
          body = upper ? 'INF' : 'inf';
          zeroOk = false;
        } else {
          const p = prec === undefined ? 6 : prec;
          const lc = conv.toLowerCase();
          if (lc === 'f') body = fixed(a, p, alt);
          else if (lc === 'e') body = sciStr(a, p, alt, upper, false);
          else {
            const P = p === 0 ? 1 : p;
            const { x } = sci(a, P);
            if (P > x && x >= -4) {
              body = fixed(a, P - 1 - x, alt);
              if (!alt && body.includes('.')) body = body.replace(/0+$/, '').replace(/\.$/, '');
            } else body = sciStr(a, P - 1, alt, upper, !alt);
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
