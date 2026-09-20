import sys

def tokenize(lines):
    prog = []
    for line in lines:
        line = line.strip('\n')
        if line.strip() == '':
            continue
        toks = line.split()
        prog.append(toks)
    return prog

def parse_block(lines, i, enders):
    body = []
    while lines[i][0] not in enders:
        stmt, i = parse_stmt(lines, i)
        body.append(stmt)
    return body, i

def parse_stmt(lines, i):
    toks = lines[i]
    kw = toks[0]
    if kw == 'REPEAT':
        expr = toks[1:]
        body, j = parse_block(lines, i+1, ('END',))
        return ('REPEAT', expr, body), j+1
    if kw == 'WHILE':
        expr = toks[1:]
        body, j = parse_block(lines, i+1, ('END',))
        return ('WHILE', expr, body), j+1
    if kw == 'IF':
        expr = toks[1:]
        body, j = parse_block(lines, i+1, ('END','ELSE'))
        if lines[j][0] == 'ELSE':
            body2, j2 = parse_block(lines, j+1, ('END',))
            return ('IF', expr, body, body2), j2+1
        else:
            return ('IF', expr, body, None), j+1
    if kw == 'DEF':
        name = toks[1]
        params = toks[2:]
        body, j = parse_block(lines, i+1, ('END',))
        return ('DEF', name, params, body), j+1
    if kw in ('SET','SETS','PRINT','PUSH','BREAK','CONTINUE','RET','GLOBAL'):
        return (kw, toks[1:]), i+1
    raise Exception("unknown stmt "+str(toks))

def parse_program(lines):
    body = []
    i = 0
    n = len(lines)
    while i < n:
        stmt, i = parse_stmt(lines, i)
        body.append(stmt)
    return body

class BreakEx(Exception): pass
class ContinueEx(Exception): pass
class RetEx(Exception):
    def __init__(self, val): self.val = val

class Scope:
    def __init__(self, parent_globals):
        self.locals = {}
        self.globalset = set()
        self.globals = parent_globals

    def get(self, name):
        if name in self.globalset:
            return self.globals.get(name, 0)
        if name in self.locals:
            return self.locals[name]
        return self.globals.get(name, 0)

    def set(self, name, val):
        if name in self.globalset:
            self.globals[name] = val
        else:
            self.locals[name] = val

    def declare_global(self, name):
        self.globalset.add(name)

    def next(self, name):
        cur = self.get(name)
        newval = cur + 1
        if name in self.globalset:
            self.globals[name] = newval
        else:
            self.locals[name] = newval
        return newval

class Interp:
    def __init__(self, program):
        self.program = program
        self.globals = {}
        self.procs = {}
        self.lists = {}
        self.output = []

    def eval_tokens(self, toks, pos, scope):
        tok = toks[pos]
        if tok == '+':
            a,pos = self.eval_tokens(toks,pos+1,scope)
            b,pos = self.eval_tokens(toks,pos,scope)
            return a+b, pos
        if tok == '-':
            a,pos = self.eval_tokens(toks,pos+1,scope)
            b,pos = self.eval_tokens(toks,pos,scope)
            return a-b, pos
        if tok == '*':
            a,pos = self.eval_tokens(toks,pos+1,scope)
            b,pos = self.eval_tokens(toks,pos,scope)
            return a*b, pos
        if tok == '/':
            a,pos = self.eval_tokens(toks,pos+1,scope)
            b,pos = self.eval_tokens(toks,pos,scope)
            if b==0: return 0,pos
            return a//b, pos
        if tok == '%':
            a,pos = self.eval_tokens(toks,pos+1,scope)
            b,pos = self.eval_tokens(toks,pos,scope)
            if b==0: return 0,pos
            return a - (a//b)*b, pos
        if tok == '<':
            a,pos = self.eval_tokens(toks,pos+1,scope)
            b,pos = self.eval_tokens(toks,pos,scope)
            return 1 if a<b else 0, pos
        if tok == '=':
            a,pos = self.eval_tokens(toks,pos+1,scope)
            b,pos = self.eval_tokens(toks,pos,scope)
            return 1 if a==b else 0, pos
        if tok == 'AND':
            a,pos = self.eval_tokens(toks,pos+1,scope)
            b,pos = self.eval_tokens(toks,pos,scope)
            return 1 if (a!=0 and b!=0) else 0, pos
        if tok == 'OR':
            a,pos = self.eval_tokens(toks,pos+1,scope)
            b,pos = self.eval_tokens(toks,pos,scope)
            return 1 if (a!=0 or b!=0) else 0, pos
        if tok == 'MIN':
            a,pos = self.eval_tokens(toks,pos+1,scope)
            b,pos = self.eval_tokens(toks,pos,scope)
            return min(a,b), pos
        if tok == 'MAX':
            a,pos = self.eval_tokens(toks,pos+1,scope)
            b,pos = self.eval_tokens(toks,pos,scope)
            return max(a,b), pos
        if tok == 'POW':
            a,pos = self.eval_tokens(toks,pos+1,scope)
            b,pos = self.eval_tokens(toks,pos,scope)
            if b<0: return 0,pos
            return a**b, pos
        if tok == 'NOT':
            a,pos = self.eval_tokens(toks,pos+1,scope)
            return (1 if a==0 else 0), pos
        if tok == 'ABS':
            a,pos = self.eval_tokens(toks,pos+1,scope)
            return abs(a), pos
        if tok == 'NEXT':
            name = toks[pos+1]
            return scope.next(name), pos+2
        if tok == 'CALL':
            fname = toks[pos+1]
            pos2 = pos+2
            if fname not in self.procs:
                # unknown proc: consume 0 args per spec (takes no arguments)
                return 0, pos2
            params, body = self.procs[fname]
            args = []
            for _ in params:
                v,pos2 = self.eval_tokens(toks,pos2,scope)
                args.append(v)
            newscope = Scope(self.globals)
            for p,v in zip(params,args):
                newscope.locals[p]=v
            try:
                self.exec_block(body, newscope)
            except RetEx as r:
                return r.val, pos2
            return 0, pos2
        if tok == 'LEN':
            lname = toks[pos+1]
            lst = self.lists.get(lname, [])
            return len(lst), pos+2
        if tok == 'AT':
            lname = toks[pos+1]
            idx,pos2 = self.eval_tokens(toks,pos+2,scope)
            lst = self.lists.get(lname, [])
            n = len(lst)
            i = idx
            if i < 0:
                i = n + i
            if i < 0 or i >= n:
                return 0, pos2
            return lst[i], pos2
        # literal or var
        try:
            val = int(tok)
            return val, pos+1
        except ValueError:
            return scope.get(tok), pos+1

    def eval_expr(self, toks, scope):
        val, pos = self.eval_tokens(toks, 0, scope)
        assert pos == len(toks), f"leftover tokens {toks[pos:]}"
        return val

    def exec_block(self, body, scope):
        i = 0
        while i < len(body):
            stmt = body[i]
            kind = stmt[0]
            if kind == 'SET':
                toks = stmt[1]
                name = toks[0]
                val = self.eval_expr(toks[1:], scope)
                scope.set(name, val)
            elif kind == 'SETS':
                toks = stmt[1]
                v,w = toks[0], toks[1]
                # need to split e and f expressions
                rest = toks[2:]
                eval1, pos = self.eval_tokens(rest, 0, scope)
                eval2, pos2 = self.eval_tokens(rest, pos, scope)
                scope.set(v, eval1)
                scope.set(w, eval2)
            elif kind == 'PRINT':
                toks = stmt[1]
                val = self.eval_expr(toks, scope)
                self.output.append(val)
            elif kind == 'PUSH':
                toks = stmt[1]
                lname = toks[0]
                val = self.eval_expr(toks[1:], scope)
                self.lists.setdefault(lname, []).append(val)
            elif kind == 'REPEAT':
                _, expr, bbody = stmt
                count = self.eval_expr(expr, scope)
                j = 0
                while j < count:
                    j += 1
                    try:
                        self.exec_block(bbody, scope)
                    except BreakEx:
                        break
                    except ContinueEx:
                        continue
            elif kind == 'WHILE':
                _, expr, bbody = stmt
                while self.eval_expr(expr, scope) != 0:
                    try:
                        self.exec_block(bbody, scope)
                    except BreakEx:
                        break
                    except ContinueEx:
                        continue
            elif kind == 'IF':
                _, expr, b1, b2 = stmt
                cond = self.eval_expr(expr, scope)
                if cond != 0:
                    self.exec_block(b1, scope)
                elif b2 is not None:
                    self.exec_block(b2, scope)
            elif kind == 'BREAK':
                raise BreakEx()
            elif kind == 'CONTINUE':
                raise ContinueEx()
            elif kind == 'RET':
                toks = stmt[1]
                val = self.eval_expr(toks, scope)
                raise RetEx(val)
            elif kind == 'GLOBAL':
                toks = stmt[1]
                scope.declare_global(toks[0])
            elif kind == 'DEF':
                _, name, params, dbody = stmt
                self.procs[name] = (params, dbody)
            else:
                raise Exception("unhandled "+kind)
            i += 1

    def run(self):
        scope = Scope(self.globals)
        scope.locals = self.globals
        self.exec_block(self.program, scope)
        return self.output

with open('program.stamp') as f:
    lines = tokenize(f.readlines())
prog = parse_program(lines)
interp = Interp(prog)
out = interp.run()
print(' '.join(str(x) for x in out))
