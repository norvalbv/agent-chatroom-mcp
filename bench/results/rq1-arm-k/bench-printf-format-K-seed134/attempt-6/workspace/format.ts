function decompose(v: number): { m: bigint; e: number } {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, v);
  const bits = dv.getBigUint64(0);
  const expBits = Number((bits >> 52n) & 0x7ffn);
  const frac = bits & ((1n << 52n) - 1n);
  if (expBits === 0) return { m: frac, e: -1074 };
  return { m: frac | (1n << 52n), e: expBits - 1075 };
}

// round(v * 10^k), half to even, v >= 0 finite
function roundScaled(v: number, k: number): bigint {
  const { m, e } = decompose(v);
  let num = m;
  let den = 1n;
  if (k >= 0) num *= 10n ** BigInt(k);
  else den *= 10n ** BigInt(-k);
  if (e >= 0) num *= 1n << BigInt(e);
  else den *= 1n << BigInt(-e);
  const q = num / den;
  const r = num % den;
  const twice = r * 2n;
  if (twice > den || (twice === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// P significant digits: returns digit string of length P and decimal exponent
function sigDigits(v: number, P: number): { digits: string; x: number } {
  if (v === 0) return { digits: '0'.repeat(P), x: 0 };
  let x = Math.floor(Math.log10(v));
  if (!Number.isFinite(x)) x = 0;
  const lo = 10n ** BigInt(P - 1);
  const hi = 10n ** BigInt(P);
  for (let i = 0; i < 20; i++) {
    const s = roundScaled(v, P - 1 - x);
    if (s >= hi) x++;
    else if (s < lo) x--;
    else return { digits: s.toString(), x };
  }
  throw new Error('digit generation failed');
}

function fStyle(v: number, prec: number, alt: boolean): string {
  let s = roundScaled(v, prec).toString();
  if (s.length < prec + 1) s = '0'.repeat(prec + 1 - s.length) + s;
  const ip = s.slice(0, s.length - prec);
  const fp = s.slice(s.length - prec);
  return ip + (prec > 0 || alt ? '.' : '') + fp;
}

function eStyle(v: number, prec: number, alt: boolean, upper: boolean, strip = false): string {
  const { digits, x } = sigDigits(v, prec + 1);
  let frac = digits.slice(1);
  if (strip) frac = frac.replace(/0+$/, '');
  const mant = digits[0] + (frac.length > 0 || alt ? '.' : '') + frac;
  const ax = Math.abs(x);
  return mant + (upper ? 'E' : 'e') + (x < 0 ? '-' : '+') + (ax < 10 ? '0' : '') + ax;
}

function gStyle(v: number, precIn: number | undefined, alt: boolean, upper: boolean): string {
  let P = precIn === undefined ? 6 : precIn;
  if (P === 0) P = 1;
  const { x } = sigDigits(v, P);
  if (P > x && x >= -4) {
    let s = fStyle(v, P - 1 - x, alt);
    if (!alt && s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
    return s;
  }
  return eStyle(v, P - 1, alt, upper, !alt);
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let ai = 0;
  const re = /%([-+ 0#]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc%])/g;
  return fmt.replace(re, (_m, flags: string, w: string, p: string | undefined, conv: string) => {
    if (conv === '%') return '%';
    const arg = args[ai++];
    const left = flags.includes('-');
    const plus = flags.includes('+');
    const space = flags.includes(' ');
    const zero = flags.includes('0') && !left;
    const alt = flags.includes('#');
    const width = w === '' ? 0 : parseInt(w, 10);
    const prec = p === undefined ? undefined : p === '' ? 0 : parseInt(p, 10);

    let sign = '';
    let prefix = '';
    let body: string;
    let canZero = false;

    if (conv === 's' || conv === 'c') {
      body = String(arg);
      if (conv === 's' && prec !== undefined) body = body.slice(0, prec);
    } else if ('diouxX'.includes(conv)) {
      let n = typeof arg === 'bigint' ? arg : BigInt(arg as number);
      const signed = conv === 'd' || conv === 'i';
      if (signed) {
        if (n < 0n) {
          sign = '-';
          n = -n;
        } else sign = plus ? '+' : space ? ' ' : '';
      }
      let digits = n === 0n && prec === 0 ? '' : n.toString(conv === 'o' ? 8 : signed ? 10 : 16);
      if (conv === 'X') digits = digits.toUpperCase();
      if (prec !== undefined && digits.length < prec) digits = '0'.repeat(prec - digits.length) + digits;
      if (alt) {
        if (conv === 'o') {
          if (digits[0] !== '0') digits = '0' + digits;
        } else if ((conv === 'x' || conv === 'X') && n !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      }
      body = digits;
      canZero = prec === undefined;
    } else {
      const num = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      if (Number.isNaN(num)) {
        body = upper ? 'NAN' : 'nan';
      } else {
        const neg = num < 0 || Object.is(num, -0);
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        const v = Math.abs(num);
        if (v === Infinity) body = upper ? 'INF' : 'inf';
        else {
          canZero = true;
          const lc = conv.toLowerCase();
          if (lc === 'f') body = fStyle(v, prec === undefined ? 6 : prec, alt);
          else if (lc === 'e') body = eStyle(v, prec === undefined ? 6 : prec, alt, upper);
          else body = gStyle(v, prec, alt, upper);
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
