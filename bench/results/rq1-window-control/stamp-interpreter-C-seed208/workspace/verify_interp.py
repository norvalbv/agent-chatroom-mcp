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
    def __init__(self, val): self.val = val

def find_matching_end(lines, i):
    depth = 1
    j = i + 1
    while depth > 0:
        toks = tokenize(lines[j])
        if toks and toks[0] in ("REPEAT", "WHILE", "IF", "DEF"):
            depth += 1
        elif toks and toks[0] == "END":
            depth -= 1
        j += 1
    return j - 1

def find_else_or_end(lines, i):
    depth = 1
    j = i + 1
    else_idx = None
    while depth > 0:
        toks = tokenize(lines[j])
        if toks and toks[0] in ("REPEAT", "WHILE", "IF", "DEF"):
            depth += 1
        elif toks and toks[0] == "END":
            depth -= 1
            if depth == 0:
                return else_idx, j
        elif toks and toks[0] == "ELSE" and depth == 1:
            else_idx = j
        j += 1
    return else_idx, j

class Interp:
    def __init__(self, lines):
        self.lines = lines
        self.globals = {}
        self.lists = {}
        self.procs = {}
        self.output = []

    def run(self):
        self.exec_block(0, len(self.lines), None, set())

    def get_var(self, name, locals_, globalset):
        if name in globalset:
            return self.globals.get(name, 0)
        if locals_ is not None and name in locals_:
            return locals_[name]
        if locals_ is None:
            return self.globals.get(name, 0)
        return self.globals.get(name, 0)

    def set_var(self, name, val, locals_, globalset):
        if locals_ is None:
            self.globals[name] = val
            return
        if name in globalset:
            self.globals[name] = val
            return
        locals_[name] = val

    def next_var(self, name, locals_, globalset):
        cur = self.get_var(name, locals_, globalset)
        newval = cur + 1
        self.set_var(name, newval, locals_, globalset)
        return newval

    def eval_tokens(self, toks, pos, locals_, globalset):
        tok = toks[pos]
        pos += 1
        binops = {"+","-","*","/","%","<","=","AND","OR","MIN","MAX","POW"}
        unops = {"NOT","ABS"}
        if tok in binops:
            a, pos = self.eval_tokens(toks, pos, locals_, globalset)
            b, pos = self.eval_tokens(toks, pos, locals_, globalset)
            if tok == "+": return a+b, pos
            if tok == "-": return a-b, pos
            if tok == "*": return a*b, pos
            if tok == "/":
                if b == 0: return 0, pos
                return a // b, pos
            if tok == "%":
                if b == 0: return 0, pos
                return a - (a//b)*b, pos
            if tok == "<": return (1 if a < b else 0), pos
            if tok == "=": return (1 if a == b else 0), pos
            if tok == "AND": return (1 if a!=0 and b!=0 else 0), pos
            if tok == "OR": return (1 if a!=0 or b!=0 else 0), pos
            if tok == "MIN": return min(a,b), pos
            if tok == "MAX": return max(a,b), pos
            if tok == "POW":
                if b < 0: return 0, pos
                return a ** b, pos
        if tok in unops:
            a, pos = self.eval_tokens(toks, pos, locals_, globalset)
            if tok == "NOT": return (1 if a==0 else 0), pos
            if tok == "ABS": return abs(a), pos
        if tok == "NEXT":
            v = toks[pos]; pos += 1
            return self.next_var(v, locals_, globalset), pos
        if tok == "CALL":
            fname = toks[pos]; pos += 1
            proc = self.procs.get(fname)
            nargs = len(proc.params) if proc else 0
            args = []
            for _ in range(nargs):
                v, pos = self.eval_tokens(toks, pos, locals_, globalset)
                args.append(v)
            if proc is None:
                return 0, pos
            return self.call_proc(proc, args), pos
        if tok == "LEN":
            L = toks[pos]; pos += 1
            lst = self.lists.get(L, [])
            return len(lst), pos
        if tok == "AT":
            L = toks[pos]; pos += 1
            i, pos = self.eval_tokens(toks, pos, locals_, globalset)
            lst = self.lists.get(L, [])
            n = len(lst)
            idx = i if i >= 0 else n + i
            if idx < 0 or idx >= n:
                return 0, pos
            return lst[idx], pos
        # literal or variable
        if tok.lstrip('-').isdigit() and (tok == '-' and False or True) and tok != '-':
            try:
                return int(tok), pos
            except ValueError:
                pass
        # variable name
        return self.get_var(tok, locals_, globalset), pos

    def eval_expr(self, tokens_from, locals_, globalset):
        val, pos = self.eval_tokens(tokens_from, 0, locals_, globalset)
        return val

    def call_proc(self, proc, args):
        locals_ = {}
        for p, a in zip(proc.params, args):
            locals_[p] = a
        globalset = set()
        try:
            self.exec_block(proc.body[0], proc.body[1], locals_, globalset)
        except RetEx as r:
            return r.val
        return 0

    def exec_block(self, start, end, locals_, globalset):
        i = start
        while i < end:
            line = self.lines[i]
            toks = tokenize(line)
            if not toks:
                i += 1
                continue
            head = toks[0]
            if head == "SET":
                v = toks[1]
                val = self.eval_expr(toks[2:], locals_, globalset)
                self.set_var(v, val, locals_, globalset)
                i += 1
            elif head == "SETS":
                v, w = toks[1], toks[2]
                # need to split remaining into two expressions e and f
                rest = toks[3:]
                e_val, pos = self.eval_tokens(rest, 0, locals_, globalset)
                f_val, pos2 = self.eval_tokens(rest, pos, locals_, globalset)
                self.set_var(v, e_val, locals_, globalset)
                self.set_var(w, f_val, locals_, globalset)
                i += 1
            elif head == "PRINT":
                val = self.eval_expr(toks[1:], locals_, globalset)
                self.output.append(val)
                i += 1
            elif head == "PUSH":
                L = toks[1]
                val = self.eval_expr(toks[2:], locals_, globalset)
                self.lists.setdefault(L, []).append(val)
                i += 1
            elif head == "GLOBAL":
                v = toks[1]
                globalset.add(v)
                i += 1
            elif head == "REPEAT":
                count = self.eval_expr(toks[1:], locals_, globalset)
                end_idx = find_matching_end(self.lines, i)
                body_start = i+1
                body_end = end_idx
                for _ in range(max(0, count)):
                    try:
                        self.exec_block(body_start, body_end, locals_, globalset)
                    except BreakEx:
                        break
                    except ContinueEx:
                        continue
                i = end_idx + 1
            elif head == "WHILE":
                end_idx = find_matching_end(self.lines, i)
                body_start = i+1
                body_end = end_idx
                while True:
                    cond = self.eval_expr(toks[1:], locals_, globalset)
                    if cond == 0:
                        break
                    try:
                        self.exec_block(body_start, body_end, locals_, globalset)
                    except BreakEx:
                        break
                    except ContinueEx:
                        continue
                i = end_idx + 1
            elif head == "IF":
                else_idx, end_idx = find_else_or_end(self.lines, i)
                cond = self.eval_expr(toks[1:], locals_, globalset)
                if cond != 0:
                    then_end = else_idx if else_idx is not None else end_idx
                    self.exec_block(i+1, then_end, locals_, globalset)
                else:
                    if else_idx is not None:
                        self.exec_block(else_idx+1, end_idx, locals_, globalset)
                i = end_idx + 1
            elif head == "DEF":
                fname = toks[1]
                params = toks[2:]
                end_idx = find_matching_end(self.lines, i)
                self.procs[fname] = Proc(params, (i+1, end_idx))
                i = end_idx + 1
            elif head == "RET":
                val = self.eval_expr(toks[1:], locals_, globalset)
                raise RetEx(val)
            elif head == "BREAK":
                raise BreakEx()
            elif head == "CONTINUE":
                raise ContinueEx()
            elif head == "END":
                i += 1
            elif head == "ELSE":
                i += 1
            else:
                raise Exception("unknown "+head)

with open(sys.argv[1]) as f:
    lines = [l.rstrip('\n') for l in f if l.strip() != ""]

interp = Interp(lines)
interp.run()
print(" ".join(str(x) for x in interp.output))
