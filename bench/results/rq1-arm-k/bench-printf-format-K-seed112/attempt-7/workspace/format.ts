function decompose(x: number): [bigint, number] {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, Math.abs(x));
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  let mant = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let e: number;
  if (expBits === 0) {
    e = -1074;
  } else {
    mant |= 1n << 52n;
    e = expBits - 1075;
  }
  return [mant, e];
}

// value = m * 2^e; returns [num, den] of value * 10^k
function ratio(m: bigint, e: number, k: number): [bigint, bigint] {
  let num = m;
  let den = 1n;
  if (e >= 0) num <<= BigInt(e);
  else den <<= BigInt(-e);
  if (k >= 0) num *= 10n ** BigInt(k);
  else den *= 10n ** BigInt(-k);
  return [num, den];
}

// round(value * 10^k), half to even
function scaledRound(m: bigint, e: number, k: number): bigint {
  const [num, den] = ratio(m, e, k);
  let q = num / den;
  const r2 = (num % den) * 2n;
  if (r2 > den || (r2 === den && (q & 1n) === 1n)) q += 1n;
  return q;
}

function floorLog10(m: bigint, e: number): number {
  let x = Math.floor(Math.log10(Number(m) * Math.pow(2, e)));
  if (!Number.isFinite(x)) x = Math.floor((Math.log10(Number(m)) + e * Math.log10(2)));
  for (;;) {
    const [n, d] = ratio(m, e, -x);
    if (n < d) x--;
    else {
      const [n2, d2] = ratio(m, e, -(x + 1));
      if (n2 >= d2) x++;
      else return x;
    }
  }
}

function fixedStr(m: bigint, e: number, prec: number, alt: boolean): string {
  let s = scaledRound(m, e, prec).toString();
  if (prec === 0) return alt ? s + '.' : s;
  s = s.padStart(prec + 1, '0');
  return s.slice(0, s.length - prec) + '.' + s.slice(s.length - prec);
}

function sciParts(m: bigint, e: number, prec: number): [string, number] {
  if (m === 0n) return ['0'.repeat(prec + 1), 0];
  let x = floorLog10(m, e);
  let n = scaledRound(m, e, prec - x);
  if (n >= 10n ** BigInt(prec + 1)) {
    x++;
    n = scaledRound(m, e, prec - x);
  }
  return [n.toString(), x];
}

function sciStr(m: bigint, e: number, prec: number, alt: boolean, upper: boolean): string {
  const [d, x] = sciParts(m, e, prec);
  let s = d[0];
  if (prec > 0) s += '.' + d.slice(1);
  else if (alt) s += '.';
  const ax = Math.abs(x);
  return s + (upper ? 'E' : 'e') + (x < 0 ? '-' : '+') + (ax < 10 ? '0' + ax : String(ax));
}

function stripZeros(s: string): string {
  const ei = s.search(/[eE]/);
  let mant = ei < 0 ? s : s.slice(0, ei);
  const tail = ei < 0 ? '' : s.slice(ei);
  if (mant.includes('.')) mant = mant.replace(/0+$/, '').replace(/\.$/, '');
  return mant + tail;
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let ai = 0;
  const re = /%([-+ 0#]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc%])/g;
  return fmt.replace(re, (_all, flags: string, w: string, p: string | undefined, conv: string) => {
    if (conv === '%') return '%';
    const arg = args[ai++];
    const left = flags.includes('-');
    const plus = flags.includes('+');
    const space = flags.includes(' ');
    const zero = flags.includes('0');
    const alt = flags.includes('#');
    const width = w === '' ? 0 : parseInt(w, 10);
    const hasPrec = p !== undefined;
    const prec = hasPrec ? (p === '' ? 0 : parseInt(p, 10)) : -1;

    let prefix = '';
    let body = '';
    let canZero = zero && !left;

    if (conv === 's' || conv === 'c') {
      body = String(arg);
      if (conv === 's' && hasPrec) body = body.slice(0, prec);
      canZero = false;
    } else if ('dioxX'.includes(conv)) {
      const v = typeof arg === 'bigint' ? arg : BigInt(arg as number);
      const neg = v < 0n;
      const mag = neg ? -v : v;
      let digits = conv === 'x' ? mag.toString(16) : conv === 'X' ? mag.toString(16).toUpperCase() : conv === 'o' ? mag.toString(8) : mag.toString();
      if (hasPrec) {
        if (prec === 0 && mag === 0n) digits = '';
        digits = digits.padStart(prec, '0');
        canZero = false;
      }
      if (conv === 'd' || conv === 'i') {
        prefix = neg ? '-' : plus ? '+' : space ? ' ' : '';
      } else if (alt) {
        if (conv === 'o') {
          if (!digits.startsWith('0')) digits = '0' + digits;
        } else if (mag !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      }
      body = digits;
    } else {
      const x = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      const neg = x < 0 || Object.is(x, -0);
      if (Number.isNaN(x)) {
        body = upper ? 'NAN' : 'nan';
        canZero = false;
      } else {
        prefix = neg ? '-' : plus ? '+' : space ? ' ' : '';
        if (!Number.isFinite(x)) {
          body = upper ? 'INF' : 'inf';
          canZero = false;
        } else {
          const [m, e] = decompose(x);
          const lc = conv.toLowerCase();
          if (lc === 'f') body = fixedStr(m, e, hasPrec ? prec : 6, alt);
          else if (lc === 'e') body = sciStr(m, e, hasPrec ? prec : 6, alt, upper);
          else {
            const P = !hasPrec ? 6 : prec === 0 ? 1 : prec;
            const X = sciParts(m, e, P - 1)[1];
            if (P > X && X >= -4) body = fixedStr(m, e, P - 1 - X, alt);
            else body = sciStr(m, e, P - 1, alt, upper);
            if (!alt) body = stripZeros(body);
          }
        }
      }
    }

    const len = prefix.length + body.length;
    if (len >= width) return prefix + body;
    const pad = width - len;
    if (left) return prefix + body + ' '.repeat(pad);
    if (canZero) return prefix + '0'.repeat(pad) + body;
    return ' '.repeat(pad) + prefix + body;
  });
}
