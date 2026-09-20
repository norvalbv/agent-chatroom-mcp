import sys

def tokenize(lines):
    toks = []
    for ln in lines:
        parts = ln.split()
        if parts:
            toks.append(parts)
    return toks

class Break(Exception): pass
class Continue(Exception): pass
class Ret(Exception):
    def __init__(self, v): self.v = v

class Prog:
    def __init__(self, lines):
        self.lines = [l.split() for l in lines if l.strip() != '']
        self.n = len(self.lines)
        self.procs = {}
        self.globals = {}
        self.lists = {}
        self.output = []

    def find_match(self, i):
        depth = 1
        j = i+1
        while j < self.n:
            head = self.lines[j][0]
            if head in ('REPEAT','WHILE','IF','DEF'):
                depth += 1
            elif head == 'END':
                depth -= 1
                if depth == 0:
                    return j
            j += 1
        raise Exception("no match")

    def run(self):
        i = 0
        env_stack = [({}, None)]  # (locals or None for global scope marker, globalset)
        self.exec_block(0, self.n, [self.globals], is_proc=False)

    def exec_block(self, start, end, scopes, is_proc):
        i = start
        while i < end:
            toks = self.lines[i]
            head = toks[0]
            if head == 'DEF':
                name = toks[1]
                params = toks[2:]
                j = self.find_match(i)
                self.procs[name] = (params, i+1, j)
                i = j+1
                continue
            elif head in ('REPEAT','WHILE'):
                j = self.find_match(i)
                if head == 'REPEAT':
                    cnt = self.eval_expr(toks, 1, scopes)[0]
                    k = 0
                    while k < cnt:
                        k += 1
                        try:
                            self.exec_block(i+1, j, scopes, is_proc)
                        except Break:
                            break
                        except Continue:
                            continue
                else:
                    while True:
                        cond = self.eval_expr(toks, 1, scopes)[0]
                        if cond == 0:
                            break
                        try:
                            self.exec_block(i+1, j, scopes, is_proc)
                        except Break:
                            break
                        except Continue:
                            continue
                i = j+1
                continue
            elif head == 'IF':
                j = self.find_match(i)
                # find ELSE within this if block at depth 1
                else_idx = None
                depth = 1
                k = i+1
                while k < j:
                    h = self.lines[k][0]
                    if h in ('REPEAT','WHILE','IF','DEF'):
                        depth += 1
                    elif h == 'END':
                        depth -= 1
                    elif h == 'ELSE' and depth == 1:
                        else_idx = k
                    k += 1
                cond = self.eval_expr(toks, 1, scopes)[0]
                if cond != 0:
                    body_end = else_idx if else_idx is not None else j
                    self.exec_block(i+1, body_end, scopes, is_proc)
                else:
                    if else_idx is not None:
                        self.exec_block(else_idx+1, j, scopes, is_proc)
                i = j+1
                continue
            elif head == 'END' or head == 'ELSE':
                i += 1
                continue
            elif head == 'BREAK':
                raise Break()
            elif head == 'CONTINUE':
                raise Continue()
            elif head == 'RET':
                v, _ = self.eval_expr(toks[1:], 0, scopes)
                raise Ret(v)
            elif head == 'GLOBAL':
                name = toks[1]
                scopes[-1]['__global__' + name] = True
                i += 1
                continue
            elif head == 'SET':
                v = toks[1]
                val, _ = self.eval_expr(toks[2:], 0, scopes)
                self.assign(v, val, scopes)
                i += 1
                continue
            elif head == 'SETS':
                v = toks[1]; w = toks[2]
                rest = toks[3:]
                val_e, pos = self.eval_expr(rest, 0, scopes)
                val_f, pos2 = self.eval_expr(rest, pos, scopes)
                self.assign(v, val_e, scopes)
                self.assign(w, val_f, scopes)
                i += 1
                continue
            elif head == 'PRINT':
                val, _ = self.eval_expr(toks[1:], 0, scopes)
                self.output.append(val)
                i += 1
                continue
            elif head == 'PUSH':
                L = toks[1]
                val, _ = self.eval_expr(toks[2:], 0, scopes)
                self.lists.setdefault(L, []).append(val)
                i += 1
                continue
            else:
                raise Exception("unknown stmt " + head)
        return None

    def is_global_marked(self, name, scopes):
        return scopes[-1].get('__global__' + name, False)

    def assign(self, name, val, scopes):
        cur = scopes[-1]
        if self.is_global_marked(name, scopes):
            self.globals[name] = val
            return
        if len(scopes) == 1:
            self.globals[name] = val
        else:
            cur[name] = val

    def read_var(self, name, scopes):
        if self.is_global_marked(name, scopes):
            return self.globals.get(name, 0)
        cur = scopes[-1]
        if len(scopes) == 1:
            return self.globals.get(name, 0)
        if name in cur:
            return cur[name]
        return self.globals.get(name, 0)

    def next_var(self, name, scopes):
        if self.is_global_marked(name, scopes):
            v = self.globals.get(name, 0) + 1
            self.globals[name] = v
            return v
        cur = scopes[-1]
        if len(scopes) == 1:
            v = self.globals.get(name, 0) + 1
            self.globals[name] = v
            return v
        if name in cur:
            v = cur[name] + 1
        else:
            v = self.read_var(name, scopes) + 1
        cur[name] = v
        return v

    def eval_expr(self, toks, pos, scopes):
        tok = toks[pos]
        if tok == 'NEXT':
            name = toks[pos+1]
            return self.next_var(name, scopes), pos+2
        if tok == 'CALL':
            fname = toks[pos+1]
            pos2 = pos+2
            if fname not in self.procs:
                return 0, pos2
            params, body_start, body_end = self.procs[fname]
            args = []
            for p in params:
                v, pos2 = self.eval_expr(toks, pos2, scopes)
                args.append(v)
            new_scope = {}
            for pname, av in zip(params, args):
                new_scope[pname] = av
            scopes.append(new_scope)
            try:
                self.exec_block(body_start, body_end, scopes, True)
                result = 0
            except Ret as r:
                result = r.v
            scopes.pop()
            return result, pos2
        if tok == 'LEN':
            L = toks[pos+1]
            return len(self.lists.get(L, [])), pos+2
        if tok == 'AT':
            L = toks[pos+1]
            idxv, pos2 = self.eval_expr(toks, pos+2, scopes)
            lst = self.lists.get(L, [])
            n = len(lst)
            i = idxv
            if i < 0:
                i = n + i
            if i < 0 or i >= n:
                return 0, pos2
            return lst[i], pos2
        if tok in ('NOT','ABS'):
            a, pos2 = self.eval_expr(toks, pos+1, scopes)
            if tok == 'NOT':
                return (1 if a == 0 else 0), pos2
            else:
                return abs(a), pos2
        if tok in ('+','-','*','/','%','<','=','AND','OR','MIN','MAX','POW'):
            a, pos2 = self.eval_expr(toks, pos+1, scopes)
            b, pos3 = self.eval_expr(toks, pos2, scopes)
            if tok == '+': return a+b, pos3
            if tok == '-': return a-b, pos3
            if tok == '*': return a*b, pos3
            if tok == '/':
                if b == 0: return 0, pos3
                return a // b, pos3
            if tok == '%':
                if b == 0: return 0, pos3
                return a - (a // b) * b, pos3
            if tok == '<': return (1 if a < b else 0), pos3
            if tok == '=': return (1 if a == b else 0), pos3
            if tok == 'AND': return (1 if (a != 0 and b != 0) else 0), pos3
            if tok == 'OR': return (1 if (a != 0 or b != 0) else 0), pos3
            if tok == 'MIN': return min(a,b), pos3
            if tok == 'MAX': return max(a,b), pos3
            if tok == 'POW':
                if b < 0: return 0, pos3
                return a ** b, pos3
        # literal or variable
        try:
            v = int(tok)
            return v, pos+1
        except ValueError:
            return self.read_var(tok, scopes), pos+1

if __name__ == '__main__':
    with open(sys.argv[1]) as f:
        lines = f.readlines()
    p = Prog(lines)
    p.run()
    print(' '.join(str(x) for x in p.output))
