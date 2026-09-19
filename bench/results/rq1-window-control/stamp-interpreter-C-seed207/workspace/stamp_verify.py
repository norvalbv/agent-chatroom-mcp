import sys

def tokenize(src):
    lines = []
    for raw in src.splitlines():
        toks = raw.split()
        if toks:
            lines.append(toks)
    return lines

class Proc:
    def __init__(self, params, body):
        self.params = params
        self.body = body

class BreakEx(Exception):
    pass
class ContinueEx(Exception):
    pass
class RetEx(Exception):
    def __init__(self, val):
        self.val = val

def parse_blocks(lines):
    # returns list of statements as nested structures, plus dict of procs (top-level)
    pos = [0]
    def parse_seq(enders):
        stmts = []
        while pos[0] < len(lines):
            toks = lines[pos[0]]
            if toks[0] in enders:
                return stmts
            stmts.append(parse_stmt())
        return stmts
    def parse_stmt():
        toks = lines[pos[0]]
        kw = toks[0]
        if kw == 'DEF':
            name = toks[1]
            params = toks[2:]
            pos[0]+=1
            body = parse_seq(['END'])
            pos[0]+=1 # consume END
            return ('DEF', name, params, body)
        elif kw == 'REPEAT':
            expr = toks[1:]
            pos[0]+=1
            body = parse_seq(['END'])
            pos[0]+=1
            return ('REPEAT', expr, body)
        elif kw == 'WHILE':
            expr = toks[1:]
            pos[0]+=1
            body = parse_seq(['END'])
            pos[0]+=1
            return ('WHILE', expr, body)
        elif kw == 'IF':
            expr = toks[1:]
            pos[0]+=1
            body1 = parse_seq(['END','ELSE'])
            if lines[pos[0]][0]=='ELSE':
                pos[0]+=1
                body2 = parse_seq(['END'])
                pos[0]+=1
                return ('IF', expr, body1, body2)
            else:
                pos[0]+=1
                return ('IF', expr, body1, None)
        elif kw == 'BREAK':
            pos[0]+=1
            return ('BREAK',)
        elif kw == 'CONTINUE':
            pos[0]+=1
            return ('CONTINUE',)
        elif kw == 'RET':
            expr = toks[1:]
            pos[0]+=1
            return ('RET', expr)
        elif kw == 'SET':
            v = toks[1]
            expr = toks[2:]
            pos[0]+=1
            return ('SET', v, expr)
        elif kw == 'SETS':
            v = toks[1]; w = toks[2]
            rest = toks[3:]
            pos[0]+=1
            return ('SETS_RAW', v, w, rest)
        elif kw == 'PRINT':
            expr = toks[1:]
            pos[0]+=1
            return ('PRINT', expr)
        elif kw == 'PUSH':
            L = toks[1]
            expr = toks[2:]
            pos[0]+=1
            return ('PUSH', L, expr)
        elif kw == 'GLOBAL':
            v = toks[1]
            pos[0]+=1
            return ('GLOBAL', v)
        else:
            raise Exception("unknown stmt "+str(toks))
    stmts = parse_seq([])
    return stmts

# Expression parsing: consume tokens list (a slice) fully representing one expr, prefix notation.
def split_two_exprs(toks):
    # split toks into first expr and remaining toks (second expr etc.) using consume
    idx = [0]
    def consume():
        return parse_expr_tokens(toks, idx)
    e1 = consume()
    return e1, idx[0]

BINOPS = {'+','-','*','/','%','<','=','AND','OR','MIN','MAX','POW'}
UNOPS = {'NOT','ABS'}

def parse_expr_tokens(toks, idx):
    t = toks[idx[0]]
    idx[0]+=1
    if t in BINOPS:
        a = parse_expr_tokens(toks, idx)
        b = parse_expr_tokens(toks, idx)
        return ('BIN', t, a, b)
    if t in UNOPS:
        a = parse_expr_tokens(toks, idx)
        return ('UN', t, a)
    if t == 'NEXT':
        v = toks[idx[0]]
        idx[0]+=1
        return ('NEXT', v)
    if t == 'CALL':
        f = toks[idx[0]]
        idx[0]+=1
        # number of args determined at eval time by proc def; but we need to parse args now.
        # We'll parse args greedily based on current known proc defs is tricky since parse is static.
        # Instead store raw remaining tokens pointer trick: we need param count at parse time.
        return ('CALL_RAW', f, toks, idx)
    if t == 'LEN':
        L = toks[idx[0]]; idx[0]+=1
        return ('LEN', L)
    if t == 'AT':
        L = toks[idx[0]]; idx[0]+=1
        i = parse_expr_tokens(toks, idx)
        return ('AT', L, i)
    # literal or var
    try:
        n = int(t)
        return ('LIT', n)
    except ValueError:
        return ('VAR', t)

def parse_full_expr(toks):
    idx=[0]
    e = parse_expr_tokens(toks, idx)
    return e

class Interp:
    def __init__(self, stmts):
        self.top_stmts = stmts
        self.globals = {}
        self.procs = {}
        self.lists = {}
        self.output = []

    def run(self):
        frame = {'locals': {}, 'globalset': set()}
        self.exec_seq(self.top_stmts, frame, is_top=True)

    def get_proc_at_call_time(self, name):
        return self.procs.get(name)

    def eval_expr(self, e, frame):
        tag = e[0]
        if tag=='LIT':
            return e[1]
        if tag=='VAR':
            return self.read_var(e[1], frame)
        if tag=='BIN':
            op=e[1]
            a=self.eval_expr(e[2], frame)
            b=self.eval_expr(e[3], frame)
            return self.apply_bin(op,a,b)
        if tag=='UN':
            op=e[1]
            a=self.eval_expr(e[2], frame)
            if op=='NOT':
                return 1 if a==0 else 0
            if op=='ABS':
                return abs(a)
        if tag=='NEXT':
            v = e[1]
            cur = self.read_var(v, frame)
            newval = cur+1
            self.write_var(v, newval, frame)
            return newval
        if tag=='LEN':
            L = e[1]
            return len(self.lists.get(L, []))
        if tag=='AT':
            L = e[1]
            i = self.eval_expr(e[2], frame)
            lst = self.lists.get(L, [])
            if i<0:
                idx = len(lst)+i
            else:
                idx = i
            if 0<=idx<len(lst):
                return lst[idx]
            return 0
        if tag=='CALL_RAW':
            f = e[1]; toks=e[2]; idx=e[3]
            proc = self.get_proc_at_call_time(f)
            if proc is None:
                # no args consumed; but tokens after CALL with unknown proc: spec says takes no args
                return 0
            nargs = len(proc.params)
            argvals = []
            for _ in range(nargs):
                a = parse_expr_tokens(toks, idx)
                argvals.append(self.eval_expr(a, frame))
            return self.call_proc(proc, argvals)
        raise Exception("bad expr "+str(e))

    def apply_bin(self, op, a, b):
        if op=='+': return a+b
        if op=='-': return a-b
        if op=='*': return a*b
        if op=='/':
            if b==0: return 0
            return a//b
        if op=='%':
            if b==0: return 0
            return a - (a//b)*b
        if op=='<': return 1 if a<b else 0
        if op=='=': return 1 if a==b else 0
        if op=='AND': return 1 if (a!=0 and b!=0) else 0
        if op=='OR': return 1 if (a!=0 or b!=0) else 0
        if op=='MIN': return min(a,b)
        if op=='MAX': return max(a,b)
        if op=='POW':
            if b<0: return 0
            return a**b
        raise Exception("bad op "+op)

    def read_var(self, name, frame):
        if frame is None or frame.get('is_top'):
            return self.globals.get(name,0)
        if name in frame['globalset']:
            return self.globals.get(name,0)
        if name in frame['locals']:
            return frame['locals'][name]
        return self.globals.get(name,0)

    def write_var(self, name, val, frame):
        if frame is None or frame.get('is_top'):
            self.globals[name]=val
            return
        if name in frame['globalset']:
            self.globals[name]=val
            return
        frame['locals'][name]=val

    def call_proc(self, proc, argvals):
        frame = {'locals':{}, 'globalset':set(), 'is_top':False}
        for p,v in zip(proc.params, argvals):
            frame['locals'][p]=v
        try:
            self.exec_seq(proc.body, frame, is_top=False)
        except RetEx as r:
            return r.val
        return 0

    def exec_seq(self, stmts, frame, is_top):
        frame['is_top']=is_top
        i=0
        while i < len(stmts):
            st = stmts[i]
            self.exec_stmt(st, frame)
            i+=1

    def exec_stmt(self, st, frame):
        tag = st[0]
        if tag=='DEF':
            _,name,params,body = st
            self.procs[name] = Proc(params, body)
            return
        if tag=='SET':
            _,v,expr_toks = st
            e = parse_full_expr(expr_toks)
            val = self.eval_expr(e, frame)
            self.write_var(v, val, frame)
            return
        if tag=='SETS_RAW':
            _,v,w,rest = st
            idx=[0]
            e1 = parse_expr_tokens(rest, idx)
            e2 = parse_expr_tokens(rest, idx)
            val_e = self.eval_expr(e1, frame)
            val_f = self.eval_expr(e2, frame)
            self.write_var(v, val_e, frame)
            self.write_var(w, val_f, frame)
            return
        if tag=='PRINT':
            e = parse_full_expr(st[1])
            val = self.eval_expr(e, frame)
            self.output.append(val)
            return
        if tag=='PUSH':
            L = st[1]
            e = parse_full_expr(st[2])
            val = self.eval_expr(e, frame)
            self.lists.setdefault(L, []).append(val)
            return
        if tag=='GLOBAL':
            frame['globalset'].add(st[1])
            return
        if tag=='REPEAT':
            e = parse_full_expr(st[1])
            n = self.eval_expr(e, frame)
            body = st[2]
            cnt=0
            while cnt<n:
                cnt+=1
                try:
                    self.exec_seq(body, frame, frame.get('is_top'))
                except BreakEx:
                    break
                except ContinueEx:
                    continue
            return
        if tag=='WHILE':
            e_toks = st[1]
            body = st[2]
            while True:
                e = parse_full_expr(e_toks)
                cond = self.eval_expr(e, frame)
                if cond==0:
                    break
                try:
                    self.exec_seq(body, frame, frame.get('is_top'))
                except BreakEx:
                    break
                except ContinueEx:
                    continue
            return
        if tag=='IF':
            e = parse_full_expr(st[1])
            cond = self.eval_expr(e, frame)
            if cond!=0:
                self.exec_seq(st[2], frame, frame.get('is_top'))
            elif st[3] is not None:
                self.exec_seq(st[3], frame, frame.get('is_top'))
            return
        if tag=='BREAK':
            raise BreakEx()
        if tag=='CONTINUE':
            raise ContinueEx()
        if tag=='RET':
            e = parse_full_expr(st[1])
            val = self.eval_expr(e, frame)
            raise RetEx(val)
        raise Exception("bad stmt "+str(st))

if __name__=='__main__':
    src = open(sys.argv[1]).read()
    lines = tokenize(src)
    stmts = parse_blocks(lines)
    interp = Interp(stmts)
    interp.run()
    print(' '.join(str(x) for x in interp.output))
