import sys

def tokenize(line):
    return line.split()

def parse_program(lines):
    return lines

class Proc:
    def __init__(self, params, body):
        self.params = params
        self.body = body

class BreakEx(Exception): pass
class ContinueEx(Exception): pass
class RetEx(Exception):
    def __init__(self, v): self.v = v

globals_ = {}
lists_ = {}
procs = {}

def is_int(tok):
    if tok[0] == '-' and len(tok) > 1:
        return tok[1:].isdigit()
    return tok.isdigit()

def find_matching_end(lines, i):
    depth = 1
    j = i + 1
    while j < len(lines):
        toks = tokenize(lines[j])
        if not toks:
            j += 1
            continue
        head = toks[0]
        if head in ('REPEAT', 'WHILE', 'IF', 'DEF'):
            depth += 1
        elif head == 'END':
            depth -= 1
            if depth == 0:
                return j
        j += 1
    raise Exception("no matching end")

def find_else_end(lines, i):
    # i is IF line; find else index (or None) and end index, at depth 0
    depth = 1
    j = i + 1
    else_idx = None
    while j < len(lines):
        toks = tokenize(lines[j])
        if not toks:
            j += 1
            continue
        head = toks[0]
        if head in ('REPEAT', 'WHILE', 'IF', 'DEF'):
            depth += 1
        elif head == 'END':
            depth -= 1
            if depth == 0:
                return else_idx, j
        elif head == 'ELSE' and depth == 1:
            else_idx = j
        j += 1
    raise Exception("no matching end")

class Interp:
    def __init__(self, lines):
        self.lines = lines
        self.output = []

    def run(self):
        self.exec_block(0, len(self.lines), None)
        return self.output

    def exec_block(self, start, end, scope):
        i = start
        while i < end:
            toks = tokenize(self.lines[i])
            if not toks:
                i += 1
                continue
            head = toks[0]
            if head == 'DEF':
                name = toks[1]
                params = toks[2:]
                j = find_matching_end(self.lines, i)
                procs[name] = Proc(params, (i+1, j))
                i = j + 1
                continue
            if head == 'SET':
                v = toks[1]
                expr_toks = toks[2:]
                val, _ = self.eval_expr(expr_toks, 0, scope)
                self.assign(v, val, scope)
                i += 1
                continue
            if head == 'SETS':
                v = toks[1]
                w = toks[2]
                rest = toks[3:]
                e_val, pos = self.eval_expr(rest, 0, scope)
                f_val, pos = self.eval_expr(rest, pos, scope)
                self.assign(v, e_val, scope)
                self.assign(w, f_val, scope)
                i += 1
                continue
            if head == 'PRINT':
                val, _ = self.eval_expr(toks[1:], 0, scope)
                self.output.append(val)
                i += 1
                continue
            if head == 'PUSH':
                l = toks[1]
                val, _ = self.eval_expr(toks[2:], 0, scope)
                lists_.setdefault(l, []).append(val)
                i += 1
                continue
            if head == 'REPEAT':
                cnt, _ = self.eval_expr(toks[1:], 0, scope)
                j = find_matching_end(self.lines, i)
                body_start, body_end = i+1, j
                n = cnt
                k = 0
                while k < n:
                    k += 1
                    try:
                        self.exec_block(body_start, body_end, scope)
                    except BreakEx:
                        break
                    except ContinueEx:
                        continue
                i = j + 1
                continue
            if head == 'WHILE':
                j = find_matching_end(self.lines, i)
                body_start, body_end = i+1, j
                while True:
                    cnt, _ = self.eval_expr(toks[1:], 0, scope)
                    if not cnt:
                        break
                    try:
                        self.exec_block(body_start, body_end, scope)
                    except BreakEx:
                        break
                    except ContinueEx:
                        continue
                i = j + 1
                continue
            if head == 'IF':
                else_idx, j = find_else_end(self.lines, i)
                cond, _ = self.eval_expr(toks[1:], 0, scope)
                if cond:
                    body_start = i+1
                    body_end = else_idx if else_idx is not None else j
                    self.exec_block(body_start, body_end, scope)
                else:
                    if else_idx is not None:
                        self.exec_block(else_idx+1, j, scope)
                i = j + 1
                continue
            if head == 'BREAK':
                raise BreakEx()
            if head == 'CONTINUE':
                raise ContinueEx()
            if head == 'RET':
                val, _ = self.eval_expr(toks[1:], 0, scope)
                raise RetEx(val)
            if head == 'GLOBAL':
                v = toks[1]
                scope['__global_decl__'].add(v)
                i += 1
                continue
            if head == 'ELSE' or head == 'END':
                i += 1
                continue
            raise Exception("unknown stmt " + head)

    def assign(self, v, val, scope):
        if scope is None:
            globals_[v] = val
            return
        if v in scope['__global_decl__']:
            globals_[v] = val
            return
        scope['locals'][v] = val

    def read_var(self, v, scope):
        if scope is not None:
            if v in scope['__global_decl__']:
                return globals_.get(v, 0)
            if v in scope['locals']:
                return scope['locals'][v]
        return globals_.get(v, 0)

    def next_var(self, v, scope):
        cur = self.read_var(v, scope)
        newv = cur + 1
        self.assign(v, newv, scope)
        return newv

    def eval_expr(self, toks, pos, scope):
        tok = toks[pos]
        if is_int(tok):
            return int(tok), pos+1
        binops = {'+','-','*','/','%','<','=','AND','OR','MIN','MAX','POW'}
        unops = {'NOT','ABS'}
        if tok in binops:
            a, pos = self.eval_expr(toks, pos+1, scope)
            b, pos = self.eval_expr(toks, pos, scope)
            if tok == '+': return a+b, pos
            if tok == '-': return a-b, pos
            if tok == '*': return a*b, pos
            if tok == '/':
                if b == 0: return 0, pos
                return a // b, pos
            if tok == '%':
                if b == 0: return 0, pos
                return a - (a//b)*b, pos
            if tok == '<': return (1 if a < b else 0), pos
            if tok == '=': return (1 if a == b else 0), pos
            if tok == 'AND': return (1 if (a!=0 and b!=0) else 0), pos
            if tok == 'OR': return (1 if (a!=0 or b!=0) else 0), pos
            if tok == 'MIN': return min(a,b), pos
            if tok == 'MAX': return max(a,b), pos
            if tok == 'POW':
                if b < 0: return 0, pos
                return a ** b, pos
        if tok in unops:
            a, pos = self.eval_expr(toks, pos+1, scope)
            if tok == 'NOT': return (1 if a==0 else 0), pos
            if tok == 'ABS': return abs(a), pos
        if tok == 'NEXT':
            v = toks[pos+1]
            return self.next_var(v, scope), pos+2
        if tok == 'LEN':
            l = toks[pos+1]
            return len(lists_.get(l, [])), pos+2
        if tok == 'AT':
            l = toks[pos+1]
            idx, pos2 = self.eval_expr(toks, pos+2, scope)
            arr = lists_.get(l, [])
            n = len(arr)
            real = idx if idx >= 0 else n + idx
            if 0 <= real < n:
                return arr[real], pos2
            return 0, pos2
        if tok == 'CALL':
            fname = toks[pos+1]
            pos = pos+2
            if fname not in procs:
                return 0, pos
            proc = procs[fname]
            nparams = len(proc.params)
            args = []
            for _ in range(nparams):
                v, pos = self.eval_expr(toks, pos, scope)
                args.append(v)
            new_scope = {'locals': {}, '__global_decl__': set()}
            for p, a in zip(proc.params, args):
                new_scope['locals'][p] = a
            try:
                self.exec_block(proc.body[0], proc.body[1], new_scope)
            except RetEx as r:
                return r.v, pos
            return 0, pos
        # variable name
        return self.read_var(tok, scope), pos+1

with open('program.stamp') as f:
    lines = [l.rstrip('\n') for l in f]

interp = Interp(lines)
out = interp.run()
print(' '.join(str(x) for x in out))
