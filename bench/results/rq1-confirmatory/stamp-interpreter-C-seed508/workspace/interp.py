import sys

def parse_lines(path):
    lines = []
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            lines.append(line.split())
    return lines

class Break(Exception): pass
class Continue(Exception): pass
class Return(Exception):
    def __init__(self, v): self.v = v

class Block:
    def __init__(self, stmts):
        self.stmts = stmts

def build_blocks(tokens_list):
    # returns list of statements (each stmt is (kind, tokens, body...) ), consuming matching END
    pos = [0]
    def parse_block(enders):
        stmts = []
        while pos[0] < len(tokens_list):
            toks = tokens_list[pos[0]]
            kw = toks[0]
            if kw in enders:
                return stmts
            pos[0] += 1
            if kw in ('REPEAT','WHILE'):
                body = parse_block(('END',))
                pos[0] += 1  # consume END
                stmts.append((kw, toks[1:], body))
            elif kw == 'IF':
                body1 = parse_block(('END','ELSE'))
                if tokens_list[pos[0]][0] == 'ELSE':
                    pos[0] += 1
                    body2 = parse_block(('END',))
                    pos[0] += 1
                    stmts.append(('IF', toks[1:], body1, body2))
                else:
                    pos[0] += 1
                    stmts.append(('IF', toks[1:], body1, None))
            elif kw == 'DEF':
                body = parse_block(('END',))
                pos[0] += 1
                stmts.append(('DEF', toks[1:], body))
            else:
                stmts.append((kw, toks[1:]))
        return stmts
    return parse_block(())

class Interp:
    def __init__(self, program):
        self.globals = {}
        self.lists = {}
        self.procs = {}
        self.output = []
        self.program = program

    def get_list(self, name):
        if name not in self.lists:
            self.lists[name] = []
        return self.lists[name]

    def eval_expr(self, tokens, idx, scope):
        tok = tokens[idx]
        idx += 1
        if tok in ('+','-','*','/','%','<','=','AND','OR','MIN','MAX','POW'):
            a, idx = self.eval_expr(tokens, idx, scope)
            b, idx = self.eval_expr(tokens, idx, scope)
            if tok == '+': return a+b, idx
            if tok == '-': return a-b, idx
            if tok == '*': return a*b, idx
            if tok == '/':
                if b == 0: return 0, idx
                return a // b, idx
            if tok == '%':
                if b == 0: return 0, idx
                return a - (a//b)*b, idx
            if tok == '<': return (1 if a < b else 0), idx
            if tok == '=': return (1 if a == b else 0), idx
            if tok == 'AND': return (1 if (a!=0 and b!=0) else 0), idx
            if tok == 'OR': return (1 if (a!=0 or b!=0) else 0), idx
            if tok == 'MIN': return min(a,b), idx
            if tok == 'MAX': return max(a,b), idx
            if tok == 'POW':
                if b < 0: return 0, idx
                return a**b, idx
        if tok in ('NOT','ABS'):
            a, idx = self.eval_expr(tokens, idx, scope)
            if tok == 'NOT': return (1 if a==0 else 0), idx
            if tok == 'ABS': return abs(a), idx
        if tok == 'NEXT':
            name = tokens[idx]; idx += 1
            cur = self.read_var(name, scope)
            newv = cur + 1
            self.write_var(name, newv, scope)
            return newv, idx
        if tok == 'LEN':
            name = tokens[idx]; idx += 1
            return len(self.get_list(name)), idx
        if tok == 'AT':
            name = tokens[idx]; idx += 1
            i, idx = self.eval_expr(tokens, idx, scope)
            lst = self.get_list(name)
            if -len(lst) <= i < len(lst):
                return lst[i], idx
            return 0, idx
        if tok == 'CALL':
            fname = tokens[idx]; idx += 1
            proc = self.procs.get(fname)
            params = proc[0] if proc else []
            args = []
            for _ in params:
                v, idx = self.eval_expr(tokens, idx, scope)
                args.append(v)
            if proc is None:
                return 0, idx
            pnames, body = proc
            newscope = {'locals': dict(zip(pnames, args)), 'globalset': set()}
            try:
                self.exec_block(body, newscope)
            except Return as r:
                return r.v, idx
            return 0, idx
        # literal or var
        try:
            val = int(tok)
            return val, idx
        except ValueError:
            return self.read_var(tok, scope), idx

    def read_var(self, name, scope):
        if scope is None:
            return self.globals.get(name, 0)
        if name in scope['globalset']:
            return self.globals.get(name, 0)
        if name in scope['locals']:
            return scope['locals'][name]
        return self.globals.get(name, 0)

    def write_var(self, name, val, scope):
        if scope is None:
            self.globals[name] = val
            return
        if name in scope['globalset']:
            self.globals[name] = val
            return
        scope['locals'][name] = val

    def eval_full(self, tokens, scope):
        val, idx = self.eval_expr(tokens, 0, scope)
        assert idx == len(tokens), f"leftover tokens {tokens[idx:]}"
        return val

    def exec_block(self, stmts, scope):
        for stmt in stmts:
            self.exec_stmt(stmt, scope)

    def exec_stmt(self, stmt, scope):
        kind = stmt[0]
        if kind == 'SET':
            toks = stmt[1]
            v = toks[0]
            val = self.eval_full(toks[1:], scope)
            self.write_var(v, val, scope)
        elif kind == 'SETS':
            toks = stmt[1]
            v, w = toks[0], toks[1]
            # need to split e f expressions; find split point by parsing
            idx = 2
            e_val, idx = self.eval_expr(toks, idx, scope)
            f_val, idx2 = self.eval_expr(toks, idx, scope)
            assert idx2 == len(toks)
            self.write_var(v, e_val, scope)
            self.write_var(w, f_val, scope)
        elif kind == 'PRINT':
            val = self.eval_full(stmt[1], scope)
            self.output.append(val)
        elif kind == 'PUSH':
            toks = stmt[1]
            name = toks[0]
            val = self.eval_full(toks[1:], scope)
            self.get_list(name).append(val)
        elif kind == 'REPEAT':
            toks, body = stmt[1], stmt[2]
            n = self.eval_full(toks, scope)
            i = 0
            while i < n:
                i += 1
                try:
                    self.exec_block(body, scope)
                except Break:
                    break
                except Continue:
                    continue
        elif kind == 'WHILE':
            toks, body = stmt[1], stmt[2]
            while self.eval_full(toks, scope) != 0:
                try:
                    self.exec_block(body, scope)
                except Break:
                    break
                except Continue:
                    continue
        elif kind == 'IF':
            toks, body1, body2 = stmt[1], stmt[2], stmt[3]
            cond = self.eval_full(toks, scope)
            if cond != 0:
                self.exec_block(body1, scope)
            elif body2 is not None:
                self.exec_block(body2, scope)
        elif kind == 'BREAK':
            raise Break()
        elif kind == 'CONTINUE':
            raise Continue()
        elif kind == 'DEF':
            toks, body = stmt[1], stmt[2]
            fname = toks[0]
            params = toks[1:]
            self.procs[fname] = (params, body)
        elif kind == 'RET':
            val = self.eval_full(stmt[1], scope)
            raise Return(val)
        elif kind == 'GLOBAL':
            name = stmt[1][0]
            scope['globalset'].add(name)
        else:
            raise Exception('unknown stmt ' + kind)

    def run(self):
        self.exec_block(self.program, None)

if __name__ == '__main__':
    toks = parse_lines('program.stamp')
    program = build_blocks(toks)
    interp = Interp(program)
    interp.run()
    print(' '.join(str(v) for v in interp.output))
