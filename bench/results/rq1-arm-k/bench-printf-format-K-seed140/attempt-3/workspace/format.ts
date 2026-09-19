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

// round(x * 10^s) half-even, x > 0 finite given as m * 2^k
function scaledRound(m: bigint, k: number, s: number): bigint {
  let num = m;
  let den = 1n;
  if (k >= 0) num <<= BigInt(k);
  else den <<= BigInt(-k);
  if (s >= 0) num *= 10n ** BigInt(s);
  else den *= 10n ** BigInt(-s);
  let q = num / den;
  const r = num - q * den;
  const twice = r * 2n;
  if (twice > den || (twice === den && (q & 1n) === 1n)) q += 1n;
  return q;
}

function fixedDigits(ax: number, p: number): string {
  if (ax === 0) return '0'.repeat(p + 1);
  const [m, k] = decompose(ax);
  let s = scaledRound(m, k, p).toString();
  if (s.length < p + 1) s = '0'.repeat(p + 1 - s.length) + s;
  return s;
}

// returns digits (p+1 of them) and decimal exponent
function expDigits(ax: number, p: number): [string, number] {
  if (ax === 0) return ['0'.repeat(p + 1), 0];
  const [m, k] = decompose(ax);
  let E = Math.floor(Math.log10(ax));
  if (!isFinite(E)) E = -324;
  const cmp = (e: number): number => {
    // compare ax with 10^e: returns -1, 0, 1
    let num = m;
    let den = 1n;
    if (k >= 0) num <<= BigInt(k);
    else den <<= BigInt(-k);
    if (e >= 0) den *= 10n ** BigInt(e);
    else num *= 10n ** BigInt(-e);
    return num < den ? -1 : num > den ? 1 : 0;
  };
  while (cmp(E) < 0) E--;
  while (cmp(E + 1) >= 0) E++;
  let d = scaledRound(m, k, p - E);
  if (d >= 10n ** BigInt(p + 1)) {
    E++;
    d = scaledRound(m, k, p - E);
  }
  return [d.toString(), E];
}

function fmtFixed(ax: number, p: number, alt: boolean): string {
  const d = fixedDigits(ax, p);
  const ip = d.slice(0, d.length - p);
  const fp = d.slice(d.length - p);
  return ip + (p > 0 || alt ? '.' : '') + fp;
}

function fmtExp(ax: number, p: number, alt: boolean, upper: boolean): string {
  const [d, E] = expDigits(ax, p);
  const ae = Math.abs(E);
  return (
    d[0] + (p > 0 || alt ? '.' : '') + d.slice(1) +
    (upper ? 'E' : 'e') + (E < 0 ? '-' : '+') + (ae < 10 ? '0' : '') + ae
  );
}

function stripZeros(s: string): string {
  const ei = s.search(/[eE]/);
  let mant = ei >= 0 ? s.slice(0, ei) : s;
  const tail = ei >= 0 ? s.slice(ei) : '';
  if (mant.includes('.')) mant = mant.replace(/0+$/, '').replace(/\.$/, '');
  return mant + tail;
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

    let prefix = '';
    let body = '';
    let numeric = true;
    let canZero = zero && !minus;

    const signOf = (neg: boolean) => (neg ? '-' : plus ? '+' : space ? ' ' : '');

    switch (conv) {
      case 'd':
      case 'i': {
        const v = BigInt(arg as number | bigint);
        prefix = signOf(v < 0n);
        body = (v < 0n ? -v : v).toString();
        if (prec === 0 && v === 0n) body = '';
        if (prec >= 0) {
          canZero = false;
          if (body.length < prec) body = '0'.repeat(prec - body.length) + body;
        }
        break;
      }
      case 'x':
      case 'X':
      case 'o': {
        const v = BigInt(arg as number | bigint);
        body = v.toString(conv === 'o' ? 8 : 16);
        if (conv === 'X') body = body.toUpperCase();
        if (prec === 0 && v === 0n) body = '';
        if (prec >= 0) {
          canZero = false;
          if (body.length < prec) body = '0'.repeat(prec - body.length) + body;
        }
        if (alt) {
          if (conv === 'o') {
            if (body[0] !== '0') body = '0' + body;
          } else if (v !== 0n) prefix = conv === 'x' ? '0x' : '0X';
        }
        break;
      }
      case 'e': case 'E': case 'f': case 'F': case 'g': case 'G': {
        const x = arg as number;
        const upper = conv === 'E' || conv === 'F' || conv === 'G';
        if (Number.isNaN(x)) {
          body = upper ? 'NAN' : 'nan';
          canZero = false;
          break;
        }
        const neg = x < 0 || Object.is(x, -0);
        prefix = signOf(neg);
        if (!isFinite(x)) {
          body = upper ? 'INF' : 'inf';
          canZero = false;
          break;
        }
        const ax = Math.abs(x);
        const lc = conv.toLowerCase();
        if (lc === 'f') body = fmtFixed(ax, prec < 0 ? 6 : prec, alt);
        else if (lc === 'e') body = fmtExp(ax, prec < 0 ? 6 : prec, alt, upper);
        else {
          let P = prec < 0 ? 6 : prec;
          if (P === 0) P = 1;
          const X = expDigits(ax, P - 1)[1];
          if (P > X && X >= -4) body = fmtFixed(ax, P - 1 - X, alt);
          else body = fmtExp(ax, P - 1, alt, upper);
          if (!alt) body = stripZeros(body);
        }
        break;
      }
      case 's': {
        numeric = false;
        body = String(arg);
        if (prec >= 0) body = body.slice(0, prec);
        break;
      }
      case 'c':
        numeric = false;
        body = String(arg);
        break;
    }

    const len = prefix.length + body.length;
    if (len >= width) out += prefix + body;
    else if (minus) out += prefix + body + ' '.repeat(width - len);
    else if (numeric && canZero) out += prefix + '0'.repeat(width - len) + body;
    else out += ' '.repeat(width - len) + prefix + body;
  }
  return out;
}
