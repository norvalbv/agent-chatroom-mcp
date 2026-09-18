# format(fmt, ...args)

`format` builds a string from a format string and arguments. Ordinary characters of `fmt` are copied unchanged. A conversion specification consumes the next argument (arguments are used left to right) and has this shape:

    %  [flags]  [width]  [.precision]  [length]  conversion

* flags: any of `-` `+` (space) `0` `#`, in any order (a flag may repeat; repeating changes nothing).
* width: a decimal number (it never starts with 0; a leading 0 is the `0` flag), or `*`.
* precision: a `.` followed by a decimal number, or by `*`; a `.` alone means precision 0.
* length: for `d i u x X o` only, one of `hh` `h` `l` `ll`, or absent.
* conversion: one of `d i u x X o e E f F g G s c`. Additionally `%%` prints one `%` and consumes no argument (it has no flags, width or precision).

Every `fmt` given to `format` is well formed, uses only combinations listed here, and has exactly as many arguments as conversions. Test inputs only use flags that are meaningful for the conversion, as stated below.

## Argument types
* `d i u x X o`: an integer (a JS number that is a safe integer, or a bigint), positive, zero or negative.
* a `*` (width or precision): an integer in the range of a 32-bit signed integer.
* `e E f F g G`: a JS number: any finite value, `-0`, `Infinity`, `-Infinity` or `NaN`.
* `s`: a string (ASCII). `c`: a string of exactly one ASCII character.

## Width and padding
Width is the minimum length of the converted text. If the text is shorter it is padded: with spaces on the left, or with spaces on the right when the `-` flag is present. The `0` flag (numeric conversions only) pads with zeros instead of spaces, inserted after any sign or `0x`/`0X` prefix and before the digits; it is ignored when `-` is present. For `d i u x X o` the `0` flag is also ignored when a precision is given. For `e f g` (any case) the `0` flag is ignored for `Infinity`, `-Infinity` and `NaN` (spaces are used). Flags used with `s` and `c` are only ever `-`.

## `*` width and precision
A `*` in place of the width digits takes the next argument as the width; a `*` in place of the precision digits takes the next argument as the precision. Both are consumed before the value argument, the width first. A negative width from `*` acts as the `-` flag together with the width `-w`. A negative precision from `*` acts as if no precision had been given. Everything else about width and precision is as described here.

## Length and signedness: `d i u x X o`
The length fixes the size N of the integer in bits: `hh` is 8, `h` is 16, absent is 32, and `l` and `ll` (equivalent) are 64. The argument is first reduced to N bits: the low N bits of its two's complement form are kept. For `d` and `i` those N bits are read as a signed integer (so `%hhd` of 200 is `-56`); for `u`, `x`, `X` and `o` they are read as an unsigned integer (so `%x` of -1 is `ffffffff`, `%hhu` of 300 is `44` and `%lu` of -1 is `18446744073709551615`). The rest of each conversion then applies to that value.

## d, i, u
The digits are the decimal magnitude (for `u`, the unsigned value; `u` never has a sign and no sign flag is used with it). A precision is the minimum number of digits (padded on the left with zeros); precision 0 with the value 0 gives no digits at all (empty digit string). The sign is `-` for a negative value; otherwise `+` if the `+` flag is present, otherwise a space if the space flag is present, otherwise nothing.

## x, X, o
Lower-case hex digits (`x`), upper-case hex digits (`X`) or octal digits (`o`) of the value; precision as for `d`. With `#`: for `x`/`X`, the prefix `0x`/`0X` is added when the value is nonzero; for `o`, the precision is increased just enough that the first digit is `0` (so the value 0 with precision 0 and `#` gives `0`). No sign flags are used with these conversions.

## e, E
A sign, one digit, then a `.` and `precision` digits (default 6), then `e` (`E` for `E`), the exponent's sign (`+` or `-`) and at least two exponent digits. The `.` is omitted when precision is 0 unless the `#` flag is present. The value 0 has exponent `+00`.

## f, F
A sign, the integer part (at least one digit), then a `.` and `precision` digits (default 6). The `.` is omitted when precision is 0 unless `#` is present.

## g, G
Let P be the precision (default 6; a precision of 0 counts as 1). Let X be the decimal exponent the value would have in `e` style with P-1 digits after the point, after rounding. If P > X and X >= -4 the value is written in `f` style with precision P-1-X, otherwise in `e` style with precision P-1. Unless the `#` flag is present, trailing zeros of the fractional part are then removed, and the `.` too if no fractional digits remain; with `#` the `.` and all zeros stay. `G` uses `E` for the exponent letter.

## Signs, infinities and NaN (e E f F g G)
The sign is `-` when the sign bit is set (so `-0` prints as `-0.000000` under `%f`), otherwise `+` with the `+` flag, otherwise a space with the space flag, otherwise nothing. `Infinity` prints as `inf`, `NaN` as `nan` (`INF`, `NAN` for `F`, `E`, `G`); `NaN` is never given a sign or space, and no test combines `NaN` with the `+` or space flags.

## Rounding
All rounding to a number of digits uses the exact binary value of the number: round to nearest, and when the exact value lies exactly halfway between two candidates, choose the one whose last digit is even. So `%.0f` of 0.5, 1.5, 2.5 gives `0`, `2`, `2`, and `%.2f` of 0.125 gives `0.12`, but `%.2f` of 2.675 gives `2.67` (2.675 is slightly below the halfway point as a double).

## s, c
`s` writes the string; a precision is the maximum number of characters written (the first ones). `c` writes the one character. Width pads as above.

## %%
Writes `%`.
