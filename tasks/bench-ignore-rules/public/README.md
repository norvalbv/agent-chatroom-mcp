# isIgnored(rules, path)

`isIgnored(rules: string, path: string): boolean` decides whether a file is ignored under gitignore-style rules.

## Inputs

- `rules` is the text of an ignore file, lines separated by "\n".
- `path` is a file path relative to the root, using "/" separators, with no leading or trailing "/" and never empty. It always names a file; every earlier component is a directory.

## Rule lines

1. Trailing spaces are removed from each line first. Blank lines and lines starting with "#" are skipped. There are no escape sequences, and "[" is an ordinary character.
2. A leading "!" makes the rule a negation; the rest of the line is the pattern.
3. A trailing "/" on the pattern means the rule applies only to directories. Remove it before continuing.
4. If the remaining pattern contains a "/" anywhere (including a leading one), it is anchored: it is matched against the whole path of the candidate, from the root, after dropping one leading "/". Otherwise it is matched against only the last component of the candidate (its name), at any depth.
5. Wildcards: "*" matches any run of characters (including none) except "/". "?" matches exactly one character except "/". Every other character matches itself. Special forms of "**": a leading "**/" matches any number of leading directories, including none; "/**/" in the middle matches "/" followed by any number of directories, including none (so a/**/b matches a/b, a/x/b and a/x/y/b); a trailing "/**" matches everything inside, meaning at least one more component (so abc/** does not match abc itself). Any other run of "*" behaves like a single "*".

## Candidates and decisions

6. A path is examined as a list of candidates: first each proper prefix directory (for a/b/c.txt those are "a" and "a/b", each a directory), then the whole path (a file). A rule marked directory-only can match only a directory candidate.
7. For one candidate, go through the rules in file order. The last rule that applies to the candidate and matches it decides: a negation rule means "not ignored", any other rule means "ignored". If no rule matches, the candidate is not ignored.
8. If any directory candidate is ignored, the file is ignored, whatever later rules say: a file cannot be re-included once one of its parent directories is ignored. Otherwise the file's own result decides.
