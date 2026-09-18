function roundDiv(n: bigint, d: bigint): bigint {
  const q = n / d;
  const r2 = (n % d) * 2n;
  if (r2 > d || (r2 === d && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// exact positive finite double as n/d
function toRational(x: number): [bigint, bigint] {
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, x);
  const hi = buf.getUint32(0);
  const lo = buf.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  let mant = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let e: number;
  if (expBits === 0) e = -1074;
  else {
    mant |= 1n << 52n;
    e = expBits - 1075;
  }
  if (e >= 0) return [mant << BigInt(e), 1n];
  return [mant, 1n << BigInt(-e)];
}

const pow10 = (k: number) => 10n ** BigInt(k);

// round x * 10^k half-even
function scaled(n: bigint, d: bigint, k: number): bigint {
  return k >= 0 ? roundDiv(n * pow10(k), d) : roundDiv(n, d * pow10(-k));
}

function fixedDigits(x: number, p: number): string {
  if (x === 0) return "0".repeat(p + 1);
  const [n, d] = toRational(x);
  let s = scaled(n, d, p).toString();
  if (s.length < p + 1) s = "0".repeat(p + 1 - s.length) + s;
  return s; // all digits, point after len-p
}

function fixedStr(x: number, p: number, alt: boolean): string {
  const s = fixedDigits(x, p);
  const ip = s.slice(0, s.length - p);
  const fp = s.slice(s.length - p);
  return ip + (p > 0 || alt ? "." : "") + fp;
}

// returns digits (p+1 digits) and exponent
function expParts(x: number, p: number): [string, number] {
  if (x === 0) return ["0".repeat(p + 1), 0];
  const [n, d] = toRational(x);
  let X = Math.floor(Math.log10(x));
  if (!isFinite(X)) X = 0;
  const lowB = pow10(p);
  const highB = pow10(p + 1);
  for (let i = 0; i < 10; i++) {
    const v = scaled(n, d, p - X);
    if (v >= highB) X++;
    else if (v < lowB) X--;
    else return [v.toString(), X];
  }
  throw new Error("exp failed");
}

function expStr(x: number, p: number, alt: boolean, upper: boolean): string {
  const [dg, X] = expParts(x, p);
  return expFmt(dg, X, p, alt, upper);
}

function expFmt(dg: string, X: number, p: number, alt: boolean, upper: boolean): string {
  const ax = Math.abs(X);
  return (
    dg[0] + (p > 0 || alt ? "." : "") + dg.slice(1) +
    (upper ? "E" : "e") + (X < 0 ? "-" : "+") + (ax < 10 ? "0" : "") + ax
  );
}

function stripZeros(s: string): string {
  if (s.indexOf(".") < 0) return s;
  s = s.replace(/0+$/, "");
  return s.replace(/\.$/, "");
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
      const f = fmt[i];
      if (f === "-") minus = true;
      else if (f === "+") plus = true;
      else if (f === " ") space = true;
      else if (f === "0") zero = true;
      else if (f === "#") alt = true;
      else break;
    }
    let width = 0;
    while (fmt[i] >= "0" && fmt[i] <= "9") width = width * 10 + (fmt.charCodeAt(i++) - 48);
    let prec = -1;
    if (fmt[i] === ".") {
      i++;
      prec = 0;
      while (fmt[i] >= "0" && fmt[i] <= "9") prec = prec * 10 + (fmt.charCodeAt(i++) - 48);
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
        const v = BigInt(arg as number | bigint);
        const neg = v < 0n;
        let dg = (neg ? -v : v).toString();
        if (prec === 0 && v === 0n) dg = "";
        if (prec > dg.length) dg = "0".repeat(prec - dg.length) + dg;
        sign = neg ? "-" : plus ? "+" : space ? " " : "";
        body = dg;
        if (prec >= 0) canZero = false;
        break;
      }
      case "x":
      case "X":
      case "o": {
        const v = BigInt(arg as number | bigint);
        let dg = v.toString(conv === "o" ? 8 : 16);
        if (conv === "X") dg = dg.toUpperCase();
        if (prec === 0 && v === 0n) dg = "";
        if (prec > dg.length) dg = "0".repeat(prec - dg.length) + dg;
        if (alt) {
          if (conv === "o") {
            if (dg[0] !== "0") dg = "0" + dg;
          } else if (v !== 0n) prefix = conv === "x" ? "0x" : "0X";
        }
        body = dg;
        if (prec >= 0) canZero = false;
        break;
      }
      case "e": case "E": case "f": case "F": case "g": case "G": {
        const x = arg as number;
        const upper = conv === "E" || conv === "F" || conv === "G";
        if (Number.isNaN(x)) {
          body = upper ? "NAN" : "nan";
          canZero = false;
          break;
        }
        const neg = x < 0 || Object.is(x, -0);
        sign = neg ? "-" : plus ? "+" : space ? " " : "";
        if (!isFinite(x)) {
          body = upper ? "INF" : "inf";
          canZero = false;
          break;
        }
        const ax = Math.abs(x);
        const lc = conv.toLowerCase();
        if (lc === "f") {
          body = fixedStr(ax, prec < 0 ? 6 : prec, alt);
        } else if (lc === "e") {
          body = expStr(ax, prec < 0 ? 6 : prec, alt, conv === "E");
        } else {
          let P = prec < 0 ? 6 : prec;
          if (P === 0) P = 1;
          const [dg, X] = expParts(ax, P - 1);
          if (P > X && X >= -4) {
            body = fixedStr(ax, P - 1 - X, alt);
            if (!alt) body = stripZeros(body);
          } else {
            body = expFmt(dg, X, P - 1, alt, conv === "G");
            if (!alt) {
              const k = body.search(/[eE]/);
              body = stripZeros(body.slice(0, k)) + body.slice(k);
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
    }
    const len = sign.length + prefix.length + body.length;
    if (len >= width) out += sign + prefix + body;
    else if (minus) out += sign + prefix + body + " ".repeat(width - len);
    else if (numeric && canZero) out += sign + prefix + "0".repeat(width - len) + body;
    else out += " ".repeat(width - len) + sign + prefix + body;
  }
  return out;
}
