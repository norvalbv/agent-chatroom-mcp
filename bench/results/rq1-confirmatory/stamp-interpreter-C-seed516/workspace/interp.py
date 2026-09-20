import sys

def load(path):
    lines = []
    with open(path) as f:
        for line in f:
            line = line.rstrip('\n')
            if line.strip() == '':
                continue
            toks = line.split(' ')
            lines.append(toks)
    return lines

lines = load('program.stamp')

# parse into block structure: index-based statements list; we'll just run with a program counter over flat lines
# find matching END for blocks by scanning with a stack, building a tree isn't necessary;
# we'll implement a simple recursive-descent parser using an index pointer over tokens list of lines.

class Proc:
    def __init__(self, params, body_start):
        self.params = params
        self.body_start = body_start  # index into lines, first line of body

globals_ = {}
lists_ = {}
procs = {}

output = []

class Ret(Exception):
    def __init__(self, val):
        self.val = val
class Brk(Exception):
    pass
class Cont(Exception):
    pass

def find_matching_end(start):
    # start is index of a line that opens a block (REPEAT/WHILE/IF/DEF), return index of its END
    depth = 1
    i = start + 1
    while i < len(lines):
        head = lines[i][0]
        if head in ('REPEAT', 'WHILE', 'IF', 'DEF'):
            depth += 1
        elif head == 'END':
            depth -= 1
            if depth == 0:
                return i
        i += 1
    raise Exception("no matching end")

def find_else_or_end(start):
    # for IF blocks: find ELSE at same depth (if exists) and END
    depth = 1
    i = start + 1
    else_idx = None
    while i < len(lines):
        head = lines[i][0]
        if head in ('REPEAT', 'WHILE', 'IF', 'DEF'):
            depth += 1
        elif head == 'END':
            depth -= 1
            if depth == 0:
                return else_idx, i
        elif head == 'ELSE' and depth == 1:
            else_idx = i
        i += 1
    raise Exception("no end")

class Scope:
    def __init__(self, parent_globals):
        self.locals = {}
        self.global_names = set()
    def get(self, name):
        if name in self.global_names:
            return globals_.get(name, 0)
        if name in self.locals:
            return self.locals[name]
        return globals_.get(name, 0)
    def set(self, name, val):
        if name in self.global_names:
            globals_[name] = val
        else:
            self.locals[name] = val
    def declare_global(self, name):
        self.global_names.add(name)
    def next(self, name):
        if name in self.global_names:
            newv = globals_.get(name, 0) + 1
            globals_[name] = newv
            return newv
        if name in self.locals:
            newv = self.locals[name] + 1
            self.locals[name] = newv
            return newv
        # create local starting from current read value (global fallback)
        cur = globals_.get(name, 0)
        newv = cur + 1
        self.locals[name] = newv
        return newv

class TopScope:
    # outside any procedure: everything is global
    def get(self, name):
        return globals_.get(name, 0)
    def set(self, name, val):
        globals_[name] = val
    def declare_global(self, name):
        pass
    def next(self, name):
        newv = globals_.get(name, 0) + 1
        globals_[name] = newv
        return newv

def parse_expr(tokens, i):
    tok = tokens[i]
    if tok in ('+', '-', '*', '/', '%', '<', '=', 'AND', 'OR', 'MIN', 'MAX', 'POW'):
        a, i = parse_expr(tokens, i+1)
        b, i = parse_expr(tokens, i)
        return ('op2', tok, a, b), i
    if tok in ('NOT', 'ABS'):
        a, i = parse_expr(tokens, i+1)
        return ('op1', tok, a), i
    if tok == 'NEXT':
        name = tokens[i+1]
        return ('next', name), i+2
    if tok == 'CALL':
        fname = tokens[i+1]
        i2 = i+2
        # need number of params of proc as currently defined; but parsing structure is static;
        # we defer arg count resolution to eval time by parsing variable count based on greedy expr parse
        # Instead: we will parse args lazily at eval time using a token-stream approach.
        return ('call_raw', fname, i2), None  # not used; see eval-time parser below
    if tok == 'LEN':
        name = tokens[i+1]
        return ('len', name), i+2
    if tok == 'AT':
        name = tokens[i+1]
        idxexpr, i2 = parse_expr(tokens, i+2)
        return ('at', name, idxexpr), i2
    # literal or variable
    if tok.lstrip('-').isdigit() and tok != '-':
        return ('lit', int(tok)), i+1
    return ('var', tok), i+1

# Because CALL requires knowing proc arity at parse time (dynamic - depends on current def),
# we'll do a token-stream evaluator instead of building a static AST for expressions.

def eval_expr_stream(tokens, pos, scope):
    tok = tokens[pos]
    if tok in ('+','-','*','/','%','<','=','AND','OR','MIN','MAX','POW'):
        a, pos = eval_expr_stream(tokens, pos+1, scope)
        b, pos = eval_expr_stream(tokens, pos, scope)
        if tok == '+': return a+b, pos
        if tok == '-': return a-b, pos
        if tok == '*': return a*b, pos
        if tok == '/':
            if b == 0: return 0, pos
            return a // b, pos  # python floor div matches floor toward -inf
        if tok == '%':
            if b == 0: return 0, pos
            return a - (a // b) * b, pos
        if tok == '<': return 1 if a < b else 0, pos
        if tok == '=': return 1 if a == b else 0, pos
        if tok == 'AND': return 1 if (a != 0 and b != 0) else 0, pos
        if tok == 'OR': return 1 if (a != 0 or b != 0) else 0, pos
        if tok == 'MIN': return min(a,b), pos
        if tok == 'MAX': return max(a,b), pos
        if tok == 'POW':
            if b < 0: return 0, pos
            return a ** b, pos
    if tok in ('NOT','ABS'):
        a, pos = eval_expr_stream(tokens, pos+1, scope)
        if tok == 'NOT': return (1 if a==0 else 0), pos
        if tok == 'ABS': return abs(a), pos
    if tok == 'NEXT':
        name = tokens[pos+1]
        return scope.next(name), pos+2
    if tok == 'CALL':
        fname = tokens[pos+1]
        pos2 = pos+2
        proc = procs.get(fname)
        if proc is None:
            return 0, pos2
        nargs = len(proc.params)
        args = []
        for _ in range(nargs):
            v, pos2 = eval_expr_stream(tokens, pos2, scope)
            args.append(v)
        result = call_proc(fname, args)
        return result, pos2
    if tok == 'LEN':
        name = tokens[pos+1]
        return len(lists_.get(name, [])), pos+2
    if tok == 'AT':
        name = tokens[pos+1]
        idx, pos2 = eval_expr_stream(tokens, pos+2, scope)
        lst = lists_.get(name, [])
        if idx < 0:
            idx2 = len(lst) + idx
        else:
            idx2 = idx
        if 0 <= idx2 < len(lst):
            return lst[idx2], pos2
        return 0, pos2
    # literal or var
    if tok != '-' and (tok.lstrip('-').isdigit()):
        return int(tok), pos+1
    return scope.get(tok), pos+1

def call_proc(fname, args):
    proc = procs[fname]
    scope = Scope(globals_)
    for p, v in zip(proc.params, args):
        scope.locals[p] = v
    try:
        run_block(proc.body_start, find_matching_end(proc.body_start-1) if False else None, scope, in_proc=True)
    except Ret as r:
        return r.val
    return 0

def run_block(start, end_excl, scope, in_proc=False):
    i = start
    while True:
        if end_excl is not None and i >= end_excl:
            return
        if i >= len(lines):
            return
        toks = lines[i]
        head = toks[0]
        if head == 'END' or head == 'ELSE':
            return
        if head == 'SET':
            name = toks[1]
            val, _ = eval_expr_stream(toks, 2, scope)
            scope.set(name, val)
            i += 1
            continue
        if head == 'SETS':
            v = toks[1]; w = toks[2]
            e_val, pos = eval_expr_stream(toks, 3, scope)
            f_val, pos = eval_expr_stream(toks, pos, scope)
            scope.set(v, e_val)
            scope.set(w, f_val)
            i += 1
            continue
        if head == 'PRINT':
            val, _ = eval_expr_stream(toks, 1, scope)
            output.append(val)
            i += 1
            continue
        if head == 'PUSH':
            name = toks[1]
            val, _ = eval_expr_stream(toks, 2, scope)
            lists_.setdefault(name, []).append(val)
            i += 1
            continue
        if head == 'GLOBAL':
            name = toks[1]
            scope.declare_global(name)
            i += 1
            continue
        if head == 'RET':
            val, _ = eval_expr_stream(toks, 1, scope)
            raise Ret(val)
        if head == 'BREAK':
            raise Brk()
        if head == 'CONTINUE':
            raise Cont()
        if head == 'DEF':
            fname = toks[1]
            params = toks[2:]
            end_idx = find_matching_end(i)
            procs[fname] = Proc(params, i+1)
            i = end_idx + 1
            continue
        if head == 'REPEAT':
            cond_val, _ = eval_expr_stream(toks, 1, scope)
            end_idx = find_matching_end(i)
            body_start = i+1
            for _ in range(max(0, cond_val)):
                try:
                    run_block(body_start, end_idx, scope, in_proc)
                except Brk:
                    break
                except Cont:
                    continue
            i = end_idx + 1
            continue
        if head == 'WHILE':
            end_idx = find_matching_end(i)
            body_start = i+1
            while True:
                cond_val, _ = eval_expr_stream(toks, 1, scope)
                if not cond_val:
                    break
                try:
                    run_block(body_start, end_idx, scope, in_proc)
                except Brk:
                    break
                except Cont:
                    continue
            i = end_idx + 1
            continue
        if head == 'IF':
            cond_val, _ = eval_expr_stream(toks, 1, scope)
            else_idx, end_idx = find_else_or_end(i)
            if cond_val:
                run_block(i+1, else_idx if else_idx is not None else end_idx, scope, in_proc)
            else:
                if else_idx is not None:
                    run_block(else_idx+1, end_idx, scope, in_proc)
            i = end_idx + 1
            continue
        raise Exception("unknown stmt " + head)

scope = TopScope()
run_block(0, None, scope, in_proc=False)
print(' '.join(str(x) for x in output))
