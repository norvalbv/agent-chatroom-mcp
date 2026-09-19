function divRound(n: bigint, d: bigint): bigint {
  const q = n / d;
  const r2 = (n % d) * 2n;
  if (r2 > d || (r2 === d && (q & 1n) === 1n)) return q + 1n;
  return q;
}

// exact positive finite double as num/den
function toRatio(x: number): [bigint, bigint] {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  let mant = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let e: number;
  if (expBits === 0) e = -1074;
  else {
    mant |= 1n << 52n;
    e = expBits - 1075;
  }
  return e >= 0 ? [mant << BigInt(e), 1n] : [mant, 1n << BigInt(-e)];
}

const pow10 = (k: number) => 10n ** BigInt(k);

// round(v / 10^k)
function scaled(r: [bigint, bigint], k: number): bigint {
  return k >= 0 ? divRound(r[0], r[1] * pow10(k)) : divRound(r[0] * pow10(-k), r[1]);
}

function fixed(x: number, p: number, alt: boolean): string {
  let digits = x === 0 ? "0" : scaled(toRatio(x), -p).toString();
  if (digits.length < p + 1) digits = digits.padStart(p + 1, "0");
  const ip = digits.slice(0, digits.length - p);
  const fp = digits.slice(digits.length - p);
  return ip + (p > 0 || alt ? "." : "") + fp;
}

// returns digits (p+1 of them) and exponent
function expo(x: number, p: number): [string, number] {
  if (x === 0) return ["0".repeat(p + 1), 0];
  const r = toRatio(x);
  let E = Math.floor(Math.log10(x));
  if (!isFinite(E)) E = -324;
  const lo = pow10(p);
  for (let i = 0; i < 20; i++) {
    const s = scaled(r, E - p);
    if (s >= lo * 10n) E++;
    else if (s < lo) E--;
    else return [s.toString(), E];
  }
  throw new Error("expo");
}

function expStr(digits: string, E: number, alt: boolean, upper: boolean): string {
  const p = digits.length - 1;
  const a = Math.abs(E);
  return (
    digits[0] + (p > 0 || alt ? "." : "") + digits.slice(1) +
    (upper ? "E" : "e") + (E < 0 ? "-" : "+") + (a < 10 ? "0" + a : String(a))
  );
}

function stripZeros(s: string): string {
  if (!s.includes(".")) return s;
  return s.replace(/0+$/, "").replace(/\.$/, "");
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let ai = 0;
  return fmt.replace(
    /%([-+ 0#]*)(\d*)(?:\.(\d*))?([diuxXoeEfFgGscp%])/g,
    (_m, flags: string, w: string, pr: string | undefined, conv: string) => {
      if (conv === "%") return "%";
      const arg = args[ai++];
      const left = flags.includes("-");
      const plus = flags.includes("+");
      const space = flags.includes(" ");
      const zero = flags.includes("0") && !left;
      const alt = flags.includes("#");
      const width = w ? parseInt(w, 10) : 0;
      const hasPrec = pr !== undefined;
      const prec = hasPrec ? (pr === "" ? 0 : parseInt(pr, 10)) : -1;

      let sign = "";
      let prefix = "";
      let body: string;
      let zeroOk = zero;

      if (conv === "s" || conv === "c") {
        body = String(arg);
        if (conv === "s" && hasPrec) body = body.slice(0, prec);
        zeroOk = false;
      } else if ("diuxXo".includes(conv)) {
        let v = typeof arg === "bigint" ? arg : BigInt(arg as number);
        const neg = v < 0n;
        if (neg) v = -v;
        if (conv === "d" || conv === "i" || conv === "u") {
          sign = neg ? "-" : plus ? "+" : space ? " " : "";
        }
        let digits = v.toString(conv === "x" || conv === "X" ? 16 : conv === "o" ? 8 : 10);
        if (conv === "X") digits = digits.toUpperCase();
        if (hasPrec) {
          if (prec === 0 && v === 0n) digits = "";
          digits = digits.padStart(prec, "0");
          zeroOk = false;
        }
        if (alt) {
          if ((conv === "x" || conv === "X") && v !== 0n) prefix = conv === "x" ? "0x" : "0X";
          if (conv === "o" && !digits.startsWith("0")) digits = "0" + digits;
        }
        body = digits;
      } else {
        const x = arg as number;
        const upper = conv === "E" || conv === "F" || conv === "G";
        const neg = x < 0 || Object.is(x, -0);
        if (Number.isNaN(x)) {
          body = upper ? "NAN" : "nan";
          zeroOk = false;
        } else {
          sign = neg ? "-" : plus ? "+" : space ? " " : "";
          const a = Math.abs(x);
          if (a === Infinity) {
            body = upper ? "INF" : "inf";
            zeroOk = false;
          } else if (conv === "f" || conv === "F") {
            body = fixed(a, hasPrec ? prec : 6, alt);
          } else if (conv === "e" || conv === "E") {
            const [d, E] = expo(a, hasPrec ? prec : 6);
            body = expStr(d, E, alt, upper);
          } else {
            const P = hasPrec ? Math.max(prec, 1) : 6;
            const [d, X] = expo(a, P - 1);
            if (P > X && X >= -4) {
              body = fixed(a, P - 1 - X, alt);
              if (!alt) body = stripZeros(body);
            } else {
              let m = d[0] + (P > 1 || alt ? "." : "") + d.slice(1);
              if (!alt) m = stripZeros(m);
              const ea = Math.abs(X);
              body = m + (upper ? "E" : "e") + (X < 0 ? "-" : "+") + (ea < 10 ? "0" + ea : String(ea));
            }
          }
        }
      }

      const len = sign.length + prefix.length + body.length;
      if (len >= width) return sign + prefix + body;
      const pad = width - len;
      if (left) return sign + prefix + body + " ".repeat(pad);
      if (zeroOk) return sign + prefix + "0".repeat(pad) + body;
      return " ".repeat(pad) + sign + prefix + body;
    }
  );
}
