function decompose(abs: number): [bigint, number] {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, abs);
  const bits = dv.getBigUint64(0);
  const ef = Number((bits >> 52n) & 0x7ffn);
  const frac = bits & ((1n << 52n) - 1n);
  return ef === 0 ? [frac, -1074] : [frac | (1n << 52n), ef - 1075];
}

// round(abs * 10^k), half to even, using the exact binary value
function roundScaled(abs: number, k: number): bigint {
  const [m, e] = decompose(abs);
  let num = m;
  let den = 1n;
  if (e >= 0) num <<= BigInt(e);
  else den <<= BigInt(-e);
  if (k >= 0) num *= 10n ** BigInt(k);
  else den *= 10n ** BigInt(-k);
  let q = num / den;
  const r2 = (num % den) * 2n;
  if (r2 > den || (r2 === den && (q & 1n) === 1n)) q += 1n;
  return q;
}

function fixedText(abs: number, prec: number, alt: boolean): string {
  let s = roundScaled(abs, prec).toString();
  if (s.length < prec + 1) s = '0'.repeat(prec + 1 - s.length) + s;
  const ip = s.slice(0, s.length - prec);
  const fp = s.slice(s.length - prec);
  return prec > 0 ? ip + '.' + fp : alt ? ip + '.' : ip;
}

// digits (p+1 of them) and decimal exponent
function expParts(abs: number, p: number): [string, number] {
  if (abs === 0) return ['0'.repeat(p + 1), 0];
  let x = Math.floor(Math.log10(abs));
  for (;;) {
    const s = roundScaled(abs, p - x).toString();
    if (s.length > p + 1) x++;
    else if (s.length < p + 1) x--;
    else return [s, x];
  }
}

function expText(digits: string, x: number, alt: boolean, upper: boolean, strip: boolean): string {
  let frac = digits.slice(1);
  if (strip) frac = frac.replace(/0+$/, '');
  let m = digits[0] + (frac.length > 0 ? '.' + frac : alt ? '.' : '');
  const ax = Math.abs(x);
  return m + (upper ? 'E' : 'e') + (x < 0 ? '-' : '+') + (ax < 10 ? '0' : '') + ax;
}

function pad(body: string, width: number, left: boolean): string {
  if (body.length >= width) return body;
  return left ? body + ' '.repeat(width - body.length) : ' '.repeat(width - body.length) + body;
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let ai = 0;
  return fmt.replace(/%([-+ 0#]*)(\d*)(\.\d*)?([diouxXeEfFgGsc%])/g, (_m, flags: string, w: string, p: string | undefined, conv: string) => {
    if (conv === '%') return '%';
    const arg = args[ai++];
    const left = flags.includes('-');
    const plus = flags.includes('+');
    const space = flags.includes(' ');
    const zero = flags.includes('0') && !left;
    const alt = flags.includes('#');
    const width = w === '' ? 0 : parseInt(w, 10);
    const prec = p === undefined ? undefined : p.length === 1 ? 0 : parseInt(p.slice(1), 10);

    if (conv === 's' || conv === 'c') {
      let s = String(arg);
      if (conv === 's' && prec !== undefined) s = s.slice(0, prec);
      return pad(s, width, left);
    }

    let sign = '';
    let prefix = '';
    let digits: string;
    let canZero = zero;

    if ('diouxX'.includes(conv)) {
      const v = BigInt(arg as number | bigint);
      const neg = v < 0n;
      const a = neg ? -v : v;
      const base = conv === 'o' ? 8 : conv === 'd' || conv === 'i' ? 10 : 16;
      digits = a.toString(base);
      if (conv === 'X') digits = digits.toUpperCase();
      if (prec !== undefined) {
        if (prec === 0 && a === 0n) digits = '';
        if (digits.length < prec) digits = '0'.repeat(prec - digits.length) + digits;
        canZero = false;
      }
      if (base === 10) sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
      else if (alt) {
        if (base === 8) {
          if (!digits.startsWith('0')) digits = '0' + digits;
        } else if (a !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      }
    } else {
      const v = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      const neg = !Number.isNaN(v) && (v < 0 || Object.is(v, -0));
      sign = neg ? '-' : Number.isNaN(v) ? '' : plus ? '+' : space ? ' ' : '';
      if (!Number.isFinite(v)) {
        digits = Number.isNaN(v) ? 'nan' : 'inf';
        if (upper) digits = digits.toUpperCase();
        canZero = false;
      } else {
        const a = Math.abs(v);
        const lc = conv.toLowerCase();
        if (lc === 'f') digits = fixedText(a, prec ?? 6, alt);
        else if (lc === 'e') {
          const [d, x] = expParts(a, prec ?? 6);
          digits = expText(d, x, alt, upper, false);
        } else {
          const P = prec === undefined ? 6 : Math.max(prec, 1);
          const [d, x] = expParts(a, P - 1);
          if (P > x && x >= -4) {
            digits = fixedText(a, P - 1 - x, alt);
            if (!alt && digits.includes('.')) digits = digits.replace(/0+$/, '').replace(/\.$/, '');
          } else {
            digits = expText(d, x, alt, upper, !alt);
          }
        }
      }
    }

    const head = sign + prefix;
    if (canZero && head.length + digits.length < width) {
      digits = '0'.repeat(width - head.length - digits.length) + digits;
    }
    return pad(head + digits, width, left);
  });
}
