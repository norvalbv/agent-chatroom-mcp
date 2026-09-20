type Flags = {
  minus: boolean;
  plus: boolean;
  space: boolean;
  zero: boolean;
  hash: boolean;
};

function pad(
  sign: string,
  prefix: string,
  digits: string,
  width: number,
  leftAlign: boolean,
  zeroPad: boolean
): string {
  const content = sign + prefix + digits;
  if (content.length >= width) return content;
  const padLen = width - content.length;
  if (leftAlign) return content + ' '.repeat(padLen);
  if (zeroPad) return sign + prefix + '0'.repeat(padLen) + digits;
  return ' '.repeat(padLen) + content;
}

function decompose(absX: number): { M: bigint; E: number } {
  if (absX === 0) return { M: 0n, E: 0 };
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setFloat64(0, absX, false);
  const bits = dv.getBigUint64(0, false);
  const expBits = Number((bits >> 52n) & 0x7ffn);
  const mantissaBits = bits & 0xfffffffffffffn;
  let M: bigint;
  let E: number;
  if (expBits === 0) {
    M = mantissaBits;
    E = -1074;
  } else {
    M = mantissaBits | (1n << 52n);
    E = expBits - 1075;
  }
  return { M, E };
}

function exactDigits(M: bigint, E: number): { intPart: string; fracPart: string } {
  if (M === 0n) return { intPart: '0', fracPart: '' };
  if (E >= 0) {
    const N = M << BigInt(E);
    return { intPart: N.toString(), fracPart: '' };
  }
  const k = -E;
  const N = M * 5n ** BigInt(k);
  let s = N.toString();
  if (s.length <= k) s = '0'.repeat(k - s.length + 1) + s;
  const intPart = s.slice(0, s.length - k);
  const fracPart = s.slice(s.length - k);
  return { intPart, fracPart };
}

function incrementDecimalString(s: string): string {
  const arr = s.split('');
  let i = arr.length - 1;
  while (i >= 0) {
    if (arr[i] === '9') {
      arr[i] = '0';
      i--;
    } else {
      arr[i] = String(Number(arr[i]) + 1);
      return arr.join('');
    }
  }
  return '1' + arr.join('');
}

function roundFixed(intPart: string, fracPart: string, p: number): { intPart: string; frac: string } {
  if (fracPart.length <= p) {
    return { intPart, frac: fracPart.padEnd(p, '0') };
  }
  const keep = fracPart.slice(0, p);
  const rest = fracPart.slice(p);
  let roundUp = false;
  const c = rest[0];
  if (c > '5') roundUp = true;
  else if (c === '5') {
    if (/[1-9]/.test(rest.slice(1))) roundUp = true;
    else {
      const lastDigit = p > 0 ? keep[p - 1] : intPart[intPart.length - 1];
      roundUp = Number(lastDigit) % 2 === 1;
    }
  }
  let combined = intPart + keep;
  if (roundUp) combined = incrementDecimalString(combined);
  const newIntPart = combined.slice(0, combined.length - p) || '0';
  const newFrac = p > 0 ? combined.slice(combined.length - p) : '';
  return { intPart: newIntPart, frac: newFrac };
}

function computeSci(intPart: string, fracPart: string, n: number): { sig: string; exponent: number } {
  const full = intPart + fracPart;
  const pointPos = intPart.length;
  const firstNonZero = full.search(/[1-9]/);
  if (firstNonZero === -1) {
    return { sig: '0'.repeat(n + 1), exponent: 0 };
  }
  const exponent0 = pointPos - 1 - firstNonZero;
  let sigNeeded = full.slice(firstNonZero, firstNonZero + n + 1);
  if (sigNeeded.length < n + 1) sigNeeded = sigNeeded.padEnd(n + 1, '0');
  const rest = full.slice(firstNonZero + n + 1);
  let roundUp = false;
  const c = rest[0];
  if (c !== undefined) {
    if (c > '5') roundUp = true;
    else if (c === '5') {
      if (/[1-9]/.test(rest.slice(1))) roundUp = true;
      else {
        const lastDigit = sigNeeded[sigNeeded.length - 1];
        roundUp = Number(lastDigit) % 2 === 1;
      }
    }
  }
  let sig = sigNeeded;
  let exponent = exponent0;
  if (roundUp) {
    const inc = incrementDecimalString(sig);
    if (inc.length > sig.length) {
      sig = inc.slice(0, n + 1);
      exponent = exponent0 + 1;
    } else {
      sig = inc;
    }
  }
  return { sig, exponent };
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let result = '';
  let argIdx = 0;
  let i = 0;
  const re = /%([-+ 0#]*)(\d*)(?:\.(\d*))?([a-zA-Z%])/y;
  while (i < fmt.length) {
    const ch = fmt[i];
    if (ch !== '%') {
      result += ch;
      i++;
      continue;
    }
    re.lastIndex = i;
    const m = re.exec(fmt) as RegExpExecArray;
    const full = m[0];
    const flagsStr = m[1];
    const widthStr = m[2];
    const precStr = m[3];
    const conv = m[4];
    i += full.length;

    if (conv === '%') {
      result += '%';
      continue;
    }

    const flags: Flags = {
      minus: flagsStr.includes('-'),
      plus: flagsStr.includes('+'),
      space: flagsStr.includes(' '),
      zero: flagsStr.includes('0'),
      hash: flagsStr.includes('#'),
    };
    const width = widthStr ? parseInt(widthStr, 10) : 0;
    const precision = precStr !== undefined ? (precStr === '' ? 0 : parseInt(precStr, 10)) : undefined;

    switch (conv) {
      case 'd':
      case 'i': {
        const arg = args[argIdx++];
        let neg: boolean;
        let magBig: bigint;
        if (typeof arg === 'bigint') {
          neg = arg < 0n;
          magBig = neg ? -arg : arg;
        } else {
          const n = arg as number;
          neg = n < 0;
          magBig = BigInt(Math.abs(n));
        }
        let digits = magBig.toString(10);
        if (precision !== undefined) {
          digits = precision === 0 && magBig === 0n ? '' : digits.padStart(precision, '0');
        }
        const sign = neg ? '-' : flags.plus ? '+' : flags.space ? ' ' : '';
        const zeroPad = flags.zero && !flags.minus && precision === undefined;
        result += pad(sign, '', digits, width, flags.minus, zeroPad);
        break;
      }
      case 'x':
      case 'X':
      case 'o': {
        const arg = args[argIdx++];
        const magBig = typeof arg === 'bigint' ? arg : BigInt(arg as number);
        const base = conv === 'o' ? 8 : 16;
        let digits = magBig.toString(base);
        if (conv === 'X') digits = digits.toUpperCase();
        if (precision !== undefined) {
          digits = precision === 0 && magBig === 0n ? '' : digits.padStart(precision, '0');
        }
        let prefix = '';
        if (flags.hash) {
          if (conv === 'o') {
            if (digits.length === 0 || digits[0] !== '0') digits = '0' + digits;
          } else if (magBig !== 0n) {
            prefix = conv === 'X' ? '0X' : '0x';
          }
        }
        const zeroPad = flags.zero && !flags.minus && precision === undefined;
        result += pad('', prefix, digits, width, flags.minus, zeroPad);
        break;
      }
      case 'e':
      case 'E':
      case 'f':
      case 'F':
      case 'g':
      case 'G': {
        const arg = args[argIdx++] as number;
        const upper = conv === conv.toUpperCase();
        const isNan = Number.isNaN(arg);
        const negative = !isNan && (arg < 0 || Object.is(arg, -0));
        let sign = '';
        if (!isNan) {
          if (negative) sign = '-';
          else if (flags.plus) sign = '+';
          else if (flags.space) sign = ' ';
        }

        let body: string;
        let zeroPad = flags.zero && !flags.minus;

        if (isNan || !Number.isFinite(arg)) {
          const word = isNan ? 'nan' : 'inf';
          body = upper ? word.toUpperCase() : word;
          zeroPad = false;
        } else {
          const absVal = Math.abs(arg);
          const { M, E } = decompose(absVal);
          const { intPart, fracPart } = exactDigits(M, E);
          if (conv === 'f' || conv === 'F') {
            const p = precision === undefined ? 6 : precision;
            const { intPart: ip, frac } = roundFixed(intPart, fracPart, p);
            body = ip + (p > 0 ? '.' + frac : flags.hash ? '.' : '');
          } else if (conv === 'e' || conv === 'E') {
            const p = precision === undefined ? 6 : precision;
            const { sig, exponent } = computeSci(intPart, fracPart, p);
            const mantissa = sig[0] + (p > 0 ? '.' + sig.slice(1) : flags.hash ? '.' : '');
            const expSign = exponent < 0 ? '-' : '+';
            const expDigits = Math.abs(exponent).toString().padStart(2, '0');
            body = mantissa + (upper ? 'E' : 'e') + expSign + expDigits;
          } else {
            let P = precision === undefined ? 6 : precision;
            if (P === 0) P = 1;
            const { sig, exponent } = computeSci(intPart, fracPart, P - 1);
            const X = exponent;
            if (P > X && X >= -4) {
              let ip: string;
              let frac: string;
              if (X >= 0) {
                ip = sig.slice(0, X + 1);
                frac = sig.slice(X + 1);
              } else {
                ip = '0';
                frac = '0'.repeat(-X - 1) + sig;
              }
              if (!flags.hash) frac = frac.replace(/0+$/, '');
              body = frac.length > 0 ? ip + '.' + frac : flags.hash ? ip + '.' : ip;
            } else {
              let mantFrac = sig.slice(1);
              if (!flags.hash) mantFrac = mantFrac.replace(/0+$/, '');
              const mantissa = sig[0] + (mantFrac.length > 0 ? '.' + mantFrac : flags.hash ? '.' : '');
              const expSign = X < 0 ? '-' : '+';
              const expDigits = Math.abs(X).toString().padStart(2, '0');
              body = mantissa + (upper ? 'E' : 'e') + expSign + expDigits;
            }
          }
        }
        result += pad(sign, '', body, width, flags.minus, zeroPad);
        break;
      }
      case 's': {
        const arg = args[argIdx++] as string;
        const str = precision !== undefined ? arg.slice(0, precision) : arg;
        result += pad('', '', str, width, flags.minus, false);
        break;
      }
      case 'c': {
        const arg = args[argIdx++] as string;
        result += pad('', '', arg, width, flags.minus, false);
        break;
      }
    }
  }
  return result;
}
