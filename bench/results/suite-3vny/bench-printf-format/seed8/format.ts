function decompose(v: number): { m: bigint; e: number } {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, v);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (expBits === 0) return { m, e: -1074 };
  m |= 1n << 52n;
  return { m, e: expBits - 1075 };
}

// round(|v| * 10^k), ties to even, exact
function roundScaled(m: bigint, e: number, k: number): bigint {
  let num = m;
  let den = 1n;
  if (e > 0) num <<= BigInt(e);
  else den <<= BigInt(-e);
  if (k > 0) num *= 10n ** BigInt(k);
  else if (k < 0) den *= 10n ** BigInt(-k);
  let q = num / den;
  const r2 = (num % den) * 2n;
  if (r2 > den || (r2 === den && (q & 1n) === 1n)) q += 1n;
  return q;
}

// is |v| >= 10^E
function gePow10(m: bigint, e: number, E: number): boolean {
  let num = m;
  let den = 1n;
  if (e > 0) num <<= BigInt(e);
  else den <<= BigInt(-e);
  if (E > 0) den *= 10n ** BigInt(E);
  else if (E < 0) num *= 10n ** BigInt(-E);
  return num >= den;
}

function fixedDigits(v: number, p: number, alt: boolean): string {
  let s: string;
  if (v === 0) s = "0".repeat(p + 1);
  else {
    const { m, e } = decompose(v);
    s = roundScaled(m, e, p).toString();
    if (s.length < p + 1) s = "0".repeat(p + 1 - s.length) + s;
  }
  const ip = s.slice(0, s.length - p);
  const fp = s.slice(s.length - p);
  return p > 0 ? ip + "." + fp : alt ? ip + "." : ip;
}

function expParts(v: number, p: number): { digits: string; x: number } {
  if (v === 0) return { digits: "0".repeat(p + 1), x: 0 };
  const { m, e } = decompose(v);
  let E = Math.floor(Math.log10(v));
  if (!isFinite(E)) E = -324;
  while (!gePow10(m, e, E)) E--;
  while (gePow10(m, e, E + 1)) E++;
  let d = roundScaled(m, e, p - E);
  if (d >= 10n ** BigInt(p + 1)) {
    E++;
    d = roundScaled(m, e, p - E);
  }
  return { digits: d.toString(), x: E };
}

function expStr(digits: string, x: number, p: number, alt: boolean, upper: boolean): string {
  let s = digits[0];
  if (p > 0) s += "." + digits.slice(1);
  else if (alt) s += ".";
  const ax = Math.abs(x);
  s += (upper ? "E" : "e") + (x < 0 ? "-" : "+") + (ax < 10 ? "0" : "") + ax;
  return s;
}

function stripZeros(s: string): string {
  if (!s.includes(".")) return s;
  return s.replace(/0+$/, "").replace(/\.$/, "");
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let ai = 0;
  const re = /%(?:(%)|([-+ 0#]*)(\d*)(?:\.(\d*))?([dixXoeEfFgGsc]))/g;
  return fmt.replace(re, (_all, pct, flags: string, w: string, prec: string | undefined, conv: string) => {
    if (pct) return "%";
    const arg = args[ai++];
    const left = flags.includes("-");
    const plus = flags.includes("+");
    const space = flags.includes(" ");
    const zero = flags.includes("0");
    const alt = flags.includes("#");
    const width = w ? parseInt(w, 10) : 0;
    const hasPrec = prec !== undefined;
    const precN = hasPrec ? (prec === "" ? 0 : parseInt(prec, 10)) : -1;

    let sign = "";
    let body: string;
    let canZero = zero && !left;

    if (conv === "s" || conv === "c") {
      body = String(arg);
      if (conv === "s" && hasPrec) body = body.slice(0, precN);
      canZero = false;
    } else if ("dixXo".includes(conv)) {
      const n = BigInt(arg as number | bigint);
      const neg = n < 0n;
      const mag = neg ? -n : n;
      let digits = conv === "d" || conv === "i" ? mag.toString() : conv === "o" ? mag.toString(8) : mag.toString(16);
      if (conv === "X") digits = digits.toUpperCase();
      if (hasPrec) {
        if (precN === 0 && mag === 0n) digits = "";
        if (digits.length < precN) digits = "0".repeat(precN - digits.length) + digits;
        canZero = false;
      }
      if (conv === "d" || conv === "i") {
        sign = neg ? "-" : plus ? "+" : space ? " " : "";
      } else if (conv === "o") {
        if (alt && digits[0] !== "0") digits = "0" + digits;
      } else if (alt && mag !== 0n) {
        sign = conv === "x" ? "0x" : "0X";
      }
      body = digits;
    } else {
      const v = arg as number;
      const upper = conv === "E" || conv === "F" || conv === "G";
      const neg = v < 0 || Object.is(v, -0);
      if (Number.isNaN(v)) {
        sign = "";
        body = upper ? "NAN" : "nan";
        canZero = false;
      } else {
        sign = neg ? "-" : plus ? "+" : space ? " " : "";
        const a = Math.abs(v);
        if (a === Infinity) {
          body = upper ? "INF" : "inf";
          canZero = false;
        } else {
          const p = hasPrec ? precN : 6;
          const lc = conv.toLowerCase();
          if (lc === "f") body = fixedDigits(a, p, alt);
          else if (lc === "e") {
            const { digits, x } = expParts(a, p);
            body = expStr(digits, x, p, alt, upper);
          } else {
            const P = p === 0 ? 1 : p;
            const { digits, x } = expParts(a, P - 1);
            if (P > x && x >= -4) {
              body = fixedDigits(a, P - 1 - x, alt);
              if (!alt) body = stripZeros(body);
            } else {
              let mant = expStr(digits, x, P - 1, alt, upper);
              if (!alt) {
                const i = mant.search(/[eE]/);
                mant = stripZeros(mant.slice(0, i)) + mant.slice(i);
              }
              body = mant;
            }
          }
        }
      }
    }

    const len = sign.length + body.length;
    if (len >= width) return sign + body;
    const pad = width - len;
    if (left) return sign + body + " ".repeat(pad);
    if (canZero) return sign + "0".repeat(pad) + body;
    return " ".repeat(pad) + sign + body;
  });
}
