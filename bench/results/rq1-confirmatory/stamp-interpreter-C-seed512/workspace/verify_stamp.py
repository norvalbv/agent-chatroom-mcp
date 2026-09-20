import sys

def tokenize_lines(path):
    lines = []
    with open(path) as f:
        for raw in f:
            raw = raw.strip()
            if not raw:
                continue
            lines.append(raw.split(' '))
    return lines

BINOPS = {'+', '-', '*', '/', '%', '<', '=', 'AND', 'OR', 'MIN', 'MAX', 'POW'}
UNOPS = {'NOT', 'ABS'}

class Proc:
    def __init__(self, params, body):
        self.params = params
        self.body = body

class RetSignal(Exception):
    def __init__(self, value):
        self.value = value

class BreakSignal(Exception):
    pass

class ContinueSignal(Exception):
    pass

class Frame:
    def __init__(self):
        self.locals = {}
        self.globals_declared = set()

globals_env = {}
lists_env = {}
procs = {}
output = []

def read_var(name, frame):
    if frame is not None:
        if name in frame.globals_declared:
            return globals_env.get(name, 0)
        if name in frame.locals:
            return frame.locals[name]
        return globals_env.get(name, 0)
    return globals_env.get(name, 0)

def write_var(name, value, frame):
    if frame is not None:
        if name in frame.globals_declared:
            globals_env[name] = value
            return
        frame.locals[name] = value
        return
    globals_env[name] = value

def floordiv(a, b):
    if b == 0:
        return 0
    return a // b

def mod(a, b):
    if b == 0:
        return 0
    return a - floordiv(a, b) * b

class TokStream:
    def __init__(self, toks, i=0):
        self.toks = toks
        self.i = i
    def next(self):
        t = self.toks[self.i]
        self.i += 1
        return t

def eval_expr(ts, frame):
    t = ts.next()
    if t == 'NEXT':
        v = ts.next()
        cur = read_var(v, frame)
        newval = cur + 1
        write_var(v, newval, frame)
        return newval
    if t == 'CALL':
        fname = ts.next()
        proc = procs.get(fname)
        if proc is None:
            return 0
        args = []
        for p in proc.params:
            args.append(eval_expr(ts, frame))
        newframe = Frame()
        for pname, aval in zip(proc.params, args):
            newframe.locals[pname] = aval
        try:
            exec_block(proc.body, newframe)
        except RetSignal as r:
            return r.value
        return 0
    if t == 'LEN':
        lname = ts.next()
        lst = lists_env.get(lname, [])
        return len(lst)
    if t == 'AT':
        lname = ts.next()
        idx = eval_expr(ts, frame)
        lst = lists_env.get(lname, [])
        n = len(lst)
        realidx = idx if idx >= 0 else n + idx
        if 0 <= realidx < n:
            return lst[realidx]
        return 0
    if t in UNOPS:
        a = eval_expr(ts, frame)
        if t == 'NOT':
            return 1 if a == 0 else 0
        if t == 'ABS':
            return abs(a)
    if t in BINOPS:
        a = eval_expr(ts, frame)
        b = eval_expr(ts, frame)
        if t == '+':
            return a + b
        if t == '-':
            return a - b
        if t == '*':
            return a * b
        if t == '/':
            return floordiv(a, b)
        if t == '%':
            return mod(a, b)
        if t == '<':
            return 1 if a < b else 0
        if t == '=':
            return 1 if a == b else 0
        if t == 'AND':
            return 1 if (a != 0 and b != 0) else 0
        if t == 'OR':
            return 1 if (a != 0 or b != 0) else 0
        if t == 'MIN':
            return min(a, b)
        if t == 'MAX':
            return max(a, b)
        if t == 'POW':
            if b < 0:
                return 0
            return a ** b
    # literal or variable
    try:
        return int(t)
    except ValueError:
        return read_var(t, frame)

def parse_blocks(lines):
    # returns list of statement dicts, consuming from index 0 to matching END/top
    pos = [0]
    def parse_seq(stop_words):
        stmts = []
        while pos[0] < len(lines):
            toks = lines[pos[0]]
            head = toks[0]
            if head in stop_words:
                return stmts
            stmts.append(parse_one())
        return stmts
    def parse_one():
        toks = lines[pos[0]]
        head = toks[0]
        if head == 'DEF':
            name = toks[1]
            params = toks[2:]
            pos[0] += 1
            body = parse_seq({'END'})
            pos[0] += 1  # consume END
            return ('DEF', name, params, body)
        if head == 'REPEAT':
            expr_toks = toks[1:]
            pos[0] += 1
            body = parse_seq({'END'})
            pos[0] += 1
            return ('REPEAT', expr_toks, body)
        if head == 'WHILE':
            expr_toks = toks[1:]
            pos[0] += 1
            body = parse_seq({'END'})
            pos[0] += 1
            return ('WHILE', expr_toks, body)
        if head == 'IF':
            expr_toks = toks[1:]
            pos[0] += 1
            body = parse_seq({'END', 'ELSE'})
            elsebody = []
            if lines[pos[0]][0] == 'ELSE':
                pos[0] += 1
                elsebody = parse_seq({'END'})
            pos[0] += 1  # consume END
            return ('IF', expr_toks, body, elsebody)
        if head == 'SET':
            v = toks[1]
            expr_toks = toks[2:]
            pos[0] += 1
            return ('SET', v, expr_toks)
        if head == 'SETS':
            v = toks[1]
            w = toks[2]
            rest = toks[3:]
            pos[0] += 1
            return ('SETS', v, w, rest)
        if head == 'PRINT':
            expr_toks = toks[1:]
            pos[0] += 1
            return ('PRINT', expr_toks)
        if head == 'PUSH':
            lname = toks[1]
            expr_toks = toks[2:]
            pos[0] += 1
            return ('PUSH', lname, expr_toks)
        if head == 'BREAK':
            pos[0] += 1
            return ('BREAK',)
        if head == 'CONTINUE':
            pos[0] += 1
            return ('CONTINUE',)
        if head == 'RET':
            expr_toks = toks[1:]
            pos[0] += 1
            return ('RET', expr_toks)
        if head == 'GLOBAL':
            v = toks[1]
            pos[0] += 1
            return ('GLOBAL', v)
        raise Exception('unknown stmt ' + head)
    stmts = parse_seq(set())
    return stmts

def split_expr_full(toks):
    return toks

def exec_block(stmts, frame):
    for st in stmts:
        exec_stmt(st, frame)

def exec_stmt(st, frame):
    kind = st[0]
    if kind == 'DEF':
        _, name, params, body = st
        procs[name] = Proc(params, body)
        return
    if kind == 'SET':
        _, v, expr_toks = st
        ts = TokStream(expr_toks)
        val = eval_expr(ts, frame)
        write_var(v, val, frame)
        return
    if kind == 'SETS':
        _, v, w, toks = st
        ts = TokStream(toks)
        eval_val = eval_expr(ts, frame)
        fval = eval_expr(ts, frame)
        write_var(v, eval_val, frame)
        write_var(w, fval, frame)
        return
    if kind == 'PRINT':
        _, expr_toks = st
        ts = TokStream(expr_toks)
        val = eval_expr(ts, frame)
        output.append(val)
        return
    if kind == 'PUSH':
        _, lname, expr_toks = st
        ts = TokStream(expr_toks)
        val = eval_expr(ts, frame)
        lists_env.setdefault(lname, []).append(val)
        return
    if kind == 'GLOBAL':
        _, v = st
        frame.globals_declared.add(v)
        return
    if kind == 'RET':
        _, expr_toks = st
        ts = TokStream(expr_toks)
        val = eval_expr(ts, frame)
        raise RetSignal(val)
    if kind == 'BREAK':
        raise BreakSignal()
    if kind == 'CONTINUE':
        raise ContinueSignal()
    if kind == 'REPEAT':
        _, expr_toks, body = st
        ts = TokStream(expr_toks)
        n = eval_expr(ts, frame)
        i = 0
        while i < n:
            i += 1
            try:
                exec_block(body, frame)
            except BreakSignal:
                break
            except ContinueSignal:
                continue
        return
    if kind == 'WHILE':
        _, expr_toks, body = st
        while True:
            ts = TokStream(expr_toks)
            cond = eval_expr(ts, frame)
            if cond == 0:
                break
            try:
                exec_block(body, frame)
            except BreakSignal:
                break
            except ContinueSignal:
                continue
        return
    if kind == 'IF':
        _, expr_toks, body, elsebody = st
        ts = TokStream(expr_toks)
        cond = eval_expr(ts, frame)
        if cond != 0:
            exec_block(body, frame)
        else:
            exec_block(elsebody, frame)
        return
    raise Exception('unknown exec ' + kind)

def main():
    lines = tokenize_lines('program.stamp')
    stmts = parse_blocks(lines)
    exec_block(stmts, None)
    print(' '.join(str(x) for x in output))

if __name__ == '__main__':
    main()
