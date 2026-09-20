import sys

def tokenize(lines):
    prog = []
    for line in lines:
        line = line.rstrip('\n')
        toks = line.split()
        if toks:
            prog.append(toks)
    return prog

class Proc:
    def __init__(self, params, body):
        self.params = params
        self.body = body

class BreakExc(Exception): pass
class ContinueExc(Exception): pass
class RetExc(Exception):
    def __init__(self, val): self.val = val

def parse_blocks(lines):
    # returns list of statements as trees, using index pointer
    pos = [0]
    def parse_stmt():
        toks = lines[pos[0]]
        pos[0] += 1
        head = toks[0]
        if head == 'DEF':
            name = toks[1]
            params = toks[2:]
            body = parse_body('END')
            return ('DEF', name, params, body)
        if head == 'REPEAT':
            e = toks[1:]
            body = parse_body('END')
            return ('REPEAT', e, body)
        if head == 'WHILE':
            e = toks[1:]
            body = parse_body('END')
            return ('WHILE', e, body)
        if head == 'IF':
            e = toks[1:]
            body1 = []
            body2 = None
            while True:
                nxt = lines[pos[0]]
                if nxt[0] == 'END':
                    pos[0]+=1
                    break
                if nxt[0] == 'ELSE':
                    pos[0]+=1
                    body2 = []
                    while lines[pos[0]][0] != 'END':
                        body2.append(parse_stmt())
                    pos[0]+=1
                    break
                body1.append(parse_stmt())
            return ('IF', e, body1, body2)
        if head == 'SET':
            return ('SET', toks[1], toks[2:])
        if head == 'SETS':
            return ('SETS', toks[1], toks[2], toks[3:])
        if head == 'PRINT':
            return ('PRINT', toks[1:])
        if head == 'PUSH':
            return ('PUSH', toks[1], toks[2:])
        if head == 'BREAK':
            return ('BREAK',)
        if head == 'CONTINUE':
            return ('CONTINUE',)
        if head == 'RET':
            return ('RET', toks[1:])
        if head == 'GLOBAL':
            return ('GLOBAL', toks[1])
        raise Exception('unknown stmt ' + str(toks))

    def parse_body(end_tok):
        body = []
        while lines[pos[0]][0] != end_tok:
            body.append(parse_stmt())
        pos[0] += 1
        return body

    stmts = []
    while pos[0] < len(lines):
        stmts.append(parse_stmt())
    return stmts

# expression evaluation: tokens list, consume from front, return (value, rest)

def eval_expr_tokens(toks, idx, env, globals_, procs):
    tok = toks[idx]
    idx += 1
    if tok in ('+','-','*','/','%','<','=','AND','OR','MIN','MAX','POW'):
        a, idx = eval_expr_tokens(toks, idx, env, globals_, procs)
        b, idx = eval_expr_tokens(toks, idx, env, globals_, procs)
        if tok=='+': return a+b, idx
        if tok=='-': return a-b, idx
        if tok=='*': return a*b, idx
        if tok=='/':
            if b==0: return 0, idx
            return a // b, idx
        if tok=='%':
            if b==0: return 0, idx
            return a - (a//b)*b, idx
        if tok=='<': return (1 if a<b else 0), idx
        if tok=='=': return (1 if a==b else 0), idx
        if tok=='AND': return (1 if a!=0 and b!=0 else 0), idx
        if tok=='OR': return (1 if a!=0 or b!=0 else 0), idx
        if tok=='MIN': return min(a,b), idx
        if tok=='MAX': return max(a,b), idx
        if tok=='POW':
            if b<0: return 0, idx
            return a**b, idx
    if tok in ('NOT','ABS'):
        a, idx = eval_expr_tokens(toks, idx, env, globals_, procs)
        if tok=='NOT': return (1 if a==0 else 0), idx
        if tok=='ABS': return abs(a), idx
    if tok == 'NEXT':
        name = toks[idx]; idx+=1
        # read current value per scope
        cur = read_var(env, globals_, name)
        newv = cur+1
        write_var(env, globals_, name, newv)
        return newv, idx
    if tok == 'CALL':
        fname = toks[idx]; idx+=1
        proc = procs.get(fname)
        nparams = len(proc.params) if proc else 0
        args = []
        for _ in range(nparams):
            v, idx = eval_expr_tokens(toks, idx, env, globals_, procs)
            args.append(v)
        if proc is None:
            return 0, idx
        return call_proc(proc, args, globals_, procs), idx
    if tok == 'LEN':
        name = toks[idx]; idx+=1
        lst = globals_.setdefault('__list__'+name, [])
        return len(lst), idx
    if tok == 'AT':
        name = toks[idx]; idx+=1
        i, idx = eval_expr_tokens(toks, idx, env, globals_, procs)
        lst = globals_.setdefault('__list__'+name, [])
        n = len(lst)
        if i < 0:
            j = n + i
        else:
            j = i
        if 0 <= j < n:
            return lst[j], idx
        return 0, idx
    # literal or variable
    try:
        val = int(tok)
        return val, idx
    except ValueError:
        return read_var(env, globals_, tok), idx

def read_var(env, globals_, name):
    if env is not None:
        if name in env['globalset']:
            return globals_.get(name, 0)
        if name in env['locals']:
            return env['locals'][name]
        return globals_.get(name, 0)
    else:
        return globals_.get(name, 0)

def write_var(env, globals_, name, value):
    if env is not None:
        if name in env['globalset']:
            globals_[name] = value
        else:
            env['locals'][name] = value
    else:
        globals_[name] = value

def eval_full(toks, env, globals_, procs):
    val, idx = eval_expr_tokens(toks, 0, env, globals_, procs)
    assert idx == len(toks)
    return val

def exec_block(stmts, env, globals_, procs, procs_stack, out):
    for st in stmts:
        exec_stmt(st, env, globals_, procs, out)

def exec_stmt(st, env, globals_, procs, out):
    kind = st[0]
    if kind == 'DEF':
        _, name, params, body = st
        procs[name] = Proc(params, body)
        return
    if kind == 'SET':
        _, v, etoks = st
        val = eval_full(etoks, env, globals_, procs)
        write_var(env, globals_, v, val)
        return
    if kind == 'SETS':
        _, v, w, rest = st
        # rest is tokens for e followed by f, need to split: e is first expr, f is second
        val_e, idx = eval_expr_tokens(rest, 0, env, globals_, procs)
        val_f, idx2 = eval_expr_tokens(rest, idx, env, globals_, procs)
        assert idx2 == len(rest)
        write_var(env, globals_, v, val_e)
        write_var(env, globals_, w, val_f)
        return
    if kind == 'PRINT':
        _, etoks = st
        val = eval_full(etoks, env, globals_, procs)
        out.append(val)
        return
    if kind == 'PUSH':
        _, name, etoks = st
        val = eval_full(etoks, env, globals_, procs)
        lst = globals_.setdefault('__list__'+name, [])
        lst.append(val)
        return
    if kind == 'GLOBAL':
        _, name = st
        env['globalset'].add(name)
        if name in env['locals']:
            del env['locals'][name]
        return
    if kind == 'BREAK':
        raise BreakExc()
    if kind == 'CONTINUE':
        raise ContinueExc()
    if kind == 'RET':
        _, etoks = st
        val = eval_full(etoks, env, globals_, procs)
        raise RetExc(val)
    if kind == 'REPEAT':
        _, etoks, body = st
        n = eval_full(etoks, env, globals_, procs)
        i = 0
        while i < n:
            try:
                exec_block(body, env, globals_, procs, None, out)
            except BreakExc:
                break
            except ContinueExc:
                pass
            i += 1
        return
    if kind == 'WHILE':
        _, etoks, body = st
        while True:
            cond = eval_full(etoks, env, globals_, procs)
            if not cond:
                break
            try:
                exec_block(body, env, globals_, procs, None, out)
            except BreakExc:
                break
            except ContinueExc:
                continue
        return
    if kind == 'IF':
        _, etoks, body1, body2 = st
        cond = eval_full(etoks, env, globals_, procs)
        if cond:
            exec_block(body1, env, globals_, procs, None, out)
        elif body2 is not None:
            exec_block(body2, env, globals_, procs, None, out)
        return
    raise Exception('unknown stmt kind ' + kind)

def call_proc(proc, args, globals_, procs):
    env = {'locals': {}, 'globalset': set()}
    for p, a in zip(proc.params, args):
        env['locals'][p] = a
    out = []  # unused inside call except PRINT goes to global out; fix below
    try:
        exec_block(proc.body, env, globals_, procs, None, GLOBAL_OUT[0])
    except RetExc as r:
        return r.val
    return 0

GLOBAL_OUT = [None]

def main():
    with open('program.stamp') as f:
        lines = f.readlines()
    toks_lines = tokenize(lines)
    stmts = parse_blocks(toks_lines)
    globals_ = {}
    procs = {}
    out = []
    GLOBAL_OUT[0] = out
    env = {'locals': {}, 'globalset': set(globals_.keys())}
    # top-level: treat as globals directly; use env=None semantics but we need GLOBAL stmt only inside proc.
    # Use a top-level env where locals act as globals: simplest -> use env=None and route SET/NEXT to globals_ directly.
    exec_block(stmts, None, globals_, procs, None, out)
    print(' '.join(str(x) for x in out))

if __name__ == '__main__':
    main()
