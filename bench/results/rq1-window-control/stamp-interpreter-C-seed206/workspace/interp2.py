import sys

def tokenize(line):
    return line.split()

def parse_program(lines):
    return lines

class Frame:
    def __init__(self, globals_):
        self.locals = {}
        self.globals = globals_
        self.global_names = set()

    def get(self, name):
        if name in self.global_names:
            return self.globals.get(name, 0)
        if name in self.locals:
            return self.locals[name]
        return self.globals.get(name, 0)

    def set(self, name, val):
        if name in self.global_names:
            self.globals[name] = val
        else:
            self.locals[name] = val

    def next(self, name):
        cur = self.get(name)
        newv = cur + 1
        if name in self.global_names:
            self.globals[name] = newv
        else:
            self.locals[name] = newv
        return newv

    def declare_global(self, name):
        self.global_names.add(name)

class GlobalFrame:
    def __init__(self, globals_):
        self.globals = globals_
    def get(self, name):
        return self.globals.get(name, 0)
    def set(self, name, val):
        self.globals[name] = val
    def next(self, name):
        newv = self.get(name) + 1
        self.globals[name] = newv
        return newv
    def declare_global(self, name):
        pass

class Ret(Exception):
    def __init__(self, val):
        self.val = val

class Brk(Exception):
    pass
class Cont(Exception):
    pass

def is_int(tok):
    if tok[0] == '-' and len(tok) > 1:
        return tok[1:].isdigit()
    return tok.isdigit()

BINOPS = {'+','-','*','/','%','<','=','AND','OR','MIN','MAX','POW'}
UNOPS = {'NOT','ABS'}

def parse_expr(tokens, i, procs, frame, lists):
    tok = tokens[i]
    if is_int(tok):
        return int(tok), i+1
    if tok in BINOPS:
        a, i = parse_expr(tokens, i+1, procs, frame, lists)
        b, i = parse_expr(tokens, i, procs, frame, lists)
        if tok == '+': return a+b, i
        if tok == '-': return a-b, i
        if tok == '*': return a*b, i
        if tok == '/':
            if b == 0: return 0, i
            return a // b, i
        if tok == '%':
            if b == 0: return 0, i
            return a % b, i
        if tok == '<': return 1 if a < b else 0, i
        if tok == '=': return 1 if a == b else 0, i
        if tok == 'AND': return 1 if (a != 0 and b != 0) else 0, i
        if tok == 'OR': return 1 if (a != 0 or b != 0) else 0, i
        if tok == 'MIN': return min(a,b), i
        if tok == 'MAX': return max(a,b), i
        if tok == 'POW':
            if b < 0: return 0, i
            return a ** b, i
    if tok in UNOPS:
        a, i = parse_expr(tokens, i+1, procs, frame, lists)
        if tok == 'NOT': return (1 if a == 0 else 0), i
        if tok == 'ABS': return abs(a), i
    if tok == 'NEXT':
        v = tokens[i+1]
        return frame.next(v), i+2
    if tok == 'CALL':
        fname = tokens[i+1]
        i = i+2
        if fname not in procs:
            return 0, i
        params, body = procs[fname]
        args = []
        for p in params:
            val, i = parse_expr(tokens, i, procs, frame, lists)
            args.append(val)
        newframe = Frame(frame.globals if isinstance(frame, Frame) else frame.globals)
        # need globals dict; both Frame and GlobalFrame have .globals
        gdict = frame.globals
        newframe = Frame(gdict)
        for p, a in zip(params, args):
            newframe.locals[p] = a
        try:
            run_block(body, procs, newframe, lists)
        except Ret as r:
            return r.val, i
        return 0, i
    if tok == 'LEN':
        L = tokens[i+1]
        return len(lists.get(L, [])), i+2
    if tok == 'AT':
        L = tokens[i+1]
        idx, i2 = parse_expr(tokens, i+2, procs, frame, lists)
        lst = lists.get(L, [])
        if idx < 0:
            idx2 = len(lst) + idx
        else:
            idx2 = idx
        if 0 <= idx2 < len(lst):
            return lst[idx2], i2
        return 0, i2
    # variable name
    return frame.get(tok), i+1

def find_matching_end(lines, start):
    depth = 1
    j = start
    while depth > 0:
        j += 1
        t = lines[j].split()
        if t[0] in ('REPEAT','WHILE','IF','DEF'):
            depth += 1
        elif t[0] == 'END':
            depth -= 1
    return j

def find_else_or_end(lines, start):
    depth = 1
    j = start
    while True:
        j += 1
        t = lines[j].split()
        if t[0] in ('REPEAT','WHILE','IF','DEF'):
            depth += 1
        elif t[0] == 'END':
            depth -= 1
            if depth == 0:
                return j, None
        elif t[0] == 'ELSE' and depth == 1:
            return None, j

def run_block(lines, procs, frame, lists):
    i = 0
    n = len(lines)
    while i < n:
        toks = lines[i].split()
        cmd = toks[0]
        if cmd == 'SET':
            v = toks[1]
            val, _ = parse_expr(toks, 2, procs, frame, lists)
            frame.set(v, val)
            i += 1
        elif cmd == 'SETS':
            v, w = toks[1], toks[2]
            eval1, ni = parse_expr(toks, 3, procs, frame, lists)
            eval2, ni = parse_expr(toks, ni, procs, frame, lists)
            frame.set(v, eval1)
            frame.set(w, eval2)
            i += 1
        elif cmd == 'PRINT':
            val, _ = parse_expr(toks, 1, procs, frame, lists)
            OUTPUT.append(val)
            i += 1
        elif cmd == 'PUSH':
            L = toks[1]
            val, _ = parse_expr(toks, 2, procs, frame, lists)
            lists.setdefault(L, []).append(val)
            i += 1
        elif cmd == 'REPEAT':
            cnt, _ = parse_expr(toks, 1, procs, frame, lists)
            end = find_matching_end(lines, i)
            body = lines[i+1:end]
            k = 0
            while k < cnt:
                k += 1
                try:
                    run_block(body, procs, frame, lists)
                except Brk:
                    break
                except Cont:
                    continue
            i = end + 1
        elif cmd == 'WHILE':
            end = find_matching_end(lines, i)
            body = lines[i+1:end]
            while True:
                cval, _ = parse_expr(toks, 1, procs, frame, lists)
                if cval == 0:
                    break
                try:
                    run_block(body, procs, frame, lists)
                except Brk:
                    break
                except Cont:
                    continue
            i = end + 1
        elif cmd == 'IF':
            cval, _ = parse_expr(toks, 1, procs, frame, lists)
            elsepos, endpos = find_else_or_end(lines, i)
            if elsepos is not None:
                body = lines[i+1:elsepos]
                end = find_matching_end(lines, i)
                elsebody = lines[elsepos+1:end]
            else:
                body = lines[i+1:endpos]
                end = endpos
                elsebody = []
            if cval != 0:
                run_block(body, procs, frame, lists)
            else:
                run_block(elsebody, procs, frame, lists)
            i = end + 1
        elif cmd == 'BREAK':
            raise Brk()
        elif cmd == 'CONTINUE':
            raise Cont()
        elif cmd == 'DEF':
            fname = toks[1]
            params = toks[2:]
            end = find_matching_end(lines, i)
            body = lines[i+1:end]
            procs[fname] = (params, body)
            i = end + 1
        elif cmd == 'RET':
            val, _ = parse_expr(toks, 1, procs, frame, lists)
            raise Ret(val)
        elif cmd == 'GLOBAL':
            v = toks[1]
            frame.declare_global(v)
            i += 1
        else:
            raise Exception('unknown cmd ' + cmd)

OUTPUT = []

def main():
    with open('program.stamp') as f:
        raw = [l.rstrip('\n') for l in f if l.strip() != '']
    globals_ = {}
    procs = {}
    lists = {}
    frame = GlobalFrame(globals_)
    run_block(raw, procs, frame, lists)
    print(' '.join(str(v) for v in OUTPUT))

main()
