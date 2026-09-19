function decompose(v: number): { m: bigint; e: number } {
  const f = new Float64Array(1);
  const b = new BigUint64Array(f.buffer);
  f[0] = v;
  const bits = b[0];
  const exp = Number((bits >> 52n) & 0x7ffn);
  const frac = bits & 0xfffffffffffffn;
  if (exp === 0) return { m: frac, e: -1074 };
  return { m: frac | (1n << 52n), e: exp - 1075 };
}

// round(|v| * 10^k), half to even, exact
function scaled(m: bigint, e: number, k: number): bigint {
  let num = m;
  let den = 1n;
  if (e >= 0) num <<= BigInt(e);
  else den <<= BigInt(-e);
  if (k >= 0) num *= 10n ** BigInt(k);
  else den *= 10n ** BigInt(-k);
  const q = num / den;
  const r2 = (num % den) * 2n;
  if (r2 > den || (r2 === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// e-style digits: p+1 digits and decimal exponent
function eDigits(v: number, p: number): { d: string; x: number } {
  const { m, e } = decompose(Math.abs(v));
  if (m === 0n) return { d: '0'.repeat(p + 1), x: 0 };
  let x = Math.floor(Math.log10(Math.abs(v)));
  if (!isFinite(x)) x = -324;
  for (;;) {
    const n = scaled(m, e, p - x);
    const s = n.toString();
    if (s.length > p + 1) x++;
    else if (s.length < p + 1) x--;
    else return { d: s, x };
  }
}

function expStr(x: number, upper: boolean): string {
  const a = Math.abs(x).toString().padStart(2, '0');
  return (upper ? 'E' : 'e') + (x < 0 ? '-' : '+') + a;
}

function fStyle(v: number, p: number, alt: boolean): string {
  const { m, e } = decompose(Math.abs(v));
  let s = scaled(m, e, p).toString().padStart(p + 1, '0');
  const ip = s.slice(0, s.length - p);
  const fp = s.slice(s.length - p);
  return ip + (p > 0 || alt ? '.' : '') + fp;
}

function eStyle(v: number, p: number, alt: boolean, upper: boolean): string {
  const { d, x } = eDigits(v, p);
  return d[0] + (p > 0 || alt ? '.' : '') + d.slice(1) + expStr(x, upper);
}

function stripZeros(s: string): string {
  if (!s.includes('.')) return s;
  return s.replace(/\.?0+$/, '');
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let ai = 0;
  const re = /%([-+ 0#]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc%])/g;
  return fmt.replace(re, (_all, flags: string, w: string, pr: string | undefined, conv: string) => {
    if (conv === '%') return '%';
    const left = flags.includes('-');
    const plus = flags.includes('+');
    const space = flags.includes(' ');
    const zero = flags.includes('0') && !left;
    const alt = flags.includes('#');
    const width = w ? parseInt(w, 10) : 0;
    const prec = pr === undefined ? undefined : pr === '' ? 0 : parseInt(pr, 10);
    const arg = args[ai++];

    let prefix = '';
    let body = '';
    let canZero = false;

    if (conv === 's' || conv === 'c') {
      body = String(arg);
      if (conv === 's' && prec !== undefined) body = body.slice(0, prec);
    } else if ('diouxX'.includes(conv)) {
      const big = BigInt(arg as number | bigint);
      const neg = big < 0n;
      const mag = neg ? -big : big;
      let digits: string;
      if (conv === 'd' || conv === 'i') digits = mag.toString();
      else if (conv === 'o') digits = mag.toString(8);
      else digits = mag.toString(16);
      if (conv === 'X') digits = digits.toUpperCase();
      if (prec !== undefined) {
        if (prec === 0 && mag === 0n) digits = '';
        digits = digits.padStart(prec, '0');
      }
      if (conv === 'd' || conv === 'i') {
        prefix = neg ? '-' : plus ? '+' : space ? ' ' : '';
      } else if (alt) {
        if (conv === 'o') {
          if (!digits.startsWith('0')) digits = '0' + digits;
        } else if (mag !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      }
      body = digits;
      canZero = prec === undefined;
    } else {
      const v = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      const neg = v < 0 || Object.is(v, -0);
      if (Number.isNaN(v)) {
        body = upper ? 'NAN' : 'nan';
      } else {
        prefix = neg ? '-' : plus ? '+' : space ? ' ' : '';
        if (!isFinite(v)) {
          body = upper ? 'INF' : 'inf';
        } else {
          canZero = true;
          const lc = conv.toLowerCase();
          if (lc === 'f') body = fStyle(v, prec ?? 6, alt);
          else if (lc === 'e') body = eStyle(v, prec ?? 6, alt, upper);
          else {
            const P = prec === undefined ? 6 : Math.max(prec, 1);
            const { x } = eDigits(v, P - 1);
            if (P > x && x >= -4) {
              body = fStyle(v, P - 1 - x, alt);
              if (!alt) body = stripZeros(body);
            } else {
              body = eStyle(v, P - 1, alt, upper);
              if (!alt) {
                const i = body.search(/[eE]/);
                body = stripZeros(body.slice(0, i)) + body.slice(i);
              }
            }
          }
        }
      }
    }

    const len = prefix.length + body.length;
    if (len >= width) return prefix + body;
    const pad = width - len;
    if (left) return prefix + body + ' '.repeat(pad);
    if (zero && canZero) return prefix + '0'.repeat(pad) + body;
    return ' '.repeat(pad) + prefix + body;
  });
}
