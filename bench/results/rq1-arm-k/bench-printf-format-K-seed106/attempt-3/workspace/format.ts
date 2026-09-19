function decompose(v: number): [bigint, number] {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, v);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (expBits === 0) return [m, -1074];
  m |= 1n << 52n;
  return [m, expBits - 1075];
}

// round-half-even(v * 10^k), v > 0 finite
function scaled(v: number, k: number): bigint {
  const [m, e] = decompose(v);
  let num = m;
  let den = 1n;
  if (e > 0) num <<= BigInt(e);
  else den <<= BigInt(-e);
  if (k > 0) num *= 10n ** BigInt(k);
  else if (k < 0) den *= 10n ** BigInt(-k);
  const q = num / den;
  const r = num % den;
  const twice = r * 2n;
  if (twice > den || (twice === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// digits (p+1 of them) and exponent for e style
function eDigits(v: number, p: number): [string, number] {
  if (v === 0) return ['0'.repeat(p + 1), 0];
  let X = Math.floor(Math.log10(v));
  if (!isFinite(X)) X = -324;
  for (;;) {
    const n = scaled(v, p - X);
    if (n >= 10n ** BigInt(p + 1)) X++;
    else if (n < 10n ** BigInt(p)) X--;
    else return [n.toString(), X];
  }
}

function fParts(v: number, p: number): [string, string] {
  let s = v === 0 ? '0' : scaled(v, p).toString();
  if (s.length < p + 1) s = '0'.repeat(p + 1 - s.length) + s;
  return [s.slice(0, s.length - p), s.slice(s.length - p)];
}

function expStr(X: number, upper: boolean): string {
  const a = Math.abs(X).toString().padStart(2, '0');
  return (upper ? 'E' : 'e') + (X < 0 ? '-' : '+') + a;
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let out = '';
  let ai = 0;
  const re = /%([-+ 0#]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc%])/y;
  let i = 0;
  while (i < fmt.length) {
    const c = fmt[i];
    if (c !== '%') {
      out += c;
      i++;
      continue;
    }
    re.lastIndex = i;
    const mt = re.exec(fmt);
    if (!mt) {
      out += c;
      i++;
      continue;
    }
    i = re.lastIndex;
    const flags = mt[1];
    const width = mt[2] ? parseInt(mt[2], 10) : 0;
    const prec = mt[3] === undefined ? undefined : mt[3] === '' ? 0 : parseInt(mt[3], 10);
    const conv = mt[4];
    if (conv === '%') {
      out += '%';
      continue;
    }
    const left = flags.includes('-');
    const plus = flags.includes('+');
    const space = flags.includes(' ');
    const zero = flags.includes('0') && !left;
    const alt = flags.includes('#');
    const arg = args[ai++];
    let sign = '';
    let prefix = '';
    let body = '';
    let zeroOk = true;
    const lower = conv.toLowerCase();
    const posSign = plus ? '+' : space ? ' ' : '';
    if (conv === 's') {
      body = String(arg);
      if (prec !== undefined) body = body.slice(0, prec);
      zeroOk = false;
    } else if (conv === 'c') {
      body = String(arg);
      zeroOk = false;
    } else if (conv === 'd' || conv === 'i' || lower === 'x' || conv === 'o') {
      const v = BigInt(arg as number | bigint);
      const neg = v < 0n;
      const mag = neg ? -v : v;
      if (conv === 'd' || conv === 'i') sign = neg ? '-' : posSign;
      let digits =
        lower === 'x' ? mag.toString(16) : conv === 'o' ? mag.toString(8) : mag.toString(10);
      if (lower === 'x' && conv === 'X') digits = digits.toUpperCase();
      if (prec !== undefined) {
        if (prec === 0 && mag === 0n) digits = '';
        else digits = digits.padStart(prec, '0');
        zeroOk = false;
      }
      if (alt) {
        if (lower === 'x' && mag !== 0n) prefix = conv === 'x' ? '0x' : '0X';
        if (conv === 'o' && !digits.startsWith('0')) digits = '0' + digits;
      }
      body = digits;
    } else {
      const v = arg as number;
      const upper = conv === conv.toUpperCase();
      if (Number.isNaN(v)) {
        body = upper ? 'NAN' : 'nan';
        zeroOk = false;
      } else {
        sign = v < 0 || Object.is(v, -0) ? '-' : posSign;
        const a = Math.abs(v);
        if (a === Infinity) {
          body = upper ? 'INF' : 'inf';
          zeroOk = false;
        } else if (lower === 'e') {
          const p = prec === undefined ? 6 : prec;
          const [d, X] = eDigits(a, p);
          body = d[0] + (p > 0 || alt ? '.' + d.slice(1) : '') + expStr(X, upper);
        } else if (lower === 'f') {
          const p = prec === undefined ? 6 : prec;
          const [ip, fp] = fParts(a, p);
          body = ip + (p > 0 || alt ? '.' + fp : '');
        } else {
          const P = prec === undefined ? 6 : Math.max(prec, 1);
          const X = eDigits(a, P - 1)[1];
          let mant: string;
          let suffix = '';
          if (P > X && X >= -4) {
            const p = P - 1 - X;
            const [ip, fp] = fParts(a, p);
            mant = ip + (p > 0 || alt ? '.' + fp : '');
          } else {
            const p = P - 1;
            const [d, XX] = eDigits(a, p);
            mant = d[0] + (p > 0 || alt ? '.' + d.slice(1) : '');
            suffix = expStr(XX, upper);
          }
          if (!alt && mant.includes('.')) mant = mant.replace(/0+$/, '').replace(/\.$/, '');
          body = mant + suffix;
        }
      }
    }
    const len = sign.length + prefix.length + body.length;
    if (len >= width) out += sign + prefix + body;
    else if (left) out += sign + prefix + body + ' '.repeat(width - len);
    else if (zero && zeroOk) out += sign + prefix + '0'.repeat(width - len) + body;
    else out += ' '.repeat(width - len) + sign + prefix + body;
  }
  return out;
}
