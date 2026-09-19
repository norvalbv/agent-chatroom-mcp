// |v| = m * 2^e exactly (v finite, nonzero)
function decompose(v: number): { m: bigint; e: number } {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, Math.abs(v));
  const bits = dv.getBigUint64(0);
  const ex = Number((bits >> 52n) & 0x7ffn);
  const frac = bits & 0xfffffffffffffn;
  if (ex === 0) return { m: frac, e: -1074 };
  return { m: frac | (1n << 52n), e: ex - 1075 };
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
  const twice = r * 2n;
  if (twice > den || (twice === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

function fixed(v: number, p: number, alt: boolean): string {
  let n = 0n;
  if (v !== 0) {
    const { m, e } = decompose(v);
    n = roundScaled(m, e, p);
  }
  const s = n.toString().padStart(p + 1, '0');
  const ip = s.slice(0, s.length - p);
  const fp = s.slice(s.length - p);
  return ip + (p > 0 || alt ? '.' : '') + fp;
}

function sci(v: number, p: number): { digits: string; x: number } {
  if (v === 0) return { digits: '0'.repeat(p + 1), x: 0 };
  const { m, e } = decompose(v);
  let x = Math.floor(Math.log10(Math.abs(v)));
  if (!isFinite(x)) x = Math.floor((e + m.toString(2).length - 1) * Math.log10(2));
  const lo = 10n ** BigInt(p);
  const hi = lo * 10n;
  for (;;) {
    const n = roundScaled(m, e, p - x);
    if (n >= hi) x++;
    else if (n < lo) x--;
    else return { digits: n.toString(), x };
  }
}

function expo(v: number, p: number, alt: boolean, upper: boolean): string {
  const { digits, x } = sci(v, p);
  const ax = Math.abs(x);
  return (
    digits[0] +
    (p > 0 || alt ? '.' : '') +
    digits.slice(1) +
    (upper ? 'E' : 'e') +
    (x < 0 ? '-' : '+') +
    (ax < 10 ? '0' + ax : String(ax))
  );
}

function stripZeros(s: string): string {
  const ei = s.search(/[eE]/);
  let mant = ei >= 0 ? s.slice(0, ei) : s;
  const rest = ei >= 0 ? s.slice(ei) : '';
  if (mant.includes('.')) mant = mant.replace(/0+$/, '').replace(/\.$/, '');
  return mant + rest;
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let ai = 0;
  const re = /%(?:(%)|([-+ 0#]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc]))/g;
  return fmt.replace(re, (_m, pct, flags: string, w: string, prec: string | undefined, conv: string) => {
    if (pct) return '%';
    const arg = args[ai++];
    const left = flags.includes('-');
    const plus = flags.includes('+');
    const space = flags.includes(' ');
    const zero = flags.includes('0') && !left;
    const alt = flags.includes('#');
    const width = w ? parseInt(w, 10) : 0;
    const hasPrec = prec !== undefined;
    const precN = hasPrec ? (prec === '' ? 0 : parseInt(prec, 10)) : 0;

    let sign = '';
    let prefix = '';
    let body: string;
    let canZero = true;

    if (conv === 's' || conv === 'c') {
      body = String(arg);
      if (conv === 's' && hasPrec) body = body.slice(0, precN);
      canZero = false;
    } else if ('dioxX'.includes(conv)) {
      const big = BigInt(arg as number | bigint);
      const neg = big < 0n;
      const mag = neg ? -big : big;
      const radix = conv === 'o' ? 8 : conv === 'd' || conv === 'i' ? 10 : 16;
      let digits = mag.toString(radix);
      if (conv === 'X') digits = digits.toUpperCase();
      if (hasPrec) {
        if (precN === 0 && mag === 0n) digits = '';
        digits = digits.padStart(precN, '0');
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
      body = digits;
      if (hasPrec) canZero = false;
    } else {
      const v = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      const neg = v < 0 || Object.is(v, -0);
      if (Number.isNaN(v)) {
        body = upper ? 'NAN' : 'nan';
        canZero = false;
      } else {
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        const a = Math.abs(v);
        if (a === Infinity) {
          body = upper ? 'INF' : 'inf';
          canZero = false;
        } else {
          const p = hasPrec ? precN : 6;
          const lc = conv.toLowerCase();
          if (lc === 'f') body = fixed(a, p, alt);
          else if (lc === 'e') body = expo(a, p, alt, upper);
          else {
            const P = p === 0 ? 1 : p;
            const x = sci(a, P - 1).x;
            if (P > x && x >= -4) body = fixed(a, P - 1 - x, alt);
            else body = expo(a, P - 1, alt, upper);
            if (!alt) body = stripZeros(body);
          }
        }
      }
    }

    const len = sign.length + prefix.length + body.length;
    if (len >= width) return sign + prefix + body;
    const pad = width - len;
    if (left) return sign + prefix + body + ' '.repeat(pad);
    if (zero && canZero) return sign + prefix + '0'.repeat(pad) + body;
    return ' '.repeat(pad) + sign + prefix + body;
  });
}
