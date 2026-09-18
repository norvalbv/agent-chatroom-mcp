// Decompose a finite non-negative double into m * 2^e (exact).
function decompose(x: number): [bigint, number] {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (expBits === 0) return [m, -1074];
  m |= 1n << 52n;
  return [m, expBits - 1075];
}

// round-half-even of m*2^e*10^k
function scaled(m: bigint, e: number, k: number): bigint {
  let num = m;
  let den = 1n;
  if (e >= 0) num <<= BigInt(e);
  else den <<= BigInt(-e);
  if (k >= 0) num *= 10n ** BigInt(k);
  else den *= 10n ** BigInt(-k);
  const q = num / den;
  const r2 = (num % den) * 2n;
  if (r2 > den || (r2 === den && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// e-style digits: returns [digit string of length p+1, exponent]
function expDigits(x: number, p: number): [string, number] {
  if (x === 0) return ["0".repeat(p + 1), 0];
  const [m, e] = decompose(x);
  let E = Math.floor(Math.log10(x));
  if (!isFinite(E)) E = 0;
  const lowB = 10n ** BigInt(p);
  for (let i = 0; i < 10; i++) {
    const q = scaled(m, e, p - E);
    if (q >= lowB * 10n) E++;
    else if (q < lowB) E--;
    else return [q.toString(), E];
  }
  throw new Error("exp");
}

function fixedStr(x: number, p: number, alt: boolean): string {
  const [m, e] = decompose(x);
  let s = scaled(m, e, p).toString();
  if (p > 0) {
    s = s.padStart(p + 1, "0");
    return s.slice(0, s.length - p) + "." + s.slice(s.length - p);
  }
  return alt ? s + "." : s;
}

function expStr(x: number, p: number, alt: boolean, upper: boolean): string {
  const [d, E] = expDigits(x, p);
  let s = d[0];
  if (p > 0) s += "." + d.slice(1);
  else if (alt) s += ".";
  const ae = Math.abs(E);
  s += (upper ? "E" : "e") + (E < 0 ? "-" : "+") + (ae < 10 ? "0" + ae : String(ae));
  return s;
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
    const lc = conv.toLowerCase();
    const upper = conv !== lc;

    if (conv === "s") {
      body = String(arg);
      if (prec >= 0) body = body.slice(0, prec);
      canZero = false;
    } else if (conv === "c") {
      body = String(arg);
      canZero = false;
    } else if (conv === "d" || conv === "i" || lc === "x" || conv === "o") {
      const v = BigInt(arg as number | bigint);
      const neg = v < 0n;
      const a = neg ? -v : v;
      if (conv === "d" || conv === "i") {
        body = a.toString();
        sign = neg ? "-" : plus ? "+" : space ? " " : "";
      } else if (conv === "o") body = a.toString(8);
      else {
        body = a.toString(16);
        if (upper) body = body.toUpperCase();
      }
      if (prec >= 0) {
        if (prec === 0 && a === 0n) body = "";
        body = body.padStart(prec, "0");
        canZero = false;
      }
      if (alt) {
        if (conv === "o") {
          if (body[0] !== "0") body = "0" + body;
        } else if (lc === "x" && a !== 0n) prefix = upper ? "0X" : "0x";
      }
    } else {
      const x = arg as number;
      const negBit = x < 0 || Object.is(x, -0);
      if (x !== x) {
        body = upper ? "NAN" : "nan";
        canZero = false;
      } else {
        sign = negBit ? "-" : plus ? "+" : space ? " " : "";
        const a = Math.abs(x);
        if (a === Infinity) {
          body = upper ? "INF" : "inf";
          canZero = false;
        } else if (lc === "f") {
          body = fixedStr(a, prec < 0 ? 6 : prec, alt);
        } else if (lc === "e") {
          body = expStr(a, prec < 0 ? 6 : prec, alt, upper);
        } else {
          const P = prec < 0 ? 6 : prec === 0 ? 1 : prec;
          const X = expDigits(a, P - 1)[1];
          if (P > X && X >= -4) {
            body = fixedStr(a, P - 1 - X, alt);
            if (!alt) body = stripZeros(body);
          } else {
            body = expStr(a, P - 1, alt, upper);
            if (!alt) {
              const k = body.search(/[eE]/);
              body = stripZeros(body.slice(0, k)) + body.slice(k);
            }
          }
        }
      }
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
