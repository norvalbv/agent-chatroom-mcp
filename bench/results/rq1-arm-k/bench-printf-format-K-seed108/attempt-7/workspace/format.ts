// Decompose a finite non-negative double into m * 2^e (m bigint).
function decompose(x: number): [bigint, number] {
  if (x === 0) return [0n, 0];
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (expBits === 0) return [m, -1074];
  m |= 1n << 52n;
  return [m, expBits - 1075];
}

// round-half-even(x * 10^k) as bigint, x finite >= 0
function scaled(x: number, k: number): bigint {
  const [m, e] = decompose(x);
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

function fixed(x: number, p: number, alt: boolean): string {
  let s = scaled(x, p).toString();
  if (s.length < p + 1) s = '0'.repeat(p + 1 - s.length) + s;
  const ip = s.slice(0, s.length - p);
  const fp = s.slice(s.length - p);
  return ip + (p > 0 || alt ? '.' : '') + fp;
}

// returns digits (p+1 of them) and decimal exponent
function expDigits(x: number, p: number): [string, number] {
  if (x === 0) return ['0'.repeat(p + 1), 0];
  let e10 = Math.floor(Math.log10(x));
  for (let i = 0; i < 10; i++) {
    const s = scaled(x, p - e10).toString();
    if (s.length === p + 1) return [s, e10];
    if (s.length > p + 1) e10++;
    else e10--;
  }
  throw new Error('exponent search failed');
}

function expo(x: number, p: number, alt: boolean, upper: boolean): string {
  const [d, e10] = expDigits(x, p);
  const a = Math.abs(e10);
  return (
    d[0] + (p > 0 || alt ? '.' : '') + d.slice(1) +
    (upper ? 'E' : 'e') + (e10 < 0 ? '-' : '+') + (a < 10 ? '0' : '') + a
  );
}

function stripZeros(s: string): string {
  // s has no exponent part
  if (!s.includes('.')) return s;
  s = s.replace(/0+$/, '');
  return s.endsWith('.') ? s.slice(0, -1) : s;
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let ai = 0;
  return fmt.replace(
    /%([-+ 0#]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc%])/g,
    (_m, flags: string, w: string, pr: string | undefined, conv: string) => {
      if (conv === '%') return '%';
      const arg = args[ai++];
      const left = flags.includes('-');
      const plus = flags.includes('+');
      const space = flags.includes(' ');
      const zero = flags.includes('0') && !left;
      const alt = flags.includes('#');
      const width = w ? parseInt(w, 10) : 0;
      const prec = pr === undefined ? undefined : pr === '' ? 0 : parseInt(pr, 10);

      let prefix = '';
      let body = '';
      let zeroOk = zero;

      if (conv === 's' || conv === 'c') {
        body = String(arg);
        if (conv === 's' && prec !== undefined) body = body.slice(0, prec);
        zeroOk = false;
      } else if ('dioxX'.includes(conv)) {
        let v = BigInt(arg as number | bigint);
        if (conv === 'd' || conv === 'i') {
          const neg = v < 0n;
          if (neg) v = -v;
          prefix = neg ? '-' : plus ? '+' : space ? ' ' : '';
          body = v.toString();
        } else {
          body = v.toString(conv === 'o' ? 8 : 16);
          if (conv === 'X') body = body.toUpperCase();
        }
        if (v === 0n && prec === 0) body = '';
        if (prec !== undefined) {
          if (body.length < prec) body = '0'.repeat(prec - body.length) + body;
          zeroOk = false;
        }
        if (alt) {
          if (conv === 'o') {
            if (!body.startsWith('0')) body = '0' + body;
          } else if (conv === 'x' && v !== 0n) prefix = '0x';
          else if (conv === 'X' && v !== 0n) prefix = '0X';
        }
      } else {
        const x = arg as number;
        const upper = conv === 'E' || conv === 'F' || conv === 'G';
        const neg = !Number.isNaN(x) && (x < 0 || Object.is(x, -0));
        if (Number.isNaN(x)) prefix = '';
        else prefix = neg ? '-' : plus ? '+' : space ? ' ' : '';
        if (!Number.isFinite(x)) {
          body = Number.isNaN(x) ? 'nan' : 'inf';
          if (upper) body = body.toUpperCase();
          zeroOk = false;
        } else {
          const ax = Math.abs(x);
          const lc = conv.toLowerCase();
          if (lc === 'f') body = fixed(ax, prec ?? 6, alt);
          else if (lc === 'e') body = expo(ax, prec ?? 6, alt, upper);
          else {
            let P = prec ?? 6;
            if (P === 0) P = 1;
            const X = expDigits(ax, P - 1)[1];
            if (P > X && X >= -4) {
              body = fixed(ax, P - 1 - X, alt);
              if (!alt) body = stripZeros(body);
            } else {
              body = expo(ax, P - 1, alt, upper);
              if (!alt) {
                const i = body.search(/[eE]/);
                body = stripZeros(body.slice(0, i)) + body.slice(i);
              }
            }
          }
        }
      }

      const len = prefix.length + body.length;
      if (len >= width) return prefix + body;
      const pad = width - len;
      if (left) return prefix + body + ' '.repeat(pad);
      if (zeroOk) return prefix + '0'.repeat(pad) + body;
      return ' '.repeat(pad) + prefix + body;
    },
  );
}
