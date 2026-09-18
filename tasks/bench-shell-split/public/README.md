# shellSplit(input)

`shellSplit(input: string): string[]` splits a command line into words the way a POSIX shell tokenizer does, without performing any expansion.

## Rules

1. Whitespace is exactly space, tab, newline and carriage return. Outside quotes, a run of whitespace ends the current word. Leading, trailing and repeated whitespace produce no empty words. Input with no words gives [].
2. Single quotes: everything between a pair of single quotes is taken literally, including backslashes, double quotes, and whitespace. There is no way to put a single quote inside single quotes.
3. Double quotes: everything between a pair of double quotes is taken literally, including single quotes and whitespace, except that a backslash followed by a double quote gives just the double quote, and a backslash followed by a backslash gives a single backslash. A backslash followed by any other character stays as a backslash followed by that character (both are kept).
4. Outside quotes, a backslash makes the next character literal and is itself removed, whatever that character is (including a space, a quote, or another backslash).
5. Quoted and unquoted pieces that touch each other belong to the same word and are concatenated: a"b c"d is one word, `ab cd`.
6. A pair of quotes with nothing inside still makes a word: `a "" b` gives ["a", "", "b"], and `a""b` gives ["ab"].
7. No expansion of any kind: "$", "`", "*", "~" and "#" are ordinary characters everywhere. A "#" does not start a comment.
8. Malformed input throws an Error: a quote that is never closed (including a double quote whose closing quote was consumed by an escape), or an unquoted backslash as the very last character.
