import sys

def tokenize(line):
    return line.split()

def load(path):
    with open(path) as f:
        lines = [l.rstrip("\n") for l in f]
    return [tokenize(l) for l in lines if l.strip() != ""]

class Proc:
    def __init__(self, params, body):
        self.params = params
        self.body = body

class BreakExc(Exception): pass
class ContinueExc(Exception): pass
class RetExc(Exception):
    def __init__(self, v): self.v = v

def is_int_literal(tok):
    if tok == "-" or tok == "":
        return False
    if tok[0] == '-':
        return tok[1:].isdigit() and len(tok) > 1
    return tok.isdigit()

class Interp:
    def __init__(self, prog):
        self.prog = prog
        self.globals = {}
        self.lists = {}
        self.procs = {}
        self.output = []
        # build line index -> statement, and find blocks
        self.n = len(prog)

    def run(self):
        pc = 0
        self.exec_block(0, self.n, None, None)

    # scope: dict or None (None means top-level -> use globals directly, but we track global set explicitly)
    def find_matching_end(self, start):
        # start is index of a line starting a block (REPEAT/WHILE/IF/DEF), find index of its END
        depth = 1
        i = start + 1
        while i < self.n:
            tok0 = self.prog[i][0]
            if tok0 in ("REPEAT", "WHILE", "IF", "DEF"):
                depth += 1
            elif tok0 == "END":
                depth -= 1
                if depth == 0:
                    return i
            i += 1
        raise Exception("no matching END")

    def find_else(self, if_start, end_idx):
        depth = 0
        i = if_start + 1
        while i < end_idx:
            tok0 = self.prog[i][0]
            if tok0 in ("REPEAT", "WHILE", "IF", "DEF"):
                depth += 1
            elif tok0 == "END":
                depth -= 1
            elif tok0 == "ELSE" and depth == 0:
                return i
            i += 1
        return None

    def eval_expr(self, tokens, idx, scope):
        tok = tokens[idx]
        if is_int_literal(tok):
            return int(tok), idx + 1
        if tok == "NOT":
            a, idx = self.eval_expr(tokens, idx+1, scope)
            return (1 if a == 0 else 0), idx
        if tok == "ABS":
            a, idx = self.eval_expr(tokens, idx+1, scope)
            return abs(a), idx
        if tok == "NEXT":
            vname = tokens[idx+1]
            idx2 = idx+2
            newv = self.do_next(vname, scope)
            return newv, idx2
        if tok == "LEN":
            lname = tokens[idx+1]
            lst = self.lists.get(lname, [])
            return len(lst), idx+2
        if tok == "AT":
            lname = tokens[idx+1]
            i_val, idx2 = self.eval_expr(tokens, idx+2, scope)
            lst = self.lists.get(lname, [])
            n = len(lst)
            real_i = i_val if i_val >= 0 else n + i_val
            if 0 <= real_i < n:
                return lst[real_i], idx2
            else:
                return 0, idx2
        if tok == "CALL":
            fname = tokens[idx+1]
            idx2 = idx+2
            proc = self.procs.get(fname)
            nparams = len(proc.params) if proc else 0
            args = []
            for _ in range(nparams):
                a, idx2 = self.eval_expr(tokens, idx2, scope)
                args.append(a)
            if proc is None:
                return 0, idx2
            return self.call_proc(proc, args), idx2
        # binary ops
        binops = {"+","-","*","/","%","<","=","AND","OR","MIN","MAX","POW"}
        if tok in binops:
            a, idx2 = self.eval_expr(tokens, idx+1, scope)
            b, idx3 = self.eval_expr(tokens, idx2, scope)
            return self.apply_bin(tok, a, b), idx3
        # variable name
        return self.read_var(tok, scope), idx+1

    def apply_bin(self, op, a, b):
        if op == "+": return a + b
        if op == "-": return a - b
        if op == "*": return a * b
        if op == "/":
            if b == 0: return 0
            return a // b  # python floor division matches floor toward -inf
        if op == "%":
            if b == 0: return 0
            return a - (a // b) * b
        if op == "<": return 1 if a < b else 0
        if op == "=": return 1 if a == b else 0
        if op == "AND": return 1 if (a != 0 and b != 0) else 0
        if op == "OR": return 1 if (a != 0 or b != 0) else 0
        if op == "MIN": return min(a,b)
        if op == "MAX": return max(a,b)
        if op == "POW":
            if b < 0: return 0
            return a ** b
        raise Exception("unknown op " + op)

    def read_var(self, name, scope):
        if scope is not None:
            globals_set = scope['globals_declared']
            if name not in globals_set and name in scope['locals']:
                return scope['locals'][name]
            return self.globals.get(name, 0)
        else:
            return self.globals.get(name, 0)

    def write_var(self, name, value, scope):
        if scope is not None:
            globals_set = scope['globals_declared']
            if name in globals_set:
                self.globals[name] = value
            else:
                scope['locals'][name] = value
        else:
            self.globals[name] = value

    def do_next(self, name, scope):
        cur = self.read_var(name, scope)
        newv = cur + 1
        self.write_var(name, newv, scope)
        return newv

    def call_proc(self, proc, args):
        scope = {'locals': {}, 'globals_declared': set()}
        for pname, aval in zip(proc.params, args):
            scope['locals'][pname] = aval
        try:
            self.exec_block(proc.body[0], proc.body[1], scope, None)
        except RetExc as r:
            return r.v
        return 0

    def exec_block(self, start, end, scope, loop_ctx):
        i = start
        while i < end:
            line = self.prog[i]
            tok0 = line[0]
            if tok0 == "DEF":
                fname = line[1]
                params = line[2:]
                end_idx = self.find_matching_end(i)
                self.procs[fname] = Proc(params, (i+1, end_idx))
                i = end_idx + 1
                continue
            if tok0 == "SET":
                vname = line[1]
                val, _ = self.eval_expr(line, 2, scope)
                self.write_var(vname, val, scope)
                i += 1
                continue
            if tok0 == "SETS":
                v = line[1]; w = line[2]
                e_val, nexti = self.eval_expr(line, 3, scope)
                f_val, nexti2 = self.eval_expr(line, nexti, scope)
                self.write_var(v, e_val, scope)
                self.write_var(w, f_val, scope)
                i += 1
                continue
            if tok0 == "PRINT":
                val, _ = self.eval_expr(line, 1, scope)
                self.output.append(val)
                i += 1
                continue
            if tok0 == "PUSH":
                lname = line[1]
                val, _ = self.eval_expr(line, 2, scope)
                self.lists.setdefault(lname, []).append(val)
                i += 1
                continue
            if tok0 == "GLOBAL":
                vname = line[1]
                if scope is not None:
                    scope['globals_declared'].add(vname)
                    if vname in scope['locals']:
                        del scope['locals'][vname]
                i += 1
                continue
            if tok0 == "REPEAT":
                count, _ = self.eval_expr(line, 1, scope)
                end_idx = self.find_matching_end(i)
                body_start, body_end = i+1, end_idx
                k = 0
                while k < count:
                    k += 1
                    try:
                        self.exec_block(body_start, body_end, scope, 'loop')
                    except BreakExc:
                        break
                    except ContinueExc:
                        continue
                i = end_idx + 1
                continue
            if tok0 == "WHILE":
                end_idx = self.find_matching_end(i)
                body_start, body_end = i+1, end_idx
                cond_tokens = line
                while True:
                    cval, _ = self.eval_expr(cond_tokens, 1, scope)
                    if cval == 0:
                        break
                    try:
                        self.exec_block(body_start, body_end, scope, 'loop')
                    except BreakExc:
                        break
                    except ContinueExc:
                        continue
                i = end_idx + 1
                continue
            if tok0 == "IF":
                end_idx = self.find_matching_end(i)
                else_idx = self.find_else(i, end_idx)
                cval, _ = self.eval_expr(line, 1, scope)
                if cval != 0:
                    body_start = i+1
                    body_end = else_idx if else_idx is not None else end_idx
                    self.exec_block(body_start, body_end, scope, loop_ctx)
                else:
                    if else_idx is not None:
                        self.exec_block(else_idx+1, end_idx, scope, loop_ctx)
                i = end_idx + 1
                continue
            if tok0 == "BREAK":
                raise BreakExc()
            if tok0 == "CONTINUE":
                raise ContinueExc()
            if tok0 == "RET":
                val, _ = self.eval_expr(line, 1, scope)
                raise RetExc(val)
            if tok0 == "END" or tok0 == "ELSE":
                i += 1
                continue
            raise Exception("unknown stmt " + tok0)

def main():
    prog = load(sys.argv[1])
    interp = Interp(prog)
    interp.run()
    print(" ".join(str(x) for x in interp.output))

if __name__ == "__main__":
    main()
