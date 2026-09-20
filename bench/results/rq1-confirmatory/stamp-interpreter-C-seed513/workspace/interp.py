import sys

def tokenize(lines):
    return [line.split() for line in lines if line.strip() != ""]

def parse_block(tokens, i, end_tokens):
    stmts = []
    while i < len(tokens):
        t = tokens[i]
        head = t[0]
        if head in end_tokens:
            return stmts, i
        if head == "IF":
            cond = t[1:]
            body, i = parse_block(tokens, i+1, ("ELSE","END"))
            if tokens[i][0] == "ELSE":
                elsebody, i = parse_block(tokens, i+1, ("END",))
            else:
                elsebody = None
            i += 1
            stmts.append(("IF", cond, body, elsebody))
        elif head == "WHILE":
            cond = t[1:]
            body, i = parse_block(tokens, i+1, ("END",))
            i += 1
            stmts.append(("WHILE", cond, body))
        elif head == "REPEAT":
            cond = t[1:]
            body, i = parse_block(tokens, i+1, ("END",))
            i += 1
            stmts.append(("REPEAT", cond, body))
        elif head == "DEF":
            name = t[1]
            params = t[2:]
            body, i = parse_block(tokens, i+1, ("END",))
            i += 1
            stmts.append(("DEF", name, params, body))
        else:
            stmts.append(("STMT", t))
            i += 1
    return stmts, i

class BreakExc(Exception): pass
class ContinueExc(Exception): pass
class RetExc(Exception):
    def __init__(self, v): self.v = v

globals_ = {}
lists_ = {}
procs = {}
output = []

def floordiv(a,b):
    if b==0: return 0
    return a // b  # python // is floor div already

def mod(a,b):
    if b==0: return 0
    return a - floordiv(a,b)*b

def parse_expr(tokens, idx, scope):
    tok = tokens[idx]
    if tok == "+":
        a, idx = parse_expr(tokens, idx+1, scope)
        b, idx = parse_expr(tokens, idx, scope)
        return a+b, idx
    if tok == "-":
        a, idx = parse_expr(tokens, idx+1, scope)
        b, idx = parse_expr(tokens, idx, scope)
        return a-b, idx
    if tok == "*":
        a, idx = parse_expr(tokens, idx+1, scope)
        b, idx = parse_expr(tokens, idx, scope)
        return a*b, idx
    if tok == "/":
        a, idx = parse_expr(tokens, idx+1, scope)
        b, idx = parse_expr(tokens, idx, scope)
        return floordiv(a,b), idx
    if tok == "%":
        a, idx = parse_expr(tokens, idx+1, scope)
        b, idx = parse_expr(tokens, idx, scope)
        return mod(a,b), idx
    if tok == "<":
        a, idx = parse_expr(tokens, idx+1, scope)
        b, idx = parse_expr(tokens, idx, scope)
        return (1 if a<b else 0), idx
    if tok == "=":
        a, idx = parse_expr(tokens, idx+1, scope)
        b, idx = parse_expr(tokens, idx, scope)
        return (1 if a==b else 0), idx
    if tok == "AND":
        a, idx = parse_expr(tokens, idx+1, scope)
        b, idx = parse_expr(tokens, idx, scope)
        return (1 if (a!=0 and b!=0) else 0), idx
    if tok == "OR":
        a, idx = parse_expr(tokens, idx+1, scope)
        b, idx = parse_expr(tokens, idx, scope)
        return (1 if (a!=0 or b!=0) else 0), idx
    if tok == "MIN":
        a, idx = parse_expr(tokens, idx+1, scope)
        b, idx = parse_expr(tokens, idx, scope)
        return min(a,b), idx
    if tok == "MAX":
        a, idx = parse_expr(tokens, idx+1, scope)
        b, idx = parse_expr(tokens, idx, scope)
        return max(a,b), idx
    if tok == "POW":
        a, idx = parse_expr(tokens, idx+1, scope)
        b, idx = parse_expr(tokens, idx, scope)
        if b<0: return 0, idx
        return a**b, idx
    if tok == "NOT":
        a, idx = parse_expr(tokens, idx+1, scope)
        return (1 if a==0 else 0), idx
    if tok == "ABS":
        a, idx = parse_expr(tokens, idx+1, scope)
        return abs(a), idx
    if tok == "NEXT":
        name = tokens[idx+1]
        idx2 = idx+2
        val = read_var(name, scope) + 1
        write_var(name, val, scope)
        return val, idx2
    if tok == "CALL":
        fname = tokens[idx+1]
        idx2 = idx+2
        proc = procs.get(fname)
        nparams = len(proc[0]) if proc else 0
        args = []
        for _ in range(nparams):
            v, idx2 = parse_expr(tokens, idx2, scope)
            args.append(v)
        if proc is None:
            return 0, idx2
        params, body = proc
        newscope = {"locals": {}, "globaled": set()}
        for p,a in zip(params,args):
            newscope["locals"][p] = a
        try:
            exec_block(body, newscope)
        except RetExc as r:
            return r.v, idx2
        return 0, idx2
    if tok == "LEN":
        lname = tokens[idx+1]
        return len(lists_.get(lname, [])), idx+2
    if tok == "AT":
        lname = tokens[idx+1]
        i2, idx2 = parse_expr(tokens, idx+2, scope)
        lst = lists_.get(lname, [])
        if i2 < 0:
            i3 = len(lst) + i2
        else:
            i3 = i2
        if i3 < 0 or i3 >= len(lst):
            return 0, idx2
        return lst[i3], idx2
    # literal or variable
    try:
        return int(tok), idx+1
    except ValueError:
        return read_var(tok, scope), idx+1

def read_var(name, scope):
    if scope is None:
        return globals_.get(name, 0)
    if name in scope["globaled"]:
        return globals_.get(name, 0)
    if name in scope["locals"]:
        return scope["locals"][name]
    return globals_.get(name, 0)

def write_var(name, val, scope):
    if scope is None:
        globals_[name] = val
        return
    if name in scope["globaled"]:
        globals_[name] = val
        return
    scope["locals"][name] = val

def exec_block(stmts, scope):
    for s in stmts:
        exec_stmt(s, scope)

def exec_stmt(s, scope):
    kind = s[0]
    if kind == "IF":
        cond, _ = parse_expr(s[1], 0, scope)
        if cond != 0:
            exec_block(s[2], scope)
        elif s[3] is not None:
            exec_block(s[3], scope)
    elif kind == "WHILE":
        while True:
            cond, _ = parse_expr(s[1], 0, scope)
            if cond == 0:
                break
            try:
                exec_block(s[2], scope)
            except BreakExc:
                break
            except ContinueExc:
                continue
    elif kind == "REPEAT":
        n, _ = parse_expr(s[1], 0, scope)
        i = 0
        while i < n:
            i += 1
            try:
                exec_block(s[2], scope)
            except BreakExc:
                break
            except ContinueExc:
                continue
    elif kind == "DEF":
        procs[s[1]] = (s[2], s[3])
    elif kind == "STMT":
        t = s[1]
        head = t[0]
        if head == "SET":
            name = t[1]
            val, _ = parse_expr(t, 2, scope)
            write_var(name, val, scope)
        elif head == "SETS":
            v = t[1]; w = t[2]
            eval1, idx = parse_expr(t, 3, scope)
            eval2, idx = parse_expr(t, idx, scope)
            write_var(v, eval1, scope)
            write_var(w, eval2, scope)
        elif head == "PRINT":
            val, _ = parse_expr(t, 1, scope)
            output.append(val)
        elif head == "PUSH":
            name = t[1]
            val, _ = parse_expr(t, 2, scope)
            lists_.setdefault(name, []).append(val)
        elif head == "BREAK":
            raise BreakExc()
        elif head == "CONTINUE":
            raise ContinueExc()
        elif head == "GLOBAL":
            name = t[1]
            scope["globaled"].add(name)
        elif head == "RET":
            val, _ = parse_expr(t, 1, scope)
            raise RetExc(val)
        else:
            raise Exception("unknown stmt " + head)

def main():
    with open(sys.argv[1]) as f:
        lines = f.readlines()
    tokens = tokenize(lines)
    stmts, i = parse_block(tokens, 0, ())
    exec_block(stmts, None)
    print(" ".join(str(x) for x in output))

main()
