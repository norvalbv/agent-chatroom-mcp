function roundDiv(n: bigint, d: bigint): bigint {
  const q = n / d;
  const r2 = (n % d) * 2n;
  if (r2 > d || (r2 === d && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// x finite, >= 0 -> [N, D] with x = N / D exactly
function ratio(x: number): [bigint, bigint] {
  if (x === 0) return [0n, 1n];
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const be = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let k: number;
  if (be === 0) k = -1074;
  else {
    m |= 1n << 52n;
    k = be - 1075;
  }
  return k >= 0 ? [m << BigInt(k), 1n] : [m, 1n << BigInt(-k)];
}

const pow10 = (n: number): bigint => 10n ** BigInt(n);

function fixedDigits(x: number, p: number): [string, string] {
  const [n, d] = ratio(x);
  let s = roundDiv(n * pow10(p), d).toString();
  if (s.length < p + 1) s = '0'.repeat(p + 1 - s.length) + s;
  return [s.slice(0, s.length - p), s.slice(s.length - p)];
}

function expDigits(x: number, p: number): [string, number] {
  if (x === 0) return ['0'.repeat(p + 1), 0];
  const [n, d] = ratio(x);
  // x >= 10^e ?
  const ge = (e: number) => (e >= 0 ? n >= d * pow10(e) : n * pow10(-e) >= d);
  let e = n.toString().length - d.toString().length;
  while (!ge(e)) e--;
  while (ge(e + 1)) e++;
  const sh = p - e;
  let digits = sh >= 0 ? roundDiv(n * pow10(sh), d) : roundDiv(n, d * pow10(-sh));
  if (digits >= pow10(p + 1)) {
    digits /= 10n;
    e++;
  }
  return [digits.toString(), e];
}

function expStr(x: number, p: number, alt: boolean, upper: boolean): string {
  const [ds, e] = expDigits(x, p);
  let s = ds[0] + (p > 0 || alt ? '.' : '') + ds.slice(1);
  const ae = Math.abs(e);
  s += (upper ? 'E' : 'e') + (e < 0 ? '-' : '+') + (ae < 10 ? '0' : '') + ae;
  return s;
}

function fixedStr(x: number, p: number, alt: boolean): string {
  const [i, f] = fixedDigits(x, p);
  return i + (p > 0 || alt ? '.' : '') + f;
}

function stripZeros(s: string): string {
  // s may contain exponent part
  const m = /^([^eE]*)([eE].*)?$/.exec(s)!;
  let mant = m[1];
  if (mant.includes('.')) mant = mant.replace(/0+$/, '').replace(/\.$/, '');
  return mant + (m[2] ?? '');
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let ai = 0;
  const re = /%([-+ 0#]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGscx%])/g;
  return fmt.replace(re, (_m, flags: string, w: string, pr: string | undefined, conv: string) => {
    if (conv === '%') return '%';
    const left = flags.includes('-');
    const plus = flags.includes('+');
    const space = flags.includes(' ');
    const zero = flags.includes('0') && !left;
    const alt = flags.includes('#');
    const width = w ? parseInt(w, 10) : 0;
    const hasPrec = pr !== undefined;
    const prec = hasPrec ? (pr === '' ? 0 : parseInt(pr, 10)) : -1;
    const arg = args[ai++];

    let sign = '';
    let body: string;
    let zeroOk = false;
    let prefix = '';

    if (conv === 's' || conv === 'c') {
      body = String(arg);
      if (conv === 's' && hasPrec) body = body.slice(0, prec);
    } else if ('dioxX'.includes(conv)) {
      let v = BigInt(arg as number | bigint);
      if (conv === 'd' || conv === 'i') {
        if (v < 0n) {
          sign = '-';
          v = -v;
        } else sign = plus ? '+' : space ? ' ' : '';
      }
      let ds = conv === 'o' ? v.toString(8) : conv === 'd' || conv === 'i' ? v.toString() : v.toString(16);
      if (conv === 'X') ds = ds.toUpperCase();
      if (hasPrec) {
        if (prec === 0 && v === 0n) ds = '';
        else if (ds.length < prec) ds = '0'.repeat(prec - ds.length) + ds;
      }
      if (alt) {
        if (conv === 'o' && !ds.startsWith('0')) ds = '0' + ds;
        else if ((conv === 'x' || conv === 'X') && v !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      }
      body = ds;
      zeroOk = !hasPrec;
    } else {
      const x = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      if (Number.isNaN(x)) {
        body = upper ? 'NAN' : 'nan';
      } else {
        sign = x < 0 || Object.is(x, -0) ? '-' : plus ? '+' : space ? ' ' : '';
        const ax = Math.abs(x);
        if (ax === Infinity) body = upper ? 'INF' : 'inf';
        else {
          zeroOk = true;
          const lc = conv.toLowerCase();
          if (lc === 'e') body = expStr(ax, hasPrec ? prec : 6, alt, upper);
          else if (lc === 'f') body = fixedStr(ax, hasPrec ? prec : 6, alt);
          else {
            let P = hasPrec ? prec : 6;
            if (P === 0) P = 1;
            const X = expDigits(ax, P - 1)[1];
            if (P > X && X >= -4) body = fixedStr(ax, P - 1 - X, alt);
            else body = expStr(ax, P - 1, alt, upper);
            if (!alt) body = stripZeros(body);
          }
        }
      }
    }

    const head = sign + prefix;
    const len = head.length + body.length;
    if (len >= width) return head + body;
    const pad = width - len;
    if (left) return head + body + ' '.repeat(pad);
    if (zero && zeroOk && conv !== 's' && conv !== 'c') return head + '0'.repeat(pad) + body;
    return ' '.repeat(pad) + head + body;
  });
}
