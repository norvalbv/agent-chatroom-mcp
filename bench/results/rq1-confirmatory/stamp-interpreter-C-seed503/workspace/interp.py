import sys

def tokenize(lines):
    return [line.split() for line in lines if line.strip() != ""]

def parse_block(tokens, i, end_tokens):
    stmts = []
    while tokens[i][0] not in end_tokens:
        stmt, i = parse_stmt(tokens, i)
        stmts.append(stmt)
    return stmts, i

def parse_stmt(tokens, i):
    t = tokens[i]
    kw = t[0]
    if kw == "SET":
        v = t[1]
        e, _ = parse_expr(t, 2)
        return ("SET", v, e), i+1
    if kw == "SETS":
        v, w = t[1], t[2]
        e, j = parse_expr(t, 3)
        f, j = parse_expr(t, j)
        return ("SETS", v, w, e, f), i+1
    if kw == "PRINT":
        e, _ = parse_expr(t, 1)
        return ("PRINT", e), i+1
    if kw == "PUSH":
        L = t[1]
        e, _ = parse_expr(t, 2)
        return ("PUSH", L, e), i+1
    if kw == "REPEAT":
        e, _ = parse_expr(t, 1)
        body, j = parse_block(tokens, i+1, ("END",))
        return ("REPEAT", e, body), j+1
    if kw == "WHILE":
        e, _ = parse_expr(t, 1)
        body, j = parse_block(tokens, i+1, ("END",))
        return ("WHILE", e, body), j+1
    if kw == "IF":
        e, _ = parse_expr(t, 1)
        body1, j = parse_block(tokens, i+1, ("END","ELSE"))
        if tokens[j][0] == "ELSE":
            body2, j = parse_block(tokens, j+1, ("END",))
        else:
            body2 = []
        return ("IF", e, body1, body2), j+1
    if kw == "BREAK":
        return ("BREAK",), i+1
    if kw == "CONTINUE":
        return ("CONTINUE",), i+1
    if kw == "DEF":
        name = t[1]
        params = t[2:]
        body, j = parse_block(tokens, i+1, ("END",))
        return ("DEF", name, params, body), j+1
    if kw == "RET":
        e, _ = parse_expr(t, 1)
        return ("RET", e), i+1
    if kw == "GLOBAL":
        return ("GLOBAL", t[1]), i+1
    raise Exception("unknown stmt " + str(t))

def parse_expr(t, i):
    tok = t[i]
    if tok in ("+","-","*","/","%","<","=","AND","OR","MIN","MAX","POW"):
        a, j = parse_expr(t, i+1)
        b, j = parse_expr(t, j)
        return (tok, a, b), j
    if tok in ("NOT","ABS"):
        a, j = parse_expr(t, i+1)
        return (tok, a), j
    if tok == "NEXT":
        return ("NEXT", t[i+1]), i+2
    if tok == "LEN":
        return ("LEN", t[i+1]), i+2
    if tok == "AT":
        L = t[i+1]
        a, j = parse_expr(t, i+2)
        return ("AT", L, a), j
    if tok == "CALL":
        f = t[i+1]
        j = i+2
        # need to know param count; defer resolving args count via special handling
        return ("CALL_RAW", f, t, j), None  # placeholder, handled specially
    # literal or var
    try:
        int(tok)
        return ("LIT", int(tok)), i+1
    except ValueError:
        return ("VAR", tok), i+1

# Because CALL needs variable arg count depending on def in force at runtime (parse time we don't know),
# we handle CALL specially during parsing using a global proc table built as we parse top-level DEFs in order.
# Simpler: re-implement parse_expr with access to a "current defs" dict for arg counts, updated as we parse top-level.

class Parser:
    def __init__(self):
        self.defs_seen = {}  # name -> nparams, updated as DEF encountered during parse (source order)

    def parse_program(self, tokens):
        stmts, i = self.parse_block(tokens, 0, ("__EOF__",))
        return stmts

    def parse_block(self, tokens, i, end_tokens):
        stmts = []
        while i < len(tokens) and tokens[i][0] not in end_tokens:
            stmt, i = self.parse_stmt(tokens, i)
            stmts.append(stmt)
        return stmts, i

    def parse_stmt(self, tokens, i):
        t = tokens[i]
        kw = t[0]
        if kw == "SET":
            v = t[1]
            e, _ = self.parse_expr(t, 2)
            return ("SET", v, e), i+1
        if kw == "SETS":
            v, w = t[1], t[2]
            e, j = self.parse_expr(t, 3)
            f, j = self.parse_expr(t, j)
            return ("SETS", v, w, e, f), i+1
        if kw == "PRINT":
            e, _ = self.parse_expr(t, 1)
            return ("PRINT", e), i+1
        if kw == "PUSH":
            L = t[1]
            e, _ = self.parse_expr(t, 2)
            return ("PUSH", L, e), i+1
        if kw == "REPEAT":
            e, _ = self.parse_expr(t, 1)
            body, j = self.parse_block(tokens, i+1, ("END",))
            return ("REPEAT", e, body), j+1
        if kw == "WHILE":
            e, _ = self.parse_expr(t, 1)
            body, j = self.parse_block(tokens, i+1, ("END",))
            return ("WHILE", e, body), j+1
        if kw == "IF":
            e, _ = self.parse_expr(t, 1)
            body1, j = self.parse_block(tokens, i+1, ("END","ELSE"))
            if tokens[j][0] == "ELSE":
                body2, j = self.parse_block(tokens, j+1, ("END",))
            else:
                body2 = []
            return ("IF", e, body1, body2), j+1
        if kw == "BREAK":
            return ("BREAK",), i+1
        if kw == "CONTINUE":
            return ("CONTINUE",), i+1
        if kw == "DEF":
            name = t[1]
            params = t[2:]
            self.defs_seen[name] = len(params)
            body, j = self.parse_block(tokens, i+1, ("END",))
            return ("DEF", name, params, body), j+1
        if kw == "RET":
            e, _ = self.parse_expr(t, 1)
            return ("RET", e), i+1
        if kw == "GLOBAL":
            return ("GLOBAL", t[1]), i+1
        raise Exception("unknown stmt " + str(t))

    def parse_expr(self, t, i):
        tok = t[i]
        if tok in ("+","-","*","/","%","<","=","AND","OR","MIN","MAX","POW"):
            a, j = self.parse_expr(t, i+1)
            b, j = self.parse_expr(t, j)
            return (tok, a, b), j
        if tok in ("NOT","ABS"):
            a, j = self.parse_expr(t, i+1)
            return (tok, a), j
        if tok == "NEXT":
            return ("NEXT", t[i+1]), i+2
        if tok == "LEN":
            return ("LEN", t[i+1]), i+2
        if tok == "AT":
            L = t[i+1]
            a, j = self.parse_expr(t, i+2)
            return ("AT", L, a), j
        if tok == "CALL":
            f = t[i+1]
            n = self.defs_seen.get(f, 0)
            args = []
            j = i+2
            for _ in range(n):
                a, j = self.parse_expr(t, j)
                args.append(a)
            return ("CALL", f, args), j
        try:
            int(tok)
            return ("LIT", int(tok)), i+1
        except ValueError:
            return ("VAR", tok), i+1


class BreakEx(Exception): pass
class ContinueEx(Exception): pass
class RetEx(Exception):
    def __init__(self, val): self.val = val

class Interp:
    def __init__(self, program):
        self.program = program
        self.globals = {}
        self.lists = {}
        self.procs = {}
        self.output = []

    def run(self):
        self.exec_block(self.program, None)

    def exec_block(self, stmts, frame):
        for s in stmts:
            self.exec_stmt(s, frame)

    def exec_stmt(self, s, frame):
        kind = s[0]
        if kind == "DEF":
            _, name, params, body = s
            self.procs[name] = (params, body)
            return
        if kind == "SET":
            _, v, e = s
            val = self.eval(e, frame)
            self.assign(v, val, frame)
            return
        if kind == "SETS":
            _, v, w, e, f = s
            ve = self.eval(e, frame)
            vf = self.eval(f, frame)
            self.assign(v, ve, frame)
            self.assign(w, vf, frame)
            return
        if kind == "PRINT":
            _, e = s
            val = self.eval(e[0] if False else e, frame)
            self.output.append(val)
            return
        if kind == "PUSH":
            _, L, e = s
            val = self.eval(e, frame)
            self.lists.setdefault(L, []).append(val)
            return
        if kind == "REPEAT":
            _, e, body = s
            n = self.eval(e, frame)
            i = 0
            while i < n:
                i += 1
                try:
                    self.exec_block(body, frame)
                except ContinueEx:
                    continue
                except BreakEx:
                    break
            return
        if kind == "WHILE":
            _, e, body = s
            while self.eval(e, frame) != 0:
                try:
                    self.exec_block(body, frame)
                except ContinueEx:
                    continue
                except BreakEx:
                    break
            return
        if kind == "IF":
            _, e, b1, b2 = s
            if self.eval(e, frame) != 0:
                self.exec_block(b1, frame)
            else:
                self.exec_block(b2, frame)
            return
        if kind == "BREAK":
            raise BreakEx()
        if kind == "CONTINUE":
            raise ContinueEx()
        if kind == "RET":
            _, e = s
            val = self.eval(e, frame)
            raise RetEx(val)
        if kind == "GLOBAL":
            _, v = s
            if frame is not None:
                frame['globalset'].add(v)
                frame['locals'].pop(v, None)
            return
        raise Exception("unknown stmt exec " + str(s))

    def read_var(self, name, frame):
        if frame is not None and name not in frame['globalset']:
            if name in frame['locals']:
                return frame['locals'][name]
            return self.globals.get(name, 0)
        return self.globals.get(name, 0)

    def assign(self, name, val, frame):
        if frame is not None and name not in frame['globalset']:
            frame['locals'][name] = val
        else:
            self.globals[name] = val

    def eval(self, e, frame):
        kind = e[0]
        if kind == "LIT":
            return e[1]
        if kind == "VAR":
            return self.read_var(e[1], frame)
        if kind in ("+","-","*","/","%","<","=","AND","OR","MIN","MAX","POW"):
            a = self.eval(e[1], frame)
            b = self.eval(e[2], frame)
            if kind == "+": return a+b
            if kind == "-": return a-b
            if kind == "*": return a*b
            if kind == "/":
                if b == 0: return 0
                return a // b
            if kind == "%":
                if b == 0: return 0
                return a - (a // b) * b
            if kind == "<": return 1 if a < b else 0
            if kind == "=": return 1 if a == b else 0
            if kind == "AND": return 1 if (a != 0 and b != 0) else 0
            if kind == "OR": return 1 if (a != 0 or b != 0) else 0
            if kind == "MIN": return min(a,b)
            if kind == "MAX": return max(a,b)
            if kind == "POW":
                if b < 0: return 0
                return a ** b
        if kind == "NOT":
            a = self.eval(e[1], frame)
            return 1 if a == 0 else 0
        if kind == "ABS":
            a = self.eval(e[1], frame)
            return abs(a)
        if kind == "NEXT":
            name = e[1]
            cur = self.read_var(name, frame)
            newv = cur + 1
            self.assign(name, newv, frame)
            return newv
        if kind == "LEN":
            return len(self.lists.get(e[1], []))
        if kind == "AT":
            lst = self.lists.get(e[1], [])
            idx = self.eval(e[2], frame)
            if idx < 0:
                idx2 = len(lst) + idx
            else:
                idx2 = idx
            if idx2 < 0 or idx2 >= len(lst):
                return 0
            return lst[idx2]
        if kind == "CALL":
            _, name, argexprs = e
            argvals = [self.eval(a, frame) for a in argexprs]
            if name not in self.procs:
                return 0
            params, body = self.procs[name]
            newframe = {'locals': {}, 'globalset': set()}
            for p, v in zip(params, argvals):
                newframe['locals'][p] = v
            try:
                self.exec_block(body, newframe)
            except RetEx as r:
                return r.val
            return 0
        raise Exception("unknown expr " + str(e))


with open(sys.argv[1]) as f:
    lines = f.readlines()
tokens = tokenize(lines)
p = Parser()
prog = p.parse_program(tokens)
interp = Interp(prog)
interp.run()
print(" ".join(str(x) for x in interp.output))
