import sys

def tokenize(lines):
    return [line.split() for line in lines]

def parse_blocks(tokens):
    # returns list of statements as nested structures with index pointers into tokens
    pass

class BreakEx(Exception): pass
class ContinueEx(Exception): pass
class RetEx(Exception):
    def __init__(self, val): self.val = val

def load_program(path):
    with open(path) as f:
        lines = [l.rstrip('\n') for l in f if l.strip() != '']
    return [l.split() for l in lines]

lines = load_program(sys.argv[1])

globals_ = {}
procs = {}
lists = {}
output = []

def find_matching_end(i):
    depth = 1
    j = i+1
    while depth > 0:
        t = lines[j][0]
        if t in ('REPEAT','WHILE','IF','DEF'):
            depth += 1
        elif t == 'END':
            depth -= 1
        j += 1
    return j-1  # index of END

def is_int(tok):
    if tok == '-' :
        return False
    if tok[0] == '-' and len(tok) > 1 and tok[1:].isdigit():
        return True
    return tok.isdigit()

class Scope:
    def __init__(self, locals_=None, globals_declared=None):
        self.locals = locals_ if locals_ is not None else {}
        self.globaldecl = globals_declared if globals_declared is not None else set()

def read_var(name, scope):
    if scope is not None and name in scope.globaldecl:
        return globals_.get(name, 0)
    if scope is not None and name in scope.locals:
        return scope.locals[name]
    return globals_.get(name, 0)

def write_var(name, value, scope):
    if scope is None:
        globals_[name] = value
        return
    if name in scope.globaldecl:
        globals_[name] = value
        return
    scope.locals[name] = value

def floordiv(a,b):
    if b == 0:
        return 0
    return a // b

def floormod(a,b):
    if b == 0:
        return 0
    return a % b

def parse_expr(tokens, pos, scope):
    tok = tokens[pos]
    pos += 1
    if tok in ('+','-','*','/','%','<','=','AND','OR','MIN','MAX','POW'):
        a, pos = parse_expr(tokens, pos, scope)
        b, pos = parse_expr(tokens, pos, scope)
        if tok == '+': return a+b, pos
        if tok == '-': return a-b, pos
        if tok == '*': return a*b, pos
        if tok == '/': return floordiv(a,b), pos
        if tok == '%': return floormod(a,b), pos
        if tok == '<': return (1 if a<b else 0), pos
        if tok == '=': return (1 if a==b else 0), pos
        if tok == 'AND': return (1 if (a!=0 and b!=0) else 0), pos
        if tok == 'OR': return (1 if (a!=0 or b!=0) else 0), pos
        if tok == 'MIN': return min(a,b), pos
        if tok == 'MAX': return max(a,b), pos
        if tok == 'POW':
            if b < 0: return 0, pos
            return a**b, pos
    if tok == 'NOT':
        a, pos = parse_expr(tokens, pos, scope)
        return (1 if a==0 else 0), pos
    if tok == 'ABS':
        a, pos = parse_expr(tokens, pos, scope)
        return abs(a), pos
    if tok == 'NEXT':
        vname = tokens[pos]; pos += 1
        cur = read_var(vname, scope)
        newv = cur + 1
        write_var(vname, newv, scope)
        return newv, pos
    if tok == 'LEN':
        lname = tokens[pos]; pos += 1
        l = lists.get(lname, [])
        return len(l), pos
    if tok == 'AT':
        lname = tokens[pos]; pos += 1
        idx, pos = parse_expr(tokens, pos, scope)
        l = lists.get(lname, [])
        n = len(l)
        real = idx if idx >= 0 else n + idx
        if real < 0 or real >= n:
            return 0, pos
        return l[real], pos
    if tok == 'CALL':
        fname = tokens[pos]; pos += 1
        if fname not in procs:
            return 0, pos
        params, body_lines = procs[fname]
        args = []
        for p in params:
            v, pos = parse_expr(tokens, pos, scope)
            args.append(v)
        newscope = Scope(locals_=dict(zip(params, args)))
        try:
            exec_block(body_lines, newscope)
        except RetEx as r:
            return r.val, pos
        return 0, pos
    if is_int(tok):
        return int(tok), pos
    # variable name
    return read_var(tok, scope), pos

def exec_stmt(toks, scope):
    op = toks[0]
    if op == 'SET':
        v = toks[1]
        val, _ = parse_expr(toks, 2, scope)
        write_var(v, val, scope)
    elif op == 'SETS':
        v = toks[1]; w = toks[2]
        val_e, pos = parse_expr(toks, 3, scope)
        val_f, pos = parse_expr(toks, pos, scope)
        write_var(v, val_e, scope)
        write_var(w, val_f, scope)
    elif op == 'PRINT':
        val, _ = parse_expr(toks, 1, scope)
        output.append(val)
    elif op == 'PUSH':
        lname = toks[1]
        val, _ = parse_expr(toks, 2, scope)
        lists.setdefault(lname, []).append(val)
    elif op == 'GLOBAL':
        vname = toks[1]
        scope.globaldecl.add(vname)
        if vname in scope.locals:
            del scope.locals[vname]
    elif op == 'RET':
        val, _ = parse_expr(toks, 1, scope)
        raise RetEx(val)
    elif op == 'BREAK':
        raise BreakEx()
    elif op == 'CONTINUE':
        raise ContinueEx()
    else:
        raise Exception("unknown stmt "+op)

def exec_block(body, scope):
    i = 0
    n = len(body)
    while i < n:
        toks = body[i]
        op = toks[0]
        if op == 'DEF':
            fname = toks[1]
            params = toks[2:]
            end = find_block_end(body, i)
            procs[fname] = (params, body[i+1:end])
            i = end+1
            continue
        if op == 'IF':
            cond, _ = parse_expr(toks, 1, scope)
            end = find_block_end(body, i)
            # find else
            else_idx = find_else(body, i, end)
            if cond != 0:
                if else_idx is not None:
                    exec_block(body[i+1:else_idx], scope)
                else:
                    exec_block(body[i+1:end], scope)
            else:
                if else_idx is not None:
                    exec_block(body[else_idx+1:end], scope)
            i = end+1
            continue
        if op == 'REPEAT':
            cnt, _ = parse_expr(toks, 1, scope)
            end = find_block_end(body, i)
            inner = body[i+1:end]
            try:
                k = 0
                while k < cnt:
                    try:
                        exec_block(inner, scope)
                    except ContinueEx:
                        pass
                    k += 1
            except BreakEx:
                pass
            i = end+1
            continue
        if op == 'WHILE':
            end = find_block_end(body, i)
            inner = body[i+1:end]
            try:
                while True:
                    cond, _ = parse_expr(toks, 1, scope)
                    if cond == 0:
                        break
                    try:
                        exec_block(inner, scope)
                    except ContinueEx:
                        pass
            except BreakEx:
                pass
            i = end+1
            continue
        exec_stmt(toks, scope)
        i += 1

def find_block_end(body, i):
    depth = 1
    j = i+1
    while depth > 0:
        t = body[j][0]
        if t in ('REPEAT','WHILE','IF','DEF'):
            depth += 1
        elif t == 'END':
            depth -= 1
        j += 1
    return j-1

def find_else(body, i, end):
    depth = 0
    j = i+1
    while j < end:
        t = body[j][0]
        if t in ('REPEAT','WHILE','IF','DEF'):
            depth += 1
        elif t == 'END':
            depth -= 1
        elif t == 'ELSE' and depth == 0:
            return j
        j += 1
    return None

exec_block(lines, None)
print(' '.join(str(x) for x in output))
