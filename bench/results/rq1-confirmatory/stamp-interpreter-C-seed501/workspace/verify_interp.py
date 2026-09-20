import re, sys

BINOPS = {'+','-','*','/','%','<','=','AND','OR','MIN','MAX','POW'}
UNOPS = {'NOT','ABS'}

class BreakLoop(Exception): pass
class ContinueLoop(Exception): pass
class ReturnValue(Exception):
    def __init__(self, val): self.val = val

procs = {}
globals_ = {}
lists_ = {}
output = []

def apply_binop(op, a, b):
    if op == '+': return a + b
    if op == '-': return a - b
    if op == '*': return a * b
    if op == '/':
        if b == 0: return 0
        return a // b
    if op == '%':
        if b == 0: return 0
        return a - (a // b) * b
    if op == '<': return 1 if a < b else 0
    if op == '=': return 1 if a == b else 0
    if op == 'AND': return 1 if (a != 0 and b != 0) else 0
    if op == 'OR': return 1 if (a != 0 or b != 0) else 0
    if op == 'MIN': return min(a, b)
    if op == 'MAX': return max(a, b)
    if op == 'POW':
        if b < 0: return 0
        return a ** b
    raise ValueError(op)

def apply_unop(op, a):
    if op == 'NOT': return 1 if a == 0 else 0
    if op == 'ABS': return abs(a)
    raise ValueError(op)

LIT_RE = re.compile(r'^-?\d+$')

class TopCtx:
    def read(self, name): return globals_.get(name, 0)
    def write(self, name, val): globals_[name] = val
    def next_var(self, name):
        v = self.read(name) + 1
        self.write(name, v)
        return v
    def declare_global(self, name): pass

class CallCtx:
    def __init__(self):
        self.locals = {}
        self.global_names = set()
    def read(self, name):
        if name in self.global_names:
            return globals_.get(name, 0)
        if name in self.locals:
            return self.locals[name]
        return globals_.get(name, 0)
    def write(self, name, val):
        if name in self.global_names:
            globals_[name] = val
        else:
            self.locals[name] = val
    def next_var(self, name):
        v = self.read(name) + 1
        self.write(name, v)
        return v
    def declare_global(self, name):
        self.global_names.add(name)

def eval_expr(toks, pos, ctx):
    tok = toks[pos]
    if tok in BINOPS:
        a, pos = eval_expr(toks, pos + 1, ctx)
        b, pos = eval_expr(toks, pos, ctx)
        return apply_binop(tok, a, b), pos
    if tok in UNOPS:
        a, pos = eval_expr(toks, pos + 1, ctx)
        return apply_unop(tok, a), pos
    if tok == 'NEXT':
        vname = toks[pos + 1]
        return ctx.next_var(vname), pos + 2
    if tok == 'CALL':
        fname = toks[pos + 1]
        pos += 2
        if fname in procs:
            params, body = procs[fname]
            nargs = len(params)
        else:
            nargs = 0
        args = []
        for _ in range(nargs):
            v, pos = eval_expr(toks, pos, ctx)
            args.append(v)
        if fname in procs:
            result = call_proc(fname, args)
        else:
            result = 0
        return result, pos
    if tok == 'LEN':
        lname = toks[pos + 1]
        return len(lists_.get(lname, [])), pos + 2
    if tok == 'AT':
        lname = toks[pos + 1]
        idxval, pos2 = eval_expr(toks, pos + 2, ctx)
        lst = lists_.get(lname, [])
        n = len(lst)
        i2 = n + idxval if idxval < 0 else idxval
        val = lst[i2] if 0 <= i2 < n else 0
        return val, pos2
    if LIT_RE.match(tok):
        return int(tok), pos + 1
    return ctx.read(tok), pos + 1

def call_proc(fname, args):
    params, body = procs[fname]
    ctx = CallCtx()
    for pname, aval in zip(params, args):
        ctx.locals[pname] = aval
    try:
        exec_block(body, ctx)
    except ReturnValue as rv:
        return rv.val
    return 0

def parse_block(lines, idx, stop_keywords):
    stmts = []
    while idx < len(lines):
        toks = lines[idx]
        head = toks[0]
        if head in stop_keywords:
            return stmts, idx
        if head == 'REPEAT':
            expr_tokens = toks[1:]
            body, idx2 = parse_block(lines, idx + 1, {'END'})
            idx = idx2 + 1
            stmts.append(('REPEAT', expr_tokens, body))
        elif head == 'WHILE':
            expr_tokens = toks[1:]
            body, idx2 = parse_block(lines, idx + 1, {'END'})
            idx = idx2 + 1
            stmts.append(('WHILE', expr_tokens, body))
        elif head == 'IF':
            expr_tokens = toks[1:]
            body, idx2 = parse_block(lines, idx + 1, {'END', 'ELSE'})
            if lines[idx2][0] == 'ELSE':
                else_body, idx3 = parse_block(lines, idx2 + 1, {'END'})
                idx = idx3 + 1
                stmts.append(('IF', expr_tokens, body, else_body))
            else:
                idx = idx2 + 1
                stmts.append(('IF', expr_tokens, body, None))
        elif head == 'DEF':
            fname = toks[1]
            params = toks[2:]
            body, idx2 = parse_block(lines, idx + 1, {'END'})
            idx = idx2 + 1
            stmts.append(('DEF', fname, params, body))
        else:
            stmts.append(('STMT', toks))
            idx += 1
    return stmts, idx

def exec_block(stmts, ctx):
    for s in stmts:
        exec_stmt(s, ctx)

def exec_stmt(stmt, ctx):
    kind = stmt[0]
    if kind == 'REPEAT':
        expr_tokens, body = stmt[1], stmt[2]
        val, _ = eval_expr(expr_tokens, 0, ctx)
        for _ in range(max(0, val)):
            try:
                exec_block(body, ctx)
            except ContinueLoop:
                continue
            except BreakLoop:
                break
    elif kind == 'WHILE':
        expr_tokens, body = stmt[1], stmt[2]
        while True:
            val, _ = eval_expr(expr_tokens, 0, ctx)
            if val == 0:
                break
            try:
                exec_block(body, ctx)
            except ContinueLoop:
                continue
            except BreakLoop:
                break
    elif kind == 'IF':
        expr_tokens, body, else_body = stmt[1], stmt[2], stmt[3]
        val, _ = eval_expr(expr_tokens, 0, ctx)
        if val != 0:
            exec_block(body, ctx)
        elif else_body is not None:
            exec_block(else_body, ctx)
    elif kind == 'DEF':
        fname, params, body = stmt[1], stmt[2], stmt[3]
        procs[fname] = (params, body)
    elif kind == 'STMT':
        toks = stmt[1]
        head = toks[0]
        if head == 'SET':
            vname = toks[1]
            val, _ = eval_expr(toks, 2, ctx)
            ctx.write(vname, val)
        elif head == 'SETS':
            v, w = toks[1], toks[2]
            val_e, pos = eval_expr(toks, 3, ctx)
            val_f, pos = eval_expr(toks, pos, ctx)
            ctx.write(v, val_e)
            ctx.write(w, val_f)
        elif head == 'PRINT':
            val, _ = eval_expr(toks, 1, ctx)
            output.append(val)
        elif head == 'PUSH':
            lname = toks[1]
            val, _ = eval_expr(toks, 2, ctx)
            lists_.setdefault(lname, []).append(val)
        elif head == 'BREAK':
            raise BreakLoop()
        elif head == 'CONTINUE':
            raise ContinueLoop()
        elif head == 'RET':
            val, _ = eval_expr(toks, 1, ctx)
            raise ReturnValue(val)
        elif head == 'GLOBAL':
            vname = toks[1]
            ctx.declare_global(vname)
        else:
            raise ValueError('unknown stmt ' + head)

def main():
    path = sys.argv[1]
    with open(path) as f:
        lines = [line.split() for line in f if line.strip()]
    top_stmts, idx = parse_block(lines, 0, set())
    assert idx == len(lines)
    ctx = TopCtx()
    try:
        exec_block(top_stmts, ctx)
    except ReturnValue:
        pass
    print(' '.join(str(v) for v in output))

if __name__ == '__main__':
    main()
