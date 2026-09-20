import sys

def parse_lines(path):
    lines = []
    with open(path) as f:
        for line in f:
            line = line.rstrip("\n")
            toks = line.split()
            if toks:
                lines.append(toks)
    return lines

lines = parse_lines("program.stamp")

# Build block structure: index -> matching END, and list of statements as flat list with pointer-based control flow.
# We'll do a simple recursive-descent over a pointer into lines, treating REPEAT/WHILE/IF/DEF as block starters.

procs = {}  # name -> (params, body_start, body_end) body_end exclusive index of END line
globals_ = {}
lists_ = {}

class Signal(Exception):
    pass
class BreakSig(Signal):
    pass
class ContinueSig(Signal):
    pass
class RetSig(Signal):
    def __init__(self, val):
        self.val = val

def find_matching_end(start):
    # start is index of a line that opens a block (REPEAT/WHILE/IF/DEF)
    depth = 1
    i = start + 1
    while i < len(lines):
        t0 = lines[i][0]
        if t0 in ("REPEAT", "WHILE", "IF", "DEF"):
            depth += 1
        elif t0 == "END":
            depth -= 1
            if depth == 0:
                return i
        i += 1
    raise Exception("no matching end")

def find_else(start, end):
    # start is IF line index, end is matching END index; find ELSE at same depth if present
    depth = 0
    i = start + 1
    while i < end:
        t0 = lines[i][0]
        if t0 in ("REPEAT", "WHILE", "IF", "DEF"):
            depth += 1
        elif t0 == "END":
            depth -= 1
        elif t0 == "ELSE" and depth == 0:
            return i
        i += 1
    return None

# Pre-scan DEF blocks positions for reference (not required upfront since DEF takes effect when reached)
def floordiv(a, b):
    if b == 0:
        return 0
    return a // b  # python // is floor division

def mod(a, b):
    if b == 0:
        return 0
    return a - floordiv(a, b) * b

class Scope:
    def __init__(self):
        self.locals = {}
        self.globals_names = set()  # names declared GLOBAL in this call

    def read(self, name):
        if name in self.globals_names:
            return globals_.get(name, 0)
        if name in self.locals:
            return self.locals[name]
        return globals_.get(name, 0)

    def write(self, name, val):
        if name in self.globals_names:
            globals_[name] = val
        else:
            self.locals[name] = val

    def next(self, name):
        cur = self.read(name)
        newval = cur + 1
        self.write(name, newval)
        return newval

def eval_expr(tokens, pos, scope):
    # returns (value, newpos)
    tok = tokens[pos]
    pos += 1
    if tok in ("+", "-", "*", "/", "%", "<", "=", "AND", "OR", "MIN", "MAX", "POW"):
        a, pos = eval_expr(tokens, pos, scope)
        b, pos = eval_expr(tokens, pos, scope)
        if tok == "+":
            return a + b, pos
        if tok == "-":
            return a - b, pos
        if tok == "*":
            return a * b, pos
        if tok == "/":
            return floordiv(a, b), pos
        if tok == "%":
            return mod(a, b), pos
        if tok == "<":
            return (1 if a < b else 0), pos
        if tok == "=":
            return (1 if a == b else 0), pos
        if tok == "AND":
            return (1 if (a != 0 and b != 0) else 0), pos
        if tok == "OR":
            return (1 if (a != 0 or b != 0) else 0), pos
        if tok == "MIN":
            return min(a, b), pos
        if tok == "MAX":
            return max(a, b), pos
        if tok == "POW":
            if b < 0:
                return 0, pos
            return a ** b, pos
    if tok == "NOT":
        a, pos = eval_expr(tokens, pos, scope)
        return (1 if a == 0 else 0), pos
    if tok == "ABS":
        a, pos = eval_expr(tokens, pos, scope)
        return abs(a), pos
    if tok == "NEXT":
        name = tokens[pos]; pos += 1
        return scope.next(name), pos
    if tok == "CALL":
        fname = tokens[pos]; pos += 1
        if fname not in procs:
            return 0, pos
        params, bstart, bend = procs[fname]
        args = []
        for _ in params:
            v, pos = eval_expr(tokens, pos, scope)
            args.append(v)
        newscope = Scope()
        for p, v in zip(params, args):
            newscope.locals[p] = v
        try:
            exec_block(bstart + 1, bend, newscope)
        except RetSig as r:
            return r.val, pos
        return 0, pos
    if tok == "LEN":
        lname = tokens[pos]; pos += 1
        lst = lists_.get(lname, [])
        return len(lst), pos
    if tok == "AT":
        lname = tokens[pos]; pos += 1
        idx, pos = eval_expr(tokens, pos, scope)
        lst = lists_.get(lname, [])
        n = len(lst)
        i = idx
        if i < 0:
            i = n + i
        if i < 0 or i >= n:
            return 0, pos
        return lst[i], pos
    # literal or variable
    if tok.lstrip("-").isdigit() and (tok == "-" and False or True) and (tok[1:].isdigit() if tok.startswith("-") else tok.isdigit()):
        return int(tok), pos
    # else it's a variable name
    return scope.read(tok), pos

def exec_block(start, end, scope):
    i = start
    while i < end:
        toks = lines[i]
        op = toks[0]
        if op == "SET":
            v = toks[1]
            val, _ = eval_expr(toks, 2, scope)
            scope.write(v, val)
            i += 1
        elif op == "SETS":
            v = toks[1]; w = toks[2]
            eval1, pos = eval_expr(toks, 3, scope)
            eval2, pos = eval_expr(toks, pos, scope)
            scope.write(v, eval1)
            scope.write(w, eval2)
            i += 1
        elif op == "PRINT":
            val, _ = eval_expr(toks, 1, scope)
            output.append(val)
            i += 1
        elif op == "PUSH":
            lname = toks[1]
            val, _ = eval_expr(toks, 2, scope)
            lists_.setdefault(lname, []).append(val)
            i += 1
        elif op == "REPEAT":
            cnt, _ = eval_expr(toks, 1, scope)
            end_idx = find_matching_end(i)
            body_start = i + 1
            body_end = end_idx
            n = cnt
            j = 0
            while j < n:
                j += 1
                try:
                    exec_block(body_start, body_end, scope)
                except BreakSig:
                    break
                except ContinueSig:
                    continue
            i = end_idx + 1
        elif op == "WHILE":
            end_idx = find_matching_end(i)
            body_start = i + 1
            body_end = end_idx
            while True:
                cond, _ = eval_expr(toks, 1, scope)
                if cond == 0:
                    break
                try:
                    exec_block(body_start, body_end, scope)
                except BreakSig:
                    break
                except ContinueSig:
                    continue
            i = end_idx + 1
        elif op == "IF":
            end_idx = find_matching_end(i)
            else_idx = find_else(i, end_idx)
            cond, _ = eval_expr(toks, 1, scope)
            if cond != 0:
                b_start = i + 1
                b_end = else_idx if else_idx is not None else end_idx
                exec_block(b_start, b_end, scope)
            else:
                if else_idx is not None:
                    exec_block(else_idx + 1, end_idx, scope)
            i = end_idx + 1
        elif op == "BREAK":
            raise BreakSig()
        elif op == "CONTINUE":
            raise ContinueSig()
        elif op == "RET":
            val, _ = eval_expr(toks, 1, scope)
            raise RetSig(val)
        elif op == "DEF":
            fname = toks[1]
            params = toks[2:]
            end_idx = find_matching_end(i)
            procs[fname] = (params, i, end_idx)
            i = end_idx + 1
        elif op == "GLOBAL":
            name = toks[1]
            scope.globals_names.add(name)
            i += 1
        else:
            raise Exception("unknown op " + op)

output = []
top_scope = Scope()
top_scope.globals_names = None  # not used; top scope writes go to locals dict which we alias to globals

# For top-level, treat scope.locals as globals_ directly
top_scope.locals = globals_
class TopScope(Scope):
    def read(self, name):
        return globals_.get(name, 0)
    def write(self, name, val):
        globals_[name] = val
    def next(self, name):
        v = self.read(name) + 1
        self.write(name, v)
        return v

top_scope = TopScope()

exec_block(0, len(lines), top_scope)

print(" ".join(str(x) for x in output))
