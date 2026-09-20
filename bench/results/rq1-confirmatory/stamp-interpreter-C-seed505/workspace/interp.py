import sys

def tokenize_line(line):
    return line.split()

def load(path):
    with open(path) as f:
        lines = [l.rstrip('\n') for l in f]
    toks = []
    for l in lines:
        l = l.strip()
        if l == '':
            continue
        toks.append(l.split(' '))
    return toks

class Break(Exception): pass
class Continue(Exception): pass
class Ret(Exception):
    def __init__(self, v): self.v = v

class Interp:
    def __init__(self, lines):
        self.lines = lines
        self.globals = {}
        self.lists = {}
        self.procs = {}  # name -> (params, body_start, body_end)
        self.output = []

    def find_matching_end(self, i):
        depth = 1
        j = i+1
        while depth > 0:
            tok = self.lines[j][0]
            if tok in ('REPEAT','WHILE','IF','DEF'):
                depth += 1
            elif tok == 'END':
                depth -= 1
            j += 1
        return j-1  # index of END

    def run(self):
        self.exec_block(0, len(self.lines), {}, None)

    def exec_block(self, start, end, scope, global_names):
        # global_names: set of names declared GLOBAL in this call scope, or None if top-level
        i = start
        while i < end:
            tok = self.lines[i]
            op = tok[0]
            if op == 'DEF':
                name = tok[1]
                params = tok[2:]
                e = self.find_matching_end(i)
                self.procs[name] = (params, i+1, e)
                i = e+1
                continue
            elif op == 'SET':
                v = tok[1]
                val = self.eval_expr(tok[2:], scope, global_names)
                self.assign(v, val, scope, global_names)
                i += 1
                continue
            elif op == 'SETS':
                v = tok[1]; w = tok[2]
                # need to split remaining tokens into two expressions
                rest = tok[3:]
                e1, consumed = self.parse_expr(rest, 0)
                e2, consumed2 = self.parse_expr(rest, consumed)
                val_e = self.eval_parsed(e1, scope, global_names)
                val_f = self.eval_parsed(e2, scope, global_names)
                self.assign(v, val_e, scope, global_names)
                self.assign(w, val_f, scope, global_names)
                i += 1
                continue
            elif op == 'PRINT':
                val = self.eval_expr(tok[1:], scope, global_names)
                self.output.append(val)
                i += 1
                continue
            elif op == 'PUSH':
                L = tok[1]
                val = self.eval_expr(tok[2:], scope, global_names)
                self.lists.setdefault(L, []).append(val)
                i += 1
                continue
            elif op == 'REPEAT':
                e = self.find_matching_end(i)
                cnt = self.eval_expr(tok[1:], scope, global_names)
                body_start = i+1
                body_end = e
                n = cnt
                k = 0
                while k < n:
                    k += 1
                    try:
                        self.exec_block(body_start, body_end, scope, global_names)
                    except Break:
                        break
                    except Continue:
                        continue
                i = e+1
                continue
            elif op == 'WHILE':
                e = self.find_matching_end(i)
                body_start = i+1
                body_end = e
                while True:
                    cond = self.eval_expr(tok[1:], scope, global_names)
                    if cond == 0:
                        break
                    try:
                        self.exec_block(body_start, body_end, scope, global_names)
                    except Break:
                        break
                    except Continue:
                        continue
                i = e+1
                continue
            elif op == 'IF':
                e = self.find_matching_end(i)
                # find ELSE within this if at depth 0
                else_idx = None
                depth = 0
                j = i+1
                while j < e:
                    t0 = self.lines[j][0]
                    if t0 in ('REPEAT','WHILE','IF','DEF'):
                        depth += 1
                    elif t0 == 'END':
                        depth -= 1
                    elif t0 == 'ELSE' and depth == 0:
                        else_idx = j
                    j += 1
                cond = self.eval_expr(tok[1:], scope, global_names)
                if cond != 0:
                    body_start = i+1
                    body_end = else_idx if else_idx is not None else e
                    self.exec_block(body_start, body_end, scope, global_names)
                else:
                    if else_idx is not None:
                        self.exec_block(else_idx+1, e, scope, global_names)
                i = e+1
                continue
            elif op == 'ELSE':
                # shouldn't hit directly
                i += 1
                continue
            elif op == 'BREAK':
                raise Break()
            elif op == 'CONTINUE':
                raise Continue()
            elif op == 'RET':
                val = self.eval_expr(tok[1:], scope, global_names)
                raise Ret(val)
            elif op == 'GLOBAL':
                name = tok[1]
                global_names.add(name)
                if name in scope:
                    del scope[name]
                i += 1
                continue
            elif op == 'END':
                i += 1
                continue
            else:
                raise Exception('unknown stmt ' + op)
        return

    def assign(self, name, val, scope, global_names):
        if global_names is None:
            self.globals[name] = val
        else:
            if name in global_names:
                self.globals[name] = val
            else:
                scope[name] = val

    def read_var(self, name, scope, global_names):
        if global_names is None:
            return self.globals.get(name, 0)
        else:
            if name in global_names:
                return self.globals.get(name, 0)
            if name in scope:
                return scope[name]
            return self.globals.get(name, 0)

    def next_var(self, name, scope, global_names):
        cur = self.read_var(name, scope, global_names)
        newv = cur + 1
        self.assign(name, newv, scope, global_names)
        return newv

    # Expression parsing: returns (parsed_tree, num_tokens_consumed)
    def parse_expr(self, toks, idx):
        t = toks[idx]
        binary_ops = {'+','-','*','/','%','<','=','AND','OR','MIN','MAX','POW'}
        unary_ops = {'NOT','ABS'}
        if t in binary_ops:
            a, c1 = self.parse_expr(toks, idx+1)
            b, c2 = self.parse_expr(toks, idx+1+c1)
            return (('bin', t, a, b), 1+c1+c2)
        if t in unary_ops:
            a, c1 = self.parse_expr(toks, idx+1)
            return (('un', t, a), 1+c1)
        if t == 'NEXT':
            v = toks[idx+1]
            return (('next', v), 2)
        if t == 'CALL':
            f = toks[idx+1]
            params = self.procs.get(f, ([],0,0))[0]
            nargs = len(params) if f in self.procs else 0
            args = []
            pos = idx+2
            for _ in range(nargs):
                a, c = self.parse_expr(toks, pos)
                args.append(a)
                pos += c
            return (('call', f, args), pos-idx)
        if t == 'LEN':
            a, c1 = self.parse_expr(toks, idx+1)
            return (('len', a), 1+c1)
        if t == 'AT':
            a, c1 = self.parse_expr(toks, idx+1)
            b, c2 = self.parse_expr(toks, idx+1+c1)
            return (('at', a, b), 1+c1+c2)
        # literal or name
        if is_int_literal(t):
            return (('lit', int(t)), 1)
        return (('var', t), 1)

    def eval_expr(self, toks, scope, global_names):
        tree, c = self.parse_expr(toks, 0)
        return self.eval_parsed(tree, scope, global_names)

    def eval_parsed(self, tree, scope, global_names):
        kind = tree[0]
        if kind == 'lit':
            return tree[1]
        if kind == 'var':
            return self.read_var(tree[1], scope, global_names)
        if kind == 'next':
            return self.next_var(tree[1], scope, global_names)
        if kind == 'un':
            op = tree[1]
            a = self.eval_parsed(tree[2], scope, global_names)
            if op == 'NOT':
                return 1 if a == 0 else 0
            if op == 'ABS':
                return abs(a)
        if kind == 'bin':
            op = tree[1]
            a = self.eval_parsed(tree[2], scope, global_names)
            b = self.eval_parsed(tree[3], scope, global_names)
            if op == '+': return a+b
            if op == '-': return a-b
            if op == '*': return a*b
            if op == '/':
                if b == 0: return 0
                return a // b
            if op == '%':
                if b == 0: return 0
                return a - (a//b)*b
            if op == '<': return 1 if a < b else 0
            if op == '=': return 1 if a == b else 0
            if op == 'AND': return 1 if (a != 0 and b != 0) else 0
            if op == 'OR': return 1 if (a != 0 or b != 0) else 0
            if op == 'MIN': return min(a,b)
            if op == 'MAX': return max(a,b)
            if op == 'POW':
                if b < 0: return 0
                return a ** b
        if kind == 'call':
            f = tree[1]
            args_trees = tree[2]
            argvals = [self.eval_parsed(a, scope, global_names) for a in args_trees]
            if f not in self.procs:
                return 0
            params, bstart, bend = self.procs[f]
            newscope = {}
            for p, v in zip(params, argvals):
                newscope[p] = v
            newglobals = set()
            try:
                self.exec_block(bstart, bend, newscope, newglobals)
            except Ret as r:
                return r.v
            return 0
        if kind == 'len':
            a = tree[1]
            # a is expr tree but LEN L takes a list name directly per spec ("LEN L")
            name = a[1] if a[0]=='var' else None
            return len(self.lists.get(name, []))
        if kind == 'at':
            Lname = tree[1][1] if tree[1][0]=='var' else None
            idxv = self.eval_parsed(tree[2], scope, global_names)
            lst = self.lists.get(Lname, [])
            n = len(lst)
            if idxv < 0:
                idxv2 = n + idxv
            else:
                idxv2 = idxv
            if 0 <= idxv2 < n:
                return lst[idxv2]
            return 0
        raise Exception('bad tree ' + str(tree))

def is_int_literal(t):
    if t == '-' :
        return False
    if t.startswith('-'):
        return t[1:].isdigit()
    return t.isdigit()

if __name__ == '__main__':
    lines = load(sys.argv[1])
    interp = Interp(lines)
    interp.run()
    print(' '.join(str(x) for x in interp.output))
