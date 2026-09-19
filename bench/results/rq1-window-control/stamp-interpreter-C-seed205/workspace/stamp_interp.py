import sys

def tokenize(lines):
    toks = []
    for line in lines:
        line = line.strip()
        if not line:
            continue
        toks.append(line.split())
    return toks

def parse_block(lines, i, enders):
    # returns (statements, next_index)
    stmts = []
    while i < len(lines):
        tok = lines[i]
        head = tok[0]
        if head in enders:
            return stmts, i
        if head == 'END':
            return stmts, i
        elif head == 'DEF':
            name = tok[1]
            params = tok[2:]
            body, i2 = parse_block(lines, i+1, ['END'])
            i2 += 1 # skip END
            stmts.append(('DEF', name, params, body))
            i = i2
        elif head == 'REPEAT':
            expr = tok[1:]
            body, i2 = parse_block(lines, i+1, ['END'])
            i2 += 1
            stmts.append(('REPEAT', expr, body))
            i = i2
        elif head == 'WHILE':
            expr = tok[1:]
            body, i2 = parse_block(lines, i+1, ['END'])
            i2 += 1
            stmts.append(('WHILE', expr, body))
            i = i2
        elif head == 'IF':
            expr = tok[1:]
            body1, i2 = parse_block(lines, i+1, ['END','ELSE'])
            if lines[i2][0] == 'ELSE':
                body2, i3 = parse_block(lines, i2+1, ['END'])
                i3 += 1
                stmts.append(('IF', expr, body1, body2))
                i = i3
            else:
                i2 += 1
                stmts.append(('IF', expr, body1, None))
                i = i2
        elif head == 'SET':
            stmts.append(('SET', tok[1], tok[2:]))
            i += 1
        elif head == 'SETS':
            v, w = tok[1], tok[2]
            rest = tok[3:]
            # need to split rest into two expressions
            stmts.append(('SETS', v, w, rest))
            i += 1
        elif head == 'PRINT':
            stmts.append(('PRINT', tok[1:]))
            i += 1
        elif head == 'PUSH':
            stmts.append(('PUSH', tok[1], tok[2:]))
            i += 1
        elif head == 'BREAK':
            stmts.append(('BREAK',))
            i += 1
        elif head == 'CONTINUE':
            stmts.append(('CONTINUE',))
            i += 1
        elif head == 'RET':
            stmts.append(('RET', tok[1:]))
            i += 1
        elif head == 'GLOBAL':
            stmts.append(('GLOBAL', tok[1]))
            i += 1
        else:
            raise Exception("unknown stmt " + str(tok))
    return stmts, i

BINOPS = {'+','-','*','/','%','<','=','AND','OR','MIN','MAX','POW'}
UNOPS = {'NOT','ABS'}

class ExprParser:
    def __init__(self, toks):
        self.toks = toks
        self.pos = 0
    def peek(self):
        return self.toks[self.pos]
    def next(self):
        t = self.toks[self.pos]
        self.pos += 1
        return t
    def parse(self):
        t = self.next()
        if t in BINOPS:
            a = self.parse()
            b = self.parse()
            return ('bin', t, a, b)
        if t in UNOPS:
            a = self.parse()
            return ('un', t, a)
        if t == 'NEXT':
            v = self.next()
            return ('next', v)
        if t == 'CALL':
            f = self.next()
            # need to know arity; but arity determined at eval time by proc def
            # we'll parse remaining as expressions greedily based on def arity at eval time
            # To handle parsing without knowing arity ahead, we return a special marker
            # and consume expressions on demand during eval using a sub-parser approach.
            return ('call_raw', f, self.toks[self.pos:])
        if t == 'LEN':
            l = self.next()
            return ('len', l)
        if t == 'AT':
            l = self.next()
            idx = self.parse()
            return ('at', l, idx)
        # literal or variable
        try:
            val = int(t)
            return ('lit', val)
        except ValueError:
            return ('var', t)

def parse_expr_tokens(tokens):
    # tokens is list; parse ONE expression from front, return (expr, remaining_tokens)
    p = ExprParser(tokens)
    e = p.parse()
    remaining = tokens[p.pos:]
    return e, remaining

# We need CALL to consume proper number of args based on proc def at eval time.
# Simplify: re-implement expression parsing lazily during eval, operating on token lists directly.

def eval_expr_tokens(tokens, env, state):
    # returns (value, remaining_tokens)
    t = tokens[0]
    rest = tokens[1:]
    if t in BINOPS:
        a, rest = eval_expr_tokens(rest, env, state)
        b, rest = eval_expr_tokens(rest, env, state)
        return apply_binop(t, a, b), rest
    if t in UNOPS:
        a, rest = eval_expr_tokens(rest, env, state)
        return apply_unop(t, a), rest
    if t == 'NEXT':
        v = rest[0]
        rest = rest[1:]
        val = env_read(env, v, state) + 1
        env_write_next(env, v, val, state)
        return val, rest
    if t == 'CALL':
        f = rest[0]
        rest = rest[1:]
        proc = state['procs'].get(f)
        if proc is None:
            return 0, rest
        params = proc['params']
        args = []
        for _ in params:
            a, rest = eval_expr_tokens(rest, env, state)
            args.append(a)
        result = call_proc(f, args, state)
        return result, rest
    if t == 'LEN':
        l = rest[0]
        rest = rest[1:]
        lst = state['lists'].get(l, [])
        return len(lst), rest
    if t == 'AT':
        l = rest[0]
        rest = rest[1:]
        idx, rest = eval_expr_tokens(rest, env, state)
        lst = state['lists'].get(l, [])
        n = len(lst)
        i = idx
        if i < 0:
            i = n + i
        if i < 0 or i >= n:
            return 0, rest
        return lst[i], rest
    # literal or var
    try:
        val = int(t)
        return val, rest
    except ValueError:
        return env_read(env, t, state), rest

def apply_binop(op, a, b):
    if op == '+': return a + b
    if op == '-': return a - b
    if op == '*': return a * b
    if op == '/':
        if b == 0: return 0
        return a // b  # python floor division matches floor toward -inf
    if op == '%':
        if b == 0: return 0
        return a - (a // b) * b
    if op == '<': return 1 if a < b else 0
    if op == '=': return 1 if a == b else 0
    if op == 'AND': return 1 if (a != 0 and b != 0) else 0
    if op == 'OR': return 1 if (a != 0 or b != 0) else 0
    if op == 'MIN': return min(a,b)
    if op == 'MAX': return max(a,b)
    if op == 'POW':
        if b < 0: return 0
        return a ** b
    raise Exception('bad binop ' + op)

def apply_unop(op, a):
    if op == 'NOT': return 1 if a == 0 else 0
    if op == 'ABS': return abs(a)
    raise Exception('bad unop ' + op)

# env represents a call frame: dict of locals, set of globalized names
# state['globals'] dict, state['lists'] dict, state['procs'] dict, state['output'] list

class Frame:
    def __init__(self):
        self.locals = {}
        self.globalized = set()

def env_read(env, name, state):
    if env is None:
        return state['globals'].get(name, 0)
    if name in env.globalized:
        return state['globals'].get(name, 0)
    if name in env.locals:
        return env.locals[name]
    return state['globals'].get(name, 0)

def env_write(env, name, value, state):
    # for SET/SETS
    if env is None:
        state['globals'][name] = value
        return
    if name in env.globalized:
        state['globals'][name] = value
        return
    env.locals[name] = value

def env_write_next(env, name, value, state):
    env_write(env, name, value, state)

class BreakExc(Exception): pass
class ContinueExc(Exception): pass
class RetExc(Exception):
    def __init__(self, value):
        self.value = value

def exec_block(stmts, env, state):
    for stmt in stmts:
        exec_stmt(stmt, env, state)

def exec_stmt(stmt, env, state):
    kind = stmt[0]
    if kind == 'DEF':
        _, name, params, body = stmt
        state['procs'][name] = {'params': params, 'body': body}
    elif kind == 'SET':
        _, v, expr_tokens = stmt
        val, rest = eval_expr_tokens(expr_tokens, env, state)
        env_write(env, v, val, state)
    elif kind == 'SETS':
        _, v, w, rest_tokens = stmt
        e_val, rest = eval_expr_tokens(rest_tokens, env, state)
        f_val, rest2 = eval_expr_tokens(rest, env, state)
        env_write(env, v, e_val, state)
        env_write(env, w, f_val, state)
    elif kind == 'PRINT':
        _, expr_tokens = stmt
        val, rest = eval_expr_tokens(expr_tokens, env, state)
        state['output'].append(val)
    elif kind == 'PUSH':
        _, l, expr_tokens = stmt
        val, rest = eval_expr_tokens(expr_tokens, env, state)
        state['lists'].setdefault(l, []).append(val)
    elif kind == 'REPEAT':
        _, expr_tokens, body = stmt
        n, rest = eval_expr_tokens(expr_tokens, env, state)
        cnt = 0
        while cnt < n:
            cnt += 1
            try:
                exec_block(body, env, state)
            except BreakExc:
                break
            except ContinueExc:
                continue
    elif kind == 'WHILE':
        _, expr_tokens, body = stmt
        while True:
            val, rest = eval_expr_tokens(expr_tokens, env, state)
            if val == 0:
                break
            try:
                exec_block(body, env, state)
            except BreakExc:
                break
            except ContinueExc:
                continue
    elif kind == 'IF':
        _, expr_tokens, body1, body2 = stmt
        val, rest = eval_expr_tokens(expr_tokens, env, state)
        if val != 0:
            exec_block(body1, env, state)
        elif body2 is not None:
            exec_block(body2, env, state)
    elif kind == 'BREAK':
        raise BreakExc()
    elif kind == 'CONTINUE':
        raise ContinueExc()
    elif kind == 'RET':
        _, expr_tokens = stmt
        val, rest = eval_expr_tokens(expr_tokens, env, state)
        raise RetExc(val)
    elif kind == 'GLOBAL':
        _, v = stmt
        env.globalized.add(v)
    else:
        raise Exception('unknown stmt kind ' + kind)

def call_proc(name, args, state):
    proc = state['procs'][name]
    env = Frame()
    for pname, aval in zip(proc['params'], args):
        env.locals[pname] = aval
    try:
        exec_block(proc['body'], env, state)
    except RetExc as r:
        return r.value
    return 0

def main():
    with open(sys.argv[1]) as f:
        lines = [l.rstrip('\n') for l in f if l.strip() != '']
    toks = tokenize(lines)
    stmts, _ = parse_block(toks, 0, [])
    state = {'globals': {}, 'lists': {}, 'procs': {}, 'output': []}
    exec_block(stmts, None, state)
    print(' '.join(str(x) for x in state['output']))

if __name__ == '__main__':
    main()
