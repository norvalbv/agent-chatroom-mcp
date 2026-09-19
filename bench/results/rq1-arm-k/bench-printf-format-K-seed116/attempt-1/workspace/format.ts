function decompose(x: number): { m: bigint; e: number } {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, x);
  const bits = dv.getBigUint64(0);
  const exp = Number((bits >> 52n) & 0x7ffn);
  const frac = bits & ((1n << 52n) - 1n);
  if (exp === 0) return { m: frac, e: -1074 };
  return { m: frac | (1n << 52n), e: exp - 1075 };
}

// round_half_even(|x| * 10^k) for finite x
function roundScaled(x: number, k: number): bigint {
  const { m, e } = decompose(Math.abs(x));
  let num = m;
  let den = 1n;
  if (k >= 0) num *= 10n ** BigInt(k);
  else den *= 10n ** BigInt(-k);
  if (e >= 0) num <<= BigInt(e);
  else den <<= BigInt(-e);
  const q = num / den;
  const r = num % den;
  const twice = r * 2n;
  if (twice > den || (twice === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

function fFixed(x: number, fd: number, alt: boolean): string {
  let s = roundScaled(x, fd).toString();
  if (fd > 0) {
    s = s.padStart(fd + 1, '0');
    return s.slice(0, s.length - fd) + '.' + s.slice(s.length - fd);
  }
  return alt ? s + '.' : s;
}

function eParts(x: number, p: number): { digits: string; exp: number } {
  if (x === 0) return { digits: '0'.repeat(p + 1), exp: 0 };
  let exp = Math.floor(Math.log10(Math.abs(x)));
  if (!Number.isFinite(exp)) exp = -324;
  const lo = 10n ** BigInt(p);
  const hi = lo * 10n;
  for (;;) {
    const n = roundScaled(x, p - exp);
    if (n >= hi) exp++;
    else if (n < lo) exp--;
    else return { digits: n.toString(), exp };
  }
}

function eStr(digits: string, exp: number, alt: boolean, upper: boolean): string {
  const p = digits.length - 1;
  let s = digits[0] + (p > 0 ? '.' + digits.slice(1) : alt ? '.' : '');
  const a = Math.abs(exp).toString().padStart(2, '0');
  s += (upper ? 'E' : 'e') + (exp < 0 ? '-' : '+') + a;
  return s;
}

function stripZeros(s: string): string {
  if (!s.includes('.')) return s;
  return s.replace(/0+$/, '').replace(/\.$/, '');
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let ai = 0;
  return fmt.replace(
    /%(?:(%)|([-+ 0#]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc]))/g,
    (_m, pct, flags: string, w: string, pr: string | undefined, conv: string) => {
      if (pct) return '%';
      const arg = args[ai++];
      const left = flags.includes('-');
      const plus = flags.includes('+');
      const space = flags.includes(' ');
      const zero = flags.includes('0') && !left;
      const alt = flags.includes('#');
      const width = w ? parseInt(w, 10) : 0;
      const prec = pr === undefined ? undefined : pr === '' ? 0 : parseInt(pr, 10);

      const pad = (sign: string, body: string, zeroOk: boolean): string => {
        const len = sign.length + body.length;
        if (len >= width) return sign + body;
        if (left) return sign + body + ' '.repeat(width - len);
        if (zero && zeroOk) return sign + '0'.repeat(width - len) + body;
        return ' '.repeat(width - len) + sign + body;
      };

      if (conv === 's' || conv === 'c') {
        let s = String(arg);
        if (conv === 's' && prec !== undefined) s = s.slice(0, prec);
        return pad('', s, false);
      }

      if ('diouxX'.includes(conv)) {
        const v = BigInt(arg as number | bigint);
        const neg = v < 0n;
        const mag = neg ? -v : v;
        const radix = conv === 'o' ? 8 : conv === 'd' || conv === 'i' ? 10 : 16;
        let digits = mag.toString(radix);
        if (conv === 'X') digits = digits.toUpperCase();
        if (mag === 0n && prec === 0) digits = '';
        if (prec !== undefined) digits = digits.padStart(prec, '0');
        let sign = '';
        if (conv === 'd' || conv === 'i') sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        else if (alt) {
          if (conv === 'o') {
            if (digits[0] !== '0') digits = '0' + digits;
          } else if (mag !== 0n) sign = conv === 'x' ? '0x' : '0X';
        }
        return pad(sign, digits, prec === undefined);
      }

      // floating point
      const x = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      const negBit = Object.is(x, -0) || x < 0;
      if (Number.isNaN(x)) return pad('', upper ? 'NAN' : 'nan', false);
      const sign = negBit ? '-' : plus ? '+' : space ? ' ' : '';
      if (!Number.isFinite(x)) return pad(sign, upper ? 'INF' : 'inf', false);
      const p = prec === undefined ? 6 : prec;
      let body: string;
      const lc = conv.toLowerCase();
      if (lc === 'f') {
        body = fFixed(x, p, alt);
      } else if (lc === 'e') {
        const { digits, exp } = eParts(x, p);
        body = eStr(digits, exp, alt, upper);
      } else {
        const P = p === 0 ? 1 : p;
        const { digits, exp } = eParts(x, P - 1);
        if (P > exp && exp >= -4) {
          body = fFixed(x, P - 1 - exp, alt);
          if (!alt) body = stripZeros(body);
        } else {
          let d = digits;
          if (!alt) {
            d = d[0] + stripZeros('0.' + d.slice(1)).slice(2);
          }
          body = eStr(d, exp, alt, upper);
        }
      }
      return pad(sign, body, true);
    },
  );
}
