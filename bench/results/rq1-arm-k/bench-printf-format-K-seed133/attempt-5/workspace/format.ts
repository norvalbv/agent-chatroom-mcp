function exact(x: number): [bigint, bigint] {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, Math.abs(x));
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const e = (hi >>> 20) & 0x7ff;
  const frac = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  const m = e ? frac | (1n << 52n) : frac;
  const exp2 = (e || 1) - 1075;
  return exp2 >= 0 ? [m << BigInt(exp2), 1n] : [m, 1n << BigInt(-exp2)];
}

// round(|x| * 10^k), half to even, exact
function scaledRound(x: number, k: number): bigint {
  let [num, den] = exact(x);
  if (k >= 0) num *= 10n ** BigInt(k);
  else den *= 10n ** BigInt(-k);
  const q = num / den;
  const r2 = (num % den) * 2n;
  if (r2 > den || (r2 === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

function fixedStr(x: number, p: number, alt: boolean): string {
  let d = scaledRound(x, p).toString();
  if (p > 0) {
    d = d.padStart(p + 1, '0');
    return d.slice(0, d.length - p) + '.' + d.slice(d.length - p);
  }
  return alt ? d + '.' : d;
}

// returns digits (p+1 of them) and decimal exponent
function expParts(x: number, p: number): [string, number] {
  if (x === 0) return ['0'.repeat(p + 1), 0];
  let X = Math.floor(Math.log10(Math.abs(x)));
  if (!isFinite(X)) X = -324;
  const lo = 10n ** BigInt(p);
  const hi = lo * 10n;
  for (let i = 0; i < 20; i++) {
    const n = scaledRound(x, p - X);
    if (n >= hi) X++;
    else if (n < lo) X--;
    else return [n.toString(), X];
  }
  throw new Error('exp');
}

function expStr(x: number, p: number, alt: boolean, upper: boolean): string {
  const [d, X] = expParts(x, p);
  let s = d[0];
  if (p > 0) s += '.' + d.slice(1);
  else if (alt) s += '.';
  const ax = Math.abs(X);
  return s + (upper ? 'E' : 'e') + (X < 0 ? '-' : '+') + String(ax).padStart(2, '0');
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
    const left = flags.includes('-');
    const plus = flags.includes('+');
    const space = flags.includes(' ');
    const zero = flags.includes('0') && !left;
    const alt = flags.includes('#');
    const width = w ? parseInt(w, 10) : 0;
    const prec = pr === undefined ? -1 : pr.length > 1 ? parseInt(pr.slice(1), 10) : 0;
    const arg = args[ai++];

    const pad = (s: string) => (s.length >= width ? s : left ? s.padEnd(width) : s.padStart(width));
    const padNum = (sign: string, body: string, zeroOk: boolean) => {
      if (zero && zeroOk && sign.length + body.length < width) {
        return sign + '0'.repeat(width - sign.length - body.length) + body;
      }
      return pad(sign + body);
    };

    if (conv === 's') {
      let s = String(arg);
      if (prec >= 0) s = s.slice(0, prec);
      return pad(s);
    }
    if (conv === 'c') return pad(String(arg));

    if ('diouxX'.includes(conv)) {
      const v = BigInt(arg as number | bigint);
      const neg = v < 0n;
      const mag = neg ? -v : v;
      let digits = mag.toString(conv === 'x' || conv === 'X' ? 16 : conv === 'o' ? 8 : 10);
      if (conv === 'X') digits = digits.toUpperCase();
      if (prec === 0 && mag === 0n) digits = '';
      if (prec > 0) digits = digits.padStart(prec, '0');
      let sign = '';
      if (conv === 'd' || conv === 'i') sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
      else if (alt) {
        if (conv === 'o') {
          if (digits[0] !== '0') digits = '0' + digits;
        } else if (mag !== 0n) sign = conv === 'x' ? '0x' : '0X';
      }
      return padNum(sign, digits, prec < 0);
    }

    // floating point
    const x = arg as number;
    const upper = conv === 'E' || conv === 'F' || conv === 'G';
    if (Number.isNaN(x)) return pad(upper ? 'NAN' : 'nan');
    const neg = x < 0 || Object.is(x, -0);
    const sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
    if (!isFinite(x)) return pad(sign + (upper ? 'INF' : 'inf'));
    const lc = conv.toLowerCase();
    let body: string;
    if (lc === 'f') body = fixedStr(x, prec < 0 ? 6 : prec, alt);
    else if (lc === 'e') body = expStr(x, prec < 0 ? 6 : prec, alt, upper);
    else {
      const P = prec < 0 ? 6 : prec === 0 ? 1 : prec;
      const [, X] = expParts(x, P - 1);
      if (P > X && X >= -4) {
        body = fixedStr(x, P - 1 - X, alt);
        if (!alt) body = stripZeros(body);
      } else {
        body = expStr(x, P - 1, alt, upper);
        if (!alt) {
          const i = body.search(/[eE]/);
          body = stripZeros(body.slice(0, i)) + body.slice(i);
        }
      }
    }
    return padNum(sign, body, true);
  });
}
