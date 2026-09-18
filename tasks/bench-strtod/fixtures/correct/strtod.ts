const HEX = /^0[xX](?:([0-9a-fA-F]+)(?:\.([0-9a-fA-F]*))?|\.([0-9a-fA-F]+))(?:[pP]([+-]?[0-9]+))?/;
const DEC = /^(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?/;
const INF = /^(?:infinity|inf)/i;
const NAN = /^nan(?:\([A-Za-z0-9_]*\))?/i;
const hex16 = (v: bigint) => v.toString(16).padStart(16, '0');
function hexValue(int: string, frac: string, exp: bigint): bigint {
  const M = BigInt('0x' + (int + frac || '0'));
  if (M === 0n) return 0n;
  const e2 = exp - 4n * BigInt(frac.length);
  const L = BigInt(M.toString(2).length);
  const E = L - 1n + e2;
  if (E > 1100n) return 0x7ff0000000000000n;
  if (E < -1200n) return 0n;
  let eLow = E - 52n > -1074n ? E - 52n : -1074n;
  const shift = eLow - e2;
  let q: bigint;
  if (shift <= 0n) q = M << -shift;
  else {
    q = M >> shift;
    const rem = M & ((1n << shift) - 1n);
    const half = 1n << (shift - 1n);
    if (rem > half || (rem === half && (q & 1n) === 1n)) q += 1n;
  }
  if (q === 1n << 53n) { q = 1n << 52n; eLow += 1n; }
  if (q < 1n << 52n) return q;
  const biased = eLow + 52n + 1023n;
  if (biased >= 2047n) return 0x7ff0000000000000n;
  return (biased << 52n) | (q & ((1n << 52n) - 1n));
}
export function strtod(s: string): { bits: string; end: number } {
  let i = 0;
  while (i < s.length && ' \t\n\v\f\r'.includes(s[i])) i++;
  let neg = false;
  if (s[i] === '+' || s[i] === '-') { neg = s[i] === '-'; i++; }
  const rest = s.slice(i);
  let m: RegExpMatchArray | null;
  let mag: bigint;
  if ((m = rest.match(HEX))) {
    mag = hexValue(m[1] ?? '', m[2] ?? m[3] ?? '', BigInt(m[4] ?? '0'));
    i += m[0].length;
  } else if ((m = rest.match(INF))) { mag = 0x7ff0000000000000n; i += m[0].length; }
  else if ((m = rest.match(NAN))) { i += m[0].length; return { bits: 'nan', end: i }; }
  else if ((m = rest.match(DEC))) {
    const dv = new DataView(new ArrayBuffer(8));
    dv.setFloat64(0, Number(m[0]));
    mag = dv.getBigUint64(0);
    i += m[0].length;
  } else return { bits: '0000000000000000', end: 0 };
  return { bits: hex16(neg ? mag | (1n << 63n) : mag), end: i };
}
