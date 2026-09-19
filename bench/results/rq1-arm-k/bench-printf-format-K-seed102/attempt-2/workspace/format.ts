function decompose(x: number): { m: bigint; e: number } {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const eb = (hi >>> 20) & 0x7ff;
  const frac = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (eb === 0) return { m: frac, e: -1074 };
  return { m: frac | (1n << 52n), e: eb - 1075 };
}

// round-half-even of |x| * 10^k, exact
function roundScaled(x: number, k: number): bigint {
  const { m, e } = decompose(Math.abs(x));
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

function expStyle(x: number, p: number): { digits: string; E: number } {
  if (x === 0) return { digits: '0'.repeat(p + 1), E: 0 };
  let E = Math.floor(Math.log10(Math.abs(x)));
  if (!Number.isFinite(E)) E = -324;
  const lo = 10n ** BigInt(p);
  const hi = lo * 10n;
  for (let i = 0; i < 100; i++) {
    const s = roundScaled(x, p - E);
    if (s >= hi) E++;
    else if (s < lo) E--;
    else return { digits: s.toString(), E };
  }
  throw new Error('exp');
}

function fixedStyle(x: number, p: number, alt: boolean): string {
  let s = roundScaled(x, p).toString();
  if (s.length < p + 1) s = '0'.repeat(p + 1 - s.length) + s;
  const ip = s.slice(0, s.length - p);
  const fp = s.slice(s.length - p);
  return p > 0 ? ip + '.' + fp : alt ? ip + '.' : ip;
}

function expText(x: number, p: number, alt: boolean): string {
  const { digits, E } = expStyle(x, p);
  let mant = digits[0];
  if (p > 0) mant += '.' + digits.slice(1);
  else if (alt) mant += '.';
  const ae = Math.abs(E);
  return mant + 'e' + (E < 0 ? '-' : '+') + (ae < 10 ? '0' : '') + ae;
}

function stripZeros(s: string): string {
  if (!s.includes('.')) return s;
  return s.replace(/0+$/, '').replace(/\.$/, '');
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let ai = 0;
  return fmt.replace(
    /%([-+ 0#]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc%])/g,
    (_all, flags: string, w: string, pr: string | undefined, conv: string) => {
      if (conv === '%') return '%';
      const arg = args[ai++];
      const minus = flags.includes('-');
      const plus = flags.includes('+');
      const space = flags.includes(' ');
      const zero = flags.includes('0');
      const alt = flags.includes('#');
      const width = w === '' ? 0 : parseInt(w, 10);
      const hasPrec = pr !== undefined;
      const prec = hasPrec ? (pr === '' ? 0 : parseInt(pr, 10)) : undefined;

      let prefix = '';
      let body = '';
      let canZero = zero && !minus;

      if (conv === 's') {
        body = String(arg);
        if (prec !== undefined) body = body.slice(0, prec);
        canZero = false;
      } else if (conv === 'c') {
        body = String(arg);
        canZero = false;
      } else if ('dioxX'.includes(conv)) {
        const v = BigInt(arg as number | bigint);
        const neg = v < 0n;
        const mag = neg ? -v : v;
        let digits =
          conv === 'd' || conv === 'i' ? mag.toString() : conv === 'o' ? mag.toString(8) : mag.toString(16);
        if (conv === 'X') digits = digits.toUpperCase();
        if (prec !== undefined) {
          if (prec === 0 && mag === 0n) digits = '';
          else if (digits.length < prec) digits = '0'.repeat(prec - digits.length) + digits;
        }
        if (conv === 'd' || conv === 'i') {
          prefix = neg ? '-' : plus ? '+' : space ? ' ' : '';
        } else if (alt) {
          if (conv === 'o') {
            if (!digits.startsWith('0')) digits = '0' + digits;
          } else if (mag !== 0n) prefix = conv === 'x' ? '0x' : '0X';
        }
        body = digits;
        if (hasPrec) canZero = false;
      } else {
        const x = arg as number;
        const lower = conv.toLowerCase();
        const upper = conv !== lower;
        const isNaNv = Number.isNaN(x);
        const neg = !isNaNv && (x < 0 || Object.is(x, -0));
        prefix = neg ? '-' : isNaNv ? '' : plus ? '+' : space ? ' ' : '';
        if (isNaNv || !Number.isFinite(x)) {
          body = isNaNv ? 'nan' : 'inf';
          canZero = false;
        } else if (lower === 'f') {
          body = fixedStyle(x, prec ?? 6, alt);
        } else if (lower === 'e') {
          body = expText(x, prec ?? 6, alt);
        } else {
          const P = prec === undefined ? 6 : Math.max(prec, 1);
          const X = expStyle(x, P - 1).E;
          if (P > X && X >= -4) {
            body = fixedStyle(x, P - 1 - X, alt);
            if (!alt) body = stripZeros(body);
          } else {
            body = expText(x, P - 1, alt);
            if (!alt) {
              const i = body.indexOf('e');
              body = stripZeros(body.slice(0, i)) + body.slice(i);
            }
          }
        }
        if (upper) {
          body = body.toUpperCase();
        }
      }

      let len = prefix.length + body.length;
      if (len < width) {
        const pad = width - len;
        if (minus) body = body + ' '.repeat(pad);
        else if (canZero) body = '0'.repeat(pad) + body;
        else prefix = ' '.repeat(pad) + prefix;
      }
      return prefix + body;
    },
  );
}
