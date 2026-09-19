import sys

def tokenize(lines):
    toks = []
    for line in lines:
        line = line.strip()
        if not line:
            continue
        toks.append(line.split())
    return toks

def parse_block(lines, i, enders):
    # returns list of statements, next index
    stmts = []
    while i < len(lines):
        line = lines[i]
        head = line[0]
        if head in enders:
            return stmts, i
        if head == 'DEF':
            name = line[1]
            params = line[2:]
            body, j = parse_block(lines, i+1, ('END',))
            stmts.append(('DEF', name, params, body))
            i = j+1
        elif head == 'REPEAT':
            e = line[1:]
            body, j = parse_block(lines, i+1, ('END',))
            stmts.append(('REPEAT', e, body))
            i = j+1
        elif head == 'WHILE':
            e = line[1:]
            body, j = parse_block(lines, i+1, ('END',))
            stmts.append(('WHILE', e, body))
            i = j+1
        elif head == 'IF':
            e = line[1:]
            body1, j = parse_block(lines, i+1, ('END','ELSE'))
            if lines[j][0] == 'ELSE':
                body2, k = parse_block(lines, j+1, ('END',))
                stmts.append(('IF', e, body1, body2))
                i = k+1
            else:
                stmts.append(('IF', e, body1, None))
                i = j+1
        else:
            stmts.append(('STMT', line))
            i += 1
    return stmts, i

class Break(Exception): pass
class Continue(Exception): pass
class Ret(Exception):
    def __init__(self, v): self.v = v

procs = {}
globals_ = {}
lists = {}
output = []

def is_int(tok):
    if tok.lstrip('-').isdigit() and tok not in ('-',):
        return True
    return False

def eval_expr(tokens, idx, scope):
    # returns (value, next_idx)
    tok = tokens[idx]
    if is_int(tok):
        return int(tok), idx+1
    binops2 = {'+','-','*','/','%','<','=','AND','OR','MIN','MAX','POW'}
    unops1 = {'NOT','ABS'}
    if tok in binops2:
        a, idx = eval_expr(tokens, idx+1, scope)
        b, idx = eval_expr(tokens, idx, scope)
        if tok == '+': v = a+b
        elif tok == '-': v = a-b
        elif tok == '*': v = a*b
        elif tok == '/':
            v = 0 if b==0 else a // b
        elif tok == '%':
            v = 0 if b==0 else a - (a//b)*b
        elif tok == '<': v = 1 if a < b else 0
        elif tok == '=': v = 1 if a == b else 0
        elif tok == 'AND': v = 1 if (a!=0 and b!=0) else 0
        elif tok == 'OR': v = 1 if (a!=0 or b!=0) else 0
        elif tok == 'MIN': v = min(a,b)
        elif tok == 'MAX': v = max(a,b)
        elif tok == 'POW':
            v = 0 if b < 0 else (1 if (a==0 and b==0) else a**b)
        return v, idx
    if tok in unops1:
        a, idx = eval_expr(tokens, idx+1, scope)
        if tok == 'NOT': v = 1 if a==0 else 0
        elif tok == 'ABS': v = abs(a)
        return v, idx
    if tok == 'NEXT':
        name = tokens[idx+1]
        newv = read_var(name, scope) + 1
        write_var(name, newv, scope)
        return newv, idx+2
    if tok == 'CALL':
        fname = tokens[idx+1]
        idx2 = idx+2
        if fname not in procs:
            # need to consume correct number of arg expressions? spec says: takes no arguments
            return 0, idx2
        params, body = procs[fname]
        args = []
        for p in params:
            v, idx2 = eval_expr(tokens, idx2, scope)
            args.append(v)
        newscope = {'locals': {}, 'globalset': set()}
        for p,v in zip(params, args):
            newscope['locals'][p] = v
        try:
            exec_block(body, newscope)
        except Ret as r:
            return r.v, idx2
        return 0, idx2
    if tok == 'LEN':
        name = tokens[idx+1]
        lst = lists.get(name, [])
        return len(lst), idx+2
    if tok == 'AT':
        name = tokens[idx+1]
        i, idx2 = eval_expr(tokens, idx+2, scope)
        lst = lists.get(name, [])
        n = len(lst)
        ii = i if i>=0 else n+i
        if 0 <= ii < n:
            return lst[ii], idx2
        return 0, idx2
    # variable name
    return read_var(tok, scope), idx+1

def read_var(name, scope):
    if name in scope['globalset']:
        return globals_.get(name, 0)
    if name in scope['locals']:
        return scope['locals'][name]
    if scope is TOPSCOPE:
        return globals_.get(name, 0)
    return globals_.get(name, 0) if False else globals_.get(name,0) if name in scope['globalset'] else globals_.get(name,0) if scope is TOPSCOPE else globals_.get(name,0) if name in scope.get('_forceglobal_all', set()) else (globals_.get(name,0) if scope.get('_isglobalscopeflag') else globals_.get(name,0))

TOPSCOPE = {'locals': {}, 'globalset': set(), 'top': True}

def read_var(name, scope):
    if scope.get('top'):
        return globals_.get(name, 0)
    if name in scope['globalset']:
        return globals_.get(name, 0)
    if name in scope['locals']:
        return scope['locals'][name]
    return globals_.get(name, 0)

def write_var(name, value, scope):
    if scope.get('top'):
        globals_[name] = value
        return
    if name in scope['globalset']:
        globals_[name] = value
        return
    scope['locals'][name] = value

def exec_block(stmts, scope):
    for st in stmts:
        exec_stmt(st, scope)

def exec_stmt(st, scope):
    kind = st[0]
    if kind == 'DEF':
        _, name, params, body = st
        procs[name] = (params, body)
        return
    if kind == 'REPEAT':
        _, e, body = st
        n, _ = eval_expr(e, 0, scope)
        i = 0
        while i < n:
            i += 1
            try:
                exec_block(body, scope)
            except Break:
                break
            except Continue:
                continue
        return
    if kind == 'WHILE':
        _, e, body = st
        while True:
            v, _ = eval_expr(e, 0, scope)
            if v == 0:
                break
            try:
                exec_block(body, scope)
            except Break:
                break
            except Continue:
                continue
        return
    if kind == 'IF':
        _, e, body1, body2 = st
        v, _ = eval_expr(e, 0, scope)
        if v != 0:
            exec_block(body1, scope)
        elif body2 is not None:
            exec_block(body2, scope)
        return
    if kind == 'STMT':
        line = st[1]
        head = line[0]
        if head == 'SET':
            v = line[1]
            val, _ = eval_expr(line, 2, scope)
            write_var(v, val, scope)
        elif head == 'SETS':
            v = line[1]; w = line[2]
            eexpr_start = 3
            eval1, nexti = eval_expr(line, 3, scope)
            eval2, _ = eval_expr(line, nexti, scope)
            write_var(v, eval1, scope)
            write_var(w, eval2, scope)
        elif head == 'PRINT':
            val, _ = eval_expr(line, 1, scope)
            output.append(val)
        elif head == 'PUSH':
            name = line[1]
            val, _ = eval_expr(line, 2, scope)
            lists.setdefault(name, []).append(val)
        elif head == 'BREAK':
            raise Break()
        elif head == 'CONTINUE':
            raise Continue()
        elif head == 'RET':
            val, _ = eval_expr(line, 1, scope)
            raise Ret(val)
        elif head == 'GLOBAL':
            name = line[1]
            scope['globalset'].add(name)
        else:
            raise Exception('unknown stmt ' + head)

with open('program.stamp') as f:
    lines = tokenize(f.readlines())

stmts, _ = parse_block(lines, 0, ())
exec_block(stmts, TOPSCOPE)

print(' '.join(str(x) for x in output))
