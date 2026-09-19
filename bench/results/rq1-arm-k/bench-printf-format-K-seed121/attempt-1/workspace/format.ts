function decompose(v: number): { neg: boolean; m: bigint; e: number } {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, v);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const neg = (hi >>> 31) === 1;
  const ex = (hi >>> 20) & 0x7ff;
  const frac = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (ex === 0) return { neg, m: frac, e: -1074 };
  return { neg, m: frac | (1n << 52n), e: ex - 1075 };
}

// round-half-even of m * 2^e * 10^k
function scaledRound(m: bigint, e: number, k: number): bigint {
  let num = m;
  let den = 1n;
  if (k >= 0) num *= 10n ** BigInt(k);
  else den *= 10n ** BigInt(-k);
  if (e >= 0) num <<= BigInt(e);
  else den <<= BigInt(-e);
  const q = num / den;
  const r2 = (num % den) * 2n;
  if (r2 > den || (r2 === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

function fixedStr(m: bigint, e: number, prec: number, alt: boolean): string {
  let s = scaledRound(m, e, prec).toString();
  if (prec > 0) {
    s = s.padStart(prec + 1, '0');
    return s.slice(0, s.length - prec) + '.' + s.slice(s.length - prec);
  }
  return alt ? s + '.' : s;
}

// returns prec+1 digits and decimal exponent
function expDigits(m: bigint, e: number, prec: number): { digits: string; x: number } {
  if (m === 0n) return { digits: '0'.repeat(prec + 1), x: 0 };
  const approx = Number(m) * Math.pow(2, e);
  let x = Number.isFinite(approx) && approx > 0 ? Math.floor(Math.log10(approx)) : 0;
  const lowB = 10n ** BigInt(prec);
  const highB = lowB * 10n;
  for (let i = 0; i < 2000; i++) {
    const s = scaledRound(m, e, prec - x);
    if (s >= highB) x++;
    else if (s < lowB) x--;
    else return { digits: s.toString(), x };
  }
  throw new Error('exp digits failed');
}

function expStr(digits: string, x: number, prec: number, alt: boolean, upper: boolean): string {
  let s = digits[0];
  if (prec > 0) s += '.' + digits.slice(1);
  else if (alt) s += '.';
  const ax = Math.abs(x);
  return s + (upper ? 'E' : 'e') + (x < 0 ? '-' : '+') + (ax < 10 ? '0' : '') + ax;
}

function stripZeros(s: string): string {
  if (!s.includes('.')) return s;
  s = s.replace(/0+$/, '');
  return s.endsWith('.') ? s.slice(0, -1) : s;
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let ai = 0;
  const re = /%(?:%|([-+ 0#]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc]))/g;
  return fmt.replace(re, (whole, flags: string | undefined, w: string, p: string | undefined, conv: string) => {
    if (conv === undefined) return '%';
    const arg = args[ai++];
    const left = flags!.includes('-');
    const plus = flags!.includes('+');
    const space = flags!.includes(' ');
    const zero = flags!.includes('0');
    const alt = flags!.includes('#');
    const width = w ? parseInt(w, 10) : 0;
    const hasPrec = p !== undefined;
    const prec = hasPrec ? (p === '' ? 0 : parseInt(p, 10)) : -1;

    let prefix = '';
    let body = '';
    let zeroOk = zero && !left;

    if (conv === 's' || conv === 'c') {
      body = String(arg);
      if (conv === 's' && hasPrec) body = body.slice(0, prec);
      zeroOk = false;
    } else if (conv === 'd' || conv === 'i' || conv === 'x' || conv === 'X' || conv === 'o') {
      let v = typeof arg === 'bigint' ? arg : BigInt(arg as number);
      let neg = false;
      if (v < 0n) {
        neg = true;
        v = -v;
      }
      let digits = conv === 'x' ? v.toString(16) : conv === 'X' ? v.toString(16).toUpperCase() : conv === 'o' ? v.toString(8) : v.toString(10);
      if (hasPrec) {
        if (prec === 0 && v === 0n) digits = '';
        digits = digits.padStart(prec, '0');
        zeroOk = false;
      }
      if (conv === 'd' || conv === 'i') {
        prefix = neg ? '-' : plus ? '+' : space ? ' ' : '';
      } else if (alt) {
        if (conv === 'o') {
          if (digits[0] !== '0') digits = '0' + digits;
        } else if (v !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      }
      body = digits;
    } else {
      const v = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      const { neg, m, e } = decompose(v);
      if (Number.isNaN(v)) {
        body = upper ? 'NAN' : 'nan';
        zeroOk = false;
      } else {
        prefix = neg ? '-' : plus ? '+' : space ? ' ' : '';
        if (!Number.isFinite(v)) {
          body = upper ? 'INF' : 'inf';
          zeroOk = false;
        } else {
          const lc = conv.toLowerCase();
          const P = hasPrec ? prec : 6;
          if (lc === 'f') {
            body = fixedStr(m, e, P, alt);
          } else if (lc === 'e') {
            const { digits, x } = expDigits(m, e, P);
            body = expStr(digits, x, P, alt, upper);
          } else {
            const PP = P === 0 ? 1 : P;
            const { digits, x } = expDigits(m, e, PP - 1);
            if (PP > x && x >= -4) {
              body = fixedStr(m, e, PP - 1 - x, alt);
              if (!alt) body = stripZeros(body);
            } else {
              let s = expStr(digits, x, PP - 1, alt, upper);
              if (!alt) {
                const idx = s.search(/[eE]/);
                s = stripZeros(s.slice(0, idx)) + s.slice(idx);
              }
              body = s;
            }
          }
        }
      }
    }

    const len = prefix.length + body.length;
    if (len >= width) return prefix + body;
    const pad = width - len;
    if (left) return prefix + body + ' '.repeat(pad);
    if (zeroOk) return prefix + '0'.repeat(pad) + body;
    return ' '.repeat(pad) + prefix + body;
  });
}
