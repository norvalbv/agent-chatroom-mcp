type Flags = {
  minus: boolean;
  plus: boolean;
  space: boolean;
  zero: boolean;
  hash: boolean;
};

function decompose(x: number): { signBit: 0 | 1; mantissa: bigint; exp2: bigint } {
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setFloat64(0, x);
  const hi = view.getUint32(0);
  const lo = view.getUint32(4);
  const signBit = ((hi >>> 31) & 1) as 0 | 1;
  const biasedExp = (hi >>> 20) & 0x7ff;
  const fracHi = hi & 0xfffff;
  const fracBig = (BigInt(fracHi) << 32n) | BigInt(lo >>> 0);
  let mantissa: bigint;
  let exp2: bigint;
  if (biasedExp === 0) {
    mantissa = fracBig;
    exp2 = -1074n;
  } else {
    mantissa = fracBig | (1n << 52n);
    exp2 = BigInt(biasedExp) - 1075n;
  }
  return { signBit, mantissa, exp2 };
}

// Round(mantissa * 2^exp2 * 10^k) to nearest integer, ties to even.
function scaleRound(mantissa: bigint, exp2: bigint, k: number): bigint {
  if (mantissa === 0n) return 0n;
  let numerator = mantissa;
  let denomExp2 = 0n;
  let denomExp5 = 0n;
  const kk = BigInt(k);
  if (kk >= 0n) numerator *= 5n ** kk;
  else denomExp5 = -kk;
  const e = exp2 + kk;
  if (e >= 0n) numerator *= 2n ** e;
  else denomExp2 = -e;
  const denom = 2n ** denomExp2 * 5n ** denomExp5;
  if (denom === 1n) return numerator;
  const q = numerator / denom;
  const r = numerator % denom;
  const twiceR = r * 2n;
  if (twiceR < denom) return q;
  if (twiceR > denom) return q + 1n;
  return q % 2n === 0n ? q : q + 1n;
}

function toExponentialDigits(mantissa: bigint, exp2: bigint, P: number): { digits: string; exp: number } {
  const N = P + 1;
  if (mantissa === 0n) return { digits: "0".repeat(N), exp: 0 };
  const log2val = Math.log2(Number(mantissa)) + Number(exp2);
  let X = Math.floor(log2val / Math.log2(10));
  const lower = 10n ** BigInt(N - 1);
  const upper = 10n ** BigInt(N);
  let D = scaleRound(mantissa, exp2, N - 1 - X);
  let guard = 0;
  while ((D >= upper || D < lower) && guard < 6) {
    if (D >= upper) X++;
    else X--;
    D = scaleRound(mantissa, exp2, N - 1 - X);
    guard++;
  }
  return { digits: D.toString(), exp: X };
}

function padNumber(sign: string, prefix: string, body: string, width: number, flags: Flags): string {
  const core = sign + prefix + body;
  if (core.length >= width) return core;
  const padLen = width - core.length;
  if (flags.minus) return core + " ".repeat(padLen);
  if (flags.zero) return sign + prefix + "0".repeat(padLen) + body;
  return " ".repeat(padLen) + core;
}

function padPlain(str: string, width: number, minus: boolean): string {
  if (str.length >= width) return str;
  const pad = " ".repeat(width - str.length);
  return minus ? str + pad : pad + str;
}

function toBigIntValue(v: number | bigint): bigint {
  return typeof v === "bigint" ? v : BigInt(v);
}

function trimFrac(frac: string, hash: boolean): { frac: string; hasDot: boolean } {
  if (hash) return { frac, hasDot: true };
  const t = frac.replace(/0+$/, "");
  return { frac: t, hasDot: t.length > 0 };
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let argi = 0;
  const nextArg = () => args[argi++];

  return fmt.replace(/%([-+ #0]*)(\d*)(?:\.(\d*))?([a-zA-Z%])/g, (_match, flagsStr, widthStr, precStr, conv) => {
    if (conv === "%") return "%";

    const flags: Flags = {
      minus: flagsStr.includes("-"),
      plus: flagsStr.includes("+"),
      space: flagsStr.includes(" "),
      zero: flagsStr.includes("0"),
      hash: flagsStr.includes("#"),
    };
    const width = widthStr === "" ? 0 : parseInt(widthStr, 10);
    const precision: number | undefined = precStr === undefined ? undefined : precStr === "" ? 0 : parseInt(precStr, 10);

    if (conv === "d" || conv === "i") {
      const raw = toBigIntValue(nextArg() as number | bigint);
      const neg = raw < 0n;
      const magnitude = neg ? -raw : raw;
      const sign = neg ? "-" : flags.plus ? "+" : flags.space ? " " : "";
      let digits: string;
      if (precision === 0 && magnitude === 0n) digits = "";
      else {
        digits = magnitude.toString(10);
        if (precision !== undefined) digits = digits.padStart(precision, "0");
      }
      const effFlags: Flags = { ...flags, zero: flags.zero && precision === undefined };
      return padNumber(sign, "", digits, width, effFlags);
    }

    if (conv === "x" || conv === "X" || conv === "o") {
      const magnitude = toBigIntValue(nextArg() as number | bigint);
      const base = conv === "o" ? 8 : 16;
      let digits = magnitude.toString(base);
      if (conv === "X") digits = digits.toUpperCase();
      if (precision === 0 && magnitude === 0n) digits = "";
      else if (precision !== undefined) digits = digits.padStart(precision, "0");
      let prefix = "";
      if (flags.hash) {
        if (conv === "o") {
          if (digits === "" || digits[0] !== "0") digits = "0" + digits;
        } else {
          if (magnitude !== 0n) prefix = conv === "X" ? "0X" : "0x";
        }
      }
      const effFlags: Flags = { ...flags, zero: flags.zero && precision === undefined };
      return padNumber("", prefix, digits, width, effFlags);
    }

    if (conv === "e" || conv === "E" || conv === "f" || conv === "F" || conv === "g" || conv === "G") {
      const value = nextArg() as number;
      const { signBit } = decompose(value);
      const negative = signBit === 1;
      const upper = conv === "E" || conv === "F" || conv === "G";

      if (Number.isNaN(value)) {
        const text = upper ? "NAN" : "nan";
        return padNumber("", "", text, width, { ...flags, zero: false, minus: flags.minus });
      }
      if (!Number.isFinite(value)) {
        const sign = negative ? "-" : flags.plus ? "+" : flags.space ? " " : "";
        const text = upper ? "INF" : "inf";
        return padNumber(sign, "", text, width, { ...flags, zero: false });
      }

      const sign = negative ? "-" : flags.plus ? "+" : flags.space ? " " : "";
      const { mantissa, exp2 } = decompose(value);

      if (conv === "f" || conv === "F") {
        const P = precision !== undefined ? precision : 6;
        const D = scaleRound(mantissa, exp2, P);
        const digitsStr = D.toString().padStart(P + 1, "0");
        const intPart = P === 0 ? digitsStr : digitsStr.slice(0, digitsStr.length - P);
        const fracPart = P === 0 ? "" : digitsStr.slice(digitsStr.length - P);
        const dot = P === 0 && !flags.hash ? "" : ".";
        const body = intPart + dot + fracPart;
        return padNumber(sign, "", body, width, flags);
      }

      if (conv === "e" || conv === "E") {
        const P = precision !== undefined ? precision : 6;
        const { digits, exp } = toExponentialDigits(mantissa, exp2, P);
        const first = digits[0];
        const rest = digits.slice(1);
        const dot = P === 0 && !flags.hash ? "" : ".";
        const expSign = exp < 0 ? "-" : "+";
        const expStr = Math.abs(exp).toString().padStart(2, "0");
        const eChar = conv === "E" ? "E" : "e";
        const body = first + dot + rest + eChar + expSign + expStr;
        return padNumber(sign, "", body, width, flags);
      }

      // g, G
      let P = precision !== undefined ? precision : 6;
      if (P === 0) P = 1;
      const { digits, exp: X } = toExponentialDigits(mantissa, exp2, P - 1);

      if (P > X && X >= -4) {
        const precF = P - 1 - X;
        const D = scaleRound(mantissa, exp2, precF);
        const digitsStr = D.toString().padStart(precF + 1, "0");
        const intPart = precF === 0 ? digitsStr : digitsStr.slice(0, digitsStr.length - precF);
        const fracPart = precF === 0 ? "" : digitsStr.slice(digitsStr.length - precF);
        const { frac, hasDot } = trimFrac(fracPart, flags.hash);
        const body = intPart + (hasDot ? "." : "") + frac;
        return padNumber(sign, "", body, width, flags);
      } else {
        const first = digits[0];
        const rest = digits.slice(1);
        const { frac, hasDot } = trimFrac(rest, flags.hash);
        const expSign = X < 0 ? "-" : "+";
        const expStr = Math.abs(X).toString().padStart(2, "0");
        const eChar = upper ? "E" : "e";
        const body = first + (hasDot ? "." : "") + frac + eChar + expSign + expStr;
        return padNumber(sign, "", body, width, flags);
      }
    }

    if (conv === "s") {
      let str = nextArg() as string;
      if (precision !== undefined) str = str.slice(0, precision);
      return padPlain(str, width, flags.minus);
    }

    if (conv === "c") {
      const str = nextArg() as string;
      return padPlain(str, width, flags.minus);
    }

    return _match;
  });
}
