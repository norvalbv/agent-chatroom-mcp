# lib: behavior contract

Each function below is documented exactly. Every statement is required behavior.

### slugify(s: string): string
Lowercases `s`, replaces every run of one or more characters that are not ASCII letters or digits (a-z, 0-9 after lowercasing) with a single "-", and removes any leading or trailing "-". If the result is empty, returns "untitled". Non-ASCII letters (é, ü, 日) count as non-alphanumeric.

### chunk<T>(arr: T[], size: number): T[][]
Splits `arr` into consecutive arrays of length `size`; the last one holds the remainder and may be shorter. Empty input gives []. Throws RangeError if `size` is not a positive integer. Does not modify `arr`.

### median(nums: number[]): number | null
Numeric median. For an even count, the mean of the two middle values. Returns null for an empty array. Compares numerically (10 is greater than 9), and does not modify `nums`.

### formatBytes(n: number): string
Formats a byte count with binary (1024-based) units B, KB, MB, GB, TB. Values below 1024 print as a whole number followed by " B" (e.g. "512 B"). Otherwise pick the largest unit for which the value is at least 1, print the value with one decimal place, and drop a trailing ".0" (e.g. 1024 gives "1 KB", 1536 gives "1.5 KB"). Values of 1024 TB or more stay in TB. Throws RangeError for negative or non-finite input.

### parseBool(s: string): boolean | undefined
Trims whitespace and ignores case. "true", "yes", "1" and "on" give true; "false", "no", "0" and "off" give false; anything else (including "") gives undefined.

### daysBetween(a: string, b: string): number
Whole calendar days from date `a` to date `b`, both "YYYY-MM-DD", computed in UTC. Positive when `b` is after `a`, negative when before, 0 for the same day. Example: ("2024-01-31", "2024-02-01") gives 1.

### dedupe<T>(arr: T[], keyFn?: (x: T) => unknown): T[]
Removes duplicates, keeping the first occurrence and the original order. Two items are duplicates when their keys are the same value under SameValueZero (so NaN duplicates NaN, and 0 duplicates -0). The key is the item itself unless `keyFn` is given. Does not modify `arr`.

### wrapText(s: string, width: number): string
Greedy word wrap. Words are separated by any run of whitespace (space, tab, newline), which is collapsed. Lines are joined with "\n" and never exceed `width` characters, except that a word longer than `width` is placed alone on its own line without being split. No line has leading or trailing spaces. Empty or whitespace-only input gives "".
