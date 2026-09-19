// Exact rational of a positive finite double: num / den.
function toRational(v: number): [bigint, bigint] {
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, v);
  const bits = buf.getBigUint64(0);
  const e = Number((bits >> 52n) & 0x7ffn);
  const frac = bits & ((1n << 52n) - 1n);
  let mant: bigint;
  let exp: number;
  if (e === 0) {
    mant = frac;
    exp = -1074;
  } else {
    mant = frac | (1n << 52n);
    exp = e - 1075;
  }
  return exp >= 0 ? [mant << BigInt(exp), 1n] : [mant, 1n << BigInt(-exp)];
}

// round-half-even(v * 10^k)
function roundScaled(rat: [bigint, bigint], k: number): bigint {
  let [num, den] = rat;
  if (k >= 0) num *= 10n ** BigInt(k);
  else den *= 10n ** BigInt(-k);
  const q = num / den;
  const r2 = (num % den) * 2n;
  if (r2 > den || (r2 === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// Fixed notation of |v| (v >= 0, finite).
function fixedStr(v: number, prec: number, alt: boolean): string {
  let digits = v === 0 ? "0" : roundScaled(toRational(v), prec).toString();
  if (prec > 0) {
    digits = digits.padStart(prec + 1, "0");
    return digits.slice(0, -prec) + "." + digits.slice(-prec);
  }
  return alt ? digits + "." : digits;
}

// Scientific pieces of |v|: prec+1 significant digits and decimal exponent.
function sciParts(v: number, prec: number): [string, number] {
  if (v === 0) return ["0".repeat(prec + 1), 0];
  const rat = toRational(v);
  let e10 = Math.floor(Math.log10(v));
  if (!isFinite(e10)) e10 = -324;
  const lo = 10n ** BigInt(prec);
  const hi = lo * 10n;
  for (;;) {
    const n = roundScaled(rat, prec - e10);
    if (n >= hi) {
      e10++;
      continue;
    }
    if (n < lo) {
      e10--;
      continue;
    }
    return [n.toString(), e10];
  }
}

function sciStr(digits: string, e10: number, prec: number, alt: boolean, upper: boolean): string {
  let m = digits[0];
  if (prec > 0) m += "." + digits.slice(1);
  else if (alt) m += ".";
  const ae = Math.abs(e10);
  return m + (upper ? "E" : "e") + (e10 < 0 ? "-" : "+") + (ae < 10 ? "0" + ae : String(ae));
}

function stripZeros(s: string): string {
  if (!s.includes(".")) return s;
  return s.replace(/0+$/, "").replace(/\.$/, "");
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
    for (;; i++) {
      const c = fmt[i];
      if (c === "-") minus = true;
      else if (c === "+") plus = true;
      else if (c === " ") space = true;
      else if (c === "0") zero = true;
      else if (c === "#") alt = true;
      else break;
    }
    let width = 0;
    while (fmt[i] >= "0" && fmt[i] <= "9") width = width * 10 + Number(fmt[i++]);
    let prec = -1;
    if (fmt[i] === ".") {
      i++;
      prec = 0;
      while (fmt[i] >= "0" && fmt[i] <= "9") prec = prec * 10 + Number(fmt[i++]);
    }
    const conv = fmt[i++];
    const arg = args[ai++];

    let sign = "";
    let prefix = "";
    let body = "";
    let numeric = true;
    let canZero = zero && !minus;

    switch (conv) {
      case "d":
      case "i": {
        const b = BigInt(arg as number | bigint);
        const neg = b < 0n;
        let d = (neg ? -b : b).toString();
        if (prec === 0 && b === 0n) d = "";
        if (prec >= 0) {
          d = d.padStart(prec, "0");
          canZero = false;
        }
        sign = neg ? "-" : plus ? "+" : space ? " " : "";
        body = d;
        break;
      }
      case "x":
      case "X":
      case "o": {
        const b = BigInt(arg as number | bigint);
        const radix = conv === "o" ? 8 : 16;
        let d = b.toString(radix);
        if (conv === "X") d = d.toUpperCase();
        if (prec === 0 && b === 0n) d = "";
        if (prec >= 0) {
          d = d.padStart(prec, "0");
          canZero = false;
        }
        if (alt) {
          if (conv === "o") {
            if (d[0] !== "0") d = "0" + d;
          } else if (b !== 0n) prefix = conv === "x" ? "0x" : "0X";
        }
        body = d;
        break;
      }
      case "e":
      case "E":
      case "f":
      case "F":
      case "g":
      case "G": {
        const x = arg as number;
        const upper = conv === "E" || conv === "F" || conv === "G";
        const neg = x < 0 || Object.is(x, -0);
        if (Number.isNaN(x)) {
          body = upper ? "NAN" : "nan";
          canZero = false;
        } else {
          sign = neg ? "-" : plus ? "+" : space ? " " : "";
          const v = Math.abs(x);
          if (v === Infinity) {
            body = upper ? "INF" : "inf";
            canZero = false;
          } else if (conv === "f" || conv === "F") {
            body = fixedStr(v, prec < 0 ? 6 : prec, alt);
          } else if (conv === "e" || conv === "E") {
            const p = prec < 0 ? 6 : prec;
            const [d, e10] = sciParts(v, p);
            body = sciStr(d, e10, p, alt, upper);
          } else {
            let P = prec < 0 ? 6 : prec;
            if (P === 0) P = 1;
            const [d, X] = sciParts(v, P - 1);
            if (P > X && X >= -4) {
              body = fixedStr(v, P - 1 - X, alt);
              if (!alt) body = stripZeros(body);
            } else {
              let m = d[0] + (P > 1 ? "." + d.slice(1) : alt ? "." : "");
              if (!alt) m = stripZeros(m);
              const ae = Math.abs(X);
              body = m + (upper ? "E" : "e") + (X < 0 ? "-" : "+") + (ae < 10 ? "0" + ae : String(ae));
            }
          }
        }
        break;
      }
      case "s": {
        numeric = false;
        body = String(arg);
        if (prec >= 0) body = body.slice(0, prec);
        break;
      }
      case "c": {
        numeric = false;
        body = String(arg);
        break;
      }
      default:
        throw new Error("bad conversion");
    }

    const len = sign.length + prefix.length + body.length;
    if (len >= width) out += sign + prefix + body;
    else if (minus) out += sign + prefix + body + " ".repeat(width - len);
    else if (numeric && canZero) out += sign + prefix + "0".repeat(width - len) + body;
    else out += " ".repeat(width - len) + sign + prefix + body;
  }
  return out;
}
