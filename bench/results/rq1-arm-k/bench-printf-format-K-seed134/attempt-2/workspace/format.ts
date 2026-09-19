function decompose(v: number): [bigint, number] {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, Math.abs(v));
  const bits = dv.getBigUint64(0);
  const e = Number((bits >> 52n) & 0x7ffn);
  const f = bits & 0xfffffffffffffn;
  if (e === 0) return [f, -1074];
  return [f | (1n << 52n), e - 1075];
}

// round_half_even(|v| * 10^k) using the exact binary value
function roundScaled(mant: bigint, exp2: number, k: number): bigint {
  let num = mant;
  let den = 1n;
  if (k >= 0) num *= 10n ** BigInt(k);
  else den *= 10n ** BigInt(-k);
  if (exp2 >= 0) num <<= BigInt(exp2);
  else den <<= BigInt(-exp2);
  const q = num / den;
  const r = num % den;
  const twice = r * 2n;
  if (twice > den || (twice === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

function fixedDigits(v: number, prec: number, alt: boolean): string {
  const [m, e] = decompose(v);
  const n = roundScaled(m, e, prec);
  let s = n.toString();
  if (prec > 0) {
    s = s.padStart(prec + 1, '0');
    s = s.slice(0, s.length - prec) + '.' + s.slice(s.length - prec);
  } else if (alt) s += '.';
  return s;
}

// returns [digit string of length prec+1, decimal exponent]
function expDigits(v: number, prec: number): [string, number] {
  if (v === 0) return ['0'.repeat(prec + 1), 0];
  const [m, e] = decompose(v);
  let X = Math.floor(Math.log10(Math.abs(v)));
  if (!isFinite(X)) X = Math.floor((Math.log2(Math.abs(v)) || -1074) * 0.30103);
  const lo = 10n ** BigInt(prec);
  for (let i = 0; i < 2000; i++) {
    const n = roundScaled(m, e, prec - X);
    if (n < lo) X--;
    else if (n >= lo * 10n) X++;
    else return [n.toString(), X];
  }
  throw new Error('exp search failed');
}

function expStr(v: number, prec: number, alt: boolean, upper: boolean): string {
  const [d, X] = expDigits(v, prec);
  let s = d[0];
  if (prec > 0) s += '.' + d.slice(1);
  else if (alt) s += '.';
  const ax = Math.abs(X);
  return s + (upper ? 'E' : 'e') + (X < 0 ? '-' : '+') + (ax < 10 ? '0' : '') + ax;
}

function stripZeros(s: string): string {
  if (!s.includes('.')) return s;
  return s.replace(/0+$/, '').replace(/\.$/, '');
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let ai = 0;
  const re = /%([-+ 0#]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc%])/g;
  return fmt.replace(re, (_m, flags: string, w: string, p: string | undefined, conv: string) => {
    if (conv === '%') return '%';
    const left = flags.includes('-');
    const plus = flags.includes('+');
    const space = flags.includes(' ');
    const zero = flags.includes('0') && !left;
    const alt = flags.includes('#');
    const width = w ? parseInt(w, 10) : 0;
    const hasPrec = p !== undefined;
    const prec = hasPrec ? (p === '' ? 0 : parseInt(p!, 10)) : -1;
    const arg = args[ai++];

    let sign = '';
    let prefix = '';
    let body: string;
    let zeroOk = zero;

    if (conv === 's') {
      body = String(arg);
      if (hasPrec) body = body.slice(0, prec);
      zeroOk = false;
    } else if (conv === 'c') {
      body = String(arg);
      zeroOk = false;
    } else if ('dioxX'.includes(conv)) {
      const n = typeof arg === 'bigint' ? arg : BigInt(arg as number);
      const neg = n < 0n;
      const mag = neg ? -n : n;
      if (conv === 'd' || conv === 'i') {
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        body = mag.toString();
      } else if (conv === 'o') body = mag.toString(8);
      else {
        body = mag.toString(16);
        if (conv === 'X') body = body.toUpperCase();
      }
      if (hasPrec) {
        if (prec === 0 && mag === 0n) body = '';
        body = body.padStart(prec, '0');
        zeroOk = false;
      }
      if (alt) {
        if (conv === 'o') {
          if (!body.startsWith('0')) body = '0' + body;
        } else if (conv !== 'd' && conv !== 'i' && mag !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      }
    } else {
      const v = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      if (Number.isNaN(v)) {
        body = upper ? 'NAN' : 'nan';
        zeroOk = false;
      } else {
        const neg = v < 0 || Object.is(v, -0);
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        if (!isFinite(v)) {
          body = upper ? 'INF' : 'inf';
          zeroOk = false;
        } else {
          const P = hasPrec ? prec : 6;
          const lc = conv.toLowerCase();
          if (lc === 'f') body = fixedDigits(v, P, alt);
          else if (lc === 'e') body = expStr(v, P, alt, upper);
          else {
            const PP = P === 0 ? 1 : P;
            const [, X] = expDigits(v, PP - 1);
            if (PP > X && X >= -4) {
              body = fixedDigits(v, PP - 1 - X, alt);
              if (!alt) body = stripZeros(body);
            } else {
              body = expStr(v, PP - 1, alt, upper);
              if (!alt) {
                const i = body.search(/[eE]/);
                body = stripZeros(body.slice(0, i)) + body.slice(i);
              }
            }
          }
        }
      }
    }

    const len = sign.length + prefix.length + body.length;
    if (len >= width) return sign + prefix + body;
    const pad = width - len;
    if (left) return sign + prefix + body + ' '.repeat(pad);
    if (zeroOk) return sign + prefix + '0'.repeat(pad) + body;
    return ' '.repeat(pad) + sign + prefix + body;
  });
}
