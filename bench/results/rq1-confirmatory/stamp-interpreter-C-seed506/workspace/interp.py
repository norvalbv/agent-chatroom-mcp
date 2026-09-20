import re, sys

with open('program.stamp') as f:
    lines = [ln.split() for ln in f.read().splitlines() if ln.strip()]

NUMRE = re.compile(r'^-?\d+$')

def parse_statements(i, enders):
    stmts = []
    while i < len(lines):
        line = lines[i]
        tok0 = line[0]
        if tok0 in enders:
            return stmts, i
        if tok0 == 'REPEAT':
            body, i2 = parse_statements(i+1, {'END'})
            i2 += 1
            stmts.append(('REPEAT', line[1:], body))
            i = i2
        elif tok0 == 'WHILE':
            body, i2 = parse_statements(i+1, {'END'})
            i2 += 1
            stmts.append(('WHILE', line[1:], body))
            i = i2
        elif tok0 == 'IF':
            body1, i2 = parse_statements(i+1, {'ELSE', 'END'})
            if lines[i2][0] == 'ELSE':
                body2, i3 = parse_statements(i2+1, {'END'})
                i3 += 1
                stmts.append(('IF', line[1:], body1, body2))
                i = i3
            else:
                i2 += 1
                stmts.append(('IF', line[1:], body1, None))
                i = i2
        elif tok0 == 'DEF':
            body, i2 = parse_statements(i+1, {'END'})
            i2 += 1
            stmts.append(('DEF', line[1], line[2:], body))
            i = i2
        elif tok0 == 'BREAK':
            stmts.append(('BREAK',)); i += 1
        elif tok0 == 'CONTINUE':
            stmts.append(('CONTINUE',)); i += 1
        elif tok0 == 'RET':
            stmts.append(('RET', line[1:])); i += 1
        elif tok0 == 'GLOBAL':
            stmts.append(('GLOBAL', line[1])); i += 1
        elif tok0 == 'SET':
            stmts.append(('SET', line[1], line[2:])); i += 1
        elif tok0 == 'SETS':
            stmts.append(('SETS', line[1], line[2], line[3:])); i += 1
        elif tok0 == 'PRINT':
            stmts.append(('PRINT', line[1:])); i += 1
        elif tok0 == 'PUSH':
            stmts.append(('PUSH', line[1], line[2:])); i += 1
        else:
            raise Exception('unknown stmt: ' + ' '.join(line))
    return stmts, i

program, endpos = parse_statements(0, set())
assert endpos == len(lines)

procs = {}
globals_dict = {}
lists = {}
output = []

class BreakExc(Exception): pass
class ContinueExc(Exception): pass
class RetExc(Exception):
    def __init__(self, val):
        self.val = val

class Frame:
    def __init__(self, always_global=False):
        self.always_global = always_global
        self.locals = {}
        self.globals_declared = set()

def read_var(frame, name):
    if frame.always_global or name in frame.globals_declared:
        return globals_dict.get(name, 0)
    if name in frame.locals:
        return frame.locals[name]
    return globals_dict.get(name, 0)

def write_var(frame, name, val):
    if frame.always_global or name in frame.globals_declared:
        globals_dict[name] = val
        return
    frame.locals[name] = val

def next_var(frame, name):
    cur = read_var(frame, name)
    newval = cur + 1
    write_var(frame, name, newval)
    return newval

BIN_OPS = {'+','-','*','/','%','<','=','AND','OR','MIN','MAX','POW'}
UN_OPS = {'NOT','ABS'}

def eval_expr(tokens, pos, frame):
    tok = tokens[pos]; pos += 1
    if NUMRE.match(tok):
        return int(tok), pos
    if tok in BIN_OPS:
        a, pos = eval_expr(tokens, pos, frame)
        b, pos = eval_expr(tokens, pos, frame)
        if tok == '+': return a+b, pos
        if tok == '-': return a-b, pos
        if tok == '*': return a*b, pos
        if tok == '/':
            if b == 0: return 0, pos
            return a // b, pos
        if tok == '%':
            if b == 0: return 0, pos
            return a % b, pos
        if tok == '<': return (1 if a < b else 0), pos
        if tok == '=': return (1 if a == b else 0), pos
        if tok == 'AND': return (1 if (a != 0 and b != 0) else 0), pos
        if tok == 'OR': return (1 if (a != 0 or b != 0) else 0), pos
        if tok == 'MIN': return min(a,b), pos
        if tok == 'MAX': return max(a,b), pos
        if tok == 'POW':
            if b < 0: return 0, pos
            return a ** b, pos
    if tok in UN_OPS:
        a, pos = eval_expr(tokens, pos, frame)
        if tok == 'NOT': return (1 if a == 0 else 0), pos
        if tok == 'ABS': return abs(a), pos
    if tok == 'NEXT':
        name = tokens[pos]; pos += 1
        return next_var(frame, name), pos
    if tok == 'CALL':
        fname = tokens[pos]; pos += 1
        proc = procs.get(fname)
        nparams = len(proc[0]) if proc else 0
        args = []
        for _ in range(nparams):
            v, pos = eval_expr(tokens, pos, frame)
            args.append(v)
        if proc is None:
            return 0, pos
        return call_proc(fname, args), pos
    if tok == 'LEN':
        Lname = tokens[pos]; pos += 1
        return len(lists.get(Lname, [])), pos
    if tok == 'AT':
        Lname = tokens[pos]; pos += 1
        idx, pos = eval_expr(tokens, pos, frame)
        lst = lists.get(Lname, [])
        if -len(lst) <= idx < len(lst):
            return lst[idx], pos
        return 0, pos
    # variable name
    return read_var(frame, tok), pos

def exec_stmts(stmts, frame):
    for s in stmts:
        exec_stmt(s, frame)

def exec_stmt(s, frame):
    kind = s[0]
    if kind == 'SET':
        _, v, etoks = s
        val, _ = eval_expr(etoks, 0, frame)
        write_var(frame, v, val)
    elif kind == 'SETS':
        _, v, w, toks = s
        e_val, pos = eval_expr(toks, 0, frame)
        f_val, pos = eval_expr(toks, pos, frame)
        write_var(frame, v, e_val)
        write_var(frame, w, f_val)
    elif kind == 'PRINT':
        _, etoks = s
        val, _ = eval_expr(etoks, 0, frame)
        output.append(val)
    elif kind == 'PUSH':
        _, L, etoks = s
        val, _ = eval_expr(etoks, 0, frame)
        lists.setdefault(L, []).append(val)
    elif kind == 'REPEAT':
        _, etoks, body = s
        n, _ = eval_expr(etoks, 0, frame)
        i = 0
        while i < n:
            try:
                exec_stmts(body, frame)
            except BreakExc:
                break
            except ContinueExc:
                pass
            i += 1
    elif kind == 'WHILE':
        _, etoks, body = s
        while True:
            cond, _ = eval_expr(etoks, 0, frame)
            if not cond:
                break
            try:
                exec_stmts(body, frame)
            except BreakExc:
                break
            except ContinueExc:
                continue
    elif kind == 'IF':
        _, etoks, body1, body2 = s
        cond, _ = eval_expr(etoks, 0, frame)
        if cond:
            exec_stmts(body1, frame)
        elif body2 is not None:
            exec_stmts(body2, frame)
    elif kind == 'BREAK':
        raise BreakExc()
    elif kind == 'CONTINUE':
        raise ContinueExc()
    elif kind == 'RET':
        _, etoks = s
        val, _ = eval_expr(etoks, 0, frame)
        raise RetExc(val)
    elif kind == 'GLOBAL':
        _, v = s
        frame.globals_declared.add(v)
    elif kind == 'DEF':
        _, fname, params, body = s
        procs[fname] = (params, body)
    else:
        raise Exception('unknown stmt kind ' + kind)

def call_proc(fname, args):
    params, body = procs[fname]
    frame = Frame()
    for p, a in zip(params, args):
        frame.locals[p] = a
    try:
        exec_stmts(body, frame)
    except RetExc as r:
        return r.val
    return 0

top_frame = Frame(always_global=True)
exec_stmts(program, top_frame)

print(' '.join(str(v) for v in output))
