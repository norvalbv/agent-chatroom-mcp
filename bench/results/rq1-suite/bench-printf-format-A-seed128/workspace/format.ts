function decompose(v: number): { m: bigint; e: number } {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, v);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (expBits === 0) return { m, e: -1074 };
  m |= 1n << 52n;
  return { m, e: expBits - 1075 };
}

// round_half_even(|v| * 10^k)
function roundScaled(v: number, k: number): bigint {
  const { m, e } = decompose(v);
  let num = m;
  let den = 1n;
  if (e >= 0) num <<= BigInt(e);
  else den <<= BigInt(-e);
  if (k >= 0) num *= 10n ** BigInt(k);
  else den *= 10n ** BigInt(-k);
  const q = num / den;
  const r = num % den;
  const twice = r * 2n;
  if (twice > den || (twice === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// p+1 significant digits and decimal exponent
function sci(v: number, p: number): { digits: string; exp: number } {
  if (v === 0) return { digits: '0'.repeat(p + 1), exp: 0 };
  let e10 = Math.floor(Math.log10(v));
  const lowB = 10n ** BigInt(p);
  const highB = lowB * 10n;
  for (let i = 0; i < 20; i++) {
    const n = roundScaled(v, p - e10);
    if (n >= highB) e10++;
    else if (n < lowB) e10--;
    else return { digits: n.toString(), exp: e10 };
  }
  throw new Error('sci failed');
}

function expStr(x: number, upper: boolean): string {
  const a = Math.abs(x).toString().padStart(2, '0');
  return (upper ? 'E' : 'e') + (x < 0 ? '-' : '+') + a;
}

function fixed(v: number, p: number, alt: boolean): string {
  const s = roundScaled(v, p).toString().padStart(p + 1, '0');
  if (p === 0) return alt ? s + '.' : s;
  return s.slice(0, s.length - p) + '.' + s.slice(s.length - p);
}

function expo(v: number, p: number, alt: boolean, upper: boolean): string {
  const { digits, exp } = sci(v, p);
  let s = digits[0];
  if (p > 0 || alt) s += '.';
  s += digits.slice(1);
  return s + expStr(exp, upper);
}

function stripZeros(s: string): string {
  if (!s.includes('.')) return s;
  return s.replace(/0+$/, '').replace(/\.$/, '');
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let ai = 0;
  const re = /%([-+ 0#]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc%])/g;
  return fmt.replace(re, (_m, flags: string, w: string, p: string | undefined, conv: string) => {
    if (conv === '%') return '%';
    const arg = args[ai++];
    const left = flags.includes('-');
    const plus = flags.includes('+');
    const space = flags.includes(' ');
    const zero = flags.includes('0') && !left;
    const alt = flags.includes('#');
    const width = w ? parseInt(w, 10) : 0;
    const prec = p === undefined ? undefined : p === '' ? 0 : parseInt(p, 10);

    let prefix = '';
    let body = '';
    let zeroOk = zero;

    if (conv === 's' || conv === 'c') {
      body = String(arg);
      if (conv === 's' && prec !== undefined) body = body.slice(0, prec);
      zeroOk = false;
    } else if ('diouxX'.includes(conv)) {
      let n = typeof arg === 'bigint' ? arg : BigInt(arg as number);
      const neg = n < 0n;
      if (neg) n = -n;
      if (conv === 'd' || conv === 'i') {
        prefix = neg ? '-' : plus ? '+' : space ? ' ' : '';
        body = n.toString();
      } else {
        body = n.toString(conv === 'o' ? 8 : 16);
        if (conv === 'X') body = body.toUpperCase();
      }
      if (prec !== undefined) {
        if (prec === 0 && n === 0n) body = '';
        body = body.padStart(prec, '0');
        zeroOk = false;
      }
      if (alt) {
        if (conv === 'o') {
          if (!body.startsWith('0')) body = '0' + body;
        } else if ((conv === 'x' || conv === 'X') && n !== 0n) {
          prefix = conv === 'x' ? '0x' : '0X';
        }
      }
    } else {
      const x = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      const neg = x < 0 || Object.is(x, -0);
      if (Number.isNaN(x)) {
        body = upper ? 'NAN' : 'nan';
        zeroOk = false;
      } else {
        prefix = neg ? '-' : plus ? '+' : space ? ' ' : '';
        const v = Math.abs(x);
        if (v === Infinity) {
          body = upper ? 'INF' : 'inf';
          zeroOk = false;
        } else {
          const lc = conv.toLowerCase();
          if (lc === 'e') body = expo(v, prec ?? 6, alt, upper);
          else if (lc === 'f') body = fixed(v, prec ?? 6, alt);
          else {
            const P = prec === undefined ? 6 : prec === 0 ? 1 : prec;
            const X = sci(v, P - 1).exp;
            if (P > X && X >= -4) {
              body = fixed(v, P - 1 - X, alt);
              if (!alt) body = stripZeros(body);
            } else {
              body = expo(v, P - 1, alt, upper);
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
    if (zeroOk) return prefix + '0'.repeat(pad) + body;
    return ' '.repeat(pad) + prefix + body;
  });
}
