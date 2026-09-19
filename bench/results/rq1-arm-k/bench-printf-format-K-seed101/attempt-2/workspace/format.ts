function roundDiv(a: bigint, b: bigint): bigint {
  const q = a / b;
  const r = a - q * b;
  const twice = r * 2n;
  if (twice > b || (twice === b && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// exact rational for a finite non-negative double
function exact(x: number): [bigint, bigint] {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const e = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let exp: number;
  if (e === 0) exp = -1074;
  else {
    m |= 1n << 52n;
    exp = e - 1075;
  }
  return exp >= 0 ? [m << BigInt(exp), 1n] : [m, 1n << BigInt(-exp)];
}

// round(x / 10^k) with x = num/den
function scaled(num: bigint, den: bigint, k: number): bigint {
  // x * 10^-k
  if (k >= 0) return roundDiv(num, den * 10n ** BigInt(k));
  return roundDiv(num * 10n ** BigInt(-k), den);
}

function fixedStr(x: number, prec: number, alt: boolean): string {
  const [n, d] = exact(x);
  const N = scaled(n, d, -prec);
  let s = N.toString();
  if (prec > 0) {
    s = s.padStart(prec + 1, '0');
    s = s.slice(0, s.length - prec) + '.' + s.slice(s.length - prec);
  } else if (alt) s += '.';
  return s;
}

function expParts(x: number, prec: number): [string, number] {
  if (x === 0) return ['0'.repeat(prec + 1), 0];
  const [n, d] = exact(x);
  let e = Math.floor(Math.log10(x));
  if (!isFinite(e)) e = -324;
  // fix estimate so that 10^e <= x < 10^(e+1) exactly
  const ge = (k: number) => (k >= 0 ? n >= d * 10n ** BigInt(k) : n * 10n ** BigInt(-k) >= d);
  while (!ge(e)) e--;
  while (ge(e + 1)) e++;
  let N = scaled(n, d, e - prec);
  if (N >= 10n ** BigInt(prec + 1)) {
    e++;
    N = scaled(n, d, e - prec);
  }
  return [N.toString(), e];
}

function expStr(digits: string, e: number, alt: boolean, upper: boolean): string {
  let s = digits[0];
  if (digits.length > 1) s += '.' + digits.slice(1);
  else if (alt) s += '.';
  const ae = Math.abs(e);
  s += (upper ? 'E' : 'e') + (e < 0 ? '-' : '+') + (ae < 10 ? '0' : '') + ae;
  return s;
}

function stripZeros(s: string): string {
  if (!s.includes('.')) return s;
  return s.replace(/0+$/, '').replace(/\.$/, '');
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let ai = 0;
  return fmt.replace(/%([-+ 0#]*)(\d*)(\.\d*)?([diouxXeEfFgGsc%])/g, (_m, fl: string, w: string, p: string | undefined, conv: string) => {
    if (conv === '%') return '%';
    const left = fl.includes('-');
    const plus = fl.includes('+');
    const space = fl.includes(' ');
    const zero = fl.includes('0') && !left;
    const alt = fl.includes('#');
    const width = w ? parseInt(w, 10) : 0;
    const hasPrec = p !== undefined;
    const prec = hasPrec ? (p!.length > 1 ? parseInt(p!.slice(1), 10) : 0) : -1;
    const arg = args[ai++];

    let sign = '';
    let prefix = '';
    let body: string;
    let zeroOk = false;

    if (conv === 's' || conv === 'c') {
      body = String(arg);
      if (conv === 's' && hasPrec) body = body.slice(0, prec);
    } else if ('dixXo'.includes(conv)) {
      const v = BigInt(arg as number | bigint);
      const neg = v < 0n;
      const mag = neg ? -v : v;
      if (conv === 'd' || conv === 'i') {
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
      }
      let digits = conv === 'x' ? mag.toString(16) : conv === 'X' ? mag.toString(16).toUpperCase() : conv === 'o' ? mag.toString(8) : mag.toString();
      if (hasPrec) {
        if (prec === 0 && mag === 0n) digits = '';
        digits = digits.padStart(prec, '0');
      }
      if (alt) {
        if ((conv === 'x' || conv === 'X') && mag !== 0n) prefix = conv === 'x' ? '0x' : '0X';
        if (conv === 'o' && digits[0] !== '0') digits = '0' + digits;
      }
      body = digits;
      zeroOk = !hasPrec;
    } else {
      const x = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      const neg = x < 0 || Object.is(x, -0);
      if (Number.isNaN(x)) {
        body = upper ? 'NAN' : 'nan';
      } else {
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        const ax = Math.abs(x);
        if (ax === Infinity) body = upper ? 'INF' : 'inf';
        else {
          zeroOk = true;
          const lc = conv.toLowerCase();
          const pr = hasPrec ? prec : 6;
          if (lc === 'f') body = fixedStr(ax, pr, alt);
          else if (lc === 'e') {
            const [dg, e] = expParts(ax, pr);
            body = expStr(dg, e, alt, upper);
          } else {
            const P = pr === 0 ? 1 : pr;
            const [dg, e] = expParts(ax, P - 1);
            if (P > e && e >= -4) {
              body = fixedStr(ax, P - 1 - e, alt);
              if (!alt) body = stripZeros(body);
            } else {
              let m = dg[0] + (dg.length > 1 ? '.' + dg.slice(1) : '');
              if (!alt) m = stripZeros(m);
              else if (dg.length === 1) m += '.';
              const ae = Math.abs(e);
              body = m + (upper ? 'E' : 'e') + (e < 0 ? '-' : '+') + (ae < 10 ? '0' : '') + ae;
            }
          }
        }
      }
    }

    const len = sign.length + prefix.length + body.length;
    if (len >= width) return sign + prefix + body;
    const pad = width - len;
    if (left) return sign + prefix + body + ' '.repeat(pad);
    if (zero && zeroOk && conv !== 's' && conv !== 'c') return sign + prefix + '0'.repeat(pad) + body;
    return ' '.repeat(pad) + sign + prefix + body;
  });
}
