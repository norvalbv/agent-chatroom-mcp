function roundDiv(num: bigint, den: bigint): bigint {
  const q = num / den;
  const r2 = (num % den) * 2n;
  if (r2 > den || (r2 === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// x > 0 finite; returns exact rational as [num, den]
function toRational(x: number): [bigint, bigint] {
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, x);
  const bits = buf.getBigUint64(0);
  const expBits = Number((bits >> 52n) & 0x7ffn);
  let m = bits & ((1n << 52n) - 1n);
  let e: number;
  if (expBits === 0) e = -1074;
  else {
    m |= 1n << 52n;
    e = expBits - 1075;
  }
  return e >= 0 ? [m << BigInt(e), 1n] : [m, 1n << BigInt(-e)];
}

// round(x * 10^k) for k any integer
function scaled(x: number, k: number): bigint {
  if (x === 0) return 0n;
  let [n, d] = toRational(x);
  if (k >= 0) n *= 10n ** BigInt(k);
  else d *= 10n ** BigInt(-k);
  return roundDiv(n, d);
}

function fixed(x: number, prec: number): string {
  let s = scaled(x, prec).toString();
  if (prec === 0) return s;
  s = s.padStart(prec + 1, '0');
  return s.slice(0, s.length - prec) + '.' + s.slice(s.length - prec);
}

// returns digit string (prec+1 digits) and exponent
function sci(x: number, prec: number): [string, number] {
  if (x === 0) return ['0'.repeat(prec + 1), 0];
  let E = Math.floor(Math.log10(x));
  if (!isFinite(E)) E = -324;
  const lo = 10n ** BigInt(prec);
  const hi = lo * 10n;
  for (let i = 0; i < 20; i++) {
    const d = scaled(x, prec - E);
    if (d >= hi) E++;
    else if (d < lo) E--;
    else return [d.toString(), E];
  }
  throw new Error('sci failed');
}

function expStr(E: number, upper: boolean): string {
  const a = Math.abs(E).toString().padStart(2, '0');
  return (upper ? 'E' : 'e') + (E < 0 ? '-' : '+') + a;
}

function fmtSci(x: number, prec: number, alt: boolean, upper: boolean): string {
  const [d, E] = sci(x, prec);
  let s = d[0];
  if (prec > 0 || alt) s += '.';
  s += d.slice(1);
  return s + expStr(E, upper);
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
    let left = false, plus = false, space = false, zero = false, alt = false;
    for (; i < fmt.length; i++) {
      const f = fmt[i];
      if (f === '-') left = true;
      else if (f === '+') plus = true;
      else if (f === ' ') space = true;
      else if (f === '0') zero = true;
      else if (f === '#') alt = true;
      else break;
    }
    let width = 0;
    while (fmt[i] >= '0' && fmt[i] <= '9') width = width * 10 + Number(fmt[i++]);
    let prec = -1;
    if (fmt[i] === '.') {
      i++;
      prec = 0;
      while (fmt[i] >= '0' && fmt[i] <= '9') prec = prec * 10 + Number(fmt[i++]);
    }
    const conv = fmt[i++];
    const arg = args[ai++];
    let sign = '';
    let prefix = '';
    let body = '';
    let canZero = false;
    const lower = conv.toLowerCase();

    if (conv === 's') {
      body = String(arg);
      if (prec >= 0) body = body.slice(0, prec);
    } else if (conv === 'c') {
      body = String(arg);
    } else if (conv === 'd' || conv === 'i') {
      const v = BigInt(arg as number | bigint);
      sign = v < 0n ? '-' : plus ? '+' : space ? ' ' : '';
      body = (v < 0n ? -v : v).toString();
      if (prec === 0 && v === 0n) body = '';
      if (prec >= 0) body = body.padStart(prec, '0');
      canZero = prec < 0;
    } else if (conv === 'x' || conv === 'X' || conv === 'o') {
      const v = BigInt(arg as number | bigint);
      body = v.toString(conv === 'o' ? 8 : 16);
      if (conv === 'X') body = body.toUpperCase();
      if (prec === 0 && v === 0n) body = '';
      if (prec >= 0) body = body.padStart(prec, '0');
      if (alt) {
        if (conv === 'o') {
          if (body[0] !== '0') body = '0' + body;
        } else if (v !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      }
      canZero = prec < 0;
    } else {
      const x = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      if (Number.isNaN(x)) {
        body = upper ? 'NAN' : 'nan';
      } else {
        const neg = x < 0 || Object.is(x, -0);
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        const a = Math.abs(x);
        if (a === Infinity) {
          body = upper ? 'INF' : 'inf';
        } else {
          canZero = true;
          if (lower === 'f') {
            const p = prec < 0 ? 6 : prec;
            body = fixed(a, p);
            if (p === 0 && alt) body += '.';
          } else if (lower === 'e') {
            body = fmtSci(a, prec < 0 ? 6 : prec, alt, upper);
          } else {
            let P = prec < 0 ? 6 : prec;
            if (P === 0) P = 1;
            const X = sci(a, P - 1)[1];
            if (P > X && X >= -4) {
              body = fixed(a, P - 1 - X);
              if (alt && !body.includes('.')) body += '.';
              if (!alt) body = stripZeros(body);
            } else {
              body = fmtSci(a, P - 1, alt, upper);
              if (!alt) {
                const k = body.search(/[eE]/);
                body = stripZeros(body.slice(0, k)) + body.slice(k);
              }
            }
          }
        }
      }
    }

    const len = sign.length + prefix.length + body.length;
    if (len < width) {
      const pad = width - len;
      if (left) body = sign + prefix + body + ' '.repeat(pad);
      else if (zero && canZero) body = sign + prefix + '0'.repeat(pad) + body;
      else body = ' '.repeat(pad) + sign + prefix + body;
    } else body = sign + prefix + body;
    out += body;
  }
  return out;
}
