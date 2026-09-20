import sys

def tokenize(lines):
    prog = []
    for line in lines:
        line = line.strip()
        if not line:
            continue
        prog.append(line.split(' '))
    return prog

def parse_int(tok):
    if tok.lstrip('-').isdigit() and tok != '-':
        return int(tok)
    return None

class Proc:
    def __init__(self, params, body):
        self.params = params
        self.body = body

globals_ = {}
lists_ = {}
procs = {}
output = []

class Break(Exception): pass
class Continue(Exception): pass
class Return(Exception):
    def __init__(self, val):
        self.val = val

def read_block(lines, i):
    body = []
    depth = 0
    while True:
        toks = lines[i]
        head = toks[0]
        if head in ('REPEAT', 'WHILE', 'IF', 'DEF'):
            depth += 1
            body.append(toks)
            i += 1
        elif head == 'END':
            if depth == 0:
                return body, i+1
            depth -= 1
            body.append(toks)
            i += 1
        else:
            body.append(toks)
            i += 1

def parse_program(lines):
    stmts, _ = parse_stmts(lines, 0, len(lines))
    return stmts

def find_matching_end(lines, start):
    depth = 0
    i = start
    while i < len(lines):
        head = lines[i][0]
        if head in ('REPEAT','WHILE','IF','DEF'):
            depth += 1
        elif head == 'END':
            if depth == 0:
                return i
            depth -= 1
        i += 1
    raise Exception("no matching end")

def find_else_or_end(lines, start):
    depth = 0
    i = start
    while i < len(lines):
        head = lines[i][0]
        if head in ('REPEAT','WHILE','IF','DEF'):
            depth += 1
        elif head == 'ELSE' and depth == 0:
            return i
        elif head == 'END':
            if depth == 0:
                return i
            depth -= 1
        i += 1
    raise Exception("no matching end/else")

def parse_stmts(lines, start, end):
    stmts = []
    i = start
    while i < end:
        toks = lines[i]
        head = toks[0]
        if head == 'REPEAT':
            e = toks[1:]
            close = find_matching_end(lines, i+1)
            body_stmts = parse_stmts(lines, i+1, close)
            stmts.append(('REPEAT', e, body_stmts))
            i = close+1
        elif head == 'WHILE':
            e = toks[1:]
            close = find_matching_end(lines, i+1)
            body_stmts = parse_stmts(lines, i+1, close)
            stmts.append(('WHILE', e, body_stmts))
            i = close+1
        elif head == 'IF':
            e = toks[1:]
            elseidx = find_else_or_end(lines, i+1)
            if lines[elseidx][0] == 'ELSE':
                then_stmts = parse_stmts(lines, i+1, elseidx)
                close = find_matching_end(lines, elseidx+1)
                else_stmts = parse_stmts(lines, elseidx+1, close)
                stmts.append(('IF', e, then_stmts, else_stmts))
                i = close+1
            else:
                then_stmts = parse_stmts(lines, i+1, elseidx)
                stmts.append(('IF', e, then_stmts, None))
                i = elseidx+1
        elif head == 'DEF':
            name = toks[1]
            params = toks[2:]
            close = find_matching_end(lines, i+1)
            body_stmts = parse_stmts(lines, i+1, close)
            stmts.append(('DEF', name, params, body_stmts))
            i = close+1
        elif head == 'END' or head == 'ELSE':
            raise Exception("unexpected " + head)
        else:
            stmts.append(('STMT', toks))
            i += 1
    return stmts

# Expression evaluation
class Scope:
    def __init__(self):
        self.locals = {}
        self.globalnames = set()

def eval_expr(toks, pos, scope):
    tok = toks[pos]
    n = parse_int(tok)
    if n is not None:
        return n, pos+1
    if tok == '+':
        a, pos = eval_expr(toks, pos+1, scope)
        b, pos = eval_expr(toks, pos, scope)
        return a+b, pos
    if tok == '-':
        a, pos = eval_expr(toks, pos+1, scope)
        b, pos = eval_expr(toks, pos, scope)
        return a-b, pos
    if tok == '*':
        a, pos = eval_expr(toks, pos+1, scope)
        b, pos = eval_expr(toks, pos, scope)
        return a*b, pos
    if tok == '/':
        a, pos = eval_expr(toks, pos+1, scope)
        b, pos = eval_expr(toks, pos, scope)
        if b == 0:
            return 0, pos
        return a // b, pos
    if tok == '%':
        a, pos = eval_expr(toks, pos+1, scope)
        b, pos = eval_expr(toks, pos, scope)
        if b == 0:
            return 0, pos
        return a % b, pos
    if tok == '<':
        a, pos = eval_expr(toks, pos+1, scope)
        b, pos = eval_expr(toks, pos, scope)
        return 1 if a < b else 0, pos
    if tok == '=':
        a, pos = eval_expr(toks, pos+1, scope)
        b, pos = eval_expr(toks, pos, scope)
        return 1 if a == b else 0, pos
    if tok == 'AND':
        a, pos = eval_expr(toks, pos+1, scope)
        b, pos = eval_expr(toks, pos, scope)
        return 1 if (a != 0 and b != 0) else 0, pos
    if tok == 'OR':
        a, pos = eval_expr(toks, pos+1, scope)
        b, pos = eval_expr(toks, pos, scope)
        return 1 if (a != 0 or b != 0) else 0, pos
    if tok == 'MIN':
        a, pos = eval_expr(toks, pos+1, scope)
        b, pos = eval_expr(toks, pos, scope)
        return min(a,b), pos
    if tok == 'MAX':
        a, pos = eval_expr(toks, pos+1, scope)
        b, pos = eval_expr(toks, pos, scope)
        return max(a,b), pos
    if tok == 'POW':
        a, pos = eval_expr(toks, pos+1, scope)
        b, pos = eval_expr(toks, pos, scope)
        if b < 0:
            return 0, pos
        return a**b, pos
    if tok == 'NOT':
        a, pos = eval_expr(toks, pos+1, scope)
        return 1 if a == 0 else 0, pos
    if tok == 'ABS':
        a, pos = eval_expr(toks, pos+1, scope)
        return abs(a), pos
    if tok == 'NEXT':
        name = toks[pos+1]
        val = read_var(name, scope) + 1
        write_var(name, val, scope)
        return val, pos+2
    if tok == 'LEN':
        name = toks[pos+1]
        l = lists_.get(name, [])
        return len(l), pos+2
    if tok == 'AT':
        name = toks[pos+1]
        idx, pos2 = eval_expr(toks, pos+2, scope)
        l = lists_.get(name, [])
        if -len(l) <= idx < len(l):
            return l[idx], pos2
        else:
            return 0, pos2
    if tok == 'CALL':
        fname = toks[pos+1]
        pos2 = pos+2
        proc = procs.get(fname)
        nparams = len(proc.params) if proc else 0
        args = []
        for _ in range(nparams):
            v, pos2 = eval_expr(toks, pos2, scope)
            args.append(v)
        if proc is None:
            return 0, pos2
        return call_proc(proc, args), pos2
    # variable
    return read_var(tok, scope), pos+1

def read_var(name, scope):
    if scope is not None:
        if name in scope.globalnames:
            return globals_.get(name, 0)
        if name in scope.locals:
            return scope.locals[name]
        return globals_.get(name, 0)
    else:
        return globals_.get(name, 0)

def write_var(name, val, scope):
    if scope is not None:
        if name in scope.globalnames:
            globals_[name] = val
        else:
            scope.locals[name] = val
    else:
        globals_[name] = val

def call_proc(proc, args):
    scope = Scope()
    for p, a in zip(proc.params, args):
        scope.locals[p] = a
    try:
        exec_stmts(proc.body, scope)
    except Return as r:
        return r.val
    return 0

def exec_stmts(stmts, scope):
    for s in stmts:
        exec_stmt(s, scope)

def exec_stmt(s, scope):
    kind = s[0]
    if kind == 'DEF':
        _, name, params, body = s
        procs[name] = Proc(params, body)
        return
    if kind == 'REPEAT':
        _, e, body = s
        n, _ = eval_expr(e, 0, scope)
        i = 0
        while i < n:
            try:
                exec_stmts(body, scope)
            except Continue:
                pass
            except Break:
                break
            i += 1
        return
    if kind == 'WHILE':
        _, e, body = s
        while True:
            v, _ = eval_expr(e, 0, scope)
            if v == 0:
                break
            try:
                exec_stmts(body, scope)
            except Continue:
                continue
            except Break:
                break
        return
    if kind == 'IF':
        _, e, then_s, else_s = s
        v, _ = eval_expr(e, 0, scope)
        if v != 0:
            exec_stmts(then_s, scope)
        elif else_s is not None:
            exec_stmts(else_s, scope)
        return
    if kind == 'STMT':
        toks = s[1]
        head = toks[0]
        if head == 'SET':
            name = toks[1]
            val, _ = eval_expr(toks, 2, scope)
            write_var(name, val, scope)
        elif head == 'SETS':
            v = toks[1]
            w = toks[2]
            eval_, pos = eval_expr(toks, 3, scope)
            f_, pos = eval_expr(toks, pos, scope)
            write_var(v, eval_, scope)
            write_var(w, f_, scope)
        elif head == 'PRINT':
            val, _ = eval_expr(toks, 1, scope)
            output.append(val)
        elif head == 'PUSH':
            name = toks[1]
            val, _ = eval_expr(toks, 2, scope)
            lists_.setdefault(name, []).append(val)
        elif head == 'BREAK':
            raise Break()
        elif head == 'CONTINUE':
            raise Continue()
        elif head == 'RET':
            val, _ = eval_expr(toks, 1, scope)
            raise Return(val)
        elif head == 'GLOBAL':
            name = toks[1]
            scope.globalnames.add(name)
            if name in scope.locals:
                del scope.locals[name]
        else:
            raise Exception("unknown stmt " + head)
        return
    raise Exception("bad stmt")

with open(sys.argv[1]) as f:
    lines = tokenize(f.readlines())

stmts = parse_stmts(lines, 0, len(lines))
exec_stmts(stmts, None)
print(' '.join(str(x) for x in output))
