# EAGER, a small expression language

A program is a text file of lines; blank lines and lines starting with `#` are skipped. Lines run in order.

## Statements

- `LET name = expr` sets the global variable `name` to the value of `expr`.
- `DEF name p1 p2 ... = expr` defines the function `name` with the given parameter names (possibly none). Defining a name again replaces the earlier definition. The body is not evaluated until the function is called.
- `SHOW expr` appends the value of `expr` to the output.

The output is the list of everything appended, in order, by SHOW and by `out` (below). All values are integers (unbounded, may be negative).

## Expressions

An expression is an integer literal such as `7` or `-3`, a name, or a parenthesised form `(op e1 e2 ... en)`. Parentheses are separate tokens and whitespace separates tokens. A name is a parameter of the running function if it is one, otherwise a global variable.

Every form has an operator and its operands. The operators are:

- `(+ a b)`, `(- a b)`, `(* a b)`: sum, difference, product.
- `(< a b)`, `(= a b)`: 1 when true, 0 when false.
- `(and a b)`: 1 when a and b are both non-zero, else 0. `(or a b)`: 1 when at least one of them is non-zero, else 0. `(not a)`: 1 when a is 0, else 0.
- `(if c a b)`: the value of a when c is non-zero, otherwise the value of b.
- `(seq a b)`: the value of b.
- `(out a)`: appends the value of a to the output and gives that value.
- `(bump k)`: adds 1 to counter number k (counters 0 to 9 all start at 0) and gives the new count of that counter. `(peek k)` gives the current count of counter k.
- `(f a1 ... an)` where `f` is a defined function: calls f.

## Evaluation

To evaluate a form `(op e1 ... en)`, whatever the operator: evaluate e1, then e2, and so on up to en, each one completely and in that order; then the form takes its value from the resulting values by the operator's rule above (for a defined function, by evaluating its body with each parameter bound to the value of the operand in the same position).

A call is at depth d when d function calls, counting itself, are running. A call whose depth would exceed 5 does not run its body and gives 0; its operands have already been evaluated as above.
