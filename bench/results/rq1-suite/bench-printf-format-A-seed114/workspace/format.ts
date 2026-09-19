function roundDiv(n: bigint, d: bigint): bigint {
  const q = n / d;
  const r2 = (n % d) * 2n;
  if (r2 > d || (r2 === d && (q & 1n) === 1n)) return q + 1n;
  return q;
}

function ratio(x: number): [bigint, bigint] {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, Math.abs(x));
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const bexp = (hi >>> 20) & 0x7ff;
  let mant = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let e: number;
  if (bexp === 0) e = -1074;
  else {
    mant |= 1n << 52n;
    e = bexp - 1075;
  }
  return e >= 0 ? [mant << BigInt(e), 1n] : [mant, 1n << BigInt(-e)];
}

const p10 = (k: number): bigint => 10n ** BigInt(k);

// round(|x| / 10^k) to integer, half-even
function scaledRound(x: number, k: number): bigint {
  const [n, d] = ratio(x);
  return k >= 0 ? roundDiv(n, d * p10(k)) : roundDiv(n * p10(-k), d);
}

function fixedDigits(x: number, prec: number, alt: boolean): string {
  let s = scaledRound(x, -prec).toString();
  if (prec > 0) {
    s = s.padStart(prec + 1, '0');
    return s.slice(0, s.length - prec) + '.' + s.slice(s.length - prec);
  }
  return alt ? s + '.' : s;
}

// returns digit string (prec+1 digits) and decimal exponent
function expParts(x: number, prec: number): [string, number] {
  if (x === 0) return ['0'.repeat(prec + 1), 0];
  const [n, d] = ratio(x);
  const ge = (E: number) => (E >= 0 ? n >= d * p10(E) : n * p10(-E) >= d);
  let E = Math.floor(Math.log10(Math.abs(x)));
  if (!Number.isFinite(E)) E = 0;
  while (!ge(E)) E--;
  while (ge(E + 1)) E++;
  let dig = scaledRound(x, E - prec);
  if (dig >= p10(prec + 1)) {
    E++;
    dig = scaledRound(x, E - prec);
  }
  return [dig.toString(), E];
}

function expStr(digs: string, E: number, prec: number, alt: boolean, upper: boolean): string {
  let s = digs[0];
  if (prec > 0) s += '.' + digs.slice(1);
  else if (alt) s += '.';
  const ae = Math.abs(E);
  s += (upper ? 'E' : 'e') + (E < 0 ? '-' : '+') + (ae < 10 ? '0' : '') + ae;
  return s;
}

function stripZeros(s: string): string {
  if (!s.includes('.')) return s;
  return s.replace(/0+$/, '').replace(/\.$/, '');
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

    let prefix = '';
    let body: string;
    let canZero = true;

    if (conv === 's' || conv === 'c') {
      body = String(arg);
      if (conv === 's' && prec >= 0) body = body.slice(0, prec);
      canZero = false;
    } else if (conv === 'd' || conv === 'i' || conv === 'x' || conv === 'X' || conv === 'o') {
      const v = typeof arg === 'bigint' ? arg : BigInt(arg as number);
      const neg = v < 0n;
      const mag = neg ? -v : v;
      let digits =
        conv === 'x' ? mag.toString(16) : conv === 'X' ? mag.toString(16).toUpperCase() : conv === 'o' ? mag.toString(8) : mag.toString();
      if (prec >= 0) {
        if (prec === 0 && mag === 0n) digits = '';
        digits = digits.padStart(prec, '0');
        canZero = false;
      }
      if (conv === 'd' || conv === 'i') {
        prefix = neg ? '-' : plus ? '+' : space ? ' ' : '';
      } else if (alt) {
        if (conv === 'o') {
          if (digits[0] !== '0') digits = '0' + digits;
        } else if (mag !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      }
      body = digits;
    } else {
      const x = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      const neg = x < 0 || Object.is(x, -0);
      if (Number.isNaN(x)) {
        body = upper ? 'NAN' : 'nan';
        canZero = false;
      } else {
        prefix = neg ? '-' : plus ? '+' : space ? ' ' : '';
        if (!Number.isFinite(x)) {
          body = upper ? 'INF' : 'inf';
          canZero = false;
        } else {
          const lc = conv.toLowerCase();
          if (lc === 'f') {
            body = fixedDigits(x, prec < 0 ? 6 : prec, alt);
          } else if (lc === 'e') {
            const p = prec < 0 ? 6 : prec;
            const [dg, E] = expParts(x, p);
            body = expStr(dg, E, p, alt, upper);
          } else {
            let P = prec < 0 ? 6 : prec;
            if (P === 0) P = 1;
            const [dg, X] = expParts(x, P - 1);
            if (P > X && X >= -4) {
              body = fixedDigits(x, P - 1 - X, alt);
              if (!alt) body = stripZeros(body);
            } else {
              let m = dg[0] + (P > 1 ? '.' + dg.slice(1) : alt ? '.' : '');
              if (!alt) m = stripZeros(m);
              const ae = Math.abs(X);
              body = m + (upper ? 'E' : 'e') + (X < 0 ? '-' : '+') + (ae < 10 ? '0' : '') + ae;
            }
          }
        }
      }
    }

    let len = prefix.length + body.length;
    if (len < width) {
      if (minus) body = body + ' '.repeat(width - len);
      else if (zero && canZero) body = '0'.repeat(width - len) + body;
      else prefix = ' '.repeat(width - len) + prefix;
    }
    out += prefix + body;
  }
  return out;
}
