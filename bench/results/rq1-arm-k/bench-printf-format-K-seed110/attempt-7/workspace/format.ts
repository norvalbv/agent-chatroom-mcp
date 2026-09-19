function decompose(x: number): { m: bigint; e2: number } {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, x);
  const bits = dv.getBigUint64(0);
  const ex = Number((bits >> 52n) & 0x7ffn);
  const frac = bits & 0xfffffffffffffn;
  if (ex === 0) return { m: frac, e2: -1074 };
  return { m: frac | (1n << 52n), e2: ex - 1075 };
}

// round(m * 2^e2 * 10^k), ties to even
function scaled(m: bigint, e2: number, k: number): bigint {
  let num = m;
  let den = 1n;
  if (e2 >= 0) num <<= BigInt(e2);
  else den <<= BigInt(-e2);
  if (k >= 0) num *= 10n ** BigInt(k);
  else den *= 10n ** BigInt(-k);
  const q = num / den;
  const r2 = (num % den) * 2n;
  if (r2 > den || (r2 === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

function fixedStr(ax: number, p: number, alt: boolean): string {
  const { m, e2 } = decompose(ax);
  let s = scaled(m, e2, p).toString();
  if (s.length < p + 1) s = '0'.repeat(p + 1 - s.length) + s;
  const ip = s.slice(0, s.length - p);
  const fp = s.slice(s.length - p);
  return ip + (p > 0 || alt ? '.' : '') + fp;
}

function expParts(ax: number, p: number): { digits: string; X: number } {
  if (ax === 0) return { digits: '0'.repeat(p + 1), X: 0 };
  const { m, e2 } = decompose(ax);
  let X = Math.floor(Math.log10(ax));
  const hi = 10n ** BigInt(p + 1);
  const lo = 10n ** BigInt(p);
  for (let i = 0; i < 10; i++) {
    const d = scaled(m, e2, p - X);
    if (d >= hi) X++;
    else if (d < lo) X--;
    else return { digits: d.toString(), X };
  }
  throw new Error('exponent search failed');
}

function expStr(ax: number, p: number, alt: boolean, upper: boolean): string {
  const { digits, X } = expParts(ax, p);
  const a = Math.abs(X);
  const es = (a < 10 ? '0' : '') + a;
  return (
    digits[0] + (p > 0 || alt ? '.' : '') + digits.slice(1) +
    (upper ? 'E' : 'e') + (X < 0 ? '-' : '+') + es
  );
}

function stripZeros(s: string): string {
  const ei = s.search(/[eE]/);
  let mant = ei < 0 ? s : s.slice(0, ei);
  const tail = ei < 0 ? '' : s.slice(ei);
  if (mant.includes('.')) mant = mant.replace(/0+$/, '').replace(/\.$/, '');
  return mant + tail;
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let ai = 0;
  const re = /%([-+ 0#]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc%])/g;
  return fmt.replace(re, (_all, flags: string, w: string, pr: string | undefined, conv: string) => {
    if (conv === '%') return '%';
    const arg = args[ai++];
    const left = flags.includes('-');
    const plus = flags.includes('+');
    const space = flags.includes(' ');
    const zero = flags.includes('0') && !left;
    const alt = flags.includes('#');
    const width = w === '' ? 0 : parseInt(w, 10);
    const hasPrec = pr !== undefined;
    const prec = hasPrec ? (pr === '' ? 0 : parseInt(pr, 10)) : -1;

    let prefix = '';
    let body: string;
    let canZero = zero;

    if (conv === 's' || conv === 'c') {
      body = String(arg);
      if (conv === 's' && hasPrec) body = body.slice(0, prec);
      canZero = false;
    } else if ('dixXo'.includes(conv)) {
      const v = BigInt(arg as number | bigint);
      const neg = v < 0n;
      const av = neg ? -v : v;
      let digits = conv === 'x' ? av.toString(16) : conv === 'X' ? av.toString(16).toUpperCase()
        : conv === 'o' ? av.toString(8) : av.toString();
      if (hasPrec) {
        if (prec === 0 && av === 0n) digits = '';
        if (digits.length < prec) digits = '0'.repeat(prec - digits.length) + digits;
        canZero = false;
      }
      if (conv === 'd' || conv === 'i') {
        prefix = neg ? '-' : plus ? '+' : space ? ' ' : '';
      } else if (conv === 'o') {
        if (alt && digits[0] !== '0') digits = '0' + digits;
      } else if (alt && av !== 0n) {
        prefix = conv === 'x' ? '0x' : '0X';
      }
      body = digits;
    } else {
      const x = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      const neg = Object.is(x, -0) || (x < 0);
      if (Number.isNaN(x)) {
        body = upper ? 'NAN' : 'nan';
        canZero = false;
      } else {
        prefix = neg ? '-' : plus ? '+' : space ? ' ' : '';
        if (!Number.isFinite(x)) {
          body = upper ? 'INF' : 'inf';
          canZero = false;
        } else {
          const ax = Math.abs(x);
          const p = hasPrec ? prec : 6;
          const lc = conv.toLowerCase();
          if (lc === 'f') {
            body = fixedStr(ax, p, alt);
          } else if (lc === 'e') {
            body = expStr(ax, p, alt, upper);
          } else {
            const P = p === 0 ? 1 : p;
            const { X } = expParts(ax, P - 1);
            if (P > X && X >= -4) body = fixedStr(ax, P - 1 - X, alt);
            else body = expStr(ax, P - 1, alt, upper);
            if (!alt) body = stripZeros(body);
          }
        }
      }
    }

    const len = prefix.length + body.length;
    if (len >= width) return prefix + body;
    const pad = width - len;
    if (left) return prefix + body + ' '.repeat(pad);
    if (canZero) return prefix + '0'.repeat(pad) + body;
    return ' '.repeat(pad) + prefix + body;
  });
}
