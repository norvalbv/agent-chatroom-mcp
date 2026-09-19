function decompose(x: number): [bigint, number] {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (expBits === 0) return [m, -1074];
  m |= 1n << 52n;
  return [m, expBits - 1075];
}

// round-half-even(|x| * 10^k) as a bigint
function roundScaled(x: number, k: number): bigint {
  const [m, e] = decompose(x);
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

function fixedDigits(x: number, prec: number, alt: boolean): string {
  let s = roundScaled(x, prec).toString();
  if (prec > 0) {
    s = s.padStart(prec + 1, '0');
    return s.slice(0, s.length - prec) + '.' + s.slice(s.length - prec);
  }
  return alt ? s + '.' : s;
}

function sciParts(x: number, prec: number): [string, number] {
  if (x === 0) return ['0'.repeat(prec + 1), 0];
  let X = Math.floor(Math.log10(x));
  if (!isFinite(X)) X = -324;
  for (let i = 0; i < 20; i++) {
    const s = roundScaled(x, prec - X).toString();
    if (s.length > prec + 1) X++;
    else if (s.length < prec + 1) X--;
    else return [s, X];
  }
  throw new Error('sci failed');
}

function sciText(digits: string, X: number, prec: number, alt: boolean, upper: boolean): string {
  let s = digits[0];
  if (prec > 0) s += '.' + digits.slice(1);
  else if (alt) s += '.';
  const ax = Math.abs(X);
  s += (upper ? 'E' : 'e') + (X < 0 ? '-' : '+') + (ax < 10 ? '0' + ax : String(ax));
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
    let canZero = zero && !minus;

    const signFor = (neg: boolean) => (neg ? '-' : plus ? '+' : space ? ' ' : '');

    if (conv === 's' || conv === 'c') {
      numeric = false;
      body = String(arg);
      if (conv === 's' && prec >= 0) body = body.slice(0, prec);
    } else if ('dixXo'.includes(conv)) {
      const v = BigInt(arg as number | bigint);
      const neg = v < 0n;
      const mag = neg ? -v : v;
      sign = conv === 'd' || conv === 'i' ? signFor(neg) : '';
      let digits: string;
      if (conv === 'x') digits = mag.toString(16);
      else if (conv === 'X') digits = mag.toString(16).toUpperCase();
      else if (conv === 'o') digits = mag.toString(8);
      else digits = mag.toString();
      if (prec >= 0) {
        if (prec === 0 && mag === 0n) digits = '';
        digits = digits.padStart(prec, '0');
        canZero = false;
      }
      if (alt) {
        if ((conv === 'x' || conv === 'X') && mag !== 0n) prefix = conv === 'x' ? '0x' : '0X';
        if (conv === 'o' && digits[0] !== '0') digits = '0' + digits;
      }
      body = digits;
    } else {
      const v = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      if (Number.isNaN(v)) {
        body = upper ? 'NAN' : 'nan';
        canZero = false;
      } else {
        const neg = v < 0 || Object.is(v, -0);
        sign = signFor(neg);
        const a = Math.abs(v);
        if (a === Infinity) {
          body = upper ? 'INF' : 'inf';
          canZero = false;
        } else {
          const lc = conv.toLowerCase();
          if (lc === 'f') {
            body = fixedDigits(a, prec < 0 ? 6 : prec, alt);
          } else if (lc === 'e') {
            const p = prec < 0 ? 6 : prec;
            const [d, X] = sciParts(a, p);
            body = sciText(d, X, p, alt, upper);
          } else {
            let P = prec < 0 ? 6 : prec;
            if (P === 0) P = 1;
            const [d, X] = sciParts(a, P - 1);
            if (P > X && X >= -4) {
              body = fixedDigits(a, P - 1 - X, alt);
              if (!alt) body = stripZeros(body);
            } else {
              let s = sciText(d, X, P - 1, alt, upper);
              if (!alt) {
                const ei = s.search(/[eE]/);
                s = stripZeros(s.slice(0, ei)) + s.slice(ei);
              }
              body = s;
            }
          }
        }
      }
    }

    let text = sign + prefix + body;
    if (text.length < width) {
      const pad = width - text.length;
      if (minus) text += ' '.repeat(pad);
      else if (numeric && canZero) text = sign + prefix + '0'.repeat(pad) + body;
      else text = ' '.repeat(pad) + text;
    }
    out += text;
  }
  return out;
}
