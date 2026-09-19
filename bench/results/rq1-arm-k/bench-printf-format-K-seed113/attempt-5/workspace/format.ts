const buf = new DataView(new ArrayBuffer(8));

// positive finite x -> [m, e] with x = m * 2^e
function decompose(x: number): [bigint, number] {
  buf.setFloat64(0, x);
  const bits = buf.getBigUint64(0);
  const expBits = Number((bits >> 52n) & 0x7ffn);
  const frac = bits & 0xfffffffffffffn;
  if (expBits === 0) return [frac, -1074];
  return [frac | (1n << 52n), expBits - 1075];
}

// round-half-even(x * 10^k), x positive finite
function scaled(x: number, k: number): bigint {
  const [m, e] = decompose(x);
  let num = m;
  let den = 1n;
  if (e >= 0) num <<= BigInt(e);
  else den <<= BigInt(-e);
  if (k >= 0) num *= 10n ** BigInt(k);
  else den *= 10n ** BigInt(-k);
  const q = num / den;
  const r = num - q * den;
  const twice = r * 2n;
  if (twice > den || (twice === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// e-style digits: returns [digit string of length p+1, decimal exponent]
function eDigits(x: number, p: number): [string, number] {
  if (x === 0) return ['0'.repeat(p + 1), 0];
  let e10 = Math.floor(Math.log10(x));
  const lo = 10n ** BigInt(p);
  const hi = lo * 10n;
  for (;;) {
    const d = scaled(x, p - e10);
    if (d >= hi) e10++;
    else if (d < lo) e10--;
    else return [d.toString(), e10];
  }
}

function fDigits(x: number, p: number): string {
  const d = x === 0 ? 0n : scaled(x, p);
  let s = d.toString();
  if (s.length < p + 1) s = '0'.repeat(p + 1 - s.length) + s;
  return p === 0 ? s : s.slice(0, s.length - p) + '.' + s.slice(s.length - p);
}

function expStr(e10: number, upper: boolean): string {
  const a = Math.abs(e10);
  return (upper ? 'E' : 'e') + (e10 < 0 ? '-' : '+') + (a < 10 ? '0' : '') + a;
}

function stripZeros(s: string): string {
  if (!s.includes('.')) return s;
  return s.replace(/0+$/, '').replace(/\.$/, '');
}

function eStyle(x: number, p: number, alt: boolean, upper: boolean, strip: boolean): string {
  const [d, e10] = eDigits(x, p);
  let m = d[0] + (p > 0 ? '.' + d.slice(1) : '');
  if (strip) m = stripZeros(m);
  if (alt && !m.includes('.')) m += '.';
  return m + expStr(e10, upper);
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let ai = 0;
  const re = /%([-+ 0#]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc%])/g;
  return fmt.replace(re, (_m, flags: string, w: string, prec: string | undefined, conv: string) => {
    if (conv === '%') return '%';
    const arg = args[ai++];
    const left = flags.includes('-');
    const plus = flags.includes('+');
    const space = flags.includes(' ');
    const zero = flags.includes('0');
    const alt = flags.includes('#');
    const width = w ? parseInt(w, 10) : 0;
    const hasPrec = prec !== undefined;
    const precN = hasPrec ? (prec === '' ? 0 : parseInt(prec, 10)) : 0;

    const pad = (sign: string, body: string, allowZero: boolean): string => {
      const len = sign.length + body.length;
      if (len >= width) return sign + body;
      const n = width - len;
      if (left) return sign + body + ' '.repeat(n);
      if (zero && allowZero) {
        // body may start with a 0x prefix
        const pm = /^0[xX]/.exec(body);
        const pre = pm ? pm[0] : '';
        return sign + pre + '0'.repeat(n) + body.slice(pre.length);
      }
      return ' '.repeat(n) + sign + body;
    };

    if (conv === 's' || conv === 'c') {
      let s = String(arg);
      if (conv === 's' && hasPrec) s = s.slice(0, precN);
      return pad('', s, false);
    }

    if ('dioxX'.includes(conv)) {
      const v = BigInt(arg as number | bigint);
      let sign = '';
      let mag = v;
      if (conv === 'd' || conv === 'i') {
        if (v < 0n) {
          sign = '-';
          mag = -v;
        } else sign = plus ? '+' : space ? ' ' : '';
      }
      let digits = conv === 'o' ? mag.toString(8) : conv === 'd' || conv === 'i' ? mag.toString() : mag.toString(16);
      if (conv === 'X') digits = digits.toUpperCase();
      if (hasPrec) {
        if (precN === 0 && mag === 0n) digits = '';
        else if (digits.length < precN) digits = '0'.repeat(precN - digits.length) + digits;
      }
      let prefix = '';
      if (alt) {
        if (conv === 'o') {
          if (!digits.startsWith('0')) digits = '0' + digits;
        } else if ((conv === 'x' || conv === 'X') && mag !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      }
      return pad(sign, prefix + digits, !hasPrec);
    }

    // floating point
    const x = arg as number;
    const upper = conv === 'E' || conv === 'F' || conv === 'G';
    const neg = x < 0 || Object.is(x, -0);
    const sign = Number.isNaN(x) ? '' : neg ? '-' : plus ? '+' : space ? ' ' : '';
    if (!Number.isFinite(x)) {
      let t = Number.isNaN(x) ? 'nan' : 'inf';
      if (upper) t = t.toUpperCase();
      return pad(sign, t, false);
    }
    const ax = Math.abs(x);
    const lower = conv.toLowerCase();
    let body: string;
    if (lower === 'f') {
      const p = hasPrec ? precN : 6;
      body = fDigits(ax, p);
      if (p === 0 && alt) body += '.';
    } else if (lower === 'e') {
      body = eStyle(ax, hasPrec ? precN : 6, alt, conv === 'E', false);
    } else {
      let P = hasPrec ? precN : 6;
      if (P === 0) P = 1;
      const X = eDigits(ax, P - 1)[1];
      if (P > X && X >= -4) {
        const p = P - 1 - X;
        body = fDigits(ax, p);
        if (!alt) body = stripZeros(body);
        else if (p === 0) body += '.';
      } else {
        body = eStyle(ax, P - 1, alt, conv === 'G', !alt);
      }
    }
    return pad(sign, body, true);
  });
}
