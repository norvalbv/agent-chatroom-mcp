// Decompose a finite non-negative double into m * 2^e with integer m.
function decompose(x: number): [bigint, number] {
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, x);
  const hi = buf.getUint32(0);
  const lo = buf.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (expBits === 0) return [m, -1074];
  m |= 1n << 52n;
  return [m, expBits - 1075];
}

// round(x * 10^s) to nearest, ties to even, exactly.
function roundScaled(x: number, s: number): bigint {
  const [m, e] = decompose(x);
  let num = m;
  let den = 1n;
  if (e >= 0) num <<= BigInt(e);
  else den <<= BigInt(-e);
  if (s >= 0) num *= 10n ** BigInt(s);
  else den *= 10n ** BigInt(-s);
  let q = num / den;
  const r2 = (num % den) * 2n;
  if (r2 > den || (r2 === den && (q & 1n) === 1n)) q += 1n;
  return q;
}

function fixedStr(x: number, prec: number, alt: boolean): string {
  let d = roundScaled(x, prec).toString();
  if (d.length < prec + 1) d = '0'.repeat(prec + 1 - d.length) + d;
  const ip = d.slice(0, d.length - prec);
  const fp = d.slice(d.length - prec);
  return prec > 0 ? ip + '.' + fp : alt ? ip + '.' : ip;
}

// Returns digits (prec+1 of them) and decimal exponent.
function expParts(x: number, prec: number): [string, number] {
  if (x === 0) return ['0'.repeat(prec + 1), 0];
  let e10 = Math.floor(Math.log10(x));
  for (let i = 0; i < 20; i++) {
    const d = roundScaled(x, prec - e10).toString();
    if (d.length > prec + 1) e10++;
    else if (d.length < prec + 1) e10--;
    else return [d, e10];
  }
  throw new Error('exponent search failed');
}

function expStr(x: number, prec: number, alt: boolean, upper: boolean): string {
  const [d, e10] = expParts(x, prec);
  let s = d[0];
  if (prec > 0) s += '.' + d.slice(1);
  else if (alt) s += '.';
  const ae = Math.abs(e10);
  return s + (upper ? 'E' : 'e') + (e10 < 0 ? '-' : '+') + (ae < 10 ? '0' : '') + ae;
}

function stripZeros(s: string): string {
  if (!s.includes('.')) return s;
  return s.replace(/0+$/, '').replace(/\.$/, '');
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let ai = 0;
  const re = /%(?:([-+ 0#]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc])|%)/g;
  return fmt.replace(re, (whole, flags: string | undefined, w: string, p: string | undefined, conv: string | undefined) => {
    if (conv === undefined) return '%';
    const left = flags!.includes('-');
    const plus = flags!.includes('+');
    const space = flags!.includes(' ');
    const zero = flags!.includes('0') && !left;
    const alt = flags!.includes('#');
    const width = w ? parseInt(w, 10) : 0;
    const hasPrec = p !== undefined;
    const precVal = hasPrec ? (p === '' ? 0 : parseInt(p, 10)) : -1;
    const arg = args[ai++];

    let sign = '';
    let prefix = '';
    let body: string;
    let canZero = false;

    if (conv === 's' || conv === 'c') {
      body = String(arg);
      if (conv === 's' && hasPrec) body = body.slice(0, precVal);
    } else if ('diouxX'.includes(conv)) {
      const v = typeof arg === 'bigint' ? arg : BigInt(arg as number);
      const neg = v < 0n;
      const mag = neg ? -v : v;
      if (conv === 'd' || conv === 'i') {
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
      }
      let digits = conv === 'o' ? mag.toString(8) : conv === 'x' ? mag.toString(16) : conv === 'X' ? mag.toString(16).toUpperCase() : mag.toString(10);
      if (hasPrec && precVal === 0 && mag === 0n) digits = '';
      if (hasPrec && digits.length < precVal) digits = '0'.repeat(precVal - digits.length) + digits;
      if (alt) {
        if (conv === 'o') {
          if (digits[0] !== '0') digits = '0' + digits;
        } else if ((conv === 'x' || conv === 'X') && mag !== 0n) {
          prefix = conv === 'x' ? '0x' : '0X';
        }
      }
      body = digits;
      canZero = !hasPrec;
    } else {
      const v = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      const neg = v < 0 || Object.is(v, -0);
      if (Number.isNaN(v)) {
        body = upper ? 'NAN' : 'nan';
      } else {
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        if (!Number.isFinite(v)) {
          body = upper ? 'INF' : 'inf';
        } else {
          const x = Math.abs(v);
          const lc = conv.toLowerCase();
          const prec = hasPrec ? precVal : 6;
          if (lc === 'f') body = fixedStr(x, prec, alt);
          else if (lc === 'e') body = expStr(x, prec, alt, upper);
          else {
            const P = prec === 0 ? 1 : prec;
            const X = expParts(x, P - 1)[1];
            if (P > X && X >= -4) {
              body = fixedStr(x, P - 1 - X, alt);
              if (!alt) body = stripZeros(body);
            } else {
              body = expStr(x, P - 1, alt, upper);
              if (!alt) {
                const k = body.search(/[eE]/);
                body = stripZeros(body.slice(0, k)) + body.slice(k);
              }
            }
          }
          canZero = true;
        }
      }
    }

    const len = sign.length + prefix.length + body.length;
    if (len >= width) return sign + prefix + body;
    const pad = width - len;
    if (left) return sign + prefix + body + ' '.repeat(pad);
    if (zero && canZero) return sign + prefix + '0'.repeat(pad) + body;
    return ' '.repeat(pad) + sign + prefix + body;
  });
}
