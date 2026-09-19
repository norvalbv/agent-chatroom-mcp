function decompose(v: number): { mant: bigint; exp2: number } {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, Math.abs(v));
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const expField = (hi >>> 20) & 0x7ff;
  const frac = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (expField === 0) return { mant: frac, exp2: -1074 };
  return { mant: frac | (1n << 52n), exp2: expField - 1075 };
}

// round(|v| * 10^k), half to even, exact
function roundScaled(mant: bigint, exp2: number, k: number): bigint {
  let num = mant;
  let den = 1n;
  if (k >= 0) num *= 10n ** BigInt(k);
  else den *= 10n ** BigInt(-k);
  if (exp2 >= 0) num <<= BigInt(exp2);
  else den <<= BigInt(-exp2);
  const q = num / den;
  const r2 = (num % den) * 2n;
  if (r2 > den || (r2 === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

function fixedStr(v: number, prec: number, alt: boolean): string {
  const { mant, exp2 } = decompose(v);
  let s = roundScaled(mant, exp2, prec).toString();
  if (s.length < prec + 1) s = '0'.repeat(prec + 1 - s.length) + s;
  const ip = s.slice(0, s.length - prec);
  const fp = s.slice(s.length - prec);
  return ip + (prec > 0 || alt ? '.' : '') + fp;
}

function expParts(v: number, prec: number): { digits: string; x: number } {
  if (v === 0) return { digits: '0'.repeat(prec + 1), x: 0 };
  const { mant, exp2 } = decompose(v);
  let e10 = Math.floor(Math.log10(Math.abs(v)));
  const lo = 10n ** BigInt(prec);
  const hi = lo * 10n;
  for (;;) {
    const n = roundScaled(mant, exp2, prec - e10);
    if (n >= hi) e10++;
    else if (n < lo) e10--;
    else return { digits: n.toString(), x: e10 };
  }
}

function expStr(v: number, prec: number, alt: boolean, upper: boolean): string {
  const { digits, x } = expParts(v, prec);
  const ax = Math.abs(x);
  return (
    digits[0] +
    (prec > 0 || alt ? '.' : '') +
    digits.slice(1) +
    (upper ? 'E' : 'e') +
    (x < 0 ? '-' : '+') +
    (ax < 10 ? '0' : '') +
    ax
  );
}

function stripZeros(s: string): string {
  const m = /^([^eE]*)(.*)$/.exec(s)!;
  let mantissa = m[1];
  if (mantissa.includes('.')) mantissa = mantissa.replace(/0+$/, '').replace(/\.$/, '');
  return mantissa + m[2];
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let ai = 0;
  return fmt.replace(/%([-+ 0#]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc%])/g, (_m, fl, w, p, conv) => {
    if (conv === '%') return '%';
    const arg = args[ai++];
    const minus = fl.includes('-');
    const plus = fl.includes('+');
    const space = fl.includes(' ');
    const zero = fl.includes('0');
    const alt = fl.includes('#');
    const width = w ? parseInt(w, 10) : 0;
    const hasPrec = p !== undefined;
    const precV = hasPrec ? parseInt(p, 10) || 0 : undefined;

    let head = '';
    let body = '';
    let canZero = false;

    if (conv === 's' || conv === 'c') {
      body = String(arg);
      if (conv === 's' && precV !== undefined) body = body.slice(0, precV);
    } else if ('dioxX'.includes(conv)) {
      let n = BigInt(arg as number | bigint);
      const neg = n < 0n;
      if (neg) n = -n;
      let digits = conv === 'd' || conv === 'i' ? n.toString() : conv === 'o' ? n.toString(8) : n.toString(16);
      if (conv === 'X') digits = digits.toUpperCase();
      if (precV !== undefined) {
        if (precV === 0 && n === 0n) digits = '';
        else if (digits.length < precV) digits = '0'.repeat(precV - digits.length) + digits;
      }
      if (conv === 'd' || conv === 'i') {
        head = neg ? '-' : plus ? '+' : space ? ' ' : '';
      } else if (alt) {
        if (conv === 'o') {
          if (!digits.startsWith('0')) digits = '0' + digits;
        } else if (n !== 0n) head = conv === 'x' ? '0x' : '0X';
      }
      body = digits;
      canZero = precV === undefined;
    } else {
      const v = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      const neg = v < 0 || Object.is(v, -0);
      if (Number.isNaN(v)) {
        body = upper ? 'NAN' : 'nan';
      } else {
        head = neg ? '-' : plus ? '+' : space ? ' ' : '';
        if (!Number.isFinite(v)) {
          body = upper ? 'INF' : 'inf';
        } else {
          canZero = true;
          const prec = precV === undefined ? 6 : precV;
          const lc = conv.toLowerCase();
          if (lc === 'f') body = fixedStr(v, prec, alt);
          else if (lc === 'e') body = expStr(v, prec, alt, upper);
          else {
            const P = precV === undefined ? 6 : precV === 0 ? 1 : precV;
            const { x } = expParts(v, P - 1);
            body =
              P > x && x >= -4 ? fixedStr(v, P - 1 - x, alt) : expStr(v, P - 1, alt, upper);
            if (!alt) body = stripZeros(body);
          }
        }
      }
    }

    let len = head.length + body.length;
    if (len < width) {
      if (minus) return head + body + ' '.repeat(width - len);
      if (zero && canZero) return head + '0'.repeat(width - len) + body;
      return ' '.repeat(width - len) + head + body;
    }
    return head + body;
  });
}
