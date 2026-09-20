import re, sys

BINOPS = {'+','-','*','/','%','<','=','AND','OR','MIN','MAX','POW'}
UNOPS = {'NOT','ABS'}

def load_lines(path):
    with open(path) as f:
        return [l.rstrip('\n') for l in f if l.strip() != '']

def build_arity(lines):
    arity = {}
    for l in lines:
        toks = l.split()
        if toks and toks[0] == 'DEF':
            arity[toks[1]] = len(toks[2:])
    return arity

def parse_expr(tokens, i, arity):
    tok = tokens[i]
    if tok in BINOPS:
        a, i = parse_expr(tokens, i+1, arity)
        b, i = parse_expr(tokens, i, arity)
        return (tok, a, b), i
    if tok in UNOPS:
        a, i = parse_expr(tokens, i+1, arity)
        return (tok, a), i
    if tok == 'NEXT':
        return ('NEXT', tokens[i+1]), i+2
    if tok == 'LEN':
        return ('LEN', tokens[i+1]), i+2
    if tok == 'AT':
        idx, j = parse_expr(tokens, i+2, arity)
        return ('AT', tokens[i+1], idx), j
    if tok == 'CALL':
        fname = tokens[i+1]
        n = arity.get(fname, 0)
        j = i+2
        args = []
        for _ in range(n):
            a, j = parse_expr(tokens, j, arity)
            args.append(a)
        return ('CALL', fname, args), j
    if re.match(r'^-?\d+$', tok):
        return ('LIT', int(tok)), i+1
    return ('VAR', tok), i+1

def parse_block(lines, i, arity):
    stmts = []
    while i < len(lines):
        toks = lines[i].split()
        head = toks[0]
        if head in ('END', 'ELSE'):
            return stmts, i
        if head == 'SET':
            e, _ = parse_expr(toks, 2, arity)
            stmts.append(('SET', toks[1], e)); i += 1
        elif head == 'SETS':
            e, j = parse_expr(toks, 3, arity)
            f, j = parse_expr(toks, j, arity)
            stmts.append(('SETS', toks[1], toks[2], e, f)); i += 1
        elif head == 'PRINT':
            e, _ = parse_expr(toks, 1, arity)
            stmts.append(('PRINT', e)); i += 1
        elif head == 'PUSH':
            e, _ = parse_expr(toks, 2, arity)
            stmts.append(('PUSH', toks[1], e)); i += 1
        elif head == 'REPEAT':
            e, _ = parse_expr(toks, 1, arity)
            body, i2 = parse_block(lines, i+1, arity)
            stmts.append(('REPEAT', e, body)); i = i2 + 1
        elif head == 'WHILE':
            e, _ = parse_expr(toks, 1, arity)
            body, i2 = parse_block(lines, i+1, arity)
            stmts.append(('WHILE', e, body)); i = i2 + 1
        elif head == 'IF':
            e, _ = parse_expr(toks, 1, arity)
            body1, i2 = parse_block(lines, i+1, arity)
            if lines[i2].split()[0] == 'ELSE':
                body2, i3 = parse_block(lines, i2+1, arity)
                stmts.append(('IF', e, body1, body2)); i = i3 + 1
            else:
                stmts.append(('IF', e, body1, None)); i = i2 + 1
        elif head == 'BREAK':
            stmts.append(('BREAK',)); i += 1
        elif head == 'CONTINUE':
            stmts.append(('CONTINUE',)); i += 1
        elif head == 'DEF':
            name = toks[1]; params = toks[2:]
            body, i2 = parse_block(lines, i+1, arity)
            stmts.append(('DEF', name, params, body)); i = i2 + 1
        elif head == 'RET':
            e, _ = parse_expr(toks, 1, arity)
            stmts.append(('RET', e)); i += 1
        elif head == 'GLOBAL':
            stmts.append(('GLOBAL', toks[1])); i += 1
        else:
            raise Exception('unknown stmt: ' + lines[i])
    return stmts, i

GLOBALS = {}
LISTS = {}
PROCS = {}
OUTPUT = []

def read_var(env, name):
    if env['locals'] is None:
        return GLOBALS.get(name, 0)
    if name in env['redirect']:
        return GLOBALS.get(name, 0)
    if name in env['locals']:
        return env['locals'][name]
    return GLOBALS.get(name, 0)

def write_var(env, name, val):
    if env['locals'] is None or name in env['redirect']:
        GLOBALS[name] = val
        return
    env['locals'][name] = val

def next_var(env, name):
    v = read_var(env, name) + 1
    write_var(env, name, v)
    return v

def eval_expr(node, env):
    t = node[0]
    if t == 'LIT': return node[1]
    if t == 'VAR': return read_var(env, node[1])
    if t == 'NEXT': return next_var(env, node[1])
    if t == 'LEN': return len(LISTS.get(node[1], []))
    if t == 'AT':
        lst = LISTS.get(node[1], [])
        i = eval_expr(node[2], env)
        if -len(lst) <= i < len(lst):
            return lst[i]
        return 0
    if t == 'CALL':
        args = [eval_expr(a, env) for a in node[2]]
        return do_call(node[1], args)
    if t == 'NOT':
        return 1 if eval_expr(node[1], env) == 0 else 0
    if t == 'ABS':
        return abs(eval_expr(node[1], env))
    a = eval_expr(node[1], env); b = eval_expr(node[2], env)
    if t == '+': return a + b
    if t == '-': return a - b
    if t == '*': return a * b
    if t == '/': return 0 if b == 0 else a // b
    if t == '%': return 0 if b == 0 else a - (a // b) * b
    if t == '<': return 1 if a < b else 0
    if t == '=': return 1 if a == b else 0
    if t == 'AND': return 1 if (a != 0 and b != 0) else 0
    if t == 'OR': return 1 if (a != 0 or b != 0) else 0
    if t == 'MIN': return min(a, b)
    if t == 'MAX': return max(a, b)
    if t == 'POW': return 0 if b < 0 else a ** b
    raise Exception('bad op ' + t)

def do_call(fname, args):
    if fname not in PROCS:
        return 0
    params, body = PROCS[fname]
    env = {'locals': {}, 'redirect': set()}
    for p, v in zip(params, args):
        env['locals'][p] = v
    sig = exec_block(body, env)
    if sig and sig[0] == 'ret':
        return sig[1]
    return 0

def exec_block(stmts, env):
    for stmt in stmts:
        sig = exec_stmt(stmt, env)
        if sig is not None:
            return sig
    return None

def exec_stmt(stmt, env):
    kind = stmt[0]
    if kind == 'SET':
        write_var(env, stmt[1], eval_expr(stmt[2], env)); return None
    if kind == 'SETS':
        _, v, w, e, f = stmt
        ev = eval_expr(e, env); fv = eval_expr(f, env)
        write_var(env, v, ev); write_var(env, w, fv)
        return None
    if kind == 'PRINT':
        OUTPUT.append(eval_expr(stmt[1], env)); return None
    if kind == 'PUSH':
        LISTS.setdefault(stmt[1], []).append(eval_expr(stmt[2], env)); return None
    if kind == 'REPEAT':
        n = eval_expr(stmt[1], env)
        for _ in range(max(n, 0)):
            sig = exec_block(stmt[2], env)
            if sig is not None:
                if sig[0] == 'break': break
                if sig[0] == 'continue': continue
                return sig
        return None
    if kind == 'WHILE':
        while eval_expr(stmt[1], env) != 0:
            sig = exec_block(stmt[2], env)
            if sig is not None:
                if sig[0] == 'break': break
                if sig[0] == 'continue': continue
                return sig
        return None
    if kind == 'IF':
        if eval_expr(stmt[1], env) != 0:
            return exec_block(stmt[2], env)
        elif stmt[3] is not None:
            return exec_block(stmt[3], env)
        return None
    if kind == 'BREAK': return ('break',)
    if kind == 'CONTINUE': return ('continue',)
    if kind == 'DEF':
        PROCS[stmt[1]] = (stmt[2], stmt[3]); return None
    if kind == 'RET':
        return ('ret', eval_expr(stmt[1], env))
    if kind == 'GLOBAL':
        env['redirect'].add(stmt[1]); return None
    raise Exception('bad stmt ' + kind)

def main():
    path = sys.argv[1]
    lines = load_lines(path)
    arity = build_arity(lines)
    stmts, end = parse_block(lines, 0, arity)
    assert end == len(lines), f"parse stopped at {end}/{len(lines)}"
    top_env = {'locals': None, 'redirect': set()}
    exec_block(stmts, top_env)
    print(' '.join(str(x) for x in OUTPUT))

if __name__ == '__main__':
    main()
