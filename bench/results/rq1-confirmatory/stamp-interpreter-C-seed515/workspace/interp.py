import sys

def tokenize_lines(path):
    lines = []
    with open(path) as f:
        for raw in f:
            toks = raw.split()
            if toks:
                lines.append(toks)
    return lines

BINOPS = {'+','-','*','/','%','<','=','AND','OR','MIN','MAX','POW'}
UNOPS = {'NOT','ABS'}

class Proc:
    def __init__(self, params, body):
        self.params = params
        self.body = body

class BreakExc(Exception): pass
class ContinueExc(Exception): pass
class RetExc(Exception):
    def __init__(self, val): self.val = val

class Interp:
    def __init__(self, lines):
        self.lines = lines
        self.globals = {}
        self.lists = {}
        self.procs = {}
        self.output = []

    def get_var(self, scope, globalset, name):
        if globalset is not None and name in globalset:
            return self.globals.get(name, 0)
        if scope is not None and name in scope:
            return scope[name]
        return self.globals.get(name, 0)

    def set_var(self, scope, globalset, name, val):
        if scope is None:
            self.globals[name] = val
            return
        if name in globalset:
            self.globals[name] = val
        else:
            scope[name] = val

    def eval_expr(self, toks, pos, scope, globalset):
        tok = toks[pos]
        if tok == 'NEXT':
            name = toks[pos+1]
            if globalset is not None and name in globalset:
                cur = self.globals.get(name,0)
                self.globals[name] = cur+1
                return self.globals[name], pos+2
            elif scope is not None:
                cur = self.get_var(scope, globalset, name)
                scope[name] = cur+1
                return scope[name], pos+2
            else:
                cur = self.globals.get(name,0)
                self.globals[name] = cur+1
                return self.globals[name], pos+2
        if tok == 'CALL':
            fname = toks[pos+1]
            p = pos+2
            if fname in self.procs:
                proc = self.procs[fname]
                nargs = len(proc.params)
                args = []
                for _ in range(nargs):
                    v, p = self.eval_expr(toks, p, scope, globalset)
                    args.append(v)
                result = self.call_proc(fname, args)
                return result, p
            else:
                # no args consumed for undefined proc call per spec (takes no arguments)
                return 0, p
        if tok == 'LEN':
            name = toks[pos+1]
            lst = self.lists.get(name, [])
            return len(lst), pos+2
        if tok == 'AT':
            name = toks[pos+1]
            v, p = self.eval_expr(toks, pos+2, scope, globalset)
            lst = self.lists.get(name, [])
            idx = v
            if idx < 0:
                idx = len(lst) + idx
            if idx < 0 or idx >= len(lst):
                return 0, p
            return lst[idx], p
        if tok in UNOPS:
            v, p = self.eval_expr(toks, pos+1, scope, globalset)
            if tok == 'NOT':
                return (1 if v==0 else 0), p
            if tok == 'ABS':
                return abs(v), p
        if tok in BINOPS:
            a, p = self.eval_expr(toks, pos+1, scope, globalset)
            b, p = self.eval_expr(toks, p, scope, globalset)
            if tok == '+': return a+b, p
            if tok == '-': return a-b, p
            if tok == '*': return a*b, p
            if tok == '/':
                if b == 0: return 0, p
                return a // b, p
            if tok == '%':
                if b == 0: return 0, p
                return a - (a//b)*b, p
            if tok == '<': return (1 if a<b else 0), p
            if tok == '=': return (1 if a==b else 0), p
            if tok == 'AND': return (1 if (a!=0 and b!=0) else 0), p
            if tok == 'OR': return (1 if (a!=0 or b!=0) else 0), p
            if tok == 'MIN': return min(a,b), p
            if tok == 'MAX': return max(a,b), p
            if tok == 'POW':
                if b < 0: return 0, p
                return a**b, p
        # literal or variable
        try:
            val = int(tok)
            return val, pos+1
        except ValueError:
            return self.get_var(scope, globalset, tok), pos+1

    def find_matching_end(self, idx):
        depth = 1
        i = idx+1
        while i < len(self.lines):
            head = self.lines[i][0]
            if head in ('REPEAT','WHILE','IF','DEF'):
                depth += 1
            elif head == 'END':
                depth -= 1
                if depth == 0:
                    return i
            i += 1
        raise Exception("no matching end")

    def find_else_or_end(self, idx):
        depth = 1
        i = idx+1
        while i < len(self.lines):
            head = self.lines[i][0]
            if head in ('REPEAT','WHILE','IF','DEF'):
                depth += 1
            elif head == 'END':
                depth -= 1
                if depth == 0:
                    return ('end', i)
            elif head == 'ELSE' and depth == 1:
                return ('else', i)
            i += 1
        raise Exception("no matching end")

    def run_block(self, start, end, scope, globalset):
        # executes lines[start:end] (end exclusive), returns None normally
        i = start
        while i < end:
            line = self.lines[i]
            head = line[0]
            if head == 'SET':
                name = line[1]
                v, _ = self.eval_expr(line, 2, scope, globalset)
                self.set_var(scope, globalset, name, v)
                i += 1
            elif head == 'SETS':
                v_name = line[1]; w_name = line[2]
                e_val, p = self.eval_expr(line, 3, scope, globalset)
                f_val, p = self.eval_expr(line, p, scope, globalset)
                self.set_var(scope, globalset, v_name, e_val)
                self.set_var(scope, globalset, w_name, f_val)
                i += 1
            elif head == 'PRINT':
                v, _ = self.eval_expr(line, 1, scope, globalset)
                self.output.append(v)
                i += 1
            elif head == 'PUSH':
                name = line[1]
                v, _ = self.eval_expr(line, 2, scope, globalset)
                self.lists.setdefault(name, []).append(v)
                i += 1
            elif head == 'GLOBAL':
                globalset.add(line[1])
                i += 1
            elif head == 'REPEAT':
                cnt, _ = self.eval_expr(line, 1, scope, globalset)
                end_idx = self.find_matching_end(i)
                for _ in range(max(0,cnt)):
                    try:
                        self.run_block(i+1, end_idx, scope, globalset)
                    except BreakExc:
                        break
                    except ContinueExc:
                        continue
                i = end_idx+1
            elif head == 'WHILE':
                end_idx = self.find_matching_end(i)
                while True:
                    cval, _ = self.eval_expr(line, 1, scope, globalset)
                    if cval == 0:
                        break
                    try:
                        self.run_block(i+1, end_idx, scope, globalset)
                    except BreakExc:
                        break
                    except ContinueExc:
                        continue
                i = end_idx+1
            elif head == 'IF':
                kind, mark = self.find_else_or_end(i)
                cval, _ = self.eval_expr(line, 1, scope, globalset)
                if kind == 'else':
                    end_idx = self.find_matching_end(mark)
                    if cval != 0:
                        self.run_block(i+1, mark, scope, globalset)
                    else:
                        self.run_block(mark+1, end_idx, scope, globalset)
                    i = end_idx+1
                else:
                    end_idx = mark
                    if cval != 0:
                        self.run_block(i+1, end_idx, scope, globalset)
                    i = end_idx+1
            elif head == 'BREAK':
                raise BreakExc()
            elif head == 'CONTINUE':
                raise ContinueExc()
            elif head == 'DEF':
                name = line[1]
                params = line[2:]
                end_idx = self.find_matching_end(i)
                self.procs[name] = Proc(params, (i+1, end_idx))
                i = end_idx+1
            elif head == 'RET':
                v, _ = self.eval_expr(line, 1, scope, globalset)
                raise RetExc(v)
            elif head == 'END' or head == 'ELSE':
                i += 1
            else:
                raise Exception("unknown stmt "+head)
        return None

    def call_proc(self, name, args):
        proc = self.procs[name]
        scope = {}
        globalset = set()
        for pname, aval in zip(proc.params, args):
            scope[pname] = aval
        start, end = proc.body
        try:
            self.run_block(start, end, scope, globalset)
        except RetExc as r:
            return r.val
        return 0

    def run(self):
        end = len(self.lines)
        self.run_block(0, end, None, set())

lines = tokenize_lines('program.stamp')
interp = Interp(lines)
interp.run()
print(' '.join(str(x) for x in interp.output))
