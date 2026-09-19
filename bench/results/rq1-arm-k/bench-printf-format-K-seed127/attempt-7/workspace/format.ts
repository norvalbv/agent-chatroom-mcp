const P10 = (n: number): bigint => 10n ** BigInt(n);

// Exact rational num/den of a finite non-negative double.
function rational(x: number): [bigint, bigint] {
  if (x === 0) return [0n, 1n];
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, x);
  const hi = buf.getUint32(0);
  const lo = buf.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let e: number;
  if (expBits === 0) e = -1074;
  else {
    m |= 1n << 52n;
    e = expBits - 1075;
  }
  return e >= 0 ? [m << BigInt(e), 1n] : [m, 1n << BigInt(-e)];
}

// round(num/den * 10^k), half to even.
function scaleRound(num: bigint, den: bigint, k: number): bigint {
  if (k >= 0) num *= P10(k);
  else den *= P10(-k);
  let q = num / den;
  const r2 = (num % den) * 2n;
  if (r2 > den || (r2 === den && (q & 1n) === 1n)) q += 1n;
  return q;
}

function fixedStr(x: number, prec: number, alt: boolean): string {
  const [n, d] = rational(x);
  let s = scaleRound(n, d, prec).toString();
  if (s.length < prec + 1) s = '0'.repeat(prec + 1 - s.length) + s;
  const ip = s.slice(0, s.length - prec);
  const fp = s.slice(s.length - prec);
  return ip + (prec > 0 || alt ? '.' : '') + fp;
}

// returns digits (prec+1 of them) and decimal exponent
function expParts(x: number, prec: number): [string, number] {
  if (x === 0) return ['0'.repeat(prec + 1), 0];
  const [n, d] = rational(x);
  let E = Math.floor(Math.log10(x));
  if (!Number.isFinite(E)) E = -324;
  const ge = (e: number): boolean => (e >= 0 ? n >= d * P10(e) : n * P10(-e) >= d);
  while (!ge(E)) E--;
  while (ge(E + 1)) E++;
  let q = scaleRound(n, d, prec - E);
  if (q >= P10(prec + 1)) {
    E++;
    q = scaleRound(n, d, prec - E);
  }
  return [q.toString(), E];
}

function expStr(x: number, prec: number, alt: boolean, upper: boolean): string {
  const [dg, E] = expParts(x, prec);
  const a = Math.abs(E);
  return (
    dg[0] +
    (prec > 0 || alt ? '.' : '') +
    dg.slice(1) +
    (upper ? 'E' : 'e') +
    (E < 0 ? '-' : '+') +
    (a < 10 ? '0' : '') +
    a
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
  return fmt.replace(
    re,
    (_m, pct: string | undefined, flags: string, w: string, p: string | undefined, conv: string) => {
      if (pct) return '%';
      const left = flags.includes('-');
      const plus = flags.includes('+');
      const space = flags.includes(' ');
      const zero = flags.includes('0') && !left;
      const alt = flags.includes('#');
      const width = w ? parseInt(w, 10) : 0;
      const hasPrec = p !== undefined;
      const precN = hasPrec ? (p === '' ? 0 : parseInt(p, 10)) : -1;
      const arg = args[ai++];

      let prefix = '';
      let body: string;
      let zeroOk = zero;

      if (conv === 's' || conv === 'c') {
        body = String(arg);
        if (conv === 's' && hasPrec) body = body.slice(0, precN);
        zeroOk = false;
      } else if ('dixXo'.includes(conv)) {
        const v = BigInt(arg as number | bigint);
        const neg = v < 0n;
        const mag = neg ? -v : v;
        let digits =
          conv === 'o' ? mag.toString(8) : conv === 'd' || conv === 'i' ? mag.toString() : mag.toString(16);
        if (conv === 'X') digits = digits.toUpperCase();
        if (hasPrec) {
          if (precN === 0 && mag === 0n) digits = '';
          else if (digits.length < precN) digits = '0'.repeat(precN - digits.length) + digits;
          zeroOk = false;
        }
        if (conv === 'd' || conv === 'i') {
          prefix = neg ? '-' : plus ? '+' : space ? ' ' : '';
        } else if (alt) {
          if (conv === 'o') {
            if (!digits.startsWith('0')) digits = '0' + digits;
          } else if (mag !== 0n) prefix = conv === 'x' ? '0x' : '0X';
        }
        body = digits;
      } else {
        const x = arg as number;
        const upper = conv === 'E' || conv === 'F' || conv === 'G';
        if (Number.isNaN(x)) {
          body = upper ? 'NAN' : 'nan';
          zeroOk = false;
        } else {
          const neg = x < 0 || Object.is(x, -0);
          prefix = neg ? '-' : plus ? '+' : space ? ' ' : '';
          const ax = Math.abs(x);
          if (ax === Infinity) {
            body = upper ? 'INF' : 'inf';
            zeroOk = false;
          } else {
            const lc = conv.toLowerCase();
            if (lc === 'f') body = fixedStr(ax, hasPrec ? precN : 6, alt);
            else if (lc === 'e') body = expStr(ax, hasPrec ? precN : 6, alt, upper);
            else {
              let P = hasPrec ? precN : 6;
              if (P === 0) P = 1;
              const X = expParts(ax, P - 1)[1];
              if (P > X && X >= -4) body = fixedStr(ax, P - 1 - X, alt);
              else body = expStr(ax, P - 1, alt, upper);
              if (!alt) body = stripZeros(body);
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
