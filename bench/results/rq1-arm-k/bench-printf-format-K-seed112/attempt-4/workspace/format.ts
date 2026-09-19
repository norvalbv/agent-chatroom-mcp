const pow10 = (n: number): bigint => 10n ** BigInt(n);

function toRat(x: number): [bigint, bigint] {
  let e = 0;
  while (!Number.isInteger(x)) {
    x *= 2;
    e++;
  }
  return [BigInt(x), 1n << BigInt(e)];
}

function divRound(n: bigint, d: bigint): bigint {
  const q = n / d;
  const r2 = (n % d) * 2n;
  if (r2 > d || (r2 === d && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// round-half-even of x * 10^k
function scaled(r: [bigint, bigint], k: number): bigint {
  return k >= 0 ? divRound(r[0] * pow10(k), r[1]) : divRound(r[0], r[1] * pow10(-k));
}

function geqPow10(r: [bigint, bigint], e: number): boolean {
  return e >= 0 ? r[0] >= r[1] * pow10(e) : r[0] * pow10(-e) >= r[1];
}

function fixedDigits(x: number, p: number, alt: boolean): string {
  let s = scaled(toRat(x), p).toString();
  if (p === 0) return alt ? s + '.' : s;
  s = s.padStart(p + 1, '0');
  return s.slice(0, s.length - p) + '.' + s.slice(s.length - p);
}

function expParts(x: number, p: number): [string, number] {
  if (x === 0) return ['0'.repeat(p + 1), 0];
  const r = toRat(x);
  let E = Math.floor(Math.log10(x));
  if (!Number.isFinite(E)) E = 0;
  while (!geqPow10(r, E)) E--;
  while (geqPow10(r, E + 1)) E++;
  let N = scaled(r, p - E);
  if (N >= pow10(p + 1)) {
    E++;
    N = scaled(r, p - E);
  }
  return [N.toString(), E];
}

function expStyle(digits: string, E: number, alt: boolean, upper: boolean): string {
  const p = digits.length - 1;
  let m = digits[0] + (p > 0 ? '.' + digits.slice(1) : alt ? '.' : '');
  const ae = Math.abs(E);
  return m + (upper ? 'E' : 'e') + (E < 0 ? '-' : '+') + (ae < 10 ? '0' : '') + ae;
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
    let prec: number | undefined;
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
    let zeroOk = false;
    const signFor = (neg: boolean) => (neg ? '-' : plus ? '+' : space ? ' ' : '');

    switch (conv) {
      case 'd':
      case 'i': {
        const v = typeof arg === 'bigint' ? arg : BigInt(arg as number);
        sign = signFor(v < 0n);
        body = (v < 0n ? -v : v).toString();
        if (prec !== undefined) {
          if (prec === 0 && v === 0n) body = '';
          body = body.padStart(prec, '0');
        }
        zeroOk = prec === undefined;
        break;
      }
      case 'x':
      case 'X':
      case 'o': {
        const v = typeof arg === 'bigint' ? arg : BigInt(arg as number);
        body = v.toString(conv === 'o' ? 8 : 16);
        if (conv === 'X') body = body.toUpperCase();
        if (prec !== undefined) {
          if (prec === 0 && v === 0n) body = '';
          body = body.padStart(prec, '0');
        }
        if (alt) {
          if (conv === 'o') {
            if (body[0] !== '0') body = '0' + body;
          } else if (v !== 0n) prefix = conv === 'x' ? '0x' : '0X';
        }
        zeroOk = prec === undefined;
        break;
      }
      case 'e': case 'E': case 'f': case 'F': case 'g': case 'G': {
        const x = arg as number;
        const upper = conv === 'E' || conv === 'F' || conv === 'G';
        if (Number.isNaN(x)) {
          body = upper ? 'NAN' : 'nan';
        } else {
          sign = signFor(x < 0 || Object.is(x, -0));
          const a = Math.abs(x);
          if (!Number.isFinite(a)) {
            body = upper ? 'INF' : 'inf';
          } else {
            zeroOk = true;
            const lc = conv.toLowerCase();
            if (lc === 'f') {
              body = fixedDigits(a, prec ?? 6, alt);
            } else if (lc === 'e') {
              const [d, E] = expParts(a, prec ?? 6);
              body = expStyle(d, E, alt, upper);
            } else {
              let P = prec ?? 6;
              if (P === 0) P = 1;
              const [d, E] = expParts(a, P - 1);
              if (P > E && E >= -4) body = fixedDigits(a, P - 1 - E, alt);
              else body = expStyle(d, E, alt, upper);
              if (!alt) body = stripZeros(body);
            }
          }
        }
        break;
      }
      case 's': {
        body = String(arg);
        if (prec !== undefined) body = body.slice(0, prec);
        break;
      }
      case 'c':
        body = String(arg);
        break;
    }

    const len = sign.length + prefix.length + body.length;
    if (len >= width) out += sign + prefix + body;
    else if (minus) out += sign + prefix + body + ' '.repeat(width - len);
    else if (zero && zeroOk) out += sign + prefix + '0'.repeat(width - len) + body;
    else out += ' '.repeat(width - len) + sign + prefix + body;
  }
  return out;
}
