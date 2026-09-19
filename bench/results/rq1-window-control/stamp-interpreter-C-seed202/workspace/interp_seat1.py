import sys

def tokenize_lines(text):
    lines = []
    for raw in text.splitlines():
        raw = raw.strip()
        if raw == '':
            continue
        toks = raw.split(' ')
        lines.append(toks)
    return lines

class BreakEx(Exception): pass
class ContinueEx(Exception): pass
class RetEx(Exception):
    def __init__(self, val): self.val = val

def is_int_literal(tok):
    if tok == '-':
        return False
    if tok[0] == '-':
        return tok[1:].isdigit() and len(tok) > 1
    return tok.isdigit()

class Interp:
    def __init__(self, lines):
        self.lines = lines
        self.n = len(lines)
        self.globals = {}
        self.lists = {}
        self.procs = {}
        self.output = []

    def find_matching_end(self, start):
        depth = 1
        i = start + 1
        while i < self.n:
            head = self.lines[i][0]
            if head in ('REPEAT', 'WHILE', 'IF', 'DEF'):
                depth += 1
            elif head == 'END':
                depth -= 1
                if depth == 0:
                    return i
            i += 1
        raise Exception('no matching end for line %d' % start)

    def run(self):
        scope = {'locals': None, 'is_global': True}
        self.exec_block(0, self.n, scope)

    def exec_block(self, start, end, scope):
        i = start
        while i < end:
            toks = self.lines[i]
            head = toks[0]
            if head == 'DEF':
                name = toks[1]
                params = toks[2:]
                end_idx = self.find_matching_end(i)
                self.procs[name] = (params, i + 1, end_idx)
                i = end_idx + 1
                continue
            elif head == 'SET':
                v = toks[1]
                val, _ = self.eval_expr(toks, 2, scope)
                self.assign(v, val, scope)
                i += 1
                continue
            elif head == 'SETS':
                v = toks[1]
                w = toks[2]
                val_e, pos = self.eval_expr(toks, 3, scope)
                val_f, pos2 = self.eval_expr(toks, pos, scope)
                self.assign(v, val_e, scope)
                self.assign(w, val_f, scope)
                i += 1
                continue
            elif head == 'PRINT':
                val, _ = self.eval_expr(toks, 1, scope)
                self.output.append(val)
                i += 1
                continue
            elif head == 'PUSH':
                Lname = toks[1]
                val, _ = self.eval_expr(toks, 2, scope)
                self.lists.setdefault(Lname, []).append(val)
                i += 1
                continue
            elif head == 'REPEAT':
                cnt, _ = self.eval_expr(toks, 1, scope)
                end_idx = self.find_matching_end(i)
                body_start, body_end = i + 1, end_idx
                k = 0
                while k < cnt:
                    k += 1
                    try:
                        self.exec_block(body_start, body_end, scope)
                    except BreakEx:
                        break
                    except ContinueEx:
                        continue
                i = end_idx + 1
                continue
            elif head == 'WHILE':
                end_idx = self.find_matching_end(i)
                body_start, body_end = i + 1, end_idx
                while True:
                    cond, _ = self.eval_expr(toks, 1, scope)
                    if cond == 0:
                        break
                    try:
                        self.exec_block(body_start, body_end, scope)
                    except BreakEx:
                        break
                    except ContinueEx:
                        continue
                i = end_idx + 1
                continue
            elif head == 'IF':
                end_idx = self.find_matching_end(i)
                else_idx = None
                depth = 0
                j = i + 1
                while j < end_idx:
                    h = self.lines[j][0]
                    if h in ('REPEAT', 'WHILE', 'IF', 'DEF'):
                        depth += 1
                    elif h == 'END':
                        depth -= 1
                    elif h == 'ELSE' and depth == 0:
                        else_idx = j
                    j += 1
                cond, _ = self.eval_expr(toks, 1, scope)
                if cond != 0:
                    self.exec_block(i + 1, else_idx if else_idx is not None else end_idx, scope)
                elif else_idx is not None:
                    self.exec_block(else_idx + 1, end_idx, scope)
                i = end_idx + 1
                continue
            elif head == 'BREAK':
                raise BreakEx()
            elif head == 'CONTINUE':
                raise ContinueEx()
            elif head == 'RET':
                val, _ = self.eval_expr(toks, 1, scope)
                raise RetEx(val)
            elif head == 'GLOBAL':
                v = toks[1]
                if scope['locals'] is not None:
                    scope.setdefault('global_decl', set()).add(v)
                i += 1
                continue
            else:
                raise Exception('unknown stmt ' + head)
        return

    def assign(self, v, val, scope):
        if scope['locals'] is None:
            self.globals[v] = val
            return
        if v in scope.get('global_decl', set()):
            self.globals[v] = val
            return
        scope['locals'][v] = val

    def read_var(self, v, scope):
        if scope['locals'] is None:
            return self.globals.get(v, 0)
        if v in scope.get('global_decl', set()):
            return self.globals.get(v, 0)
        if v in scope['locals']:
            return scope['locals'][v]
        return self.globals.get(v, 0)

    def next_var(self, v, scope):
        newval = self.read_var(v, scope) + 1
        self.assign(v, newval, scope)
        return newval

    def eval_expr(self, toks, pos, scope):
        tok = toks[pos]
        if is_int_literal(tok):
            return int(tok), pos + 1
        if tok in ('+', '-', '*', '/', '%', '<', '=', 'AND', 'OR', 'MIN', 'MAX', 'POW'):
            a, pos = self.eval_expr(toks, pos + 1, scope)
            b, pos = self.eval_expr(toks, pos, scope)
            if tok == '+': return a + b, pos
            if tok == '-': return a - b, pos
            if tok == '*': return a * b, pos
            if tok == '/':
                return (0 if b == 0 else a // b), pos
            if tok == '%':
                return (0 if b == 0 else a - (a // b) * b), pos
            if tok == '<': return (1 if a < b else 0), pos
            if tok == '=': return (1 if a == b else 0), pos
            if tok == 'AND': return (1 if (a != 0 and b != 0) else 0), pos
            if tok == 'OR': return (1 if (a != 0 or b != 0) else 0), pos
            if tok == 'MIN': return min(a, b), pos
            if tok == 'MAX': return max(a, b), pos
            if tok == 'POW':
                return (0 if b < 0 else a ** b), pos
        if tok in ('NOT', 'ABS'):
            a, pos = self.eval_expr(toks, pos + 1, scope)
            if tok == 'NOT': return (1 if a == 0 else 0), pos
            if tok == 'ABS': return abs(a), pos
        if tok == 'NEXT':
            v = toks[pos + 1]
            return self.next_var(v, scope), pos + 2
        if tok == 'LEN':
            Lname = toks[pos + 1]
            return len(self.lists.get(Lname, [])), pos + 2
        if tok == 'AT':
            Lname = toks[pos + 1]
            idx, pos2 = self.eval_expr(toks, pos + 2, scope)
            lst = self.lists.get(Lname, [])
            actual = len(lst) + idx if idx < 0 else idx
            if 0 <= actual < len(lst):
                return lst[actual], pos2
            return 0, pos2
        if tok == 'CALL':
            fname = toks[pos + 1]
            p = pos + 2
            if fname not in self.procs:
                return 0, p
            params, body_start, body_end = self.procs[fname]
            args = []
            for _ in params:
                val, p = self.eval_expr(toks, p, scope)
                args.append(val)
            newlocals = dict(zip(params, args))
            newscope = {'locals': newlocals, 'is_global': False, 'global_decl': set()}
            try:
                self.exec_block(body_start, body_end, newscope)
                return 0, p
            except RetEx as r:
                return r.val, p
        val = self.read_var(tok, scope)
        return val, pos + 1


text = open(sys.argv[1]).read()
lines = tokenize_lines(text)
interp = Interp(lines)
interp.run()
print(' '.join(str(x) for x in interp.output))
