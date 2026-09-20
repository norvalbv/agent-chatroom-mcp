import sys

def tokenize(line):
    return line.split()

def load(path):
    lines = []
    with open(path) as f:
        for raw in f:
            raw = raw.rstrip('\n')
            if raw.strip() == '':
                continue
            lines.append(tokenize(raw))
    return lines

class Proc:
    def __init__(self, params, start):
        self.params = params
        self.start = start  # index of first body line (after DEF line)

class Frame:
    def __init__(self):
        self.locals = {}
        self.globals_declared = set()

class RetSignal(Exception):
    def __init__(self, val):
        self.val = val

class BreakSignal(Exception):
    pass

class ContinueSignal(Exception):
    pass

class Interp:
    def __init__(self, lines):
        self.lines = lines
        self.globals = {}
        self.lists = {}
        self.procs = {}
        self.output = []
        # find matching ENDs for blocks, and DEF bodies, precompute END index for each opener
        self.end_of = {}
        self._match_blocks()

    def _match_blocks(self):
        stack = []
        for i, tok in enumerate(self.lines):
            head = tok[0]
            if head in ('REPEAT', 'WHILE', 'IF', 'DEF'):
                stack.append(i)
            elif head == 'ELSE':
                # associate with top IF
                pass
            elif head == 'END':
                start = stack.pop()
                self.end_of[start] = i
                self.end_of[i] = start

    def run(self):
        pc = 0
        frame = None  # global scope
        self.exec_block(0, len(self.lines), None)
        return self.output

    def find_else(self, if_idx, end_idx):
        # search for ELSE at same nesting between if_idx+1 and end_idx
        depth = 0
        i = if_idx + 1
        while i < end_idx:
            head = self.lines[i][0]
            if head in ('REPEAT', 'WHILE', 'IF', 'DEF'):
                depth += 1
            elif head == 'END':
                depth -= 1
            elif head == 'ELSE' and depth == 0:
                return i
            i += 1
        return None

    def exec_block(self, start, end, frame):
        i = start
        while i < end:
            tok = self.lines[i]
            head = tok[0]
            if head == 'DEF':
                name = tok[1]
                params = tok[2:]
                endi = self.end_of[i]
                self.procs[name] = Proc(params, i+1)
                i = endi + 1
                continue
            elif head == 'REPEAT':
                endi = self.end_of[i]
                n = self.eval_expr(tok[1:], frame)[0]
                count = n if n > 0 else 0
                j = 0
                while j < count:
                    try:
                        self.exec_block(i+1, endi, frame)
                    except BreakSignal:
                        break
                    except ContinueSignal:
                        pass
                    j += 1
                i = endi + 1
                continue
            elif head == 'WHILE':
                endi = self.end_of[i]
                while True:
                    val, _ = self.eval_expr(tok[1:], frame)
                    if val == 0:
                        break
                    try:
                        self.exec_block(i+1, endi, frame)
                    except BreakSignal:
                        break
                    except ContinueSignal:
                        continue
                i = endi + 1
                continue
            elif head == 'IF':
                endi = self.end_of[i]
                elsei = self.find_else(i, endi)
                val, _ = self.eval_expr(tok[1:], frame)
                if val != 0:
                    body_end = elsei if elsei is not None else endi
                    self.exec_block(i+1, body_end, frame)
                else:
                    if elsei is not None:
                        self.exec_block(elsei+1, endi, frame)
                i = endi + 1
                continue
            elif head == 'ELSE':
                # shouldn't hit directly when iterating properly, skip to end
                i += 1
                continue
            elif head == 'END':
                i += 1
                continue
            elif head == 'BREAK':
                raise BreakSignal()
            elif head == 'CONTINUE':
                raise ContinueSignal()
            elif head == 'RET':
                val, _ = self.eval_expr(tok[1:], frame)
                raise RetSignal(val)
            elif head == 'SET':
                v = tok[1]
                val, _ = self.eval_expr(tok[2:], frame)
                self.assign(v, val, frame)
            elif head == 'SETS':
                v = tok[1]
                w = tok[2]
                rest = tok[3:]
                val_e, consumed = self.eval_expr(rest, frame)
                val_f, _ = self.eval_expr(rest[consumed:], frame)
                self.assign(v, val_e, frame)
                self.assign(w, val_f, frame)
            elif head == 'PRINT':
                val, _ = self.eval_expr(tok[1:], frame)
                self.output.append(val)
            elif head == 'PUSH':
                L = tok[1]
                val, _ = self.eval_expr(tok[2:], frame)
                self.lists.setdefault(L, []).append(val)
            elif head == 'GLOBAL':
                v = tok[1]
                if frame is not None:
                    frame.globals_declared.add(v)
                    if v in frame.locals:
                        del frame.locals[v]
            else:
                raise Exception('unknown stmt ' + head)
            i += 1

    def assign(self, name, val, frame):
        if frame is None:
            self.globals[name] = val
            return
        if name in frame.globals_declared:
            self.globals[name] = val
            return
        frame.locals[name] = val

    def read_var(self, name, frame):
        if frame is None:
            return self.globals.get(name, 0)
        if name in frame.globals_declared:
            return self.globals.get(name, 0)
        if name in frame.locals:
            return frame.locals[name]
        return self.globals.get(name, 0)

    def next_var(self, name, frame):
        cur = self.read_var(name, frame)
        newval = cur + 1
        self.assign_next(name, newval, frame)
        return newval

    def assign_next(self, name, val, frame):
        # NEXT creates local same rule as assign, but if already local keep local else create
        self.assign(name, val, frame)

    def eval_expr(self, toks, frame):
        # returns (value, number_of_tokens_consumed)
        head = toks[0]
        if head == '-' and len(toks) >= 2 and toks[1].lstrip('-').isdigit() and False:
            pass
        # literal integer (allow leading - attached)
        if self.is_int_literal(head):
            return int(head), 1
        if head in ('+','-','*','/','%','<','=','AND','OR','MIN','MAX','POW'):
            a, ca = self.eval_expr(toks[1:], frame)
            b, cb = self.eval_expr(toks[1+ca:], frame)
            consumed = 1 + ca + cb
            val = self.binop(head, a, b)
            return val, consumed
        if head in ('NOT','ABS'):
            a, ca = self.eval_expr(toks[1:], frame)
            consumed = 1 + ca
            if head == 'NOT':
                return (1 if a == 0 else 0), consumed
            else:
                return abs(a), consumed
        if head == 'NEXT':
            v = toks[1]
            val = self.next_var(v, frame)
            return val, 2
        if head == 'CALL':
            fname = toks[1]
            proc = self.procs.get(fname)
            if proc is None:
                return 0, 2
            nparams = len(proc.params)
            args = []
            idx = 2
            for _ in range(nparams):
                val, c = self.eval_expr(toks[idx:], frame)
                args.append(val)
                idx += c
            newframe = Frame()
            for pname, aval in zip(proc.params, args):
                newframe.locals[pname] = aval
            try:
                self.exec_block(proc.start, self.end_of[proc.start-1], newframe)
                result = 0
            except RetSignal as r:
                result = r.val
            return result, idx
        if head == 'LEN':
            Lname = toks[1]
            lst = self.lists.get(Lname, [])
            return len(lst), 2
        if head == 'AT':
            Lname = toks[1]
            idxval, c = self.eval_expr(toks[2:], frame)
            lst = self.lists.get(Lname, [])
            n = len(lst)
            real = idxval if idxval >= 0 else n + idxval
            if real < 0 or real >= n:
                return 0, 2 + c
            return lst[real], 2 + c
        # variable name
        val = self.read_var(head, frame)
        return val, 1

    def is_int_literal(self, tok):
        if tok in ('+','-','*','/','%','<','=','AND','OR','MIN','MAX','POW','NOT','ABS','NEXT','CALL','LEN','AT'):
            return False
        if tok.startswith('-') and len(tok) > 1 and tok[1:].isdigit():
            return True
        if tok.isdigit():
            return True
        return False

    def binop(self, op, a, b):
        if op == '+':
            return a + b
        if op == '-':
            return a - b
        if op == '*':
            return a * b
        if op == '/':
            if b == 0:
                return 0
            return a // b  # floor div, python // is floor
        if op == '%':
            if b == 0:
                return 0
            return a - (a // b) * b
        if op == '<':
            return 1 if a < b else 0
        if op == '=':
            return 1 if a == b else 0
        if op == 'AND':
            return 1 if (a != 0 and b != 0) else 0
        if op == 'OR':
            return 1 if (a != 0 or b != 0) else 0
        if op == 'MIN':
            return min(a, b)
        if op == 'MAX':
            return max(a, b)
        if op == 'POW':
            if b < 0:
                return 0
            return a ** b

if __name__ == '__main__':
    lines = load(sys.argv[1])
    interp = Interp(lines)
    out = interp.run()
    print(' '.join(str(x) for x in out))
