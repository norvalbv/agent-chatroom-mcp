import sys

def tokenize(line):
    return line.split()

def parse_program(lines):
    # returns list of statements (recursive structure), each stmt is tuple
    pos = [0]
    def parse_block(enders):
        stmts = []
        while pos[0] < len(lines):
            toks = lines[pos[0]]
            if not toks:
                pos[0] += 1
                continue
            head = toks[0]
            if head in enders:
                return stmts
            pos[0] += 1
            if head == 'SET':
                stmts.append(('SET', toks[1], toks[2:]))
            elif head == 'SETS':
                stmts.append(('SETS', toks[1], toks[2], toks[3:]))
            elif head == 'PRINT':
                stmts.append(('PRINT', toks[1:]))
            elif head == 'PUSH':
                stmts.append(('PUSH', toks[1], toks[2:]))
            elif head == 'REPEAT':
                body = parse_block({'END'})
                pos[0] += 1  # consume END
                stmts.append(('REPEAT', toks[1:], body))
            elif head == 'WHILE':
                body = parse_block({'END'})
                pos[0] += 1
                stmts.append(('WHILE', toks[1:], body))
            elif head == 'IF':
                body1 = parse_block({'END', 'ELSE'})
                if pos[0] < len(lines) and lines[pos[0]] and lines[pos[0]][0] == 'ELSE':
                    pos[0] += 1
                    body2 = parse_block({'END'})
                    pos[0] += 1
                    stmts.append(('IF', toks[1:], body1, body2))
                else:
                    pos[0] += 1
                    stmts.append(('IF', toks[1:], body1, None))
            elif head == 'BREAK':
                stmts.append(('BREAK',))
            elif head == 'CONTINUE':
                stmts.append(('CONTINUE',))
            elif head == 'DEF':
                name = toks[1]
                params = toks[2:]
                body = parse_block({'END'})
                pos[0] += 1
                stmts.append(('DEF', name, params, body))
            elif head == 'RET':
                stmts.append(('RET', toks[1:]))
            elif head == 'GLOBAL':
                stmts.append(('GLOBAL', toks[1]))
            else:
                raise Exception("unknown stmt " + head)
        return stmts
    return parse_block(set())

class BreakExc(Exception): pass
class ContinueExc(Exception): pass
class RetExc(Exception):
    def __init__(self, val): self.val = val

class Interp:
    def __init__(self, stmts):
        self.stmts = stmts
        self.globals = {}
        self.lists = {}
        self.procs = {}
        self.output = []

    def run(self):
        self.exec_block(self.stmts, None)

    def exec_block(self, stmts, frame):
        for s in stmts:
            self.exec_stmt(s, frame)

    def exec_stmt(self, s, frame):
        tag = s[0]
        if tag == 'SET':
            v = s[1]
            val = self.eval_expr(s[2], frame)[0]
            self.assign(v, val, frame)
        elif tag == 'SETS':
            v, w, rest = s[1], s[2], s[3]
            eexpr, i = self.parse_one(rest, 0, frame)
            fexpr, i = self.parse_one(rest, i, frame)
            self.assign(v, eexpr, frame)
            self.assign(w, fexpr, frame)
        elif tag == 'PRINT':
            val = self.eval_expr(s[1], frame)[0]
            self.output.append(val)
        elif tag == 'PUSH':
            L = s[1]
            val = self.eval_expr(s[2], frame)[0]
            self.lists.setdefault(L, []).append(val)
        elif tag == 'REPEAT':
            n = self.eval_expr(s[1], frame)[0]
            body = s[2]
            i = 0
            while i < n:
                i += 1
                try:
                    self.exec_block(body, frame)
                except BreakExc:
                    break
                except ContinueExc:
                    continue
        elif tag == 'WHILE':
            cond_toks = s[1]
            body = s[2]
            while True:
                c = self.eval_expr(cond_toks, frame)[0]
                if not c:
                    break
                try:
                    self.exec_block(body, frame)
                except BreakExc:
                    break
                except ContinueExc:
                    continue
        elif tag == 'IF':
            c = self.eval_expr(s[1], frame)[0]
            if c:
                self.exec_block(s[2], frame)
            elif s[3] is not None:
                self.exec_block(s[3], frame)
        elif tag == 'BREAK':
            raise BreakExc()
        elif tag == 'CONTINUE':
            raise ContinueExc()
        elif tag == 'DEF':
            self.procs[s[1]] = (s[2], s[3])
        elif tag == 'RET':
            val = self.eval_expr(s[1], frame)[0]
            raise RetExc(val)
        elif tag == 'GLOBAL':
            if frame is not None:
                frame['globals_declared'].add(s[1])
                if s[1] in frame['locals']:
                    del frame['locals'][s[1]]
        else:
            raise Exception('bad stmt ' + tag)

    def assign(self, name, val, frame):
        if frame is None:
            self.globals[name] = val
        else:
            if name in frame['globals_declared']:
                self.globals[name] = val
            else:
                frame['locals'][name] = val

    def read(self, name, frame):
        if frame is not None:
            if name in frame['globals_declared']:
                return self.globals.get(name, 0)
            if name in frame['locals']:
                return frame['locals'][name]
        return self.globals.get(name, 0)

    def next_var(self, name, frame):
        cur = self.read(name, frame)
        newv = cur + 1
        self.assign(name, newv, frame)
        return newv

    # expr parsing/eval: tokens list, consume from index, return (value, next_index)
    def parse_one(self, toks, i, frame):
        tok = toks[i]
        i += 1
        if tok in ('+', '-', '*', '/', '%', '<', '=', 'AND', 'OR', 'MIN', 'MAX', 'POW'):
            a, i = self.parse_one(toks, i, frame)
            b, i = self.parse_one(toks, i, frame)
            if tok == '+': return a + b, i
            if tok == '-': return a - b, i
            if tok == '*': return a * b, i
            if tok == '/':
                if b == 0: return 0, i
                return a // b, i
            if tok == '%':
                if b == 0: return 0, i
                return a - (a // b) * b, i
            if tok == '<': return (1 if a < b else 0), i
            if tok == '=': return (1 if a == b else 0), i
            if tok == 'AND': return (1 if (a != 0 and b != 0) else 0), i
            if tok == 'OR': return (1 if (a != 0 or b != 0) else 0), i
            if tok == 'MIN': return min(a, b), i
            if tok == 'MAX': return max(a, b), i
            if tok == 'POW':
                if b < 0: return 0, i
                return a ** b, i
        elif tok in ('NOT', 'ABS'):
            a, i = self.parse_one(toks, i, frame)
            if tok == 'NOT': return (1 if a == 0 else 0), i
            if tok == 'ABS': return abs(a), i
        elif tok == 'NEXT':
            v = toks[i]; i += 1
            return self.next_var(v, frame), i
        elif tok == 'LEN':
            L = toks[i]; i += 1
            return len(self.lists.get(L, [])), i
        elif tok == 'AT':
            L = toks[i]; i += 1
            idx, i = self.parse_one(toks, i, frame)
            lst = self.lists.get(L, [])
            if -len(lst) <= idx < len(lst):
                return lst[idx], i
            else:
                return 0, i
        elif tok == 'CALL':
            fname = toks[i]; i += 1
            if fname not in self.procs:
                # need to consume 0 args since undefined -> but spec says takes no args
                return 0, i
            params, body = self.procs[fname]
            args = []
            for p in params:
                val, i = self.parse_one(toks, i, frame)
                args.append(val)
            newframe = {'locals': {}, 'globals_declared': set()}
            for pname, aval in zip(params, args):
                newframe['locals'][pname] = aval
            try:
                self.exec_block(body, newframe)
            except RetExc as r:
                return r.val, i
            return 0, i
        else:
            # literal or variable
            try:
                return int(tok), i
            except ValueError:
                return self.read(tok, frame), i
        raise Exception("bad token " + tok)

    def eval_expr(self, toks, frame):
        val, i = self.parse_one(toks, 0, frame)
        return val, i


def main():
    with open('program.stamp') as f:
        raw = f.readlines()
    lines = [tokenize(l.rstrip('\n')) for l in raw]
    stmts = parse_program(lines)
    interp = Interp(stmts)
    interp.run()
    print(' '.join(str(x) for x in interp.output))

if __name__ == '__main__':
    main()
