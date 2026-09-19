function decompose(v: number): [bigint, number] {
  // v finite, > 0: returns [m, e] with v = m * 2^e
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, v);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const be = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (be === 0) return [m, -1074];
  m |= 1n << 52n;
  return [m, be - 1075];
}

// round(v * 10^k), half to even
function scaleRound(v: number, k: number): bigint {
  const [m, e] = decompose(v);
  let num = m;
  let den = 1n;
  if (e >= 0) num <<= BigInt(e);
  else den <<= BigInt(-e);
  if (k >= 0) num *= 10n ** BigInt(k);
  else den *= 10n ** BigInt(-k);
  let q = num / den;
  const r2 = (num % den) * 2n;
  if (r2 > den || (r2 === den && (q & 1n) === 1n)) q += 1n;
  return q;
}

function fixedStr(v: number, p: number, alt: boolean): string {
  let s = v === 0 ? '0'.repeat(p + 1) : scaleRound(v, p).toString();
  if (s.length < p + 1) s = '0'.repeat(p + 1 - s.length) + s;
  const ip = s.slice(0, s.length - p);
  const fp = s.slice(s.length - p);
  return ip + (p > 0 || alt ? '.' : '') + fp;
}

// returns digits (p+1 of them) and decimal exponent
function expParts(v: number, p: number): [string, number] {
  if (v === 0) return ['0'.repeat(p + 1), 0];
  let X = Math.floor(Math.log10(v));
  const lo = 10n ** BigInt(p);
  const hi = lo * 10n;
  for (let i = 0; i < 10; i++) {
    const n = scaleRound(v, p - X);
    if (n >= hi) X++;
    else if (n < lo) X--;
    else return [n.toString(), X];
  }
  throw new Error('exp');
}

function expStr(v: number, p: number, alt: boolean, upper: boolean, parts?: [string, number]): string {
  const [d, X] = parts ?? expParts(v, p);
  const ax = Math.abs(X);
  return (
    d[0] +
    (p > 0 || alt ? '.' : '') +
    d.slice(1) +
    (upper ? 'E' : 'e') +
    (X < 0 ? '-' : '+') +
    (ax < 10 ? '0' + ax : String(ax))
  );
}

function stripZeros(s: string): string {
  // s has a '.' possibly followed by exponent
  const ei = s.search(/[eE]/);
  const mant = ei < 0 ? s : s.slice(0, ei);
  const ex = ei < 0 ? '' : s.slice(ei);
  if (mant.indexOf('.') < 0) return s;
  return mant.replace(/0+$/, '').replace(/\.$/, '') + ex;
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let out = '';
  let ai = 0;
  const re = /%(?:(%)|([-+ 0#]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc]))/y;
  let i = 0;
  while (i < fmt.length) {
    const pc = fmt.indexOf('%', i);
    if (pc < 0) {
      out += fmt.slice(i);
      break;
    }
    out += fmt.slice(i, pc);
    re.lastIndex = pc;
    const mt = re.exec(fmt);
    if (!mt) {
      out += '%';
      i = pc + 1;
      continue;
    }
    i = re.lastIndex;
    if (mt[1]) {
      out += '%';
      continue;
    }
    const flags = mt[2];
    const minus = flags.includes('-');
    const plus = flags.includes('+');
    const space = flags.includes(' ');
    const zero = flags.includes('0');
    const alt = flags.includes('#');
    const width = mt[3] ? parseInt(mt[3], 10) : 0;
    const hasPrec = mt[4] !== undefined;
    const prec = hasPrec ? (mt[4] === '' ? 0 : parseInt(mt[4], 10)) : -1;
    const conv = mt[5];
    const arg = args[ai++];

    let sign = '';
    let body = '';
    let zeroOk = zero && !minus;

    if (conv === 's' || conv === 'c') {
      let s = String(arg);
      if (conv === 's' && hasPrec) s = s.slice(0, prec);
      body = s;
      zeroOk = false;
    } else if (conv === 'd' || conv === 'i' || conv === 'x' || conv === 'X' || conv === 'o') {
      const n = BigInt(arg as number | bigint);
      const neg = n < 0n;
      const mag = neg ? -n : n;
      if (conv === 'd' || conv === 'i') {
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
      }
      let digits = conv === 'x' ? mag.toString(16) : conv === 'X' ? mag.toString(16).toUpperCase() : conv === 'o' ? mag.toString(8) : mag.toString();
      if (hasPrec) {
        if (prec === 0 && mag === 0n) digits = '';
        else if (digits.length < prec) digits = '0'.repeat(prec - digits.length) + digits;
      }
      if (alt) {
        if (conv === 'o') {
          if (digits[0] !== '0') digits = '0' + digits;
        } else if ((conv === 'x' || conv === 'X') && mag !== 0n) {
          sign = conv === 'x' ? '0x' : '0X';
        }
      }
      body = digits;
      if (hasPrec) zeroOk = false;
    } else {
      const v = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      const neg = v < 0 || Object.is(v, -0);
      if (Number.isNaN(v)) {
        sign = '';
        body = upper ? 'NAN' : 'nan';
        zeroOk = false;
      } else {
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        const a = Math.abs(v);
        if (a === Infinity) {
          body = upper ? 'INF' : 'inf';
          zeroOk = false;
        } else {
          const lc = conv.toLowerCase();
          if (lc === 'f') {
            body = fixedStr(a, prec < 0 ? 6 : prec, alt);
          } else if (lc === 'e') {
            body = expStr(a, prec < 0 ? 6 : prec, alt, upper);
          } else {
            let P = prec < 0 ? 6 : prec;
            if (P === 0) P = 1;
            const parts = expParts(a, P - 1);
            const X = parts[1];
            if (P > X && X >= -4) {
              body = fixedStr(a, P - 1 - X, alt);
            } else {
              body = expStr(a, P - 1, alt, upper, parts);
            }
            if (!alt) body = stripZeros(body);
          }
        }
      }
    }

    const len = sign.length + body.length;
    if (len < width) {
      const pad = width - len;
      if (minus) body = sign + body + ' '.repeat(pad);
      else if (zeroOk) body = sign + '0'.repeat(pad) + body;
      else body = ' '.repeat(pad) + sign + body;
    } else {
      body = sign + body;
    }
    out += body;
  }
  return out;
}
