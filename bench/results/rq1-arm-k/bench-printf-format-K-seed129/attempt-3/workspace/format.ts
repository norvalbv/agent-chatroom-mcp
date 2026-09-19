function exact(x: number): [bigint, bigint] {
  // |x| = N / D exactly
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, Math.abs(x));
  const bits = dv.getBigUint64(0);
  const expBits = Number((bits >> 52n) & 0x7ffn);
  const frac = bits & ((1n << 52n) - 1n);
  let m: bigint;
  let e: number;
  if (expBits === 0) {
    m = frac;
    e = -1074;
  } else {
    m = frac | (1n << 52n);
    e = expBits - 1075;
  }
  return e >= 0 ? [m << BigInt(e), 1n] : [m, 1n << BigInt(-e)];
}

function roundDiv(n: bigint, d: bigint): bigint {
  const q = n / d;
  const r2 = (n % d) * 2n;
  if (r2 > d || (r2 === d && (q & 1n) === 1n)) return q + 1n;
  return q;
}

const p10 = (k: number): bigint => 10n ** BigInt(k);

// round(v * 10^k)
function scaled(N: bigint, D: bigint, k: number): bigint {
  return k >= 0 ? roundDiv(N * p10(k), D) : roundDiv(N, D * p10(-k));
}

function fixed(x: number, prec: number, alt: boolean): string {
  const [N, D] = exact(x);
  let s = scaled(N, D, prec).toString();
  if (prec > 0) {
    s = s.padStart(prec + 1, '0');
    return s.slice(0, s.length - prec) + '.' + s.slice(s.length - prec);
  }
  return alt ? s + '.' : s;
}

function sciParts(x: number, prec: number): { digits: string; exp: number } {
  if (x === 0) return { digits: '0'.repeat(prec + 1), exp: 0 };
  const [N, D] = exact(x);
  let E = Math.floor(Math.log10(Math.abs(x)));
  if (!isFinite(E)) E = 0;
  const ge = (k: number): boolean => (k >= 0 ? N >= p10(k) * D : N * p10(-k) >= D);
  while (!ge(E)) E--;
  while (ge(E + 1)) E++;
  let s = scaled(N, D, prec - E);
  if (s >= p10(prec + 1)) {
    E++;
    s = scaled(N, D, prec - E);
  }
  return { digits: s.toString(), exp: E };
}

function sciStr(x: number, prec: number, alt: boolean, upper: boolean): string {
  const { digits, exp } = sciParts(x, prec);
  let s = digits[0];
  if (prec > 0) s += '.' + digits.slice(1);
  else if (alt) s += '.';
  const a = Math.abs(exp);
  s += (upper ? 'E' : 'e') + (exp < 0 ? '-' : '+') + (a < 10 ? '0' + a : String(a));
  return s;
}

function stripZeros(s: string): string {
  if (!s.includes('.')) return s;
  return s.replace(/0+$/, '').replace(/\.$/, '');
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let ai = 0;
  return fmt.replace(
    /%([-+ 0#]*)(\d*)(\.\d*)?([diouxXeEfFgGsc%])/g,
    (_m, flags: string, w: string, p: string | undefined, conv: string) => {
      if (conv === '%') return '%';
      const left = flags.includes('-');
      const plus = flags.includes('+');
      const space = flags.includes(' ');
      const zero = flags.includes('0') && !left;
      const alt = flags.includes('#');
      const width = w ? parseInt(w, 10) : 0;
      const hasPrec = p !== undefined;
      const prec = hasPrec ? (p!.length > 1 ? parseInt(p!.slice(1), 10) : 0) : -1;
      const arg = args[ai++];

      let sign = '';
      let prefix = '';
      let body: string;
      let canZero = true;

      if (conv === 's' || conv === 'c') {
        body = String(arg);
        if (conv === 's' && hasPrec) body = body.slice(0, prec);
        canZero = false;
      } else if ('diouxX'.includes(conv)) {
        let v = BigInt(arg as number | bigint);
        if (conv === 'd' || conv === 'i') {
          if (v < 0n) {
            sign = '-';
            v = -v;
          } else sign = plus ? '+' : space ? ' ' : '';
          body = v.toString();
        } else {
          body = v.toString(conv === 'o' ? 8 : 16);
          if (conv === 'X') body = body.toUpperCase();
        }
        if (hasPrec) {
          if (prec === 0 && v === 0n) body = '';
          body = body.padStart(prec, '0');
          canZero = false;
        }
        if (alt) {
          if (conv === 'o') {
            if (!body.startsWith('0')) body = '0' + body;
          } else if ((conv === 'x' || conv === 'X') && v !== 0n) prefix = conv === 'x' ? '0x' : '0X';
        }
      } else {
        const x = arg as number;
        const upper = conv === 'E' || conv === 'F' || conv === 'G';
        if (Number.isNaN(x)) {
          body = upper ? 'NAN' : 'nan';
          canZero = false;
        } else {
          sign = x < 0 || Object.is(x, -0) ? '-' : plus ? '+' : space ? ' ' : '';
          if (!isFinite(x)) {
            body = upper ? 'INF' : 'inf';
            canZero = false;
          } else {
            const lc = conv.toLowerCase();
            const P = hasPrec ? prec : 6;
            if (lc === 'f') body = fixed(x, P, alt);
            else if (lc === 'e') body = sciStr(x, P, alt, upper);
            else {
              const PP = P === 0 ? 1 : P;
              const X = sciParts(x, PP - 1).exp;
              if (PP > X && X >= -4) {
                body = fixed(x, PP - 1 - X, alt);
              } else {
                body = sciStr(x, PP - 1, alt, upper);
              }
              if (!alt) {
                const ei = body.search(/[eE]/);
                if (ei >= 0) body = stripZeros(body.slice(0, ei)) + body.slice(ei);
                else body = stripZeros(body);
              }
            }
          }
        }
      }

      const len = sign.length + prefix.length + body.length;
      if (len >= width) return sign + prefix + body;
      const pad = width - len;
      if (left) return sign + prefix + body + ' '.repeat(pad);
      if (zero && canZero) return sign + prefix + '0'.repeat(pad) + body;
      return ' '.repeat(pad) + sign + prefix + body;
    },
  );
}
