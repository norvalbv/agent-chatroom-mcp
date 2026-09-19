function decompose(x: number): [bigint, number] {
  // x finite, > 0 : x = m * 2^e exactly
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, x);
  const hi = buf.getUint32(0);
  const lo = buf.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (expBits === 0) return [m, -1074];
  m |= 1n << 52n;
  return [m, expBits - 1075];
}

// round(x * 10^k), half-even, exact
function roundScaled(x: number, k: number): bigint {
  if (x === 0) return 0n;
  const [m, e] = decompose(x);
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

function fixed(x: number, prec: number, alt: boolean): string {
  const s = roundScaled(x, prec).toString().padStart(prec + 1, '0');
  if (prec === 0) return alt ? s + '.' : s;
  return s.slice(0, s.length - prec) + '.' + s.slice(s.length - prec);
}

// returns [digit string of length prec+1, decimal exponent]
function sci(x: number, prec: number): [string, number] {
  if (x === 0) return ['0'.repeat(prec + 1), 0];
  let e10 = Math.floor(Math.log10(x));
  if (!isFinite(e10)) e10 = -320;
  const lo = 10n ** BigInt(prec);
  const hi = lo * 10n;
  for (let i = 0; i < 20; i++) {
    const n = roundScaled(x, prec - e10);
    if (n >= hi) e10++;
    else if (n < lo) e10--;
    else return [n.toString(), e10];
  }
  throw new Error('unreachable');
}

function expStr(x: number, prec: number, alt: boolean, upper: boolean): string {
  const [d, e10] = sci(x, prec);
  let body = d[0];
  if (prec > 0) body += '.' + d.slice(1);
  else if (alt) body += '.';
  const ae = Math.abs(e10);
  body += (upper ? 'E' : 'e') + (e10 < 0 ? '-' : '+') + (ae < 10 ? '0' + ae : String(ae));
  return body;
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
    const prec: number | undefined = p === undefined ? undefined : p === '' ? 0 : parseInt(p, 10);
    const arg = args[ai++];

    let sign = '';
    let prefix = '';
    let body = '';
    let zeroOk = false;

    if (conv === 's' || conv === 'c') {
      body = String(arg);
      if (conv === 's' && prec !== undefined) body = body.slice(0, prec);
    } else if ('dioxX'.includes(conv)) {
      let v = BigInt(arg as number | bigint);
      if (conv === 'd' || conv === 'i') {
        if (v < 0n) {
          sign = '-';
          v = -v;
        } else sign = plus ? '+' : space ? ' ' : '';
      }
      const radix = conv === 'o' ? 8 : conv === 'd' || conv === 'i' ? 10 : 16;
      let digits = v.toString(radix);
      if (conv === 'X') digits = digits.toUpperCase();
      if (prec !== undefined) {
        if (prec === 0 && v === 0n) digits = '';
        digits = digits.padStart(prec, '0');
      }
      if (alt) {
        if (conv === 'o') {
          if (!digits.startsWith('0')) digits = '0' + digits;
        } else if ((conv === 'x' || conv === 'X') && v !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      }
      body = digits;
      zeroOk = zero && prec === undefined;
    } else {
      const x = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      if (Number.isNaN(x)) {
        body = upper ? 'NAN' : 'nan';
      } else {
        const neg = x < 0 || Object.is(x, -0);
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        const a = Math.abs(x);
        if (a === Infinity) {
          body = upper ? 'INF' : 'inf';
        } else {
          zeroOk = zero;
          const lc = conv.toLowerCase();
          if (lc === 'f') body = fixed(a, prec ?? 6, alt);
          else if (lc === 'e') body = expStr(a, prec ?? 6, alt, upper);
          else {
            let P = prec ?? 6;
            if (P === 0) P = 1;
            const X = sci(a, P - 1)[1];
            if (P > X && X >= -4) {
              body = fixed(a, P - 1 - X, alt);
              if (!alt && body.includes('.')) body = body.replace(/\.?0+$/, '');
            } else {
              body = expStr(a, P - 1, alt, upper);
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
