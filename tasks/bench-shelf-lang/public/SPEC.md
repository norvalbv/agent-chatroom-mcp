# SHELF, a small list-manipulation language

A SHELF program is a text file. Each line is one statement or one block end. Leading and trailing whitespace on a line is ignored, and blank lines and lines starting with `#` are skipped. Running a program executes its statements in order and collects the output of its PRINT statements.

## Values

There are two kinds of value: integers (unbounded, may be negative) and lists. A list is a mutable object holding an ordered sequence of values; lists can contain integers and other lists. No list is ever stored inside itself, directly or through other lists.

## Expressions

An expression is an integer literal such as `7` or `-3`, a variable name, or a parenthesised form `(op arg ...)`. Parentheses are separate tokens and whitespace separates tokens. The forms are:

- `(+ a b)`, `(- a b)`, `(* a b)` on integers give the sum, difference and product. `(+ a b)` where both are lists gives a new list holding the elements of a followed by the elements of b.
- `(< a b)` and `(= a b)` on integers give 1 when true and 0 when false.
- `(list e1 e2 ...)` gives a new list holding the values of e1, e2, ... in order. `(list)` is the empty list.
- `(idx l i)` gives element number i (counting from 0) of list l.
- `(len l)` gives the number of elements of list l.

## Statements

- `LET name expr` binds name in the current scope to the value of expr.
- `PUSH name expr` appends the value of expr to the end of the list that name refers to.
- `SET name i expr` replaces element number i of the list that name refers to with the value of expr.
- `PRINT expr` appends one line to the output: an integer prints as its decimal digits, a list prints as `[`, its elements printed the same way separated by `,` with no spaces, and `]`. So a list holding 1 and a list holding 2 and 3 prints as `[1,[2,3]]`.
- `IF expr`, optionally `ELSE`, then `END`: the first block runs when the value of expr is a non-zero integer, otherwise the ELSE block, if present, runs.
- `REPEAT expr` ... `END` runs its block that many times; the count is evaluated once, and zero or less means the block does not run.
- `FOR name expr` ... `END` runs its block once for each element of the list that expr gives, in order, with name bound in the current scope to that element before each run.
- `DEF name p1 p2 ...` ... `END` defines a procedure with the given parameter names (possibly none). The definition takes effect when the DEF statement is executed. The block is not run until called.
- `RUN name e1 e2 ...` calls the procedure: each argument expression is evaluated by the caller, then the body runs in a new local scope in which the parameter names are bound to the argument values.

Every IF, REPEAT, FOR and DEF block is closed by its own END.

## Scopes

There is one global scope, and each RUN creates a new local scope. Statements at the top level of the program use the global scope. A name is looked up in the current scope first, and if it is not bound there, in the global scope. A procedure body therefore sees its own local names and the global names, never the local names of its caller. LET always binds in the current scope. PUSH, SET and FOR act on whatever the name refers to when the statement runs, found by the same lookup.

## Copying and sharing

A variable holds an integer, or a reference to a list object. Which operations copy a list and which share it is part of the language:

- LET copies. When the value of the LET expression is a list, the name is bound to a new independent list built by structure: a new list for the outer list and, recursively, a new list for every list nested at any depth inside it. Every occurrence of a nested list becomes its own new list, even when the same list object appears more than once inside the original, so the copy contains no sharing that the original's structure did not spell out position by position. Integers are bound as they are.
- PUSH and SET do not copy. A list value is stored in the target list as the same object.
- Evaluating an expression does not copy. A variable name gives the list it refers to; `(idx l i)` gives that element itself; `(list ...)` builds a new outer list whose elements are the argument values as they are, and `(+ a b)` on lists builds a new outer list whose elements are the elements of a then of b as they are. Nested lists inside these are the same objects as before.
- RUN passes list arguments by reference: the parameter name refers to the same list object the caller's expression gave. Integers are passed by value.
- FOR takes a snapshot when it starts: the elements of the list are captured at that moment in order, and the block runs once per captured element even if the list is changed while the loop runs. The loop name is bound to each captured element as it is, so a list element is the same object, not a copy.
