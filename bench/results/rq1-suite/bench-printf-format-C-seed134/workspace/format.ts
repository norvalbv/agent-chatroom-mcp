const f64 = new Float64Array(1);
const u64 = new BigUint64Array(f64.buffer);

// abs finite x = m * 2^e2 exactly
function decompose(x: number): [bigint, number] {
  f64[0] = Math.abs(x);
  const bits = u64[0];
  const be = Number((bits >> 52n) & 0x7ffn);
  const frac = bits & 0xfffffffffffffn;
  if (be === 0) return [frac, -1074];
  return [frac | (1n << 52n), be - 1075];
}

// round_half_even(|x| * 10^k) as bigint
function scaled(x: number, k: number): bigint {
  const [m, e2] = decompose(x);
  let num = m;
  let den = 1n;
  if (e2 >= 0) num <<= BigInt(e2);
  else den <<= BigInt(-e2);
  if (k >= 0) num *= 10n ** BigInt(k);
  else den *= 10n ** BigInt(-k);
  const q = num / den;
  const r = num % den;
  const c = 2n * r - den;
  if (c > 0n || (c === 0n && (q & 1n) === 1n)) return q + 1n;
  return q;
}

function fixedDigits(x: number, prec: number, alt: boolean): string {
  let s = scaled(x, prec).toString();
  if (prec > 0) {
    s = s.padStart(prec + 1, '0');
    return s.slice(0, s.length - prec) + '.' + s.slice(s.length - prec);
  }
  return alt ? s + '.' : s;
}

// returns [digit string of length prec+1, exponent]
function expDigits(x: number, prec: number): [string, number] {
  if (x === 0) return ['0'.repeat(prec + 1), 0];
  let e10 = Math.floor(Math.log10(Math.abs(x)));
  const lo = 10n ** BigInt(prec);
  const hi = lo * 10n;
  for (;;) {
    const d = scaled(x, prec - e10);
    if (d >= hi) e10++;
    else if (d < lo) e10--;
    else return [d.toString(), e10];
  }
}

function expStr(digits: string, e10: number, prec: number, alt: boolean, upper: boolean): string {
  let s = digits[0];
  if (prec > 0) s += '.' + digits.slice(1);
  else if (alt) s += '.';
  const ae = Math.abs(e10);
  s += (upper ? 'E' : 'e') + (e10 < 0 ? '-' : '+') + (ae < 10 ? '0' + ae : String(ae));
  return s;
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let out = '';
  let ai = 0;
  let i = 0;
  const n = fmt.length;
  while (i < n) {
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
    while (fmt[i] >= '0' && fmt[i] <= '9') width = width * 10 + (fmt.charCodeAt(i++) - 48);
    let prec = -1;
    if (fmt[i] === '.') {
      i++;
      prec = 0;
      while (fmt[i] >= '0' && fmt[i] <= '9') prec = prec * 10 + (fmt.charCodeAt(i++) - 48);
    }
    const conv = fmt[i++];
    const arg = args[ai++];

    let sign = '';
    let prefix = '';
    let body = '';
    let canZero = false;
    const signFor = (neg: boolean) => (neg ? '-' : plus ? '+' : space ? ' ' : '');

    switch (conv) {
      case 'd':
      case 'i':
      case 'x':
      case 'X':
      case 'o': {
        let v = BigInt(arg as number | bigint);
        if (conv === 'd' || conv === 'i') {
          sign = signFor(v < 0n);
          if (v < 0n) v = -v;
        }
        let digits = v === 0n && prec === 0 ? '' : v.toString(conv === 'o' ? 8 : conv === 'd' || conv === 'i' ? 10 : 16);
        if (conv === 'X') digits = digits.toUpperCase();
        if (prec > 0) digits = digits.padStart(prec, '0');
        if (alt) {
          if ((conv === 'x' || conv === 'X') && v !== 0n) prefix = conv === 'x' ? '0x' : '0X';
          else if (conv === 'o' && digits[0] !== '0') digits = '0' + digits;
        }
        body = digits;
        canZero = prec < 0;
        break;
      }
      case 'e':
      case 'E':
      case 'f':
      case 'F':
      case 'g':
      case 'G': {
        const x = arg as number;
        const upper = conv === 'E' || conv === 'F' || conv === 'G';
        if (Number.isNaN(x)) {
          body = upper ? 'NAN' : 'nan';
          break;
        }
        sign = signFor(x < 0 || Object.is(x, -0));
        if (!Number.isFinite(x)) {
          body = upper ? 'INF' : 'inf';
          break;
        }
        canZero = true;
        const lc = conv.toLowerCase();
        if (lc === 'f') {
          body = fixedDigits(x, prec < 0 ? 6 : prec, alt);
        } else if (lc === 'e') {
          const p = prec < 0 ? 6 : prec;
          const [d, e] = expDigits(x, p);
          body = expStr(d, e, p, alt, upper);
        } else {
          let P = prec < 0 ? 6 : prec;
          if (P === 0) P = 1;
          const [d, X] = expDigits(x, P - 1);
          if (P > X && X >= -4) {
            body = fixedDigits(x, P - 1 - X, alt);
            if (!alt && body.includes('.')) body = body.replace(/0+$/, '').replace(/\.$/, '');
          } else {
            let dd = d;
            let pp = P - 1;
            if (!alt) {
              dd = d.replace(/0+$/, '');
              if (dd === '') dd = '0';
              pp = dd.length - 1;
            }
            body = expStr(dd, X, pp, alt, upper);
          }
        }
        break;
      }
      case 's': {
        body = String(arg);
        if (prec >= 0) body = body.slice(0, prec);
        break;
      }
      case 'c':
        body = String(arg);
        break;
    }

    const len = sign.length + prefix.length + body.length;
    if (len >= width) out += sign + prefix + body;
    else if (minus) out += sign + prefix + body + ' '.repeat(width - len);
    else if (zero && canZero) out += sign + prefix + '0'.repeat(width - len) + body;
    else out += ' '.repeat(width - len) + sign + prefix + body;
  }
  return out;
}
