const pow10 = (n: number): bigint => 10n ** BigInt(n);

function roundDiv(num: bigint, den: bigint): bigint {
  const q = num / den;
  const r2 = (num % den) * 2n;
  if (r2 > den || (r2 === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// Decompose a positive finite double into exact N / D.
function toRational(v: number): [bigint, bigint] {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, v);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const ef = (hi >>> 20) & 0x7ff;
  const frac = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let m: bigint;
  let ex: number;
  if (ef === 0) {
    m = frac;
    ex = -1074;
  } else {
    m = frac | (1n << 52n);
    ex = ef - 1075;
  }
  return ex >= 0 ? [m << BigInt(ex), 1n] : [m, 1n << BigInt(-ex)];
}

// round(v * 10^k) half-even, exact
function scaled(r: [bigint, bigint], k: number, floor = false): bigint {
  let [n, d] = r;
  if (k >= 0) n *= pow10(k);
  else d *= pow10(-k);
  return floor ? n / d : roundDiv(n, d);
}

function decExp(r: [bigint, bigint], v: number): number {
  let e = Math.floor(Math.log10(v));
  if (!isFinite(e)) e = 0;
  for (;;) {
    const t = scaled(r, -e, true);
    if (t === 0n) e--;
    else if (t >= 10n) e++;
    else return e;
  }
}

function fixedDigits(v: number, prec: number, alt: boolean): string {
  let s: string;
  if (v === 0) s = '0'.repeat(prec + 1);
  else s = scaled(toRational(v), prec).toString().padStart(prec + 1, '0');
  if (prec === 0) return alt ? s + '.' : s;
  return s.slice(0, s.length - prec) + '.' + s.slice(s.length - prec);
}

// returns [mantissa digits string (prec+1 long), exponent]
function expParts(v: number, prec: number): [string, number] {
  if (v === 0) return ['0'.repeat(prec + 1), 0];
  const r = toRational(v);
  let e = decExp(r, v);
  let q = scaled(r, prec - e);
  if (q >= pow10(prec + 1)) {
    e++;
    q = scaled(r, prec - e);
  }
  return [q.toString(), e];
}

function expStr(v: number, prec: number, alt: boolean, upper: boolean): string {
  const [d, e] = expParts(v, prec);
  let s = d[0];
  if (prec > 0) s += '.' + d.slice(1);
  else if (alt) s += '.';
  const ae = Math.abs(e);
  return s + (upper ? 'E' : 'e') + (e < 0 ? '-' : '+') + (ae < 10 ? '0' : '') + ae;
}

function stripZeros(s: string): string {
  if (!s.includes('.')) return s;
  return s.replace(/0+$/, '').replace(/\.$/, '');
}

function floatBody(v: number, conv: string, flags: string, prec: number | null): [string, boolean] {
  const upper = conv === conv.toUpperCase();
  const alt = flags.includes('#');
  const neg = v < 0 || Object.is(v, -0);
  let sign = '';
  if (!Number.isNaN(v)) sign = neg ? '-' : flags.includes('+') ? '+' : flags.includes(' ') ? ' ' : '';
  if (!Number.isFinite(v)) {
    const t = Number.isNaN(v) ? 'nan' : 'inf';
    return [sign + (upper ? t.toUpperCase() : t), false];
  }
  const a = Math.abs(v);
  const lc = conv.toLowerCase();
  let p = prec === null ? 6 : prec;
  let body: string;
  if (lc === 'f') body = fixedDigits(a, p, alt);
  else if (lc === 'e') body = expStr(a, p, alt, upper);
  else {
    const P = p === 0 ? 1 : p;
    const X = expParts(a, P - 1)[1];
    if (P > X && X >= -4) {
      body = fixedDigits(a, P - 1 - X, alt);
      if (!alt) body = stripZeros(body);
    } else {
      body = expStr(a, P - 1, alt, upper);
      if (!alt) {
        const i = body.search(/[eE]/);
        body = stripZeros(body.slice(0, i)) + body.slice(i);
      }
    }
  }
  return [sign + body, true];
}

function pad(sign: string, body: string, width: number, flags: string, zero: boolean): string {
  const len = sign.length + body.length;
  if (len >= width) return sign + body;
  const n = width - len;
  if (flags.includes('-')) return sign + body + ' '.repeat(n);
  if (zero) return sign + '0'.repeat(n) + body;
  return ' '.repeat(n) + sign + body;
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
    let flags = '';
    while (i < fmt.length && '-+ 0#'.includes(fmt[i])) flags += fmt[i++];
    let ws = '';
    while (i < fmt.length && fmt[i] >= '0' && fmt[i] <= '9') ws += fmt[i++];
    const width = ws ? parseInt(ws, 10) : 0;
    let prec: number | null = null;
    if (fmt[i] === '.') {
      i++;
      let ps = '';
      while (i < fmt.length && fmt[i] >= '0' && fmt[i] <= '9') ps += fmt[i++];
      prec = ps ? parseInt(ps, 10) : 0;
    }
    const conv = fmt[i++];
    const arg = args[ai++];
    const left = flags.includes('-');
    const zeroFlag = flags.includes('0') && !left;
    switch (conv) {
      case 'd':
      case 'i':
      case 'x':
      case 'X':
      case 'o': {
        const val = BigInt(arg as number | bigint);
        const neg = val < 0n;
        const mag = neg ? -val : val;
        let digits =
          conv === 'd' || conv === 'i'
            ? mag.toString()
            : conv === 'o'
              ? mag.toString(8)
              : conv === 'x'
                ? mag.toString(16)
                : mag.toString(16).toUpperCase();
        if (prec !== null) {
          if (prec === 0 && mag === 0n) digits = '';
          digits = digits.padStart(prec, '0');
        }
        let sign = '';
        let prefix = '';
        if (conv === 'd' || conv === 'i') {
          sign = neg ? '-' : flags.includes('+') ? '+' : flags.includes(' ') ? ' ' : '';
        } else if (flags.includes('#')) {
          if (conv === 'o') {
            if (!digits.startsWith('0')) digits = '0' + digits;
          } else if (mag !== 0n) prefix = conv === 'x' ? '0x' : '0X';
        }
        out += pad(sign + prefix, digits, width, flags, zeroFlag && prec === null);
        break;
      }
      case 'e':
      case 'E':
      case 'f':
      case 'F':
      case 'g':
      case 'G': {
        const [text, finite] = floatBody(Number(arg), conv, flags, prec);
        const m = /^[-+ ]/.test(text) ? 1 : 0;
        out += pad(text.slice(0, m), text.slice(m), width, flags, zeroFlag && finite);
        break;
      }
      case 's': {
        let s = String(arg);
        if (prec !== null) s = s.slice(0, prec);
        out += pad('', s, width, flags, false);
        break;
      }
      case 'c':
        out += pad('', String(arg), width, flags, false);
        break;
    }
  }
  return out;
}
