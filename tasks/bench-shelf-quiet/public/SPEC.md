# SHELF, a small list-manipulation language

A SHELF program is a text file. Each line is one statement or one block end. Leading and trailing whitespace on a line is ignored, and blank lines and lines starting with `#` are skipped. Running a program executes its statements in order and collects the output of its PRINT statements.

## Values

There are two kinds of value: integers (unbounded, may be negative) and lists. A list is a mutable object holding an ordered sequence of values; lists can contain integers and other lists. No list is ever stored inside itself, directly or through other lists.

## Expressions

An expression is an integer literal such as `7` or `-3`, a variable name, or a parenthesised form `(op arg ...)`. Parentheses are separate tokens and whitespace separates tokens. The forms are:

- `(+ a b)`, `(- a b)`, `(* a b)` on integers give the sum, difference and product. `(+ a b)` where both are lists gives a new list holding the elements of a followed by the elements of b, each element as it is.
- `(< a b)` and `(= a b)` on integers give 1 when true and 0 when false.
- `(list e1 e2 ...)` gives a new list holding the values of e1, e2, ... in order, each value as it is. `(list)` is the empty list.
- `(idx l i)` gives element number i (counting from 0) of list l, that element itself.
- `(len l)` gives the number of elements of list l.

## Statements

- `LET name expr` binds name in the current scope to the value of expr. When that value is a list, the name is bound to a new independent list built by structure: a new list for the outer list and, recursively, a new list for every list nested at any depth inside it. Every occurrence of a nested list becomes its own new list, even when the same list object appears more than once inside the original, so the copy contains no sharing that the original's structure did not spell out position by position. Integers are bound as they are.
- `PUSH name expr` appends the value of expr, as it is, to the end of the list that name refers to.
- `SET name i expr` replaces element number i of the list that name refers to with the value of expr, as it is.
- `PRINT expr` appends one line to the output: an integer prints as its decimal digits, a list prints as `[`, its elements printed the same way separated by `,` with no spaces, and `]`. So a list holding 1 and a list holding 2 and 3 prints as `[1,[2,3]]`.
- `IF expr`, optionally `ELSE`, then `END`: the first block runs when the value of expr is a non-zero integer, otherwise the ELSE block, if present, runs.
- `REPEAT expr` ... `END` runs its block that many times; the count is evaluated once, and zero or less means the block does not run.
- `FOR name expr` ... `END` runs its block once for each element of the list that expr gives, in order, with name bound in the current scope to that element, as it is, before each run. The elements are those the list holds when the FOR statement starts, in order, and the block runs once per one of them even if the list is changed while the loop runs.
- `DEF name p1 p2 ...` ... `END` defines a procedure with the given parameter names (possibly none). The definition takes effect when the DEF statement is executed. The block is not run until called.
- `RUN name e1 e2 ...` calls the procedure: each argument expression is evaluated by the caller, then the body runs in a new local scope in which the parameter names are bound to the argument values, as they are.

Every IF, REPEAT, FOR and DEF block is closed by its own END.

## Scopes

There is one global scope, and each RUN creates a new local scope. Statements at the top level of the program use the global scope. A name is looked up in the current scope first, and if it is not bound there, in the global scope. A procedure body therefore sees its own local names and the global names, never the local names of its caller. LET always binds in the current scope. PUSH, SET and FOR act on whatever the name refers to when the statement runs, found by the same lookup.
