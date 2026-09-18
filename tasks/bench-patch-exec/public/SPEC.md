# applyPatch specification

`applyPatch(original: string, patch: string): string` applies a single-file
unified-diff patch (hunks only) to `original` and returns the new text. Every
failure throws `PatchError` (exported from `patch.ts`); no partial output is ever
returned. For string arguments, nothing other than `PatchError` may be thrown.

## 1. Lines of the original

- Split `original` on `"\n"`. If `original` is empty or ends with `"\n"`, there is
  no final partial line. The empty string has zero lines.
- If `original` is non-empty and does not end with `"\n"`, its last line is
  flagged NO_EOL.
- `"\r"` is ordinary content: the line `"a\r"` is different from `"a"`.
- Two lines are equal only if their content (terminator excluded) is identical
  AND their NO_EOL flags are equal.

## 2. Reading the patch

- Split `patch` on `"\n"`. If the last piece is `""` (the patch ended with
  `"\n"`), drop it. Nothing else is trimmed.
- Every line before the first line that starts with `@@` is ignored (file headers
  live there).
- A hunk header must match `@@ -A[,B] +C[,D] @@` (regular expression
  `^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@`); anything after the closing `@@`
  is ignored. A line that starts with `@@` but does not match is a `PatchError`.
  `B` and `D` default to 1 when omitted. `C` is never validated or used.
- A header with `B = 0` and `D = 0` is a `PatchError`. A header with `B > 0` and
  `A = 0` is a `PatchError`.
- Body lines follow the header. Each starts with one of:
  - `" "` context (counts as one old line and one new line),
  - `"-"` removal (one old line),
  - `"+"` addition (one new line),
  - `"\"` marker (see below).
  The rest of the line after the first character is the line content (may be
  empty). A body line that is empty, or starts with any other character, is a
  `PatchError`.
- A hunk's body ends as soon as it holds exactly `B` old lines and exactly `D`
  new lines and the next line is not a marker. Running out of patch lines before
  that, or a context/removal/addition line that would push a count past `B` or
  `D`, is a `PatchError`. After a hunk ends, the next patch line (if any) must
  start with `@@`, otherwise `PatchError`.
- A marker line (any line starting with `"\"`) sets the NO_EOL flag on the
  immediately preceding body line of the same hunk: a context line is flagged in
  both its old and new copies; a removal in old only; an addition in new only. A
  marker with no preceding body line in the hunk, or following a line that is
  already marked, is a `PatchError`.
- Within one hunk, a NO_EOL-flagged line must be the last line of its sequence
  (the last old line for old lines, the last new line for new lines); otherwise
  `PatchError`.
- A patch with no hunks is a `PatchError`.

## 3. Placement

Let `n` be the number of lines of `original`. For a hunk let `old` be its old
lines in order (context and removals, with flags), `L` be the length of `old`, and
`nominal` be `A - 1` when `B > 0`, or `A` when `B = 0` (for `B = 0`, `A` is the
number of original lines that come before the insertion point).

Keep two values across hunks, both starting at 0: `delta` (how far the previous
hunk landed from its nominal position) and `prevEnd` (the index just past the
previous hunk's old lines in `original`).

For each hunk in order, let `start = nominal + delta`. Try candidate start
positions `p` in this order: `start`, then `start-1`, `start+1`, then `start-2`,
`start+2`, and so on (for distance k = 1, 2, 3, ...: `start-k` first, then
`start+k`). A candidate is acceptable when all of these hold:

- `0 <= p <= n - L`;
- `p >= prevEnd`;
- `original`'s lines at `p, p+1, ..., p+L-1` equal `old`, line by line (§1).

The first acceptable candidate is the placement. If no candidate can ever be
acceptable, throw `PatchError`. After placing, set `delta = p - nominal` (against
the hunk's own nominal position, not `start`) and `prevEnd = p + L`.

Searching always runs against the untouched `original`; line-count changes made by
earlier hunks never shift later positions.

## 4. Output

The result is: the original lines before the first placement, then for each hunk
its new lines (with their flags) followed by the original lines up to the next
placement, and finally the remaining original lines. Original lines keep the
flags they had.

Each output line is written followed by `"\n"`, except that the very last output
line is written without a terminator when it is flagged NO_EOL. A NO_EOL flag on
any other output line has no effect. If there are no output lines the result is
`""`.

## Examples

`applyPatch("a\nb\nc\n", "@@ -2 +2 @@\n-b\n+B\n")` returns `"a\nB\nc\n"`.

`applyPatch("x\ny\n", "@@ -0,0 +1 @@\n+w\n")` returns `"w\nx\ny\n"`.

`applyPatch("a\nb", "@@ -2 +2 @@\n-b\n\\ No newline at end of file\n+B\n")` returns
`"a\nB\n"`.
