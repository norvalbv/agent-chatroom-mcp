function decompose(v: number): { m: bigint; e: number } {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, v);
  const bits = dv.getBigUint64(0);
  const expBits = Number((bits >> 52n) & 0x7ffn);
  const frac = bits & ((1n << 52n) - 1n);
  if (expBits === 0) return { m: frac, e: -1074 };
  return { m: frac | (1n << 52n), e: expBits - 1075 };
}

// round-half-even of m*2^e*10^s
function scaled(m: bigint, e: number, s: number): bigint {
  let num = m;
  let den = 1n;
  if (e >= 0) num *= 1n << BigInt(e);
  else den *= 1n << BigInt(-e);
  if (s >= 0) num *= 10n ** BigInt(s);
  else den *= 10n ** BigInt(-s);
  const q = num / den;
  const r = num % den;
  const twice = r * 2n;
  if (twice > den || (twice === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

function fixedDigits(v: number, p: number): string {
  if (v === 0) return '0'.repeat(p + 1);
  const { m, e } = decompose(v);
  let s = scaled(m, e, p).toString();
  if (s.length < p + 1) s = '0'.repeat(p + 1 - s.length) + s;
  return s;
}

function fixed(v: number, p: number, alt: boolean): string {
  const s = fixedDigits(v, p);
  const ip = s.slice(0, s.length - p);
  const fp = s.slice(s.length - p);
  return ip + (p > 0 || alt ? '.' : '') + fp;
}

function sci(v: number, p: number): { digits: string; exp: number } {
  if (v === 0) return { digits: '0'.repeat(p + 1), exp: 0 };
  const { m, e } = decompose(v);
  let x = Math.floor(Math.log10(v));
  if (!isFinite(x)) x = -324;
  const ge = (k: number): boolean => {
    // v >= 10^k ?
    let num = m;
    let den = 1n;
    if (e >= 0) num *= 1n << BigInt(e);
    else den *= 1n << BigInt(-e);
    if (k >= 0) den *= 10n ** BigInt(k);
    else num *= 10n ** BigInt(-k);
    return num >= den;
  };
  while (!ge(x)) x--;
  while (ge(x + 1)) x++;
  let n = scaled(m, e, p - x);
  if (n === 10n ** BigInt(p + 1)) {
    x++;
    n /= 10n;
  }
  return { digits: n.toString(), exp: x };
}

function sciStr(v: number, p: number, alt: boolean, upper: boolean): string {
  const { digits, exp } = sci(v, p);
  const mant = digits[0] + (p > 0 || alt ? '.' : '') + digits.slice(1);
  const ea = Math.abs(exp).toString().padStart(2, '0');
  return mant + (upper ? 'E' : 'e') + (exp < 0 ? '-' : '+') + ea;
}

function stripZeros(s: string): string {
  if (!s.includes('.')) return s;
  return s.replace(/0+$/, '').replace(/\.$/, '');
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let out = '';
  let ai = 0;
  const re = /%(?:(%)|([-+ 0#]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc]))/g;
  let last = 0;
  let mt: RegExpExecArray | null;
  while ((mt = re.exec(fmt))) {
    out += fmt.slice(last, mt.index);
    last = mt.index + mt[0].length;
    if (mt[1]) {
      out += '%';
      continue;
    }
    const flags = mt[2];
    const left = flags.includes('-');
    const plus = flags.includes('+');
    const space = flags.includes(' ');
    const zero = flags.includes('0');
    const alt = flags.includes('#');
    const width = mt[3] ? parseInt(mt[3], 10) : 0;
    const hasPrec = mt[4] !== undefined;
    const prec = hasPrec ? (mt[4] === '' ? 0 : parseInt(mt[4], 10)) : -1;
    const conv = mt[5];
    const arg = args[ai++];
    let sign = '';
    let prefix = '';
    let body = '';
    let zeroOk = false;

    if (conv === 's' || conv === 'c') {
      body = String(arg);
      if (conv === 's' && hasPrec) body = body.slice(0, prec);
    } else if ('dixXo'.includes(conv)) {
      let n = typeof arg === 'bigint' ? arg : BigInt(arg as number);
      if (conv === 'd' || conv === 'i') {
        if (n < 0n) {
          sign = '-';
          n = -n;
        } else sign = plus ? '+' : space ? ' ' : '';
      }
      const base = conv === 'o' ? 8 : conv === 'd' || conv === 'i' ? 10 : 16;
      let digits = n.toString(base);
      if (conv === 'X') digits = digits.toUpperCase();
      if (hasPrec) {
        if (prec === 0 && n === 0n) digits = '';
        if (digits.length < prec) digits = '0'.repeat(prec - digits.length) + digits;
      }
      if (alt) {
        if (conv === 'o') {
          if (digits[0] !== '0') digits = '0' + digits;
        } else if ((conv === 'x' || conv === 'X') && n !== 0n) {
          prefix = conv === 'x' ? '0x' : '0X';
        }
      }
      body = digits;
      zeroOk = !hasPrec;
    } else {
      const v = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      if (Number.isNaN(v)) {
        body = upper ? 'NAN' : 'nan';
      } else {
        const neg = v < 0 || Object.is(v, -0);
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        const a = Math.abs(v);
        if (a === Infinity) {
          body = upper ? 'INF' : 'inf';
        } else {
          zeroOk = true;
          const lc = conv.toLowerCase();
          if (lc === 'f') {
            body = fixed(a, hasPrec ? prec : 6, alt);
          } else if (lc === 'e') {
            body = sciStr(a, hasPrec ? prec : 6, alt, upper);
          } else {
            let P = hasPrec ? prec : 6;
            if (P === 0) P = 1;
            const { exp: X } = sci(a, P - 1);
            if (P > X && X >= -4) {
              body = fixed(a, P - 1 - X, alt);
              if (!alt) body = stripZeros(body);
            } else {
              let s = sciStr(a, P - 1, alt, upper);
              if (!alt) {
                const i = s.search(/[eE]/);
                s = stripZeros(s.slice(0, i)) + s.slice(i);
              }
              body = s;
            }
          }
        }
      }
    }

    const len = sign.length + prefix.length + body.length;
    if (len >= width) {
      out += sign + prefix + body;
    } else if (left) {
      out += sign + prefix + body + ' '.repeat(width - len);
    } else if (zero && zeroOk && conv !== 's' && conv !== 'c') {
      out += sign + prefix + '0'.repeat(width - len) + body;
    } else {
      out += ' '.repeat(width - len) + sign + prefix + body;
    }
  }
  out += fmt.slice(last);
  return out;
}
