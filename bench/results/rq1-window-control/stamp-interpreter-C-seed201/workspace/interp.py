import sys

def tokenize(text):
    lines = []
    for raw in text.splitlines():
        toks = raw.split()
        if toks:
            lines.append(toks)
    return lines

def parse_blocks(lines):
    # returns list of statements (each stmt is dict), consuming matching END
    pass

class Proc:
    def __init__(self, params, body):
        self.params = params
        self.body = body

class BreakExc(Exception): pass
class ContinueExc(Exception): pass
class RetExc(Exception):
    def __init__(self, val):
        self.val = val

def parse_program(lines):
    # returns list of top-level statements; DEF bodies parsed recursively
    idx = [0]
    def parse_stmts(terminators):
        stmts = []
        while idx[0] < len(lines):
            toks = lines[idx[0]]
            head = toks[0]
            if head in terminators:
                return stmts
            if head == 'DEF':
                name = toks[1]
                params = toks[2:]
                idx[0]+=1
                body = parse_stmts(['END'])
                idx[0]+=1 # consume END
                stmts.append(('DEF', name, params, body))
            elif head == 'REPEAT':
                expr = toks[1:]
                idx[0]+=1
                body = parse_stmts(['END'])
                idx[0]+=1
                stmts.append(('REPEAT', expr, body))
            elif head == 'WHILE':
                expr = toks[1:]
                idx[0]+=1
                body = parse_stmts(['END'])
                idx[0]+=1
                stmts.append(('WHILE', expr, body))
            elif head == 'IF':
                expr = toks[1:]
                idx[0]+=1
                body1 = parse_stmts(['END','ELSE'])
                if lines[idx[0]][0] == 'ELSE':
                    idx[0]+=1
                    body2 = parse_stmts(['END'])
                    idx[0]+=1
                    stmts.append(('IF', expr, body1, body2))
                else:
                    idx[0]+=1
                    stmts.append(('IF', expr, body1, None))
            elif head == 'SET':
                stmts.append(('SET', toks[1], toks[2:]))
                idx[0]+=1
            elif head == 'SETS':
                v,w = toks[1], toks[2]
                rest = toks[3:]
                stmts.append(('SETS', v, w, rest))
                idx[0]+=1
            elif head == 'PRINT':
                stmts.append(('PRINT', toks[1:]))
                idx[0]+=1
            elif head == 'PUSH':
                stmts.append(('PUSH', toks[1], toks[2:]))
                idx[0]+=1
            elif head == 'BREAK':
                stmts.append(('BREAK',))
                idx[0]+=1
            elif head == 'CONTINUE':
                stmts.append(('CONTINUE',))
                idx[0]+=1
            elif head == 'RET':
                stmts.append(('RET', toks[1:]))
                idx[0]+=1
            elif head == 'GLOBAL':
                stmts.append(('GLOBAL', toks[1]))
                idx[0]+=1
            else:
                raise Exception('unknown stmt '+head)
        return stmts
    stmts = parse_stmts([])
    return stmts

# Expression parsing: consume tokens from a list, returning (value_node, rest)
def parse_expr(toks):
    tok = toks[0]
    rest = toks[1:]
    binops = {'+','-','*','/','%','<','=','AND','OR','MIN','MAX','POW'}
    unops = {'NOT','ABS'}
    if tok in binops:
        a, rest = parse_expr(rest)
        b, rest = parse_expr(rest)
        return (tok, a, b), rest
    if tok in unops:
        a, rest = parse_expr(rest)
        return (tok, a), rest
    if tok == 'NEXT':
        v = rest[0]
        return ('NEXT', v), rest[1:]
    if tok == 'CALL':
        f = rest[0]
        rest = rest[1:]
        return ('CALL', f, rest), []  # special-cased below since args count depends on def; handled in eval directly
    if tok == 'LEN':
        a, rest = parse_expr(rest)
        return ('LEN', a), rest
    if tok == 'AT':
        a, rest = parse_expr(rest)
        b, rest = parse_expr(rest)
        return ('AT', a, b), rest
    # literal or var
    try:
        val = int(tok)
        return ('LIT', val), rest
    except ValueError:
        return ('VAR', tok), rest

class Interp:
    def __init__(self):
        self.globals = {}
        self.lists = {}
        self.procs = {}
        self.output = []

    def run(self, stmts):
        env = Scope(self, None, is_global=True)
        self.exec_stmts(stmts, env)

    def exec_stmts(self, stmts, env):
        for s in stmts:
            self.exec_stmt(s, env)

    def exec_stmt(self, s, env):
        kind = s[0]
        if kind == 'DEF':
            _, name, params, body = s
            self.procs[name] = Proc(params, body)
        elif kind == 'SET':
            _, v, exprtoks = s
            node, rest = parse_expr(exprtoks)
            val = self.eval(node, env)
            env.set(v, val)
        elif kind == 'SETS':
            _, v, w, exprtoks = s
            node1, rest = parse_expr(exprtoks)
            node2, rest2 = parse_expr(rest)
            val1 = self.eval(node1, env)
            val2 = self.eval(node2, env)
            env.set(v, val1)
            env.set(w, val2)
        elif kind == 'PRINT':
            node, rest = parse_expr(s[1])
            val = self.eval(node, env)
            self.output.append(val)
        elif kind == 'PUSH':
            _, L, exprtoks = s
            node, rest = parse_expr(exprtoks)
            val = self.eval(node, env)
            self.lists.setdefault(L, []).append(val)
        elif kind == 'REPEAT':
            _, exprtoks, body = s
            node, rest = parse_expr(exprtoks)
            n = self.eval(node, env)
            i = 0
            while i < n:
                i += 1
                try:
                    self.exec_stmts(body, env)
                except ContinueExc:
                    continue
                except BreakExc:
                    break
        elif kind == 'WHILE':
            _, exprtoks, body = s
            while True:
                node, rest = parse_expr(exprtoks)
                cond = self.eval(node, env)
                if cond == 0:
                    break
                try:
                    self.exec_stmts(body, env)
                except ContinueExc:
                    continue
                except BreakExc:
                    break
        elif kind == 'IF':
            _, exprtoks, body1, body2 = s
            node, rest = parse_expr(exprtoks)
            cond = self.eval(node, env)
            if cond != 0:
                self.exec_stmts(body1, env)
            elif body2 is not None:
                self.exec_stmts(body2, env)
        elif kind == 'BREAK':
            raise BreakExc()
        elif kind == 'CONTINUE':
            raise ContinueExc()
        elif kind == 'RET':
            node, rest = parse_expr(s[1])
            val = self.eval(node, env)
            raise RetExc(val)
        elif kind == 'GLOBAL':
            env.declare_global(s[1])
        else:
            raise Exception('unknown '+str(s))

    def eval(self, node, env):
        kind = node[0]
        if kind == 'LIT':
            return node[1]
        if kind == 'VAR':
            return env.get(node[1])
        if kind == 'NEXT':
            v = node[1]
            cur = env.get(v)
            newv = cur + 1
            env.set(v, newv)
            return newv
        if kind == 'LEN':
            a = self.eval(node[1], env)
            return len(self.lists.get_list_by_value(a)) if False else None
        if kind == 'AT':
            pass
        if kind in ('+','-','*','/','%','<','=','AND','OR','MIN','MAX','POW'):
            a = self.eval(node[1], env)
            b = self.eval(node[2], env)
            return self.binop(kind, a, b)
        if kind in ('NOT','ABS'):
            a = self.eval(node[1], env)
            if kind == 'NOT':
                return 1 if a == 0 else 0
            else:
                return abs(a)
        if kind == 'CALL':
            f = node[1]
            argtoks = node[2]
            return self.call(f, argtoks, env)
        raise Exception('bad node '+str(node))

    def binop(self, op, a, b):
        if op == '+': return a+b
        if op == '-': return a-b
        if op == '*': return a*b
        if op == '/':
            if b == 0: return 0
            return a // b  # python floor division matches floor toward -inf
        if op == '%':
            if b == 0: return 0
            return a - (a//b)*b
        if op == '<': return 1 if a < b else 0
        if op == '=': return 1 if a == b else 0
        if op == 'AND': return 1 if (a!=0 and b!=0) else 0
        if op == 'OR': return 1 if (a!=0 or b!=0) else 0
        if op == 'MIN': return min(a,b)
        if op == 'MAX': return max(a,b)
        if op == 'POW':
            if b < 0: return 0
            return a ** b
        raise Exception('bad op '+op)

    def call(self, f, argtoks, env):
        # parse args: number determined by proc def in force
        proc = self.procs.get(f)
        if proc is None:
            return 0
        nargs = len(proc.params)
        args = []
        rest = argtoks
        for _ in range(nargs):
            node, rest = parse_expr(rest)
            args.append(self.eval(node, env))
        newenv = Scope(self, None)
        for p, v in zip(proc.params, args):
            newenv.locals[p] = v
        try:
            self.exec_stmts(proc.body, newenv)
        except RetExc as r:
            return r.val
        return 0

class Scope:
    def __init__(self, interp, parent, is_global=False):
        self.interp = interp
        self.locals = {}
        self.globals_declared = set()
        self.is_global = is_global

    def get(self, name):
        if self.is_global or name in self.globals_declared:
            return self.interp.globals.get(name, 0)
        if name in self.locals:
            return self.locals[name]
        return self.interp.globals.get(name, 0)

    def set(self, name, val):
        if self.is_global or name in self.globals_declared:
            self.interp.globals[name] = val
        else:
            self.locals[name] = val

    def declare_global(self, name):
        self.globals_declared.add(name)

# Need LEN/AT to use lists properly; patch eval
orig_eval = Interp.eval
def eval2(self, node, env):
    kind = node[0]
    if kind == 'LEN':
        # node[1] is a VAR node representing list name typically, but per grammar LEN L, L is a name token parsed as VAR
        lname = node[1][1] if node[1][0]=='VAR' else None
        lst = self.lists.get(lname, [])
        return len(lst)
    if kind == 'AT':
        lname = node[1][1] if node[1][0]=='VAR' else None
        idx = self.eval(node[2], env)
        lst = self.lists.get(lname, [])
        n = len(lst)
        if idx < 0:
            idx = n + idx
        if idx < 0 or idx >= n:
            return 0
        return lst[idx]
    return orig_eval(self, node, env)
Interp.eval = eval2

if __name__ == '__main__':
    with open('program.stamp') as f:
        text = f.read()
    lines = tokenize(text)
    stmts = parse_program(lines)
    interp = Interp()
    interp.run(stmts)
    print(' '.join(str(x) for x in interp.output))
