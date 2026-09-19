function decompose(v: number): { mant: bigint; exp2: number } {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, Math.abs(v));
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const be = (hi >>> 20) & 0x7ff;
  let mant = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (be === 0) return { mant, exp2: -1074 };
  mant |= 1n << 52n;
  return { mant, exp2: be - 1075 };
}

// round(|v| * 10^k), half to even, exact
function scaled(v: number, k: number): bigint {
  const { mant, exp2 } = decompose(v);
  let num = mant;
  let den = 1n;
  if (exp2 >= 0) num <<= BigInt(exp2);
  else den <<= BigInt(-exp2);
  if (k >= 0) num *= 10n ** BigInt(k);
  else den *= 10n ** BigInt(-k);
  const q = num / den;
  const r = num % den;
  const twice = r * 2n;
  if (twice > den || (twice === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

function fixed(v: number, prec: number, alt: boolean): string {
  let s = scaled(v, prec).toString();
  if (prec === 0) return alt ? s + '.' : s;
  s = s.padStart(prec + 1, '0');
  return s.slice(0, s.length - prec) + '.' + s.slice(s.length - prec);
}

// returns digits (prec+1 of them) and decimal exponent
function expDigits(v: number, prec: number): { digits: string; x: number } {
  if (v === 0) return { digits: '0'.repeat(prec + 1), x: 0 };
  let x = Math.floor(Math.log10(Math.abs(v)));
  if (!isFinite(x)) x = -324;
  const lim = 10n ** BigInt(prec + 1);
  const low = 10n ** BigInt(prec);
  for (;;) {
    const n = scaled(v, prec - x);
    if (n >= lim) x++;
    else if (n < low) x--;
    else return { digits: n.toString(), x };
  }
}

function expStr(digits: string, x: number, prec: number, alt: boolean, upper: boolean): string {
  let m = digits[0];
  if (prec > 0) m += '.' + digits.slice(1);
  else if (alt) m += '.';
  const ax = Math.abs(x);
  return m + (upper ? 'E' : 'e') + (x < 0 ? '-' : '+') + (ax < 10 ? '0' : '') + ax;
}

function stripZeros(s: string): string {
  if (!s.includes('.')) return s;
  return s.replace(/0+$/, '').replace(/\.$/, '');
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let ai = 0;
  return fmt.replace(
    /%(?:(%)|([-+ 0#]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc]))/g,
    (_m, pct, flags: string, w: string, p: string | undefined, conv: string) => {
      if (pct) return '%';
      const arg = args[ai++];
      const left = flags.includes('-');
      const plus = flags.includes('+');
      const space = flags.includes(' ');
      const zero = flags.includes('0');
      const alt = flags.includes('#');
      const width = w ? parseInt(w, 10) : 0;
      const prec = p === undefined ? undefined : p === '' ? 0 : parseInt(p, 10);

      let sign = '';
      let prefix = '';
      let body = '';
      let canZero = zero && !left;

      if (conv === 's' || conv === 'c') {
        body = String(arg);
        if (conv === 's' && prec !== undefined) body = body.slice(0, prec);
        canZero = false;
      } else if ('dioxX'.includes(conv)) {
        let n = typeof arg === 'bigint' ? arg : BigInt(arg as number);
        if (conv === 'd' || conv === 'i') {
          if (n < 0n) {
            sign = '-';
            n = -n;
          } else sign = plus ? '+' : space ? ' ' : '';
        }
        const radix = conv === 'o' ? 8 : conv === 'd' || conv === 'i' ? 10 : 16;
        body = n.toString(radix);
        if (conv === 'X') body = body.toUpperCase();
        if (prec !== undefined) {
          canZero = false;
          if (prec === 0 && n === 0n) body = '';
          else body = body.padStart(prec, '0');
        }
        if (alt) {
          if (conv === 'o') {
            if (body[0] !== '0') body = '0' + body;
          } else if (conv === 'x' && n !== 0n) prefix = '0x';
          else if (conv === 'X' && n !== 0n) prefix = '0X';
        }
      } else {
        const v = arg as number;
        const upper = conv === 'E' || conv === 'F' || conv === 'G';
        if (Number.isNaN(v)) {
          body = upper ? 'NAN' : 'nan';
          canZero = false;
        } else {
          const neg = v < 0 || Object.is(v, -0);
          sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
          if (!isFinite(v)) {
            body = upper ? 'INF' : 'inf';
            canZero = false;
          } else if (conv === 'f' || conv === 'F') {
            body = fixed(v, prec ?? 6, alt);
          } else if (conv === 'e' || conv === 'E') {
            const pr = prec ?? 6;
            const { digits, x } = expDigits(v, pr);
            body = expStr(digits, x, pr, alt, upper);
          } else {
            const P = prec === undefined ? 6 : Math.max(prec, 1);
            const { digits, x } = expDigits(v, P - 1);
            if (P > x && x >= -4) {
              body = fixed(v, P - 1 - x, alt);
              if (!alt) body = stripZeros(body);
            } else {
              let m = digits[0];
              if (P > 1) {
                let f = digits.slice(1);
                if (!alt) f = f.replace(/0+$/, '');
                if (f) m += '.' + f;
                else if (alt) m += '.';
              } else if (alt) m += '.';
              const ax = Math.abs(x);
              body = m + (upper ? 'E' : 'e') + (x < 0 ? '-' : '+') + (ax < 10 ? '0' : '') + ax;
            }
          }
        }
      }

      const len = sign.length + prefix.length + body.length;
      if (len >= width) return sign + prefix + body;
      const pad = width - len;
      if (left) return sign + prefix + body + ' '.repeat(pad);
      if (canZero) return sign + prefix + '0'.repeat(pad) + body;
      return ' '.repeat(pad) + sign + prefix + body;
    },
  );
}
