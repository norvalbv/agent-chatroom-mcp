function roundDiv(num: bigint, den: bigint): bigint {
  const q = num / den;
  const r = num % den;
  const twice = r * 2n;
  if (twice > den || (twice === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// x finite, >= 0. Returns [num, den] with x = num/den exactly.
function toRational(x: number): [bigint, bigint] {
  if (x === 0) return [0n, 1n];
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, x);
  const hi = buf.getUint32(0);
  const lo = buf.getUint32(4);
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

// round(x * 10^s) as BigInt
function scaled(x: number, s: number): bigint {
  let [num, den] = toRational(x);
  if (s >= 0) num *= 10n ** BigInt(s);
  else den *= 10n ** BigInt(-s);
  return roundDiv(num, den);
}

function fixedDigits(x: number, prec: number): string {
  const n = scaled(x, prec).toString();
  if (prec === 0) return n;
  const p = n.padStart(prec + 1, '0');
  return p.slice(0, p.length - prec) + '.' + p.slice(p.length - prec);
}

// returns [digits (prec+1 chars), exponent]
function expDigits(x: number, prec: number): [string, number] {
  if (x === 0) return ['0'.repeat(prec + 1), 0];
  let k = Math.floor(Math.log10(x));
  if (!isFinite(k)) k = -324;
  for (;;) {
    const n = scaled(x, prec - k);
    const s = n.toString();
    if (s.length > prec + 1) k++;
    else if (s.length < prec + 1) k--;
    else return [s, k];
  }
}

function expStr(x: number, prec: number, alt: boolean, upper: boolean): string {
  const [d, k] = expDigits(x, prec);
  let s = d[0];
  if (prec > 0 || alt) s += '.';
  s += d.slice(1);
  const ak = Math.abs(k);
  return s + (upper ? 'E' : 'e') + (k < 0 ? '-' : '+') + (ak < 10 ? '0' + ak : String(ak));
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
    for (;; i++) {
      const f = fmt[i];
      if (f === '-') minus = true;
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
    let numeric = true;
    let zeroOk = zero && !minus;

    if (conv === 'd' || conv === 'i' || conv === 'x' || conv === 'X' || conv === 'o') {
      let v = BigInt(arg as number | bigint);
      if (conv === 'd' || conv === 'i') {
        if (v < 0n) {
          sign = '-';
          v = -v;
        } else sign = plus ? '+' : space ? ' ' : '';
      }
      let digits = v.toString(conv === 'x' || conv === 'X' ? 16 : conv === 'o' ? 8 : 10);
      if (conv === 'X') digits = digits.toUpperCase();
      if (prec === 0 && v === 0n) digits = '';
      if (prec > digits.length) digits = '0'.repeat(prec - digits.length) + digits;
      if (alt) {
        if (conv === 'o') {
          if (digits[0] !== '0') digits = '0' + digits;
        } else if ((conv === 'x' || conv === 'X') && v !== 0n) {
          prefix = conv === 'x' ? '0x' : '0X';
        }
      }
      body = digits;
      if (prec >= 0) zeroOk = false;
    } else if ('eEfFgG'.includes(conv)) {
      const x = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      if (Number.isNaN(x)) {
        body = upper ? 'NAN' : 'nan';
        zeroOk = false;
      } else {
        const neg = x < 0 || Object.is(x, -0);
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        const a = Math.abs(x);
        if (a === Infinity) {
          body = upper ? 'INF' : 'inf';
          zeroOk = false;
        } else {
          const lc = conv.toLowerCase();
          const p = prec < 0 ? 6 : prec;
          if (lc === 'f') {
            body = fixedDigits(a, p);
            if (p === 0 && alt) body += '.';
          } else if (lc === 'e') {
            body = expStr(a, p, alt, upper);
          } else {
            const P = p === 0 ? 1 : p;
            const X = expDigits(a, P - 1)[1];
            let s: string;
            if (P > X && X >= -4) {
              s = fixedDigits(a, P - 1 - X);
              if (alt && !s.includes('.')) s += '.';
              if (!alt && s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
              body = s;
            } else {
              s = expStr(a, P - 1, alt, upper);
              if (!alt) {
                const m = s.match(/^([0-9.]*?)([eE].*)$/)!;
                let mant = m[1];
                if (mant.includes('.')) mant = mant.replace(/0+$/, '').replace(/\.$/, '');
                s = mant + m[2];
              }
              body = s;
            }
          }
        }
      }
    } else if (conv === 's') {
      numeric = false;
      body = String(arg);
      if (prec >= 0) body = body.slice(0, prec);
    } else {
      numeric = false;
      body = String(arg);
    }

    const len = sign.length + prefix.length + body.length;
    if (len >= width) out += sign + prefix + body;
    else if (minus) out += sign + prefix + body + ' '.repeat(width - len);
    else if (numeric && zeroOk) out += sign + prefix + '0'.repeat(width - len) + body;
    else out += ' '.repeat(width - len) + sign + prefix + body;
  }
  return out;
}
