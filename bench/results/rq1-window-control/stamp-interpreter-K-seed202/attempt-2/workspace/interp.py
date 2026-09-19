import sys

lines = []
with open("program.stamp") as f:
    for line in f:
        line = line.rstrip("\n")
        if line.strip() == "":
            continue
        toks = line.split(" ")
        lines.append(toks)

globals_ = {}
lists_ = {}
procs = {}
output = []

class Break(Exception): pass
class Continue(Exception): pass
class Return(Exception):
    def __init__(self, val):
        self.val = val

def is_int_literal(tok):
    if tok == "-":
        return False
    if tok[0] == '-' and len(tok) > 1 and tok[1:].isdigit():
        return True
    return tok.isdigit()

class Scope:
    def __init__(self, is_top=False):
        self.locals = {}
        self.global_names = set()
        self.is_top = is_top

    def read(self, name):
        if self.is_top or name in self.global_names:
            return globals_.get(name, 0)
        if name in self.locals:
            return self.locals[name]
        return globals_.get(name, 0)

    def write(self, name, val):
        if self.is_top or name in self.global_names:
            globals_[name] = val
        else:
            self.locals[name] = val

    def declare_global(self, name):
        self.global_names.add(name)

def find_matching_end(idx):
    depth = 1
    i = idx + 1
    while depth > 0:
        t = lines[i]
        if t[0] in ("REPEAT", "WHILE", "IF"):
            depth += 1
        elif t[0] == "END":
            depth -= 1
            if depth == 0:
                return i
        i += 1
    raise Exception("no matching end")

def find_else_or_end(idx):
    # idx points at IF line
    depth = 1
    i = idx + 1
    while True:
        t = lines[i]
        if t[0] in ("REPEAT", "WHILE", "IF"):
            depth += 1
        elif t[0] == "END":
            depth -= 1
            if depth == 0:
                return ("end", i)
        elif t[0] == "ELSE" and depth == 1:
            return ("else", i)
        i += 1

# Pre-scan top-level for procedure defs positions (we execute DEF as encountered instead)

def parse_expr(toks, pos, scope):
    tok = toks[pos]
    if is_int_literal(tok):
        return int(tok), pos+1
    if tok == "+":
        a, pos = parse_expr(toks, pos+1, scope)
        b, pos = parse_expr(toks, pos, scope)
        return a+b, pos
    if tok == "-":
        a, pos = parse_expr(toks, pos+1, scope)
        b, pos = parse_expr(toks, pos, scope)
        return a-b, pos
    if tok == "*":
        a, pos = parse_expr(toks, pos+1, scope)
        b, pos = parse_expr(toks, pos, scope)
        return a*b, pos
    if tok == "/":
        a, pos = parse_expr(toks, pos+1, scope)
        b, pos = parse_expr(toks, pos, scope)
        if b == 0:
            return 0, pos
        return a // b, pos  # python floor div matches floor toward -inf
    if tok == "%":
        a, pos = parse_expr(toks, pos+1, scope)
        b, pos = parse_expr(toks, pos, scope)
        if b == 0:
            return 0, pos
        return a % b, pos  # python % matches floor-based modulo
    if tok == "<":
        a, pos = parse_expr(toks, pos+1, scope)
        b, pos = parse_expr(toks, pos, scope)
        return (1 if a < b else 0), pos
    if tok == "=":
        a, pos = parse_expr(toks, pos+1, scope)
        b, pos = parse_expr(toks, pos, scope)
        return (1 if a == b else 0), pos
    if tok == "AND":
        a, pos = parse_expr(toks, pos+1, scope)
        b, pos = parse_expr(toks, pos, scope)
        return (1 if (a != 0 and b != 0) else 0), pos
    if tok == "OR":
        a, pos = parse_expr(toks, pos+1, scope)
        b, pos = parse_expr(toks, pos, scope)
        return (1 if (a != 0 or b != 0) else 0), pos
    if tok == "MIN":
        a, pos = parse_expr(toks, pos+1, scope)
        b, pos = parse_expr(toks, pos, scope)
        return min(a,b), pos
    if tok == "MAX":
        a, pos = parse_expr(toks, pos+1, scope)
        b, pos = parse_expr(toks, pos, scope)
        return max(a,b), pos
    if tok == "POW":
        a, pos = parse_expr(toks, pos+1, scope)
        b, pos = parse_expr(toks, pos, scope)
        if b < 0:
            return 0, pos
        return a**b, pos
    if tok == "NOT":
        a, pos = parse_expr(toks, pos+1, scope)
        return (1 if a == 0 else 0), pos
    if tok == "ABS":
        a, pos = parse_expr(toks, pos+1, scope)
        return abs(a), pos
    if tok == "NEXT":
        name = toks[pos+1]
        cur = scope.read(name)
        newv = cur + 1
        scope.write(name, newv)
        return newv, pos+2
    if tok == "CALL":
        fname = toks[pos+1]
        pos = pos+2
        if fname not in procs:
            # need to know arg count = 0 if not defined
            return 0, pos
        params, body_start, body_end = procs[fname]
        args = []
        for p in params:
            v, pos = parse_expr(toks, pos, scope)
            args.append(v)
        newscope = Scope()
        for pname, aval in zip(params, args):
            newscope.locals[pname] = aval
        try:
            exec_block(body_start, body_end, newscope)
        except Return as r:
            return r.val, pos
        return 0, pos
    if tok == "LEN":
        name = toks[pos+1]
        lst = lists_.get(name, [])
        return len(lst), pos+2
    if tok == "AT":
        name = toks[pos+1]
        idxval, pos2 = parse_expr(toks, pos+2, scope)
        lst = lists_.get(name, [])
        n = len(lst)
        i = idxval
        if i < 0:
            i2 = n + i
        else:
            i2 = i
        if i2 < 0 or i2 >= n:
            return 0, pos2
        return lst[i2], pos2
    # variable name
    return scope.read(tok), pos+1

def exec_block(start, end, scope):
    i = start
    while i < end:
        toks = lines[i]
        op = toks[0]
        if op == "SET":
            v = toks[1]
            val, _ = parse_expr(toks, 2, scope)
            scope.write(v, val)
            i += 1
        elif op == "SETS":
            v = toks[1]; w = toks[2]
            eval1, pos = parse_expr(toks, 3, scope)
            eval2, pos = parse_expr(toks, pos, scope)
            scope.write(v, eval1)
            scope.write(w, eval2)
            i += 1
        elif op == "PRINT":
            val, _ = parse_expr(toks, 1, scope)
            output.append(val)
            i += 1
        elif op == "PUSH":
            name = toks[1]
            val, _ = parse_expr(toks, 2, scope)
            lists_.setdefault(name, []).append(val)
            i += 1
        elif op == "REPEAT":
            cnt, _ = parse_expr(toks, 1, scope)
            end_idx = find_matching_end(i)
            body_start = i+1
            body_end = end_idx
            remaining = cnt
            try:
                while remaining > 0:
                    try:
                        exec_block(body_start, body_end, scope)
                    except Continue:
                        pass
                    remaining -= 1
            except Break:
                pass
            i = end_idx + 1
        elif op == "WHILE":
            end_idx = find_matching_end(i)
            body_start = i+1
            body_end = end_idx
            try:
                while True:
                    cval, _ = parse_expr(toks, 1, scope)
                    if cval == 0:
                        break
                    try:
                        exec_block(body_start, body_end, scope)
                    except Continue:
                        pass
            except Break:
                pass
            i = end_idx + 1
        elif op == "IF":
            kind, marker_idx = find_else_or_end(i)
            cval, _ = parse_expr(toks, 1, scope)
            if kind == "else":
                else_idx = marker_idx
                end_idx = find_matching_end(i)  # careful, this recomputes; let's instead find actual end after else
            i_after = None
            if kind == "end":
                end_idx = marker_idx
                if cval != 0:
                    exec_block(i+1, end_idx, scope)
                i = end_idx + 1
            else:
                else_idx = marker_idx
                # find matching end after else at same depth
                depth = 1
                j = else_idx+1
                while True:
                    t = lines[j]
                    if t[0] in ("REPEAT","WHILE","IF"):
                        depth += 1
                    elif t[0] == "END":
                        depth -= 1
                        if depth == 0:
                            break
                    j += 1
                end_idx = j
                if cval != 0:
                    exec_block(i+1, else_idx, scope)
                else:
                    exec_block(else_idx+1, end_idx, scope)
                i = end_idx + 1
        elif op == "BREAK":
            raise Break()
        elif op == "CONTINUE":
            raise Continue()
        elif op == "RET":
            val, _ = parse_expr(toks, 1, scope)
            raise Return(val)
        elif op == "GLOBAL":
            name = toks[1]
            scope.declare_global(name)
            i += 1
        elif op == "DEF":
            fname = toks[1]
            params = toks[2:]
            end_idx = find_matching_end(i)
            procs[fname] = (params, i+1, end_idx)
            i = end_idx + 1
        else:
            raise Exception("unknown op " + op)

top_scope = Scope(is_top=True)
exec_block(0, len(lines), top_scope)

print(" ".join(str(v) for v in output))
