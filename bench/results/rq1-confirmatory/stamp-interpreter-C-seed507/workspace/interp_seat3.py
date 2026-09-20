import sys

def parse(lines):
    toks = [l.split() for l in lines if l.strip()]
    pos = [0]

    def peek():
        return toks[pos[0]] if pos[0] < len(toks) else None

    def next_line():
        t = toks[pos[0]]
        pos[0] += 1
        return t

    def parse_block(enders):
        stmts = []
        while True:
            t = peek()
            if t is None or t[0] in enders:
                return stmts
            stmts.append(parse_stmt())

    def parse_stmt():
        t = next_line()
        kw = t[0]
        if kw == 'SET':
            return ('SET', t[1], t[2:])
        if kw == 'SETS':
            return ('SETS', t[1], t[2], t[3:])
        if kw == 'PRINT':
            return ('PRINT', t[1:])
        if kw == 'PUSH':
            return ('PUSH', t[1], t[2:])
        if kw == 'REPEAT':
            body = parse_block(('END',))
            next_line()  # consume END
            return ('REPEAT', t[1:], body)
        if kw == 'WHILE':
            body = parse_block(('END',))
            next_line()
            return ('WHILE', t[1:], body)
        if kw == 'IF':
            body1 = parse_block(('END', 'ELSE'))
            nt = peek()
            if nt and nt[0] == 'ELSE':
                next_line()
                body2 = parse_block(('END',))
                next_line()
                return ('IF', t[1:], body1, body2)
            else:
                next_line()
                return ('IF', t[1:], body1, None)
        if kw == 'BREAK':
            return ('BREAK',)
        if kw == 'CONTINUE':
            return ('CONTINUE',)
        if kw == 'DEF':
            name = t[1]
            params = t[2:]
            body = parse_block(('END',))
            next_line()
            return ('DEF', name, params, body)
        if kw == 'RET':
            return ('RET', t[1:])
        if kw == 'GLOBAL':
            return ('GLOBAL', t[1])
        raise Exception("unknown stmt " + kw)

    prog = parse_block(())
    return prog


class Break(Exception): pass
class Continue(Exception): pass
class Ret(Exception):
    def __init__(self, v):
        self.v = v

globals_ = {}
lists_ = {}
procs = {}
output = []

def is_int_lit(tok):
    if tok[0] == '-' and len(tok) > 1:
        return tok[1:].isdigit()
    return tok.isdigit()

def eval_tokens(tokens, idx, scope, globalset):
    # returns (value, next_idx)
    tok = tokens[idx]
    idx += 1
    if is_int_lit(tok):
        return int(tok), idx
    binops2 = {'+', '-', '*', '/', '%', '<', '=', 'AND', 'OR', 'MIN', 'MAX', 'POW'}
    unops1 = {'NOT', 'ABS'}
    if tok in binops2:
        a, idx = eval_tokens(tokens, idx, scope, globalset)
        b, idx = eval_tokens(tokens, idx, scope, globalset)
        if tok == '+': return a + b, idx
        if tok == '-': return a - b, idx
        if tok == '*': return a * b, idx
        if tok == '/':
            if b == 0: return 0, idx
            return a // b, idx
        if tok == '%':
            if b == 0: return 0, idx
            return a - (a // b) * b, idx
        if tok == '<': return 1 if a < b else 0, idx
        if tok == '=': return 1 if a == b else 0, idx
        if tok == 'AND': return 1 if (a != 0 and b != 0) else 0, idx
        if tok == 'OR': return 1 if (a != 0 or b != 0) else 0, idx
        if tok == 'MIN': return min(a, b), idx
        if tok == 'MAX': return max(a, b), idx
        if tok == 'POW':
            if b < 0: return 0, idx
            return a ** b, idx
    if tok in unops1:
        a, idx = eval_tokens(tokens, idx, scope, globalset)
        if tok == 'NOT': return (1 if a == 0 else 0), idx
        if tok == 'ABS': return abs(a), idx
    if tok == 'NEXT':
        v = tokens[idx]; idx += 1
        newval = do_next(v, scope, globalset)
        return newval, idx
    if tok == 'LEN':
        L = tokens[idx]; idx += 1
        lst = lists_.get(L, [])
        return len(lst), idx
    if tok == 'AT':
        L = tokens[idx]; idx += 1
        i, idx = eval_tokens(tokens, idx, scope, globalset)
        lst = lists_.get(L, [])
        n = len(lst)
        actual = i if i >= 0 else n + i
        if 0 <= actual < n:
            return lst[actual], idx
        return 0, idx
    if tok == 'CALL':
        f = tokens[idx]; idx += 1
        if f not in procs:
            # need to know arity: none if undefined
            return 0, idx
        params, body = procs[f]
        args = []
        for p in params:
            v, idx = eval_tokens(tokens, idx, scope, globalset)
            args.append(v)
        newscope = {}
        newglobalset = set()
        for pname, aval in zip(params, args):
            newscope[pname] = aval
        try:
            exec_block(body, newscope, newglobalset)
        except Ret as r:
            return r.v, idx
        return 0, idx
    # variable name
    return read_var(tok, scope, globalset), idx


def read_var(name, scope, globalset):
    if name in globalset:
        return globals_.get(name, 0)
    if scope is not None and name in scope:
        return scope[name]
    return globals_.get(name, 0)


def write_var(name, val, scope, globalset):
    if name in globalset:
        globals_[name] = val
        return
    if scope is None:
        globals_[name] = val
        return
    scope[name] = val


def do_next(name, scope, globalset):
    cur = read_var(name, scope, globalset)
    newval = cur + 1
    write_var(name, newval, scope, globalset)
    return newval


def eval_expr(tokens, scope, globalset):
    v, idx = eval_tokens(tokens, 0, scope, globalset)
    assert idx == len(tokens), f"leftover tokens {tokens[idx:]}"
    return v


def exec_block(stmts, scope, globalset):
    i = 0
    while i < len(stmts):
        st = stmts[i]
        exec_stmt(st, scope, globalset)
        i += 1


def exec_stmt(st, scope, globalset):
    kind = st[0]
    if kind == 'SET':
        _, v, e = st
        val = eval_expr(e, scope, globalset)
        write_var(v, val, scope, globalset)
    elif kind == 'SETS':
        _, v, w, rest = st
        # rest = e_tokens f_tokens ; need to split: e is expr, f is expr
        # We know both are single-token-or-nested; use eval_tokens sequentially
        eval_, idx = eval_tokens(rest, 0, scope, globalset)
        fval, idx2 = eval_tokens(rest, idx, scope, globalset)
        assert idx2 == len(rest)
        write_var(v, eval_, scope, globalset)
        write_var(w, fval, scope, globalset)
    elif kind == 'PRINT':
        _, e = st
        val = eval_expr(e, scope, globalset)
        output.append(val)
    elif kind == 'PUSH':
        _, L, e = st
        val = eval_expr(e, scope, globalset)
        lists_.setdefault(L, []).append(val)
    elif kind == 'REPEAT':
        _, e, body = st
        n = eval_expr(e, scope, globalset)
        for _ in range(max(0, n)):
            try:
                exec_block(body, scope, globalset)
            except Break:
                break
            except Continue:
                continue
    elif kind == 'WHILE':
        _, e, body = st
        while True:
            c = eval_expr(e, scope, globalset)
            if c == 0:
                break
            try:
                exec_block(body, scope, globalset)
            except Break:
                break
            except Continue:
                continue
    elif kind == 'IF':
        _, e, body1, body2 = st
        c = eval_expr(e, scope, globalset)
        if c != 0:
            exec_block(body1, scope, globalset)
        elif body2 is not None:
            exec_block(body2, scope, globalset)
    elif kind == 'BREAK':
        raise Break()
    elif kind == 'CONTINUE':
        raise Continue()
    elif kind == 'DEF':
        _, name, params, body = st
        procs[name] = (params, body)
    elif kind == 'RET':
        _, e = st
        val = eval_expr(e, scope, globalset)
        raise Ret(val)
    elif kind == 'GLOBAL':
        _, v = st
        globalset.add(v)
    else:
        raise Exception("unhandled " + kind)


with open('program.stamp') as f:
    lines = f.readlines()

prog = parse(lines)
exec_block(prog, None, set())
print(' '.join(str(x) for x in output))
