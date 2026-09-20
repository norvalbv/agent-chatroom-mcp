import sys

def tokenize(line):
    return line.split()

def load(path):
    lines = []
    with open(path) as f:
        for l in f:
            l = l.strip()
            if l:
                lines.append(tokenize(l))
    return lines

lines = load("program.stamp")

procs = {}
globals_ = {}
lists = {}
output = []

def find_matching_end(lines, start):
    depth = 0
    i = start
    while i < len(lines):
        t = lines[i][0]
        if t in ("DEF", "REPEAT", "WHILE", "IF"):
            depth += 1
        elif t == "END":
            depth -= 1
            if depth == 0:
                return i
        i += 1
    raise Exception("no matching end")

class BreakEx(Exception): pass
class ContinueEx(Exception): pass
class RetEx(Exception):
    def __init__(self, val): self.val = val

def parse_block(lines, start, end):
    stmts = []
    i = start
    while i < end:
        t = lines[i][0]
        if t in ("REPEAT", "WHILE", "IF"):
            e = find_matching_end(lines, i)
            stmts.append(("BLOCK", lines[i], i, e))
            i = e + 1
        elif t == "DEF":
            e = find_matching_end(lines, i)
            stmts.append(("DEF", lines[i], i, e))
            i = e + 1
        else:
            stmts.append(("STMT", lines[i], i, i))
            i += 1
    return stmts

class Frame:
    def __init__(self):
        self.locals = {}
        self.globals_decl = set()

def read_var(frame, name):
    if frame is None:
        return globals_.get(name, 0)
    if name in frame.globals_decl:
        return globals_.get(name, 0)
    if name in frame.locals:
        return frame.locals[name]
    return globals_.get(name, 0)

def write_var(frame, name, val):
    if frame is None:
        globals_[name] = val
        return
    if name in frame.globals_decl:
        globals_[name] = val
        return
    frame.locals[name] = val

def eval_expr(tokens, pos, frame):
    tok = tokens[pos]
    pos += 1
    binops = {"+","-","*","/","%","<","=","AND","OR","MIN","MAX","POW"}
    unops = {"NOT","ABS"}
    if tok in binops:
        a, pos = eval_expr(tokens, pos, frame)
        b, pos = eval_expr(tokens, pos, frame)
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
        if tok == "AND": return (1 if (a!=0 and b!=0) else 0), pos
        if tok == "OR": return (1 if (a!=0 or b!=0) else 0), pos
        if tok == "MIN": return min(a,b), pos
        if tok == "MAX": return max(a,b), pos
        if tok == "POW":
            if b < 0: return 0, pos
            return a**b, pos
    if tok in unops:
        a, pos = eval_expr(tokens, pos, frame)
        if tok == "NOT": return (1 if a==0 else 0), pos
        if tok == "ABS": return abs(a), pos
    if tok == "NEXT":
        name = tokens[pos]; pos += 1
        cur = read_var(frame, name)
        newv = cur + 1
        write_var(frame, name, newv)
        return newv, pos
    if tok == "CALL":
        fname = tokens[pos]; pos += 1
        if fname not in procs:
            return 0, pos
        params, body_stmts = procs[fname]
        args = []
        for p in params:
            v, pos = eval_expr(tokens, pos, frame)
            args.append(v)
        newframe = Frame()
        for pname, v in zip(params, args):
            newframe.locals[pname] = v
        try:
            exec_block(body_stmts, newframe)
        except RetEx as r:
            return r.val, pos
        return 0, pos
    if tok == "LEN":
        lname = tokens[pos]; pos += 1
        lst = lists.get(lname, [])
        return len(lst), pos
    if tok == "AT":
        lname = tokens[pos]; pos += 1
        idx, pos = eval_expr(tokens, pos, frame)
        lst = lists.get(lname, [])
        n = len(lst)
        i = idx
        i2 = n + i if i < 0 else i
        if i2 < 0 or i2 >= n:
            return 0, pos
        return lst[i2], pos
    try:
        return int(tok), pos
    except ValueError:
        return read_var(frame, tok), pos

def exec_block(stmts, frame):
    i = 0
    while i < len(stmts):
        kind, toks, s, e = stmts[i]
        if kind == "DEF":
            fname = toks[1]
            params = toks[2:]
            inner_stmts = parse_block(lines, s+1, e)
            procs[fname] = (params, inner_stmts)
        elif kind == "BLOCK":
            head = toks[0]
            if head == "REPEAT":
                cnt, _ = eval_expr(toks, 1, frame)
                inner_stmts = parse_block(lines, s+1, e)
                for _ in range(cnt if cnt > 0 else 0):
                    try:
                        exec_block(inner_stmts, frame)
                    except BreakEx:
                        break
                    except ContinueEx:
                        continue
            elif head == "WHILE":
                inner_stmts = parse_block(lines, s+1, e)
                while True:
                    cond, _ = eval_expr(toks, 1, frame)
                    if cond == 0:
                        break
                    try:
                        exec_block(inner_stmts, frame)
                    except BreakEx:
                        break
                    except ContinueEx:
                        continue
            elif head == "IF":
                cond, _ = eval_expr(toks, 1, frame)
                depth = 0
                else_idx = None
                j = s+1
                while j < e:
                    t0 = lines[j][0]
                    if t0 in ("REPEAT","WHILE","IF","DEF"):
                        depth += 1
                    elif t0 == "END":
                        depth -= 1
                    elif t0 == "ELSE" and depth == 0:
                        else_idx = j
                        break
                    j += 1
                if cond != 0:
                    body_end = else_idx if else_idx is not None else e
                    inner_stmts = parse_block(lines, s+1, body_end)
                    exec_block(inner_stmts, frame)
                else:
                    if else_idx is not None:
                        inner_stmts = parse_block(lines, else_idx+1, e)
                        exec_block(inner_stmts, frame)
        else:
            t0 = toks[0]
            if t0 == "SET":
                name = toks[1]
                val, _ = eval_expr(toks, 2, frame)
                write_var(frame, name, val)
            elif t0 == "SETS":
                v = toks[1]; w = toks[2]
                val_e, pos2 = eval_expr(toks, 3, frame)
                val_f, pos2 = eval_expr(toks, pos2, frame)
                write_var(frame, v, val_e)
                write_var(frame, w, val_f)
            elif t0 == "PRINT":
                val, _ = eval_expr(toks, 1, frame)
                output.append(val)
            elif t0 == "PUSH":
                lname = toks[1]
                val, _ = eval_expr(toks, 2, frame)
                lists.setdefault(lname, []).append(val)
            elif t0 == "GLOBAL":
                name = toks[1]
                frame.globals_decl.add(name)
                if name in frame.locals:
                    del frame.locals[name]
            elif t0 == "BREAK":
                raise BreakEx()
            elif t0 == "CONTINUE":
                raise ContinueEx()
            elif t0 == "RET":
                val, _ = eval_expr(toks, 1, frame)
                raise RetEx(val)
            else:
                raise Exception("unknown stmt " + str(toks))
        i += 1

top_stmts = parse_block(lines, 0, len(lines))
exec_block(top_stmts, None)
print(" ".join(str(v) for v in output))
