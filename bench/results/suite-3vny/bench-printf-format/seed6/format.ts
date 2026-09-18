function decompose(v: number): { m: bigint; e: number } {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, v);
  const bits = dv.getBigUint64(0);
  const expBits = Number((bits >> 52n) & 0x7ffn);
  const frac = bits & ((1n << 52n) - 1n);
  if (expBits === 0) return { m: frac, e: -1074 };
  return { m: frac | (1n << 52n), e: expBits - 1075 };
}

function divRoundEven(num: bigint, den: bigint): bigint {
  const q = num / den;
  const r = num % den;
  const twice = r * 2n;
  if (twice > den || (twice === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// round(|v| * 10^k) exactly, half-even
function scaledRound(v: number, k: number): bigint {
  const { m, e } = decompose(v);
  let num = m;
  let den = 1n;
  if (e >= 0) num <<= BigInt(e);
  else den <<= BigInt(-e);
  if (k >= 0) num *= 10n ** BigInt(k);
  else den *= 10n ** BigInt(-k);
  return divRoundEven(num, den);
}

function fixedDigits(v: number, p: number): { int: string; frac: string } {
  let s = scaledRound(v, p).toString();
  if (p > 0) {
    if (s.length <= p) s = '0'.repeat(p - s.length + 1) + s;
    return { int: s.slice(0, s.length - p), frac: s.slice(s.length - p) };
  }
  return { int: s, frac: '' };
}

function expDigits(v: number, p: number): { digits: string; x: number } {
  if (v === 0) return { digits: '0'.repeat(p + 1), x: 0 };
  let x = Math.floor(Math.log10(v));
  if (!isFinite(x)) x = -324;
  const lo = 10n ** BigInt(p);
  const hi = lo * 10n;
  for (let i = 0; i < 10; i++) {
    const n = scaledRound(v, p - x);
    if (n >= hi) x++;
    else if (n < lo) x--;
    else return { digits: n.toString(), x };
  }
  throw new Error('exp failure');
}

function expStyle(v: number, p: number, alt: boolean, upper: boolean): string {
  const { digits, x } = expDigits(v, p);
  let body = digits[0];
  if (p > 0) body += '.' + digits.slice(1);
  else if (alt) body += '.';
  const ax = Math.abs(x);
  return body + (upper ? 'E' : 'e') + (x < 0 ? '-' : '+') + (ax < 10 ? '0' + ax : String(ax));
}

function fixedStyle(v: number, p: number, alt: boolean): string {
  const { int, frac } = fixedDigits(v, p);
  if (p > 0) return int + '.' + frac;
  return alt ? int + '.' : int;
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
      const c = fmt[i];
      if (c === '-') minus = true;
      else if (c === '+') plus = true;
      else if (c === ' ') space = true;
      else if (c === '0') zero = true;
      else if (c === '#') alt = true;
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

    if (conv === 's' || conv === 'c') {
      body = String(arg);
      if (conv === 's' && prec >= 0) body = body.slice(0, prec);
    } else if ('dixXo'.includes(conv)) {
      const big = typeof arg === 'bigint' ? arg : BigInt(arg as number);
      const neg = big < 0n;
      const mag = neg ? -big : big;
      let digits: string;
      if (conv === 'd' || conv === 'i') digits = mag.toString();
      else if (conv === 'o') digits = mag.toString(8);
      else digits = mag.toString(16);
      if (conv === 'X') digits = digits.toUpperCase();
      if (prec === 0 && mag === 0n) digits = '';
      if (prec > digits.length) digits = '0'.repeat(prec - digits.length) + digits;
      if (conv === 'd' || conv === 'i') {
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
      } else if (alt) {
        if (conv === 'o') {
          if (digits[0] !== '0') digits = '0' + digits;
        } else if (mag !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      }
      body = digits;
      canZero = prec < 0;
    } else {
      const v = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      const lc = conv.toLowerCase();
      if (Number.isNaN(v)) {
        body = upper ? 'NAN' : 'nan';
      } else {
        const negative = v < 0 || Object.is(v, -0);
        sign = negative ? '-' : plus ? '+' : space ? ' ' : '';
        const a = Math.abs(v);
        if (a === Infinity) {
          body = upper ? 'INF' : 'inf';
        } else {
          canZero = true;
          if (lc === 'f') body = fixedStyle(a, prec < 0 ? 6 : prec, alt);
          else if (lc === 'e') body = expStyle(a, prec < 0 ? 6 : prec, alt, upper);
          else {
            let P = prec < 0 ? 6 : prec;
            if (P === 0) P = 1;
            const { x } = expDigits(a, P - 1);
            if (P > x && x >= -4) body = fixedStyle(a, P - 1 - x, alt);
            else body = expStyle(a, P - 1, alt, upper);
            if (!alt) {
              const ei = body.search(/[eE]/);
              let mant = ei >= 0 ? body.slice(0, ei) : body;
              const rest = ei >= 0 ? body.slice(ei) : '';
              if (mant.includes('.')) mant = mant.replace(/0+$/, '').replace(/\.$/, '');
              body = mant + rest;
            }
          }
        }
      }
    }

    let text = sign + prefix + body;
    if (text.length < width) {
      const pad = width - text.length;
      if (minus) text += ' '.repeat(pad);
      else if (zero && canZero) text = sign + prefix + '0'.repeat(pad) + body;
      else text = ' '.repeat(pad) + text;
    }
    out += text;
  }
  return out;
}
