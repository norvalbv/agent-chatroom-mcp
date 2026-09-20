type Flags = {
  minus: boolean;
  plus: boolean;
  space: boolean;
  zero: boolean;
  hash: boolean;
};

function roundDiv(num: bigint, den: bigint): bigint {
  if (den === 1n) return num;
  const q = num / den;
  const r = num % den;
  const twice = r * 2n;
  if (twice < den) return q;
  if (twice > den) return q + 1n;
  return q % 2n === 0n ? q : q + 1n;
}

// Rounds M * 2^E * 10^t to the nearest integer (ties to even), exactly.
function roundScaled(M: bigint, E: number, t: number): bigint {
  if (M === 0n) return 0n;
  const pow2exp = E + t;
  const pow5exp = t;
  let numerator = M;
  let denominator = 1n;
  if (pow5exp > 0) numerator *= 5n ** BigInt(pow5exp);
  if (pow2exp > 0) numerator *= 2n ** BigInt(pow2exp);
  if (pow5exp < 0) denominator *= 5n ** BigInt(-pow5exp);
  if (pow2exp < 0) denominator *= 2n ** BigInt(-pow2exp);
  return roundDiv(numerator, denominator);
}

function decompose(x: number): { M: bigint; E: number } {
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  const mantHi = BigInt(hi & 0xfffff);
  const mantissa = (mantHi << 32n) | BigInt(lo);
  if (expBits === 0) {
    return { M: mantissa, E: -1074 };
  }
  return { M: mantissa | (1n << 52n), E: expBits - 1075 };
}

// P significant digits of |x| (rounded, ties to even), plus decimal exponent X
// such that the value equals 0.d1d2...dP * 10^(X+1) i.e. d1.d2...dP * 10^X.
function sciDigits(M: bigint, E: number, P: number): { digits: string; X: number } {
  if (M === 0n) return { digits: "0".repeat(P), X: 0 };
  const approx = Math.log10(Number(M)) + E * Math.log10(2);
  let x0 = Math.floor(approx);
  for (let iter = 0; iter < 20; iter++) {
    const t = P - 1 - x0;
    const rounded = roundScaled(M, E, t);
    const digits = rounded.toString();
    if (digits.length === P) {
      return { digits, X: x0 };
    }
    x0 += digits.length - P;
  }
  throw new Error("sciDigits failed to converge");
}

function pad2(s: string): string {
  return s.length < 2 ? "0".repeat(2 - s.length) + s : s;
}

function trimTrailingZeros(s: string): string {
  let end = s.length;
  while (end > 0 && s[end - 1] === "0") end--;
  return s.slice(0, end);
}

function assemble(
  sign: string,
  prefix: string,
  digits: string,
  width: number | undefined,
  flags: Flags,
  zeroApplicable: boolean
): string {
  const text = sign + prefix + digits;
  if (width === undefined || text.length >= width) return text;
  const pad = width - text.length;
  if (flags.minus) return text + " ".repeat(pad);
  if (flags.zero && zeroApplicable) return sign + prefix + "0".repeat(pad) + digits;
  return " ".repeat(pad) + text;
}

function isNegativeNumber(x: number): boolean {
  return x < 0 || Object.is(x, -0);
}

function convert(
  conv: string,
  flags: Flags,
  width: number | undefined,
  precision: number | undefined,
  arg: number | bigint | string
): string {
  switch (conv) {
    case "d":
    case "i": {
      const value = arg as number | bigint;
      const isBig = typeof value === "bigint";
      const neg = isBig ? (value as bigint) < 0n : (value as number) < 0;
      const abs = neg ? (isBig ? -(value as bigint) : -(value as number)) : value;
      let digits = abs.toString();
      const isZero = isBig ? (abs as bigint) === 0n : (abs as number) === 0;
      if (precision !== undefined) {
        if (precision === 0 && isZero) {
          digits = "";
        } else if (digits.length < precision) {
          digits = "0".repeat(precision - digits.length) + digits;
        }
      }
      const sign = neg ? "-" : flags.plus ? "+" : flags.space ? " " : "";
      const zeroApplicable = flags.zero && precision === undefined;
      return assemble(sign, "", digits, width, flags, zeroApplicable);
    }
    case "x":
    case "X":
    case "o": {
      const value = arg as number | bigint;
      const base = conv === "o" ? 8 : 16;
      const isZero = typeof value === "bigint" ? value === 0n : value === 0;
      let digits = value.toString(base);
      if (conv === "X") digits = digits.toUpperCase();
      if (precision !== undefined) {
        if (precision === 0 && isZero) {
          digits = "";
        } else if (digits.length < precision) {
          digits = "0".repeat(precision - digits.length) + digits;
        }
      }
      let prefix = "";
      if (flags.hash) {
        if (conv === "o") {
          if (digits === "" || digits[0] !== "0") digits = "0" + digits;
        } else if (!isZero) {
          prefix = conv === "x" ? "0x" : "0X";
        }
      }
      const zeroApplicable = flags.zero && precision === undefined;
      return assemble("", prefix, digits, width, flags, zeroApplicable);
    }
    case "e":
    case "E": {
      const x = arg as number;
      const upper = conv === "E";
      if (Number.isNaN(x)) {
        return assemble("", "", upper ? "NAN" : "nan", width, flags, false);
      }
      const neg = isNegativeNumber(x);
      const sign = neg ? "-" : flags.plus ? "+" : flags.space ? " " : "";
      if (!Number.isFinite(x)) {
        return assemble(sign, "", upper ? "INF" : "inf", width, flags, false);
      }
      const prec = precision ?? 6;
      const P = prec + 1;
      const { M, E } = decompose(Math.abs(x));
      const { digits, X } = sciDigits(M, E, P);
      const frac = digits.slice(1);
      const dot = prec > 0 || flags.hash ? "." : "";
      const mantissa = digits[0] + dot + (prec > 0 ? frac : "");
      const expSign = X < 0 ? "-" : "+";
      const expAbs = pad2(Math.abs(X).toString());
      const core = mantissa + (upper ? "E" : "e") + expSign + expAbs;
      return assemble(sign, "", core, width, flags, flags.zero);
    }
    case "f":
    case "F": {
      const x = arg as number;
      const upper = conv === "F";
      if (Number.isNaN(x)) {
        return assemble("", "", upper ? "NAN" : "nan", width, flags, false);
      }
      const neg = isNegativeNumber(x);
      const sign = neg ? "-" : flags.plus ? "+" : flags.space ? " " : "";
      if (!Number.isFinite(x)) {
        return assemble(sign, "", upper ? "INF" : "inf", width, flags, false);
      }
      const prec = precision ?? 6;
      const { M, E } = decompose(Math.abs(x));
      const rounded = roundScaled(M, E, prec);
      let digits = rounded.toString();
      if (digits.length < prec + 1) {
        digits = "0".repeat(prec + 1 - digits.length) + digits;
      }
      const intPart = prec > 0 ? digits.slice(0, digits.length - prec) : digits;
      const fracPart = prec > 0 ? digits.slice(digits.length - prec) : "";
      const dot = prec > 0 || flags.hash ? "." : "";
      const core = intPart + dot + fracPart;
      return assemble(sign, "", core, width, flags, flags.zero);
    }
    case "g":
    case "G": {
      const x = arg as number;
      const upper = conv === "G";
      if (Number.isNaN(x)) {
        return assemble("", "", upper ? "NAN" : "nan", width, flags, false);
      }
      const neg = isNegativeNumber(x);
      const sign = neg ? "-" : flags.plus ? "+" : flags.space ? " " : "";
      if (!Number.isFinite(x)) {
        return assemble(sign, "", upper ? "INF" : "inf", width, flags, false);
      }
      const prec0 = precision ?? 6;
      const P = prec0 === 0 ? 1 : prec0;
      const { M, E } = decompose(Math.abs(x));
      const { digits, X } = sciDigits(M, E, P);
      const useF = P > X && X >= -4;
      let core: string;
      if (useF) {
        let intPart: string;
        let frac: string;
        if (X >= 0) {
          intPart = digits.slice(0, X + 1);
          frac = digits.slice(X + 1);
        } else {
          intPart = "0";
          frac = "0".repeat(-X - 1) + digits;
        }
        const outFrac = flags.hash ? frac : trimTrailingZeros(frac);
        const dot = outFrac.length > 0 || flags.hash ? "." : "";
        core = intPart + dot + outFrac;
      } else {
        const frac = digits.slice(1);
        const outFrac = flags.hash ? frac : trimTrailingZeros(frac);
        const dot = outFrac.length > 0 || flags.hash ? "." : "";
        const expSign = X < 0 ? "-" : "+";
        const expAbs = pad2(Math.abs(X).toString());
        core = digits[0] + dot + outFrac + (upper ? "E" : "e") + expSign + expAbs;
      }
      return assemble(sign, "", core, width, flags, flags.zero);
    }
    case "s": {
      const s = arg as string;
      const text = precision !== undefined ? s.slice(0, precision) : s;
      return assemble("", "", text, width, flags, false);
    }
    case "c": {
      const s = arg as string;
      return assemble("", "", s, width, flags, false);
    }
    default:
      throw new Error(`unsupported conversion: ${conv}`);
  }
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let result = "";
  let argi = 0;
  let i = 0;
  const n = fmt.length;
  while (i < n) {
    const ch = fmt[i];
    if (ch !== "%") {
      result += ch;
      i++;
      continue;
    }
    i++;
    if (fmt[i] === "%") {
      result += "%";
      i++;
      continue;
    }
    const flags: Flags = { minus: false, plus: false, space: false, zero: false, hash: false };
    while (i < n && "-+ 0#".includes(fmt[i])) {
      switch (fmt[i]) {
        case "-":
          flags.minus = true;
          break;
        case "+":
          flags.plus = true;
          break;
        case " ":
          flags.space = true;
          break;
        case "0":
          flags.zero = true;
          break;
        case "#":
          flags.hash = true;
          break;
      }
      i++;
    }
    let widthStr = "";
    while (i < n && /[0-9]/.test(fmt[i])) {
      widthStr += fmt[i];
      i++;
    }
    const width = widthStr ? parseInt(widthStr, 10) : undefined;
    let precision: number | undefined = undefined;
    if (fmt[i] === ".") {
      i++;
      let precStr = "";
      while (i < n && /[0-9]/.test(fmt[i])) {
        precStr += fmt[i];
        i++;
      }
      precision = precStr ? parseInt(precStr, 10) : 0;
    }
    const conv = fmt[i];
    i++;
    const arg = args[argi++];
    result += convert(conv, flags, width, precision, arg);
  }
  return result;
}
