function decompose(x: number): [bigint, bigint] {
  // x > 0 finite; returns exact [num, den]
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, x);
  const hi = buf.getUint32(0);
  const lo = buf.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let e: number;
  if (expBits === 0) {
    e = -1074;
  } else {
    m |= 1n << 52n;
    e = expBits - 1075;
  }
  return e >= 0 ? [m << BigInt(e), 1n] : [m, 1n << BigInt(-e)];
}

function scaled(r: [bigint, bigint], k: number): [bigint, bigint] {
  return k >= 0 ? [r[0] * 10n ** BigInt(k), r[1]] : [r[0], r[1] * 10n ** BigInt(-k)];
}

function roundDiv(n: bigint, d: bigint): bigint {
  const q = n / d;
  const r2 = (n - q * d) * 2n;
  if (r2 > d || (r2 === d && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// digits string of round(x * 10^p)
function fixedDigits(x: number, p: number): string {
  if (x === 0) return "0";
  const [n, d] = scaled(decompose(x), p);
  return roundDiv(n, d).toString();
}

// e-style: returns digit string of length p+1 and exponent
function expDigits(x: number, p: number): [string, number] {
  if (x === 0) return ["0".repeat(p + 1), 0];
  const r = decompose(x);
  let E = Math.floor(Math.log10(x));
  if (!isFinite(E)) E = 0;
  // adjust so 10^E <= x < 10^(E+1)
  for (;;) {
    const [n, d] = scaled(r, -E);
    if (n < d) E--;
    else if (n >= d * 10n) E++;
    else break;
  }
  const [n, d] = scaled(r, p - E);
  let q = roundDiv(n, d);
  if (q >= 10n ** BigInt(p + 1)) {
    q /= 10n;
    E++;
  }
  return [q.toString(), E];
}

function expStr(digits: string, E: number, p: number, alt: boolean, upper: boolean): string {
  let s = digits[0];
  if (p > 0 || alt) s += ".";
  s += digits.slice(1);
  const ae = Math.abs(E);
  s += (upper ? "E" : "e") + (E < 0 ? "-" : "+") + (ae < 10 ? "0" : "") + ae;
  return s;
}

function fixedStr(x: number, p: number, alt: boolean): string {
  let d = fixedDigits(x, p);
  if (d.length < p + 1) d = "0".repeat(p + 1 - d.length) + d;
  const ip = d.slice(0, d.length - p);
  const fp = d.slice(d.length - p);
  return ip + (p > 0 || alt ? "." : "") + fp;
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let out = "";
  let ai = 0;
  let i = 0;
  while (i < fmt.length) {
    const ch = fmt[i++];
    if (ch !== "%") {
      out += ch;
      continue;
    }
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
    let canZero = true;

    if (conv === "s" || conv === "c") {
      body = String(arg);
      if (conv === "s" && prec >= 0) body = body.slice(0, prec);
      canZero = false;
    } else if ("dixXo".includes(conv)) {
      const v = BigInt(arg as number | bigint);
      const neg = v < 0n;
      const mag = neg ? -v : v;
      sign = neg ? "-" : plus ? "+" : space ? " " : "";
      body = conv === "o" ? mag.toString(8) : conv === "x" ? mag.toString(16) : conv === "X" ? mag.toString(16).toUpperCase() : mag.toString();
      if (prec === 0 && mag === 0n) body = "";
      if (prec >= 0 && body.length < prec) body = "0".repeat(prec - body.length) + body;
      if (conv === "o" && alt && body[0] !== "0") body = "0" + body;
      if (alt && mag !== 0n && (conv === "x" || conv === "X")) prefix = conv === "x" ? "0x" : "0X";
      if (prec >= 0) canZero = false;
    } else {
      const x = arg as number;
      const upper = conv === "E" || conv === "F" || conv === "G";
      if (Number.isNaN(x)) {
        body = upper ? "NAN" : "nan";
        canZero = false;
      } else {
        const neg = x < 0 || Object.is(x, -0);
        sign = neg ? "-" : plus ? "+" : space ? " " : "";
        const ax = Math.abs(x);
        if (ax === Infinity) {
          body = upper ? "INF" : "inf";
          canZero = false;
        } else {
          const lc = conv.toLowerCase();
          if (lc === "f") {
            body = fixedStr(ax, prec < 0 ? 6 : prec, alt);
          } else if (lc === "e") {
            const p = prec < 0 ? 6 : prec;
            const [dg, E] = expDigits(ax, p);
            body = expStr(dg, E, p, alt, upper);
          } else {
            let P = prec < 0 ? 6 : prec;
            if (P === 0) P = 1;
            const [dg, X] = expDigits(ax, P - 1);
            if (P > X && X >= -4) {
              body = fixedStr(ax, P - 1 - X, alt);
              if (!alt && body.includes(".")) body = body.replace(/0+$/, "").replace(/\.$/, "");
            } else {
              let ds = dg;
              if (!alt) ds = ds[0] + ds.slice(1).replace(/0+$/, "");
              const fp = ds.length - 1;
              body = expStr(ds, X, fp, alt, upper);
            }
          }
        }
      }
    }

    let len = sign.length + prefix.length + body.length;
    if (len < width) {
      const pad = width - len;
      if (minus) body = body + " ".repeat(pad);
      else if (zero && canZero) body = "0".repeat(pad) + body;
      else sign = " ".repeat(pad) + sign;
    }
    out += sign + prefix + body;
  }
  return out;
}
