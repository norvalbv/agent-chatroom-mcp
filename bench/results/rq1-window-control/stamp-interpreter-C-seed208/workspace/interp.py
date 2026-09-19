import sys

def tokenize(line):
    return line.split()

def parse_lines(path):
    with open(path) as f:
        return [line.rstrip('\n') for line in f if line.strip() != '']

class Proc:
    def __init__(self, params, body):
        self.params = params
        self.body = body

class Ret(Exception):
    def __init__(self, val):
        self.val = val

class Brk(Exception):
    pass

class Cont(Exception):
    pass

globals_ = {}
lists_ = {}
procs = {}
output = []

def is_int_literal(tok):
    if tok == '-' or tok == '':
        return False
    if tok[0] == '-':
        return tok[1:].isdigit() and len(tok) > 1
    return tok.isdigit()

class Frame:
    def __init__(self):
        self.locals = {}
        self.globalset = set()

def read_name(frame, name):
    if frame is None:
        return globals_.get(name, 0)
    if name in frame.globalset:
        return globals_.get(name, 0)
    if name in frame.locals:
        return frame.locals[name]
    return globals_.get(name, 0)

def write_name(frame, name, val):
    if frame is None:
        globals_[name] = val
        return
    if name in frame.globalset:
        globals_[name] = val
        return
    frame.locals[name] = val

def next_name(frame, name):
    cur = read_name(frame, name)
    newv = cur + 1
    write_name(frame, name, newv)
    return newv

# tokens are pre-split lines; we need an expression parser working on a token stream (list), consuming tokens.

class TokStream:
    def __init__(self, toks):
        self.toks = toks
        self.i = 0
    def next(self):
        t = self.toks[self.i]
        self.i += 1
        return t
    def peek(self):
        return self.toks[self.i]
    def done(self):
        return self.i >= len(self.toks)

BINOPS = {'+','-','*','/','%','<','=','AND','OR','MIN','MAX','POW'}
UNOPS = {'NOT','ABS'}

def eval_expr(ts, frame):
    tok = ts.next()
    if tok in BINOPS:
        a = eval_expr(ts, frame)
        b = eval_expr(ts, frame)
        if tok == '+': return a+b
        if tok == '-': return a-b
        if tok == '*': return a*b
        if tok == '/':
            if b == 0: return 0
            return a // b  # floor div, python already floors
        if tok == '%':
            if b == 0: return 0
            return a - (a // b) * b
        if tok == '<': return 1 if a < b else 0
        if tok == '=': return 1 if a == b else 0
        if tok == 'AND': return 1 if (a != 0 and b != 0) else 0
        if tok == 'OR': return 1 if (a != 0 or b != 0) else 0
        if tok == 'MIN': return min(a,b)
        if tok == 'MAX': return max(a,b)
        if tok == 'POW':
            if b < 0: return 0
            return a ** b
    if tok in UNOPS:
        a = eval_expr(ts, frame)
        if tok == 'NOT': return 1 if a == 0 else 0
        if tok == 'ABS': return abs(a)
    if tok == 'NEXT':
        v = ts.next()
        return next_name(frame, v)
    if tok == 'CALL':
        fname = ts.next()
        proc = procs.get(fname)
        if proc is None:
            # takes no arguments, yields 0. But we must not consume argument tokens since
            # we don't know how many - spec says a call to undefined name takes no args.
            return 0
        nargs = len(proc.params)
        args = [eval_expr(ts, frame) for _ in range(nargs)]
        return call_proc(fname, args)
    if tok == 'LEN':
        L = ts.next()
        return len(lists_.get(L, []))
    if tok == 'AT':
        L = ts.next()
        idx = eval_expr(ts, frame)
        lst = lists_.get(L, [])
        n = len(lst)
        real = idx if idx >= 0 else n + idx
        if real < 0 or real >= n:
            return 0
        return lst[real]
    if is_int_literal(tok):
        return int(tok)
    # variable name
    return read_name(frame, tok)

def find_matching_end(lines, start):
    depth = 1
    i = start + 1
    while i < len(lines):
        toks = tokenize(lines[i])
        head = toks[0] if toks else ''
        if head in ('REPEAT','WHILE','IF','DEF'):
            depth += 1
        elif head == 'END':
            depth -= 1
            if depth == 0:
                return i
        i += 1
    raise Exception('no matching end')

def find_else(lines, start, end):
    depth = 0
    i = start + 1
    while i < end:
        toks = tokenize(lines[i])
        head = toks[0] if toks else ''
        if head in ('REPEAT','WHILE','IF','DEF'):
            depth += 1
        elif head == 'END':
            depth -= 1
        elif head == 'ELSE' and depth == 0:
            return i
        i += 1
    return None

# Pre-scan procedure defs is dynamic (defined when DEF reached), so we execute sequentially.

def exec_block(lines, start, end, frame):
    """Execute statements from index start to end (exclusive of end). Returns nothing; may raise Ret/Brk/Cont."""
    i = start
    while i < end:
        toks = tokenize(lines[i])
        head = toks[0]
        if head == 'SET':
            v = toks[1]
            ts = TokStream(toks[2:])
            val = eval_expr(ts, frame)
            write_name(frame, v, val)
        elif head == 'SETS':
            v = toks[1]; w = toks[2]
            ts = TokStream(toks[3:])
            e = eval_expr(ts, frame)
            f = eval_expr(ts, frame)
            write_name(frame, v, e)
            write_name(frame, w, f)
        elif head == 'PRINT':
            ts = TokStream(toks[1:])
            val = eval_expr(ts, frame)
            output.append(val)
        elif head == 'PUSH':
            L = toks[1]
            ts = TokStream(toks[2:])
            val = eval_expr(ts, frame)
            lists_.setdefault(L, []).append(val)
        elif head == 'GLOBAL':
            v = toks[1]
            frame.globalset.add(v)
            if v in frame.locals:
                del frame.locals[v]
        elif head == 'RET':
            ts = TokStream(toks[1:])
            val = eval_expr(ts, frame)
            raise Ret(val)
        elif head == 'BREAK':
            raise Brk()
        elif head == 'CONTINUE':
            raise Cont()
        elif head == 'DEF':
            fname = toks[1]
            params = toks[2:]
            end_i = find_matching_end(lines, i)
            procs[fname] = Proc(params, (i+1, end_i))
            i = end_i
        elif head == 'REPEAT':
            ts = TokStream(toks[1:])
            n = eval_expr(ts, frame)
            end_i = find_matching_end(lines, i)
            body_start, body_end = i+1, end_i
            for _ in range(max(0,n)):
                try:
                    exec_block(lines, body_start, body_end, frame)
                except Brk:
                    break
                except Cont:
                    continue
            i = end_i
        elif head == 'WHILE':
            end_i = find_matching_end(lines, i)
            body_start, body_end = i+1, end_i
            while True:
                ts = TokStream(toks[1:])
                cond = eval_expr(ts, frame)
                if cond == 0:
                    break
                try:
                    exec_block(lines, body_start, body_end, frame)
                except Brk:
                    break
                except Cont:
                    continue
            i = end_i
        elif head == 'IF':
            end_i = find_matching_end(lines, i)
            else_i = find_else(lines, i, end_i)
            ts = TokStream(toks[1:])
            cond = eval_expr(ts, frame)
            if cond != 0:
                exec_block(lines, i+1, else_i if else_i is not None else end_i, frame)
            else:
                if else_i is not None:
                    exec_block(lines, else_i+1, end_i, frame)
            i = end_i
        else:
            raise Exception('unknown stmt ' + head)
        i += 1

def call_proc(fname, args):
    proc = procs[fname]
    frame = Frame()
    for p, a in zip(proc.params, args):
        frame.locals[p] = a
    start, end = proc.body
    try:
        exec_block(lines, start, end, frame)
    except Ret as r:
        return r.val
    return 0

lines = parse_lines(sys.argv[1])
top_frame = None
exec_block(lines, 0, len(lines), None)
print(' '.join(str(x) for x in output))
