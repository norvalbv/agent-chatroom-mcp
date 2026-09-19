const TEN = 10n;

function pow10(k: number): bigint {
  return TEN ** BigInt(k);
}

// exact positive finite double as n/d
function toRational(v: number): [bigint, bigint] {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, v);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const bexp = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let ex: number;
  if (bexp === 0) {
    ex = -1074;
  } else {
    m |= 1n << 52n;
    ex = bexp - 1075;
  }
  return ex >= 0 ? [m << BigInt(ex), 1n] : [m, 1n << BigInt(-ex)];
}

function roundDiv(a: bigint, b: bigint): bigint {
  const q = a / b;
  const r = a % b;
  const twice = r * 2n;
  if (twice > b || (twice === b && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// round(v * 10^k), half-even
function scaledRound(n: bigint, d: bigint, k: number): bigint {
  return k >= 0 ? roundDiv(n * pow10(k), d) : roundDiv(n, d * pow10(-k));
}

// floor(log10(v)) for v = n/d > 0
function floorLog10(n: bigint, d: bigint): number {
  let e = n.toString().length - d.toString().length;
  const ge = e >= 0 ? n >= d * pow10(e) : n * pow10(-e) >= d;
  if (!ge) e--;
  return e;
}

// digits of v (>=0) fixed with p decimals
function fixedDigits(v: number, p: number, alt: boolean): string {
  let N: bigint;
  if (v === 0) N = 0n;
  else {
    const [n, d] = toRational(v);
    N = scaledRound(n, d, p);
  }
  let s = N.toString();
  if (p > 0) {
    s = s.padStart(p + 1, '0');
    return s.slice(0, s.length - p) + '.' + s.slice(s.length - p);
  }
  return alt ? s + '.' : s;
}

// returns [digits string of p+1 digits, exponent]
function expParts(v: number, p: number): [string, number] {
  if (v === 0) return ['0'.repeat(p + 1), 0];
  const [n, d] = toRational(v);
  let e = floorLog10(n, d);
  let N = scaledRound(n, d, p - e);
  if (N >= pow10(p + 1)) {
    e++;
    N = scaledRound(n, d, p - e);
  }
  return [N.toString(), e];
}

function expStyle(v: number, p: number, alt: boolean, upper: boolean): string {
  const [ds, e] = expParts(v, p);
  let s = ds[0];
  if (p > 0) s += '.' + ds.slice(1);
  else if (alt) s += '.';
  const ae = Math.abs(e);
  return s + (upper ? 'E' : 'e') + (e < 0 ? '-' : '+') + (ae < 10 ? '0' + ae : String(ae));
}

function stripZeros(s: string): string {
  if (!s.includes('.')) return s;
  return s.replace(/0+$/, '').replace(/\.$/, '');
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let ai = 0;
  const re = /%([-+ 0#]*)(\d*)(\.\d*)?([diouxXeEfFgGscp%])/g;
  return fmt.replace(re, (_m, flags: string, w: string, pr: string | undefined, conv: string) => {
    if (conv === '%') return '%';
    const left = flags.includes('-');
    const plus = flags.includes('+');
    const space = flags.includes(' ');
    const zero = flags.includes('0') && !left;
    const alt = flags.includes('#');
    const width = w ? parseInt(w, 10) : 0;
    const prec = pr === undefined ? -1 : pr.length > 1 ? parseInt(pr.slice(1), 10) : 0;
    const arg = args[ai++];

    const pad = (body: string) => (left ? body.padEnd(width) : body.padStart(width));
    const padNum = (sign: string, digits: string, allowZero: boolean) => {
      if (zero && allowZero && sign.length + digits.length < width) {
        digits = digits.padStart(width - sign.length, '0');
      }
      return pad(sign + digits);
    };

    if (conv === 's') {
      let s = String(arg);
      if (prec >= 0) s = s.slice(0, prec);
      return pad(s);
    }
    if (conv === 'c') return pad(String(arg));

    if (conv === 'd' || conv === 'i') {
      const b = BigInt(arg as number | bigint);
      const neg = b < 0n;
      let digits = (neg ? -b : b).toString();
      if (prec === 0 && b === 0n) digits = '';
      if (prec >= 0) digits = digits.padStart(prec, '0');
      const sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
      return padNum(sign, digits, prec < 0);
    }

    if (conv === 'x' || conv === 'X' || conv === 'o') {
      const b = BigInt(arg as number | bigint);
      let digits = b.toString(conv === 'o' ? 8 : 16);
      if (conv === 'X') digits = digits.toUpperCase();
      if (prec === 0 && b === 0n) digits = '';
      if (prec >= 0) digits = digits.padStart(prec, '0');
      let prefix = '';
      if (alt) {
        if (conv === 'o') {
          if (digits[0] !== '0') digits = '0' + digits;
        } else if (b !== 0n) prefix = conv === 'x' ? '0x' : '0X';
      }
      return padNum(prefix, digits, prec < 0);
    }

    // floats
    const v = arg as number;
    const upper = conv === 'E' || conv === 'F' || conv === 'G';
    const neg = !Number.isNaN(v) && (v < 0 || Object.is(v, -0));
    const sign = Number.isNaN(v) ? '' : neg ? '-' : plus ? '+' : space ? ' ' : '';
    if (!Number.isFinite(v)) {
      let t = Number.isNaN(v) ? 'nan' : 'inf';
      if (upper) t = t.toUpperCase();
      return padNum(sign, t, false);
    }
    const a = Math.abs(v);
    let body: string;
    const lc = conv.toLowerCase();
    if (lc === 'f') {
      body = fixedDigits(a, prec < 0 ? 6 : prec, alt);
    } else if (lc === 'e') {
      body = expStyle(a, prec < 0 ? 6 : prec, alt, upper);
    } else {
      const P = prec < 0 ? 6 : prec === 0 ? 1 : prec;
      const X = expParts(a, P - 1)[1];
      if (P > X && X >= -4) {
        body = fixedDigits(a, P - 1 - X, alt);
        if (!alt) body = stripZeros(body);
      } else {
        body = expStyle(a, P - 1, alt, upper);
        if (!alt) {
          const i = body.search(/[eE]/);
          body = stripZeros(body.slice(0, i)) + body.slice(i);
        }
      }
    }
    return padNum(sign, body, true);
  });
}
