# strtod specification

`strtod(s: string): { bits: string; end: number }` converts the beginning of `s` to an IEEE 754
binary64 number, the way C99's `strtod` does in the "C" locale. `s` holds only characters
U+0001 to U+007F.

## Result

- `end` is the number of characters of `s` that were consumed, so `s.slice(end)` is what was
  left over.
- `bits` describes the value: exactly 16 lower-case hexadecimal digits, the big-endian bytes of
  the binary64 value (`3ff0000000000000` is 1, `8000000000000000` is negative zero,
  `7ff0000000000000` is positive infinity), except that every NaN, of any sign or payload, is
  returned as the four letters `nan`.
- If nothing can be converted (see step 3), the result is `bits` of positive zero
  (`0000000000000000`) and `end` is 0. Whitespace and a sign are then not counted as consumed.

## What is consumed

1. Skip leading whitespace: the six characters space, `\t`, `\n`, `\v` (U+000B), `\f` (U+000C)
   and `\r`. Nothing else counts as whitespace.
2. Take an optional sign, `+` or `-`. It applies to whatever number follows, including zero,
   infinity and NaN.
3. Then consume the longest match of the first of these forms that matches at all, trying them
   in this order:
   1. **Hexadecimal**: `0x` or `0X`, then either (at least one hex digit, optionally followed by
      a `.` and any number of hex digits) or (a `.` and at least one hex digit); then optionally
      an exponent: `p` or `P`, an optional sign and at least one decimal digit. If the `p` is
      not followed by such an exponent, the exponent is not part of the number and the
      characters from the `p` on are left over.
   2. **Infinity**: `infinity` or `inf`, in any mix of upper and lower case; the longer word
      wins when it is fully there.
   3. **NaN**: `nan` in any mix of case, optionally followed directly by `(`, any number of
      letters, digits and underscores, and `)`. If the parenthesised part is not complete or
      contains any other character, only `nan` is consumed.
   4. **Decimal**: either (at least one decimal digit, optionally followed by a `.` and any
      number of digits) or (a `.` and at least one digit); then optionally an exponent: `e` or
      `E`, an optional sign and at least one decimal digit. If the `e` is not followed by such
      an exponent, it is not part of the number.
   If none of these matches (for example `0x` followed by a non-hex character still matches the
   decimal form and consumes just the `0`), nothing can be converted.

## The value

- Decimal digits are read in base 10 with an optional decimal exponent; hexadecimal digits in base 16
  with an optional binary exponent (a power of two written in decimal digits), so `0x1.8p3` is
  1.5 x 2^3 = 12. Digit strings and exponents may be arbitrarily long.
- The exact value of the text is converted to the nearest binary64 value; when the exact value is
  exactly halfway between two adjacent binary64 values, the one whose last significand bit is
  even is chosen. Subnormal numbers are used for results below the smallest normal number
  (`0x1p-1022`), and a value that rounds to zero keeps its sign. A value that rounds above the largest finite
  binary64 value (`0x1.fffffffffffffp1023`) becomes infinity of the same sign. Both are decided from the exact value, in a
  single rounding step.
- Infinity and NaN carry the sign as described above; NaN is always reported as `nan`.

## Examples

`strtod("  -12.5e1x")` returns `{ bits: "c05f400000000000", end: 9 }`.
`strtod("0x1.8p3")` returns `{ bits: "4028000000000000", end: 7 }`.
`strtod("0x")` returns `{ bits: "0000000000000000", end: 1 }`.
`strtod("e5")` returns `{ bits: "0000000000000000", end: 0 }`.
