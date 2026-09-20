function rdiv(n: bigint, d: bigint): bigint {
  const q = n / d;
  const r2 = (n - q * d) * 2n;
  if (r2 > d || (r2 === d && (q & 1n) === 1n)) return q + 1n;
  return q;
}

function decompose(x: number): [bigint, number] {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const be = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let e: number;
  if (be === 0) e = -1074;
  else {
    m |= 1n << 52n;
    e = be - 1075;
  }
  return [m, e];
}

// round(x * 10^k) half-even, x > 0 finite or zero
function scaled(x: number, k: number): bigint {
  if (x === 0) return 0n;
  const [m, e] = decompose(x);
  let num = m;
  let den = 1n;
  if (e >= 0) num <<= BigInt(e);
  else den <<= BigInt(-e);
  if (k >= 0) num *= 10n ** BigInt(k);
  else den *= 10n ** BigInt(-k);
  return rdiv(num, den);
}

function fixedStr(x: number, p: number, alt: boolean): string {
  let s = scaled(x, p).toString();
  if (p > 0) {
    s = s.padStart(p + 1, '0');
    return s.slice(0, s.length - p) + '.' + s.slice(s.length - p);
  }
  return alt ? s + '.' : s;
}

// returns digits string (p+1 digits) and exponent
function expParts(x: number, p: number): [string, number] {
  if (x === 0) return ['0'.repeat(p + 1), 0];
  const [m, e] = decompose(x);
  // find E with 10^E <= x < 10^(E+1)
  let E = Math.floor(Math.log10(x));
  if (!isFinite(E)) E = 0;
  const ge = (k: number): boolean => {
    // x >= 10^k ?
    let num = m;
    let den = 1n;
    if (e >= 0) num <<= BigInt(e);
    else den <<= BigInt(-e);
    if (k >= 0) den *= 10n ** BigInt(k);
    else num *= 10n ** BigInt(-k);
    return num >= den;
  };
  while (!ge(E)) E--;
  while (ge(E + 1)) E++;
  let d = scaled(x, p - E);
  if (d >= 10n ** BigInt(p + 1)) {
    E++;
    d = scaled(x, p - E);
  }
  return [d.toString(), E];
}

function expStr(digits: string, E: number, p: number, alt: boolean, upper: boolean): string {
  let s = digits[0];
  if (p > 0) s += '.' + digits.slice(1);
  else if (alt) s += '.';
  const a = Math.abs(E).toString().padStart(2, '0');
  return s + (upper ? 'E' : 'e') + (E < 0 ? '-' : '+') + a;
}

function stripZeros(s: string): string {
  if (!s.includes('.')) return s;
  return s.replace(/0+$/, '').replace(/\.$/, '');
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let out = '';
  let ai = 0;
  const re = /%(?:(%)|([-+ 0#]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc]))/y;
  let i = 0;
  while (i < fmt.length) {
    const pc = fmt.indexOf('%', i);
    if (pc < 0) {
      out += fmt.slice(i);
      break;
    }
    out += fmt.slice(i, pc);
    re.lastIndex = pc;
    const mt = re.exec(fmt);
    if (!mt) {
      out += '%';
      i = pc + 1;
      continue;
    }
    i = re.lastIndex;
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

    let prefix = '';
    let body = '';
    let canZero = zero && !left;

    if (conv === 's' || conv === 'c') {
      body = String(arg);
      if (conv === 's' && hasPrec) body = body.slice(0, prec);
      canZero = false;
    } else if ('diouxX'.includes(conv)) {
      const v = BigInt(arg as number | bigint);
      const neg = v < 0n;
      const mag = neg ? -v : v;
      if (conv === 'd' || conv === 'i') {
        body = mag.toString();
        prefix = neg ? '-' : plus ? '+' : space ? ' ' : '';
      } else if (conv === 'o') body = mag.toString(8);
      else body = mag.toString(16);
      if (conv === 'X') body = body.toUpperCase();
      if (hasPrec) {
        if (prec === 0 && mag === 0n) body = '';
        body = body.padStart(prec, '0');
        canZero = false;
      }
      if (alt) {
        if (conv === 'o') {
          if (!body.startsWith('0')) body = '0' + body;
        } else if ((conv === 'x' || conv === 'X') && mag !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      }
    } else {
      const x = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      if (Number.isNaN(x)) {
        body = upper ? 'NAN' : 'nan';
        canZero = false;
      } else {
        const neg = x < 0 || Object.is(x, -0);
        prefix = neg ? '-' : plus ? '+' : space ? ' ' : '';
        const ax = Math.abs(x);
        if (!isFinite(ax)) {
          body = upper ? 'INF' : 'inf';
          canZero = false;
        } else {
          const lc = conv.toLowerCase();
          if (lc === 'f') {
            body = fixedStr(ax, hasPrec ? prec : 6, alt);
          } else if (lc === 'e') {
            const p = hasPrec ? prec : 6;
            const [d, E] = expParts(ax, p);
            body = expStr(d, E, p, alt, upper);
          } else {
            let P = hasPrec ? prec : 6;
            if (P === 0) P = 1;
            const [d, X] = expParts(ax, P - 1);
            if (P > X && X >= -4) {
              body = fixedStr(ax, P - 1 - X, alt);
              if (!alt) body = stripZeros(body);
            } else {
              let mant = d[0] + (P > 1 ? '.' + d.slice(1) : alt ? '.' : '');
              if (!alt) mant = stripZeros(mant);
              body = mant + (upper ? 'E' : 'e') + (X < 0 ? '-' : '+') + Math.abs(X).toString().padStart(2, '0');
            }
          }
        }
      }
    }

    const len = prefix.length + body.length;
    if (len < width) {
      const n = width - len;
      if (left) body = prefix + body + ' '.repeat(n);
      else if (canZero) body = prefix + '0'.repeat(n) + body;
      else body = ' '.repeat(n) + prefix + body;
    } else body = prefix + body;
    out += body;
  }
  return out;
}
