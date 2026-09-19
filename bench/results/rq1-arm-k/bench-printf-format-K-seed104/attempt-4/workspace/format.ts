function roundDiv(n: bigint, d: bigint): bigint {
  const q = n / d;
  const r2 = (n % d) * 2n;
  if (r2 > d || (r2 === d && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// abs (finite, >= 0) as exact rational num/den
function toRational(x: number): [bigint, bigint] {
  if (x === 0) return [0n, 1n];
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

// round(abs * 10^k) as integer
function scaled(x: number, k: number): bigint {
  const [n, d] = toRational(x);
  return k >= 0 ? roundDiv(n * 10n ** BigInt(k), d) : roundDiv(n, d * 10n ** BigInt(-k));
}

function fixedDigits(x: number, prec: number, alt: boolean): string {
  let s = scaled(x, prec).toString();
  if (prec > 0) {
    s = s.padStart(prec + 1, '0');
    return s.slice(0, s.length - prec) + '.' + s.slice(s.length - prec);
  }
  return alt ? s + '.' : s;
}

function sci(x: number, prec: number): { digits: string; exp: number } {
  if (x === 0) return { digits: '0'.repeat(prec + 1), exp: 0 };
  let E = Math.floor(Math.log10(x));
  const lowB = 10n ** BigInt(prec);
  const highB = lowB * 10n;
  for (let i = 0; i < 10; i++) {
    const s = scaled(x, prec - E);
    if (s >= highB) E++;
    else if (s < lowB) E--;
    else return { digits: s.toString(), exp: E };
  }
  throw new Error('sci failed');
}

function expStr(exp: number, upper: boolean): string {
  const a = Math.abs(exp).toString().padStart(2, '0');
  return (upper ? 'E' : 'e') + (exp < 0 ? '-' : '+') + a;
}

function sciText(x: number, prec: number, alt: boolean, upper: boolean): string {
  const { digits, exp } = sci(x, prec);
  let m = digits[0];
  if (prec > 0) m += '.' + digits.slice(1);
  else if (alt) m += '.';
  return m + expStr(exp, upper);
}

function stripZeros(s: string): string {
  if (!s.includes('.')) return s;
  return s.replace(/0+$/, '').replace(/\.$/, '');
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let out = '';
  let ai = 0;
  const re = /%([-+ 0#]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc%])/y;
  let i = 0;
  while (i < fmt.length) {
    const p = fmt.indexOf('%', i);
    if (p < 0) {
      out += fmt.slice(i);
      break;
    }
    out += fmt.slice(i, p);
    re.lastIndex = p;
    const m = re.exec(fmt);
    if (!m) {
      out += '%';
      i = p + 1;
      continue;
    }
    i = re.lastIndex;
    const conv = m[4];
    if (conv === '%') {
      out += '%';
      continue;
    }
    const flags = m[1];
    const left = flags.includes('-');
    const plus = flags.includes('+');
    const space = flags.includes(' ');
    let zero = flags.includes('0') && !left;
    const alt = flags.includes('#');
    const width = m[2] ? parseInt(m[2], 10) : 0;
    const hasPrec = m[3] !== undefined;
    const prec = hasPrec ? (m[3] === '' ? 0 : parseInt(m[3], 10)) : -1;
    const arg = args[ai++];

    let sign = '';
    let prefix = '';
    let body = '';
    const signFor = (neg: boolean) => (neg ? '-' : plus ? '+' : space ? ' ' : '');

    if (conv === 's' || conv === 'c') {
      body = String(arg);
      if (conv === 's' && hasPrec) body = body.slice(0, prec);
      zero = false;
    } else if ('diouxX'.includes(conv)) {
      const v = BigInt(arg as number | bigint);
      const neg = v < 0n;
      const a = neg ? -v : v;
      if (conv === 'd' || conv === 'i') {
        sign = signFor(neg);
        body = a.toString();
      } else if (conv === 'o') {
        body = a.toString(8);
      } else {
        body = a.toString(16);
        if (conv === 'X') body = body.toUpperCase();
      }
      if (hasPrec) {
        if (prec === 0 && a === 0n) body = '';
        body = body.padStart(prec, '0');
        zero = false;
      }
      if (conv === 'o' && alt && !body.startsWith('0')) body = '0' + body;
      if ((conv === 'x' || conv === 'X') && alt && a !== 0n) prefix = conv === 'x' ? '0x' : '0X';
    } else {
      const x = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      if (Number.isNaN(x)) {
        body = upper ? 'NAN' : 'nan';
        zero = false;
      } else {
        const neg = x < 0 || Object.is(x, -0);
        sign = signFor(neg);
        const a = Math.abs(x);
        if (a === Infinity) {
          body = upper ? 'INF' : 'inf';
          zero = false;
        } else {
          const lc = conv.toLowerCase();
          if (lc === 'f') {
            body = fixedDigits(a, prec < 0 ? 6 : prec, alt);
          } else if (lc === 'e') {
            body = sciText(a, prec < 0 ? 6 : prec, alt, upper);
          } else {
            const P = prec < 0 ? 6 : prec === 0 ? 1 : prec;
            const X = sci(a, P - 1).exp;
            if (P > X && X >= -4) {
              body = fixedDigits(a, P - 1 - X, alt);
              if (!alt) body = stripZeros(body);
            } else {
              const t = sciText(a, P - 1, alt, upper);
              if (alt) body = t;
              else {
                const k = t.search(/[eE]/);
                body = stripZeros(t.slice(0, k)) + t.slice(k);
              }
            }
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
