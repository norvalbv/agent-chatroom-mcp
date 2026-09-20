import sys

class Return(Exception):
    def __init__(self, val): self.val = val
class Break(Exception): pass
class Continue(Exception): pass

def tokenize(path):
    lines = []
    with open(path) as f:
        for line in f:
            toks = line.split()
            if toks:
                lines.append(toks)
    return lines

def parse_block(lines, i, enders):
    stmts = []
    while i < len(lines):
        toks = lines[i]
        head = toks[0]
        if head in enders:
            return stmts, i
        if head == 'REPEAT':
            body, i = parse_block(lines, i+1, ('END',))
            stmts.append(('REPEAT', toks[1:], body))
            i += 1
        elif head == 'WHILE':
            body, i = parse_block(lines, i+1, ('END',))
            stmts.append(('WHILE', toks[1:], body))
            i += 1
        elif head == 'IF':
            body1, i = parse_block(lines, i+1, ('END','ELSE'))
            if lines[i][0] == 'ELSE':
                body2, i = parse_block(lines, i+1, ('END',))
            else:
                body2 = None
            stmts.append(('IF', toks[1:], body1, body2))
            i += 1
        elif head == 'DEF':
            body, i = parse_block(lines, i+1, ('END',))
            stmts.append(('DEF', toks[1], toks[2:], body))
            i += 1
        else:
            stmts.append((head, toks[1:]))
            i += 1
    return stmts, i

class Frame:
    def __init__(self):
        self.locals = {}
        self.globalized = set()

class Interp:
    def __init__(self):
        self.globals = {}
        self.lists = {}
        self.procs = {}
        self.stack = []  # frame stack
        self.output = []

    def is_num(self, tok):
        if tok[0] == '-' and len(tok) > 1 and tok[1:].isdigit():
            return True
        return tok.isdigit()

    def read_var(self, name):
        if self.stack:
            fr = self.stack[-1]
            if name in fr.globalized:
                return self.globals.get(name, 0)
            if name in fr.locals:
                return fr.locals[name]
            return self.globals.get(name, 0)
        else:
            return self.globals.get(name, 0)

    def write_var(self, name, val):
        if self.stack:
            fr = self.stack[-1]
            if name in fr.globalized:
                self.globals[name] = val
            elif name in fr.locals:
                fr.locals[name] = val
            else:
                fr.locals[name] = val
        else:
            self.globals[name] = val

    def floordiv(self, a, b):
        if b == 0: return 0
        return a // b  # python floor div matches spec

    def mod(self, a, b):
        if b == 0: return 0
        return a - self.floordiv(a,b)*b

    def eval_expr(self, toks, pos):
        tok = toks[pos]
        if self.is_num(tok):
            return int(tok), pos+1
        binary2 = {'+','-','*','/','%','<','=','AND','OR','MIN','MAX','POW'}
        unary1 = {'NOT','ABS'}
        if tok in binary2:
            a, pos = self.eval_expr(toks, pos+1)
            b, pos = self.eval_expr(toks, pos)
            if tok == '+': return a+b, pos
            if tok == '-': return a-b, pos
            if tok == '*': return a*b, pos
            if tok == '/': return self.floordiv(a,b), pos
            if tok == '%': return self.mod(a,b), pos
            if tok == '<': return 1 if a<b else 0, pos
            if tok == '=': return 1 if a==b else 0, pos
            if tok == 'AND': return 1 if (a!=0 and b!=0) else 0, pos
            if tok == 'OR': return 1 if (a!=0 or b!=0) else 0, pos
            if tok == 'MIN': return min(a,b), pos
            if tok == 'MAX': return max(a,b), pos
            if tok == 'POW':
                if b < 0: return 0, pos
                return a**b, pos
        if tok in unary1:
            a, pos = self.eval_expr(toks, pos+1)
            if tok == 'NOT': return (1 if a==0 else 0), pos
            if tok == 'ABS': return abs(a), pos
        if tok == 'NEXT':
            name = toks[pos+1]
            val = self.read_var(name) + 1
            self.write_var(name, val)
            return val, pos+2
        if tok == 'LEN':
            name = toks[pos+1]
            lst = self.lists.get(name, [])
            return len(lst), pos+2
        if tok == 'AT':
            name = toks[pos+1]
            idx, pos2 = self.eval_expr(toks, pos+2)
            lst = self.lists.get(name, [])
            n = len(lst)
            i = idx
            if i < 0: i += n
            if i < 0 or i >= n: return 0, pos2
            return lst[i], pos2
        if tok == 'CALL':
            fname = toks[pos+1]
            pos2 = pos+2
            if fname in self.procs:
                params, body = self.procs[fname]
            else:
                params, body = [], None
            args = []
            for _ in params:
                v, pos2 = self.eval_expr(toks, pos2)
                args.append(v)
            if body is None:
                return 0, pos2
            fr = Frame()
            for p, v in zip(params, args):
                fr.locals[p] = v
            self.stack.append(fr)
            ret = 0
            try:
                self.exec_block(body)
            except Return as r:
                ret = r.val
            finally:
                self.stack.pop()
            return ret, pos2
        # variable name
        return self.read_var(tok), pos+1

    def eval_full(self, toks):
        v, pos = self.eval_expr(toks, 0)
        assert pos == len(toks), f"leftover tokens {toks[pos:]}"
        return v

    def exec_block(self, stmts):
        for st in stmts:
            self.exec_stmt(st)

    def exec_stmt(self, st):
        kind = st[0]
        if kind == 'SET':
            toks = st[1]
            v = toks[0]
            val = self.eval_full(toks[1:])
            self.write_var(v, val)
        elif kind == 'SETS':
            toks = st[1]
            v, w = toks[0], toks[1]
            e_val, pos = self.eval_expr(toks, 2)
            f_val, pos = self.eval_expr(toks, pos)
            self.write_var(v, e_val)
            self.write_var(w, f_val)
        elif kind == 'PRINT':
            val = self.eval_full(st[1])
            self.output.append(val)
        elif kind == 'PUSH':
            toks = st[1]
            name = toks[0]
            val = self.eval_full(toks[1:])
            self.lists.setdefault(name, []).append(val)
        elif kind == 'REPEAT':
            toks, body = st[1], st[2]
            n = self.eval_full(toks)
            i = 0
            while i < n:
                i += 1
                try:
                    self.exec_block(body)
                except Break:
                    break
                except Continue:
                    continue
        elif kind == 'WHILE':
            toks, body = st[1], st[2]
            while self.eval_full(toks) != 0:
                try:
                    self.exec_block(body)
                except Break:
                    break
                except Continue:
                    continue
        elif kind == 'IF':
            toks, body1, body2 = st[1], st[2], st[3]
            if self.eval_full(toks) != 0:
                self.exec_block(body1)
            elif body2 is not None:
                self.exec_block(body2)
        elif kind == 'BREAK':
            raise Break()
        elif kind == 'CONTINUE':
            raise Continue()
        elif kind == 'DEF':
            _, fname, params, body = st
            self.procs[fname] = (params, body)
        elif kind == 'RET':
            val = self.eval_full(st[1])
            raise Return(val)
        elif kind == 'GLOBAL':
            name = st[1][0]
            if self.stack:
                self.stack[-1].globalized.add(name)
        else:
            raise Exception(f"unknown stmt {kind}")

def main():
    lines = tokenize(sys.argv[1])
    stmts, i = parse_block(lines, 0, ())
    interp = Interp()
    interp.exec_block(stmts)
    print(' '.join(str(x) for x in interp.output))

if __name__ == '__main__':
    main()
