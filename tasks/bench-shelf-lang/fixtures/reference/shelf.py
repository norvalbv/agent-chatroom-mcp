"""Independent second implementation of SHELF (parse to AST first, then evaluate). Used only for cross-checking."""
import re, sys

def tokenize(s):
    return s.replace('(', ' ( ').replace(')', ' ) ').split()

def parse_expr(toks, i):
    t = toks[i]
    if t == '(':
        op = toks[i + 1]
        j = i + 2
        args = []
        while toks[j] != ')':
            a, j = parse_expr(toks, j)
            args.append(a)
        return ('call', op, args), j + 1
    if re.fullmatch(r'-?\d+', t):
        return ('int', int(t)), i + 1
    return ('var', t), i + 1

def parse_block(lines, i, stop):
    body = []
    while i < len(lines) and lines[i].split()[0] not in stop:
        st, i = parse_stmt(lines, i)
        body.append(st)
    return body, i

def parse_stmt(lines, i):
    toks = tokenize(lines[i])
    h = toks[0]
    if h in ('LET', 'PUSH', 'PRINT', 'SET', 'IF', 'REPEAT', 'FOR', 'RUN', 'DEF'):
        pass
    if h == 'LET' or h == 'PUSH':
        e, _ = parse_expr(toks, 2)
        return (h, toks[1], e), i + 1
    if h == 'SET':
        a, j = parse_expr(toks, 2)
        b, _ = parse_expr(toks, j)
        return ('SET', toks[1], a, b), i + 1
    if h == 'PRINT':
        e, _ = parse_expr(toks, 1)
        return ('PRINT', e), i + 1
    if h == 'RUN':
        j = 2
        args = []
        while j < len(toks):
            a, j = parse_expr(toks, j)
            args.append(a)
        return ('RUN', toks[1], args), i + 1
    if h == 'IF':
        c, _ = parse_expr(toks, 1)
        body, k = parse_block(lines, i + 1, ('ELSE', 'END'))
        other = []
        if lines[k].split()[0] == 'ELSE':
            other, k = parse_block(lines, k + 1, ('END',))
        return ('IF', c, body, other), k + 1
    if h == 'REPEAT':
        c, _ = parse_expr(toks, 1)
        body, k = parse_block(lines, i + 1, ('END',))
        return ('REPEAT', c, body), k + 1
    if h == 'FOR':
        c, _ = parse_expr(toks, 2)
        body, k = parse_block(lines, i + 1, ('END',))
        return ('FOR', toks[1], c, body), k + 1
    if h == 'DEF':
        body, k = parse_block(lines, i + 1, ('END',))
        return ('DEF', toks[1], toks[2:], body), k + 1
    raise SystemExit('bad ' + lines[i])

def fresh(v):
    return [fresh(x) for x in v] if isinstance(v, list) else v

def show(v):
    return '[' + ','.join(show(x) for x in v) + ']' if isinstance(v, list) else str(v)

def run(src):
    lines = [l.strip() for l in src.split('\n')]
    lines = [l for l in lines if l and not l.startswith('#')]
    prog, _ = parse_block(lines, 0, ())
    out, procs, glob = [], {}, {}
    def look(n, sc):
        return sc[n] if n in sc else glob[n]
    def ev(e, sc):
        k = e[0]
        if k == 'int': return e[1]
        if k == 'var': return look(e[1], sc)
        op, args = e[1], [ev(a, sc) for a in e[2]]
        if op == '+': return args[0] + args[1]
        if op == '-': return args[0] - args[1]
        if op == '*': return args[0] * args[1]
        if op == '<': return int(args[0] < args[1])
        if op == '=': return int(args[0] == args[1])
        if op == 'list': return list(args)
        if op == 'idx': return args[0][args[1]]
        if op == 'len': return len(args[0])
    def ex(body, sc):
        for s in body:
            k = s[0]
            if k == 'LET': sc[s[1]] = fresh(ev(s[2], sc))
            elif k == 'PUSH': look(s[1], sc).append(ev(s[2], sc))
            elif k == 'SET':
                i = ev(s[2], sc); v = ev(s[3], sc); look(s[1], sc)[i] = v
            elif k == 'PRINT': out.append(show(ev(s[1], sc)))
            elif k == 'IF':
                ex(s[2] if ev(s[1], sc) != 0 else s[3], sc)
            elif k == 'REPEAT':
                for _ in range(ev(s[1], sc)): ex(s[2], sc)
            elif k == 'FOR':
                for el in list(ev(s[2], sc)):
                    sc[s[1]] = el
                    ex(s[3], sc)
            elif k == 'DEF': procs[s[1]] = (s[2], s[3])
            elif k == 'RUN':
                params, pb = procs[s[1]]
                vals = [ev(a, sc) for a in s[2]]
                ex(pb, dict(zip(params, vals)))
    ex(prog, glob)
    return out

if __name__ == '__main__':
    print('|'.join(run(open(sys.argv[1]).read())))
