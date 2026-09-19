function pow10(k: number): bigint {
  return 10n ** BigInt(k);
}

// exact value of a positive finite double as N / D
function toRational(x: number): [bigint, bigint] {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  let mant = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let e: number;
  if (expBits === 0) {
    e = -1074;
  } else {
    mant |= 1n << 52n;
    e = expBits - 1075;
  }
  return e >= 0 ? [mant << BigInt(e), 1n] : [mant, 1n << BigInt(-e)];
}

function roundDiv(n: bigint, d: bigint): bigint {
  const q = n / d;
  const r = n % d;
  const twice = 2n * r;
  if (twice > d || (twice === d && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// round(x * 10^k), half-even, exact
function scaledRound(nd: [bigint, bigint], k: number): bigint {
  const [N, D] = nd;
  return k >= 0 ? roundDiv(N * pow10(k), D) : roundDiv(N, D * pow10(-k));
}

function fixedDigits(x: number, p: number): string {
  if (x === 0) return '0'.repeat(p + 1);
  let s = scaledRound(toRational(x), p).toString();
  if (s.length < p + 1) s = s.padStart(p + 1, '0');
  return s;
}

function fixedStr(x: number, p: number, alt: boolean): string {
  const s = fixedDigits(x, p);
  const ip = s.slice(0, s.length - p);
  const fp = s.slice(s.length - p);
  return p > 0 ? ip + '.' + fp : ip + (alt ? '.' : '');
}

// digits (p+1 of them) and decimal exponent
function expParts(x: number, p: number): [string, number] {
  if (x === 0) return ['0'.repeat(p + 1), 0];
  const nd = toRational(x);
  const [N, D] = nd;
  let E = Math.floor(Math.log10(x));
  if (!isFinite(E)) E = -324;
  const ge = (e: number) => (e >= 0 ? N >= D * pow10(e) : N * pow10(-e) >= D);
  while (!ge(E)) E--;
  while (ge(E + 1)) E++;
  let digits = scaledRound(nd, p - E);
  if (digits >= pow10(p + 1)) {
    E++;
    digits = scaledRound(nd, p - E);
  }
  return [digits.toString(), E];
}

function expSuffix(E: number, upper: boolean): string {
  const a = Math.abs(E);
  return (upper ? 'E' : 'e') + (E < 0 ? '-' : '+') + (a < 10 ? '0' + a : String(a));
}

function expStr(digits: string, E: number, p: number, alt: boolean, upper: boolean): string {
  const mant = digits[0] + (p > 0 ? '.' + digits.slice(1) : alt ? '.' : '');
  return mant + expSuffix(E, upper);
}

function stripZeros(s: string): string {
  if (!s.includes('.')) return s;
  return s.replace(/0+$/, '').replace(/\.$/, '');
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let ai = 0;
  const re = /%([-+ 0#]*)(\d*)(\.\d*)?([diouxXeEfFgGscp%])/g;
  return fmt.replace(re, (_m, flags: string, w: string, pr: string | undefined, conv: string) => {
    if (conv === '%') return '%';
    const minus = flags.includes('-');
    const plus = flags.includes('+');
    const space = flags.includes(' ');
    const zero = flags.includes('0');
    const alt = flags.includes('#');
    const width = w ? parseInt(w, 10) : 0;
    const prec: number | undefined = pr === undefined ? undefined : pr.length > 1 ? parseInt(pr.slice(1), 10) : 0;
    const arg = args[ai++];

    let sign = '';
    let prefix = '';
    let body: string;
    let zeroOk = false;

    if (conv === 's' || conv === 'c') {
      body = String(arg);
      if (conv === 's' && prec !== undefined) body = body.slice(0, prec);
    } else if (conv === 'd' || conv === 'i' || conv === 'x' || conv === 'X' || conv === 'o') {
      let v = BigInt(arg as number | bigint);
      const neg = v < 0n;
      if (neg) v = -v;
      if (conv === 'd' || conv === 'i') {
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        body = v.toString();
      } else if (conv === 'o') {
        body = v.toString(8);
      } else {
        body = v.toString(16);
        if (conv === 'X') body = body.toUpperCase();
      }
      if (prec !== undefined) {
        if (prec === 0 && v === 0n) body = '';
        body = body.padStart(prec, '0');
      }
      if (alt) {
        if (conv === 'o') {
          if (!body.startsWith('0')) body = '0' + body;
        } else if ((conv === 'x' || conv === 'X') && v !== 0n) {
          prefix = conv === 'x' ? '0x' : '0X';
        }
      }
      zeroOk = prec === undefined;
    } else {
      const x = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      if (Number.isNaN(x)) {
        body = upper ? 'NAN' : 'nan';
      } else {
        const neg = x < 0 || Object.is(x, -0);
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        const ax = Math.abs(x);
        if (ax === Infinity) {
          body = upper ? 'INF' : 'inf';
        } else {
          zeroOk = true;
          const lc = conv.toLowerCase();
          if (lc === 'f') {
            body = fixedStr(ax, prec ?? 6, alt);
          } else if (lc === 'e') {
            const p = prec ?? 6;
            const [d, E] = expParts(ax, p);
            body = expStr(d, E, p, alt, upper);
          } else {
            let P = prec ?? 6;
            if (P === 0) P = 1;
            const [d, E] = expParts(ax, P - 1);
            if (P > E && E >= -4) {
              body = fixedStr(ax, P - 1 - E, alt);
              if (!alt) body = stripZeros(body);
            } else {
              let m = d[0] + (P > 1 ? '.' + d.slice(1) : alt ? '.' : '');
              if (!alt) m = stripZeros(m);
              body = m + expSuffix(E, upper);
            }
          }
        }
      }
    }

    const len = sign.length + prefix.length + body.length;
    if (len >= width) return sign + prefix + body;
    const pad = width - len;
    if (minus) return sign + prefix + body + ' '.repeat(pad);
    if (zero && zeroOk && conv !== 's' && conv !== 'c' && !/^(inf|nan)$/i.test(body)) {
      return sign + prefix + '0'.repeat(pad) + body;
    }
    return ' '.repeat(pad) + sign + prefix + body;
  });
}
