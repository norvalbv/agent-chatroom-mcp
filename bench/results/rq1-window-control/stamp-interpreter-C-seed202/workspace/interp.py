import sys

def tokenize(line):
    return line.split()

def parse_program(lines):
    return [tokenize(l) for l in lines if l.strip() != ""]

def is_int(tok):
    if tok == "-":
        return False
    if tok[0] == '-' and tok[1:].isdigit():
        return True
    return tok.isdigit()

class Proc:
    def __init__(self, params, body_start):
        self.params = params
        self.body_start = body_start

globals_ = {}
lists = {}
procs = {}
output = []

def floordiv(a,b):
    if b == 0:
        return 0
    return a // b

def floormod(a,b):
    if b == 0:
        return 0
    return a - floordiv(a,b)*b

class RetSignal(Exception):
    def __init__(self, val):
        self.val = val

class BreakSignal(Exception):
    pass

class ContinueSignal(Exception):
    pass

def find_matching_end(toks_lines, start):
    depth = 1
    i = start
    while i < len(toks_lines):
        t = toks_lines[i]
        if t[0] in ("REPEAT","WHILE","IF","DEF"):
            depth += 1
        elif t[0] == "END":
            depth -= 1
            if depth == 0:
                return i
        i += 1
    raise Exception("no matching end")

def skip_block(toks_lines, start):
    # start points at line after opening; returns index of END line
    return find_matching_end(toks_lines, start)

class Scope:
    def __init__(self, is_global, locals_dict=None, global_names=None):
        self.is_global = is_global
        self.locals = locals_dict if locals_dict is not None else {}
        self.global_names = global_names if global_names is not None else set()

    def read(self, name):
        if self.is_global:
            return globals_.get(name, 0)
        if name in self.global_names:
            return globals_.get(name, 0)
        if name in self.locals:
            return self.locals[name]
        return globals_.get(name, 0)

    def write(self, name, val):
        if self.is_global:
            globals_[name] = val
            return
        if name in self.global_names:
            globals_[name] = val
            return
        self.locals[name] = val

    def declare_global(self, name):
        if not self.is_global:
            self.global_names.add(name)
            if name in self.locals:
                del self.locals[name]

toks_lines = None

def eval_expr(tokens, idx, scope):
    tok = tokens[idx]
    idx += 1
    if is_int(tok):
        return int(tok), idx
    binops = {"+","-","*","/","%","<","=","AND","OR","MIN","MAX","POW"}
    unops = {"NOT","ABS"}
    if tok in binops:
        a, idx = eval_expr(tokens, idx, scope)
        b, idx = eval_expr(tokens, idx, scope)
        if tok == "+": return a+b, idx
        if tok == "-": return a-b, idx
        if tok == "*": return a*b, idx
        if tok == "/": return floordiv(a,b), idx
        if tok == "%": return floormod(a,b), idx
        if tok == "<": return 1 if a<b else 0, idx
        if tok == "=": return 1 if a==b else 0, idx
        if tok == "AND": return 1 if (a!=0 and b!=0) else 0, idx
        if tok == "OR": return 1 if (a!=0 or b!=0) else 0, idx
        if tok == "MIN": return min(a,b), idx
        if tok == "MAX": return max(a,b), idx
        if tok == "POW":
            if b < 0: return 0, idx
            return a**b, idx
    if tok in unops:
        a, idx = eval_expr(tokens, idx, scope)
        if tok == "NOT": return (1 if a==0 else 0), idx
        if tok == "ABS": return abs(a), idx
    if tok == "NEXT":
        v = tokens[idx]; idx += 1
        cur = scope.read(v)
        newval = cur + 1
        scope.write(v, newval)
        return newval, idx
    if tok == "CALL":
        fname = tokens[idx]; idx += 1
        if fname not in procs:
            return 0, idx
        proc = procs[fname]
        args = []
        for _ in proc.params:
            val, idx = eval_expr(tokens, idx, scope)
            args.append(val)
        result = call_proc(fname, args)
        return result, idx
    if tok == "LEN":
        lname = tokens[idx]; idx += 1
        lst = lists.get(lname, [])
        return len(lst), idx
    if tok == "AT":
        lname = tokens[idx]; idx += 1
        i, idx = eval_expr(tokens, idx, scope)
        lst = lists.get(lname, [])
        n = len(lst)
        actual = i if i >= 0 else n + i
        if 0 <= actual < n:
            return lst[actual], idx
        return 0, idx
    # variable name
    return scope.read(tok), idx

def call_proc(fname, args):
    proc = procs[fname]
    locals_dict = {}
    for pname, aval in zip(proc.params, args):
        locals_dict[pname] = aval
    scope = Scope(False, locals_dict, set())
    try:
        run_block(proc.body_start, scope)
    except RetSignal as r:
        return r.val
    return 0

def run_block(start, scope):
    i = start
    while i < len(toks_lines):
        line = toks_lines[i]
        head = line[0]
        if head == "END":
            return i+1
        if head == "DEF":
            fname = line[1]
            params = line[2:]
            end_idx = find_matching_end(toks_lines, i+1)
            procs[fname] = Proc(params, i+1)
            i = end_idx + 1
            continue
        if head == "SET":
            v = line[1]
            val, _ = eval_expr(line, 2, scope)
            scope.write(v, val)
            i += 1
            continue
        if head == "SETS":
            v = line[1]; w = line[2]
            val_e, nexti = eval_expr(line, 3, scope)
            val_f, nexti = eval_expr(line, nexti, scope)
            scope.write(v, val_e)
            scope.write(w, val_f)
            i += 1
            continue
        if head == "PRINT":
            val, _ = eval_expr(line, 1, scope)
            output.append(val)
            i += 1
            continue
        if head == "PUSH":
            lname = line[1]
            val, _ = eval_expr(line, 2, scope)
            lists.setdefault(lname, []).append(val)
            i += 1
            continue
        if head == "GLOBAL":
            v = line[1]
            scope.declare_global(v)
            i += 1
            continue
        if head == "RET":
            val, _ = eval_expr(line, 1, scope)
            raise RetSignal(val)
        if head == "BREAK":
            raise BreakSignal()
        if head == "CONTINUE":
            raise ContinueSignal()
        if head == "REPEAT":
            count, _ = eval_expr(line, 1, scope)
            end_idx = find_matching_end(toks_lines, i+1)
            n = count
            j = 0
            while j < n:
                j += 1
                try:
                    run_block(i+1, scope)
                except BreakSignal:
                    break
                except ContinueSignal:
                    continue
            i = end_idx + 1
            continue
        if head == "WHILE":
            end_idx = find_matching_end(toks_lines, i+1)
            while True:
                cond, _ = eval_expr(line, 1, scope)
                if cond == 0:
                    break
                try:
                    run_block(i+1, scope)
                except BreakSignal:
                    break
                except ContinueSignal:
                    continue
            i = end_idx + 1
            continue
        if head == "IF":
            cond, _ = eval_expr(line, 1, scope)
            # find else/end
            depth = 1
            j = i+1
            else_idx = None
            end_idx = None
            while j < len(toks_lines):
                h = toks_lines[j][0]
                if h in ("REPEAT","WHILE","IF","DEF"):
                    depth += 1
                elif h == "ELSE" and depth == 1:
                    else_idx = j
                elif h == "END":
                    depth -= 1
                    if depth == 0:
                        end_idx = j
                        break
                j += 1
            if cond != 0:
                run_block(i+1, scope)
            else:
                if else_idx is not None:
                    run_block(else_idx+1, scope)
            i = end_idx + 1
            continue
        raise Exception("unknown stmt " + head)
    return i

def main():
    with open("program.stamp") as f:
        lines = f.readlines()
    global toks_lines
    toks_lines = parse_program(lines)
    scope = Scope(True)
    run_block(0, scope)
    print(" ".join(str(x) for x in output))

main()
