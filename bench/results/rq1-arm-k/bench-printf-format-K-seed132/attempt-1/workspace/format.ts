const pow10 = (n: number): bigint => 10n ** BigInt(n);

// Exact decomposition of a finite non-negative double: value = m * 2^e
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

// round-half-even(value * 10^k)
function scaledRound(m: bigint, e: number, k: number): bigint {
  let num = m;
  let den = 1n;
  if (e >= 0) num <<= BigInt(e);
  else den <<= BigInt(-e);
  if (k >= 0) num *= pow10(k);
  else den *= pow10(-k);
  const q = num / den;
  const r = num % den;
  const twice = r * 2n;
  if (twice > den || (twice === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

function fixedDigits(x: number, p: number): [string, string] {
  const [m, e] = decompose(x);
  let s = scaledRound(m, e, p).toString();
  if (p === 0) return [s, ''];
  if (s.length < p + 1) s = '0'.repeat(p + 1 - s.length) + s;
  return [s.slice(0, s.length - p), s.slice(s.length - p)];
}

// returns p+1 significant digits and decimal exponent
function expDigits(x: number, p: number): [string, number] {
  if (x === 0) return ['0'.repeat(p + 1), 0];
  const [m, e] = decompose(x);
  let X = Math.floor(Math.log10(x));
  if (!isFinite(X)) X = 0;
  for (let i = 0; i < 10; i++) {
    const n = scaledRound(m, e, p - X);
    if (n >= pow10(p + 1)) X++;
    else if (n < pow10(p)) X--;
    else return [n.toString(), X];
  }
  throw new Error('exponent search failed');
}

function expStr(X: number, upper: boolean): string {
  const a = Math.abs(X);
  return (upper ? 'E' : 'e') + (X < 0 ? '-' : '+') + (a < 10 ? '0' + a : String(a));
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let out = '';
  let ai = 0;
  const re = /%([-+ 0#]*)(\d*)(\.\d*)?([diouxXeEfFgGsc%])/y;
  let i = 0;
  while (i < fmt.length) {
    const pct = fmt.indexOf('%', i);
    if (pct < 0) {
      out += fmt.slice(i);
      break;
    }
    out += fmt.slice(i, pct);
    re.lastIndex = pct;
    const mt = re.exec(fmt);
    if (!mt) {
      out += '%';
      i = pct + 1;
      continue;
    }
    i = re.lastIndex;
    const flags = mt[1];
    const width = mt[2] ? parseInt(mt[2], 10) : 0;
    const prec = mt[3] === undefined ? -1 : mt[3].length > 1 ? parseInt(mt[3].slice(1), 10) : 0;
    const conv = mt[4];
    if (conv === '%') {
      out += '%';
      continue;
    }
    const left = flags.includes('-');
    let zero = flags.includes('0') && !left;
    const plus = flags.includes('+');
    const space = flags.includes(' ');
    const alt = flags.includes('#');
    const arg = args[ai++];

    let sign = '';
    let prefix = '';
    let body = '';
    const signFor = (neg: boolean) => (neg ? '-' : plus ? '+' : space ? ' ' : '');

    if (conv === 's' || conv === 'c') {
      let s = String(arg);
      if (conv === 's' && prec >= 0) s = s.slice(0, prec);
      body = s;
      zero = false;
    } else if ('dioxX'.includes(conv)) {
      const v = BigInt(arg as number | bigint);
      const neg = v < 0n;
      const mag = neg ? -v : v;
      let digits: string;
      if (conv === 'd' || conv === 'i') {
        sign = signFor(neg);
        digits = mag.toString();
      } else if (conv === 'o') {
        digits = mag.toString(8);
      } else {
        digits = mag.toString(16);
        if (conv === 'X') digits = digits.toUpperCase();
      }
      if (prec >= 0) {
        if (prec === 0 && mag === 0n) digits = '';
        if (digits.length < prec) digits = '0'.repeat(prec - digits.length) + digits;
        zero = false;
      }
      if (alt) {
        if (conv === 'o') {
          if (digits[0] !== '0') digits = '0' + digits;
        } else if ((conv === 'x' || conv === 'X') && mag !== 0n) {
          prefix = conv === 'x' ? '0x' : '0X';
        }
      }
      body = digits;
    } else {
      const num = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      if (Number.isNaN(num)) {
        body = upper ? 'NAN' : 'nan';
        zero = false;
      } else {
        const neg = num < 0 || Object.is(num, -0);
        sign = signFor(neg);
        const ax = Math.abs(num);
        if (ax === Infinity) {
          body = upper ? 'INF' : 'inf';
          zero = false;
        } else {
          const lc = conv.toLowerCase();
          const P = prec < 0 ? 6 : prec;
          if (lc === 'f') {
            const [ip, fp] = fixedDigits(ax, P);
            body = ip + (fp || alt ? '.' : '') + fp;
          } else if (lc === 'e') {
            const [d, X] = expDigits(ax, P);
            const fp = d.slice(1);
            body = d[0] + (fp || alt ? '.' : '') + fp + expStr(X, upper);
          } else {
            const Pg = P === 0 ? 1 : P;
            const [d, X] = expDigits(ax, Pg - 1);
            let ip: string;
            let fp: string;
            let suffix = '';
            if (Pg > X && X >= -4) {
              [ip, fp] = fixedDigits(ax, Pg - 1 - X);
            } else {
              ip = d[0];
              fp = d.slice(1);
              suffix = expStr(X, upper);
            }
            if (!alt) fp = fp.replace(/0+$/, '');
            body = ip + (fp || alt ? '.' : '') + fp + suffix;
          }
        }
      }
    }

    const len = sign.length + prefix.length + body.length;
    if (len >= width) out += sign + prefix + body;
    else if (left) out += sign + prefix + body + ' '.repeat(width - len);
    else if (zero) out += sign + prefix + '0'.repeat(width - len) + body;
    else out += ' '.repeat(width - len) + sign + prefix + body;
  }
  return out;
}
