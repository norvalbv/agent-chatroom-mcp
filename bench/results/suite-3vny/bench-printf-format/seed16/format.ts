function roundDiv(n: bigint, d: bigint): bigint {
  const q = n / d;
  const r = n - q * d;
  const twice = r * 2n;
  if (twice > d || (twice === d && (q & 1n) === 1n)) return q + 1n;
  return q;
}

function pow10(k: number): bigint {
  return 10n ** BigInt(k);
}

// exact rational of a positive finite double
function toRational(v: number): [bigint, bigint] {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, v);
  const bits = dv.getBigUint64(0);
  const expBits = Number((bits >> 52n) & 0x7ffn);
  const frac = bits & ((1n << 52n) - 1n);
  let m: bigint;
  let e: number;
  if (expBits === 0) {
    m = frac;
    e = -1074;
  } else {
    m = frac | (1n << 52n);
    e = expBits - 1075;
  }
  return e >= 0 ? [m << BigInt(e), 1n] : [m, 1n << BigInt(-e)];
}

// round v * 10^s to an integer (half-even)
function scaledRound(num: bigint, den: bigint, s: number): bigint {
  if (s >= 0) return roundDiv(num * pow10(s), den);
  return roundDiv(num, den * pow10(-s));
}

// fixed: digits string of integer part and fraction
function fixedDigits(v: number, prec: number): string {
  // returns digits with at least prec+1 chars (int part + fraction), no point
  if (v === 0) return "0".repeat(prec + 1);
  const [n, d] = toRational(v);
  let s = scaledRound(n, d, prec).toString();
  if (s.length < prec + 1) s = "0".repeat(prec + 1 - s.length) + s;
  return s;
}

// exponent-style: returns [digits (prec+1 chars), exponent]
function expDigits(v: number, prec: number): [string, number] {
  if (v === 0) return ["0".repeat(prec + 1), 0];
  const [n, d] = toRational(v);
  let k = n.toString().length - d.toString().length;
  const ge = (kk: number) => (kk >= 0 ? n >= d * pow10(kk) : n * pow10(-kk) >= d);
  while (ge(k + 1)) k++;
  while (!ge(k)) k--;
  let r = scaledRound(n, d, prec - k);
  if (r >= pow10(prec + 1)) {
    k++;
    r = scaledRound(n, d, prec - k);
  }
  return [r.toString(), k];
}

function fmtExp(digits: string, x: number, prec: number, alt: boolean, upper: boolean): string {
  let s = digits[0];
  if (prec > 0 || alt) s += ".";
  s += digits.slice(1);
  const ax = Math.abs(x);
  s += (upper ? "E" : "e") + (x < 0 ? "-" : "+") + (ax < 10 ? "0" : "") + ax;
  return s;
}

function fmtFixed(digits: string, prec: number, alt: boolean): string {
  const ip = digits.slice(0, digits.length - prec);
  const fp = digits.slice(digits.length - prec);
  return ip + (prec > 0 || alt ? "." : "") + fp;
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let out = "";
  let ai = 0;
  let i = 0;
  while (i < fmt.length) {
    const ch = fmt[i];
    if (ch !== "%") {
      out += ch;
      i++;
      continue;
    }
    i++;
    if (fmt[i] === "%") {
      out += "%";
      i++;
      continue;
    }
    let minus = false, plus = false, space = false, zero = false, alt = false;
    for (; i < fmt.length; i++) {
      const f = fmt[i];
      if (f === "-") minus = true;
      else if (f === "+") plus = true;
      else if (f === " ") space = true;
      else if (f === "0") zero = true;
      else if (f === "#") alt = true;
      else break;
    }
    let width = 0;
    while (i < fmt.length && fmt[i] >= "0" && fmt[i] <= "9") width = width * 10 + Number(fmt[i++]);
    let prec = -1;
    if (fmt[i] === ".") {
      i++;
      prec = 0;
      while (i < fmt.length && fmt[i] >= "0" && fmt[i] <= "9") prec = prec * 10 + Number(fmt[i++]);
    }
    const conv = fmt[i++];
    const arg = args[ai++];

    let sign = "";
    let prefix = "";
    let body = "";
    let canZero = true;

    switch (conv) {
      case "d":
      case "i": {
        const b = BigInt(arg as number | bigint);
        const neg = b < 0n;
        body = (neg ? -b : b).toString();
        if (prec === 0 && b === 0n) body = "";
        if (prec >= 0) {
          canZero = false;
          if (body.length < prec) body = "0".repeat(prec - body.length) + body;
        }
        sign = neg ? "-" : plus ? "+" : space ? " " : "";
        break;
      }
      case "x":
      case "X":
      case "o": {
        const b = BigInt(arg as number | bigint);
        body = b.toString(conv === "o" ? 8 : 16);
        if (conv === "X") body = body.toUpperCase();
        if (prec === 0 && b === 0n) body = "";
        if (prec >= 0) {
          canZero = false;
          if (body.length < prec) body = "0".repeat(prec - body.length) + body;
        }
        if (alt) {
          if (conv === "o") {
            if (body[0] !== "0") body = "0" + body;
          } else if (b !== 0n) prefix = conv === "x" ? "0x" : "0X";
        }
        break;
      }
      case "e":
      case "E":
      case "f":
      case "F":
      case "g":
      case "G": {
        const v = arg as number;
        const upper = conv === "E" || conv === "F" || conv === "G";
        if (Number.isNaN(v)) {
          body = upper ? "NAN" : "nan";
          canZero = false;
          break;
        }
        const neg = v < 0 || Object.is(v, -0);
        sign = neg ? "-" : plus ? "+" : space ? " " : "";
        if (!Number.isFinite(v)) {
          body = upper ? "INF" : "inf";
          canZero = false;
          break;
        }
        const a = Math.abs(v);
        const lc = conv.toLowerCase();
        if (lc === "f") {
          const p = prec < 0 ? 6 : prec;
          body = fmtFixed(fixedDigits(a, p), p, alt);
        } else if (lc === "e") {
          const p = prec < 0 ? 6 : prec;
          const [dg, x] = expDigits(a, p);
          body = fmtExp(dg, x, p, alt, upper);
        } else {
          let P = prec < 0 ? 6 : prec;
          if (P === 0) P = 1;
          const [dg, x] = expDigits(a, P - 1);
          const strip = (s: string) => (s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s);
          if (P > x && x >= -4) {
            const p = P - 1 - x;
            body = fmtFixed(fixedDigits(a, p), p, alt);
            if (!alt) body = strip(body);
          } else {
            const p = P - 1;
            if (alt) body = fmtExp(dg, x, p, true, upper);
            else {
              const m = strip(fmtExp(dg, x, p, false, upper).split(/[eE]/)[0]);
              const e = fmtExp(dg, x, p, false, upper);
              body = m + e.slice(e.search(/[eE]/));
            }
          }
        }
        break;
      }
      case "s": {
        body = arg as string;
        if (prec >= 0) body = body.slice(0, prec);
        canZero = false;
        break;
      }
      case "c":
        body = arg as string;
        canZero = false;
        break;
    }

    const len = sign.length + prefix.length + body.length;
    if (len < width) {
      const pad = width - len;
      if (minus) body = sign + prefix + body + " ".repeat(pad);
      else if (zero && canZero) body = sign + prefix + "0".repeat(pad) + body;
      else body = " ".repeat(pad) + sign + prefix + body;
    } else body = sign + prefix + body;
    out += body;
  }
  return out;
}
