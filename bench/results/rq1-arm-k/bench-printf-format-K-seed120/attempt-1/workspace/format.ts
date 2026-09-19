function ratio(x: number): [bigint, bigint] {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, x);
  const bits = dv.getBigUint64(0);
  const e = Number((bits >> 52n) & 0x7ffn);
  const frac = bits & ((1n << 52n) - 1n);
  let m: bigint;
  let k: number;
  if (e === 0) {
    m = frac;
    k = -1074;
  } else {
    m = frac | (1n << 52n);
    k = e - 1075;
  }
  return k >= 0 ? [m << BigInt(k), 1n] : [m, 1n << BigInt(-k)];
}

function divRound(n: bigint, d: bigint): bigint {
  const q = n / d;
  const r2 = (n % d) * 2n;
  if (r2 > d || (r2 === d && (q & 1n) === 1n)) return q + 1n;
  return q;
}

function scaled(x: number, p: number): bigint {
  // round(|x| * 10^p)
  const [n, d] = ratio(x);
  return p >= 0 ? divRound(n * 10n ** BigInt(p), d) : divRound(n, d * 10n ** BigInt(-p));
}

function fixedDigits(x: number, prec: number): string {
  let s = scaled(x, prec).toString();
  if (prec === 0) return s;
  s = s.padStart(prec + 1, '0');
  return s.slice(0, s.length - prec) + '.' + s.slice(s.length - prec);
}

function expParts(x: number, prec: number): [string, number] {
  if (x === 0) return ['0'.repeat(prec + 1), 0];
  const [n, d] = ratio(x);
  let e = Math.floor(Math.log10(x));
  if (!isFinite(e)) e = 0;
  const ge = (ex: number) => (ex >= 0 ? n >= d * 10n ** BigInt(ex) : n * 10n ** BigInt(-ex) >= d);
  while (!ge(e)) e--;
  while (ge(e + 1)) e++;
  let q = scaled(x, prec - e);
  if (q >= 10n ** BigInt(prec + 1)) {
    e++;
    q = scaled(x, prec - e);
  }
  return [q.toString(), e];
}

function expStr(digits: string, e: number, prec: number, alt: boolean, upper: boolean): string {
  let s = digits[0];
  if (prec > 0 || alt) s += '.';
  s += digits.slice(1);
  const ae = Math.abs(e);
  s += (upper ? 'E' : 'e') + (e < 0 ? '-' : '+') + (ae < 10 ? '0' + ae : String(ae));
  return s;
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let ai = 0;
  const re = /%([-+ 0#]*)(\d*)(\.\d*)?([diouxXeEfFgGsc%])/g;
  return fmt.replace(re, (_m, flags: string, w: string, p: string | undefined, conv: string) => {
    if (conv === '%') return '%';
    const arg = args[ai++];
    const left = flags.includes('-');
    const plus = flags.includes('+');
    const space = flags.includes(' ');
    const zero = flags.includes('0') && !left;
    const alt = flags.includes('#');
    const width = w ? parseInt(w, 10) : 0;
    const hasPrec = p !== undefined;
    const prec = hasPrec ? (p!.length > 1 ? parseInt(p!.slice(1), 10) : 0) : -1;

    let prefix = '';
    let body: string;
    let canZero = true;

    if (conv === 's' || conv === 'c') {
      let s = String(arg);
      if (conv === 's' && hasPrec) s = s.slice(0, prec);
      body = s;
      canZero = false;
    } else if ('dioxX'.includes(conv)) {
      let v = BigInt(arg as number | bigint);
      if (conv === 'd' || conv === 'i') {
        if (v < 0n) {
          prefix = '-';
          v = -v;
        } else prefix = plus ? '+' : space ? ' ' : '';
        body = v.toString(10);
      } else {
        body = v.toString(conv === 'o' ? 8 : 16);
        if (conv === 'X') body = body.toUpperCase();
      }
      if (hasPrec) {
        if (prec === 0 && v === 0n) body = '';
        body = body.padStart(prec, '0');
        canZero = false;
      }
      if (alt) {
        if (conv === 'o') {
          if (!body.startsWith('0')) body = '0' + body;
        } else if (conv !== 'd' && conv !== 'i' && v !== 0n) {
          prefix = conv === 'x' ? '0x' : '0X';
        }
      }
    } else {
      const x = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      const neg = x < 0 || Object.is(x, -0);
      if (Number.isNaN(x)) {
        body = upper ? 'NAN' : 'nan';
        canZero = false;
      } else {
        prefix = neg ? '-' : plus ? '+' : space ? ' ' : '';
        const ax = Math.abs(x);
        if (ax === Infinity) {
          body = upper ? 'INF' : 'inf';
          canZero = false;
        } else if (conv === 'f' || conv === 'F') {
          const pr = hasPrec ? prec : 6;
          body = fixedDigits(ax, pr);
          if (pr === 0 && alt) body += '.';
        } else if (conv === 'e' || conv === 'E') {
          const pr = hasPrec ? prec : 6;
          const [dg, e] = expParts(ax, pr);
          body = expStr(dg, e, pr, alt, upper);
        } else {
          let P = hasPrec ? prec : 6;
          if (P === 0) P = 1;
          const [dg, X] = expParts(ax, P - 1);
          if (P > X && X >= -4) {
            body = fixedDigits(ax, P - 1 - X);
            if (!alt) {
              if (body.includes('.')) body = body.replace(/0+$/, '').replace(/\.$/, '');
            } else if (!body.includes('.')) body += '.';
          } else {
            let dd = dg;
            let pr = P - 1;
            if (!alt) {
              dd = dd[0] + dd.slice(1).replace(/0+$/, '');
              pr = dd.length - 1;
            }
            body = expStr(dd, X, pr, alt, upper);
          }
        }
      }
    }

    let len = prefix.length + body.length;
    if (len >= width) return prefix + body;
    const pad = width - len;
    if (left) return prefix + body + ' '.repeat(pad);
    if (zero && canZero) return prefix + '0'.repeat(pad) + body;
    return ' '.repeat(pad) + prefix + body;
  });
}
