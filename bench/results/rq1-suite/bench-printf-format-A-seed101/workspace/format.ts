function exact(x: number): [bigint, bigint] {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  let mant = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let e: number;
  if (expBits === 0) e = -1074;
  else {
    mant |= 1n << 52n;
    e = expBits - 1075;
  }
  return e >= 0 ? [mant << BigInt(e), 1n] : [mant, 1n << BigInt(-e)];
}

function roundDiv(a: bigint, b: bigint): bigint {
  const q = a / b;
  const r2 = (a - q * b) * 2n;
  if (r2 > b || (r2 === b && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// round(x * 10^k), half-even, exact
function scaled(x: number, k: number): bigint {
  const [n, d] = exact(x);
  const p = 10n ** BigInt(Math.abs(k));
  return k >= 0 ? roundDiv(n * p, d) : roundDiv(n, d * p);
}

function fixedStr(x: number, prec: number, alt: boolean): string {
  let s = scaled(x, prec).toString();
  if (prec > 0) {
    s = s.padStart(prec + 1, '0');
    s = s.slice(0, s.length - prec) + '.' + s.slice(s.length - prec);
  } else if (alt) s += '.';
  return s;
}

function sciParts(x: number, prec: number): [string, number] {
  if (x === 0) return ['0'.repeat(prec + 1), 0];
  let E = Math.floor(Math.log10(x));
  if (!isFinite(E)) E = 0;
  const lowB = 10n ** BigInt(prec);
  const highB = lowB * 10n;
  for (let i = 0; i < 20; i++) {
    const N = scaled(x, prec - E);
    if (N >= highB) E++;
    else if (N < lowB) E--;
    else return [N.toString(), E];
  }
  throw new Error('sci');
}

function expStr(digits: string, E: number, alt: boolean, upper: boolean): string {
  let s = digits[0];
  if (digits.length > 1) s += '.' + digits.slice(1);
  else if (alt) s += '.';
  const a = Math.abs(E).toString().padStart(2, '0');
  return s + (upper ? 'E' : 'e') + (E < 0 ? '-' : '+') + a;
}

function stripZeros(s: string): string {
  if (!s.includes('.')) return s;
  s = s.replace(/0+$/, '');
  if (s.endsWith('.')) s = s.slice(0, -1);
  return s;
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let out = '';
  let ai = 0;
  let i = 0;
  while (i < fmt.length) {
    const ch = fmt[i];
    if (ch !== '%') {
      out += ch;
      i++;
      continue;
    }
    i++;
    if (fmt[i] === '%') {
      out += '%';
      i++;
      continue;
    }
    let minus = false, plus = false, space = false, zero = false, alt = false;
    for (; i < fmt.length; i++) {
      const f = fmt[i];
      if (f === '-') minus = true;
      else if (f === '+') plus = true;
      else if (f === ' ') space = true;
      else if (f === '0') zero = true;
      else if (f === '#') alt = true;
      else break;
    }
    let width = 0;
    while (i < fmt.length && fmt[i] >= '0' && fmt[i] <= '9') width = width * 10 + Number(fmt[i++]);
    let prec = -1;
    if (fmt[i] === '.') {
      i++;
      prec = 0;
      while (i < fmt.length && fmt[i] >= '0' && fmt[i] <= '9') prec = prec * 10 + Number(fmt[i++]);
    }
    const conv = fmt[i++];
    const arg = args[ai++];

    let sign = '';
    let prefix = '';
    let body = '';
    let canZero = false;

    if (conv === 's' || conv === 'c') {
      body = String(arg);
      if (conv === 's' && prec >= 0) body = body.slice(0, prec);
    } else if ('dixXo'.includes(conv)) {
      const v = BigInt(arg as number | bigint);
      const neg = v < 0n;
      const mag = neg ? -v : v;
      let digits = conv === 'x' ? mag.toString(16) : conv === 'X' ? mag.toString(16).toUpperCase() : conv === 'o' ? mag.toString(8) : mag.toString();
      if (prec === 0 && mag === 0n) digits = '';
      if (prec >= 0) digits = digits.padStart(prec, '0');
      if (conv === 'd' || conv === 'i') {
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
      } else if (alt) {
        if (conv === 'o') {
          if (!digits.startsWith('0')) digits = '0' + digits;
        } else if (mag !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      }
      body = digits;
      canZero = prec < 0;
    } else {
      const x = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      const neg = x < 0 || Object.is(x, -0);
      if (Number.isNaN(x)) {
        body = upper ? 'NAN' : 'nan';
      } else {
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        const a = Math.abs(x);
        if (a === Infinity) body = upper ? 'INF' : 'inf';
        else {
          canZero = true;
          const lc = conv.toLowerCase();
          if (lc === 'f') body = fixedStr(a, prec < 0 ? 6 : prec, alt);
          else if (lc === 'e') {
            const p = prec < 0 ? 6 : prec;
            const [d, E] = sciParts(a, p);
            body = expStr(d, E, alt, upper);
          } else {
            const P = prec < 0 ? 6 : prec === 0 ? 1 : prec;
            const [d, X] = sciParts(a, P - 1);
            if (P > X && X >= -4) {
              body = fixedStr(a, P - 1 - X, alt);
              if (!alt) body = stripZeros(body);
            } else {
              let m = d[0] + (d.length > 1 ? '.' + d.slice(1) : alt ? '.' : '');
              if (!alt) m = stripZeros(m);
              const ea = Math.abs(X).toString().padStart(2, '0');
              body = m + (upper ? 'E' : 'e') + (X < 0 ? '-' : '+') + ea;
            }
          }
        }
      }
    }

    const len = sign.length + prefix.length + body.length;
    if (len >= width) out += sign + prefix + body;
    else if (minus) out += sign + prefix + body + ' '.repeat(width - len);
    else if (zero && canZero && conv !== 's' && conv !== 'c') out += sign + prefix + '0'.repeat(width - len) + body;
    else out += ' '.repeat(width - len) + sign + prefix + body;
  }
  return out;
}
