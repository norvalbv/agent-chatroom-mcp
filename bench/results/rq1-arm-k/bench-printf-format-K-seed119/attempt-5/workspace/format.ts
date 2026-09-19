function roundDiv(a: bigint, b: bigint): bigint {
  const q = a / b;
  const r2 = (a - q * b) * 2n;
  if (r2 > b || (r2 === b && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// exact rational num/den of a finite non-negative double
function ratio(v: number): [bigint, bigint] {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, v);
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
  return e >= 0 ? [m << BigInt(e), 1n] : [m, 1n << BigInt(-e)];
}

function scaled(v: number, k: number): bigint {
  let [n, d] = ratio(v);
  if (k >= 0) n *= 10n ** BigInt(k);
  else d *= 10n ** BigInt(-k);
  return roundDiv(n, d);
}

function fixedDigits(v: number, p: number): [string, string] {
  let s = scaled(v, p).toString();
  if (s.length < p + 1) s = '0'.repeat(p + 1 - s.length) + s;
  return [s.slice(0, s.length - p), s.slice(s.length - p)];
}

// returns digit string of length p+1 and exponent
function sciDigits(v: number, p: number): [string, number] {
  if (v === 0) return ['0'.repeat(p + 1), 0];
  let x = Math.floor(Math.log10(v));
  if (!isFinite(x)) x = -324;
  const lim = 10n ** BigInt(p + 1);
  const low = 10n ** BigInt(p);
  for (let i = 0; i < 20; i++) {
    const n = scaled(v, p - x);
    if (n >= lim) x++;
    else if (n < low) x--;
    else return [n.toString(), x];
  }
  throw new Error('sci failed');
}

function expStr(x: number, upper: boolean): string {
  const a = Math.abs(x);
  return (upper ? 'E' : 'e') + (x < 0 ? '-' : '+') + (a < 10 ? '0' : '') + a;
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let out = '';
  let ai = 0;
  let i = 0;
  while (i < fmt.length) {
    const ch = fmt[i++];
    if (ch !== '%') {
      out += ch;
      continue;
    }
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
    let canZero = zero && !minus;

    if (conv === 's' || conv === 'c') {
      body = String(arg);
      if (conv === 's' && prec >= 0) body = body.slice(0, prec);
      canZero = false;
    } else if ('dixXo'.includes(conv)) {
      let n = BigInt(arg as number | bigint);
      if (n < 0n) {
        sign = '-';
        n = -n;
      } else sign = plus ? '+' : space ? ' ' : '';
      if (conv === 'd' || conv === 'i') body = n.toString();
      else if (conv === 'o') body = n.toString(8);
      else body = conv === 'x' ? n.toString(16) : n.toString(16).toUpperCase();
      if (prec === 0 && n === 0n) body = '';
      if (prec >= 0) {
        if (body.length < prec) body = '0'.repeat(prec - body.length) + body;
        canZero = false;
      }
      if (alt) {
        if (conv === 'o') {
          if (body[0] !== '0') body = '0' + body;
        } else if (conv !== 'd' && conv !== 'i' && n !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      }
    } else {
      const v = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      const neg = v < 0 || Object.is(v, -0);
      if (Number.isNaN(v)) sign = '';
      else sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
      if (!isFinite(v)) {
        body = Number.isNaN(v) ? 'nan' : 'inf';
        if (upper) body = body.toUpperCase();
        canZero = false;
      } else {
        const a = Math.abs(v);
        const lc = conv.toLowerCase();
        const sci = (p: number) => {
          const [d, x] = sciDigits(a, p);
          return d[0] + (p > 0 || alt ? '.' : '') + d.slice(1) + expStr(x, upper);
        };
        const fix = (p: number) => {
          const [ip, fp] = fixedDigits(a, p);
          return ip + (p > 0 || alt ? '.' : '') + fp;
        };
        if (lc === 'e') body = sci(prec < 0 ? 6 : prec);
        else if (lc === 'f') body = fix(prec < 0 ? 6 : prec);
        else {
          let P = prec < 0 ? 6 : prec;
          if (P === 0) P = 1;
          const x = sciDigits(a, P - 1)[1];
          if (P > x && x >= -4) body = fix(P - 1 - x);
          else body = sci(P - 1);
          if (!alt) {
            const m = body.match(/^([^eE]*)([eE].*)?$/)!;
            let mant = m[1];
            if (mant.includes('.')) mant = mant.replace(/0+$/, '').replace(/\.$/, '');
            body = mant + (m[2] ?? '');
          }
        }
      }
    }

    let text = sign + prefix + body;
    if (text.length < width) {
      const pad = width - text.length;
      if (minus) text += ' '.repeat(pad);
      else if (canZero) text = sign + prefix + '0'.repeat(pad) + body;
      else text = ' '.repeat(pad) + text;
    }
    out += text;
  }
  return out;
}
