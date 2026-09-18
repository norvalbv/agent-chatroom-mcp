import sys

BIN = {'+','-','*','/','%','<','=','AND','OR','MIN','MAX','POW'}
UN = {'NOT','ABS'}

def parse_block(lines, i, stop):
    out = []
    while i < len(lines):
        t = lines[i].split()
        h = t[0]
        if h == 'END':
            return out, i + 1
        if h == 'ELSE':
            return out, i
        if h in ('REPEAT', 'WHILE', 'IF'):
            body, i2 = parse_block(lines, i + 1, None)
            els = None
            if i2 < len(lines) and lines[i2].split()[0] == 'ELSE':
                els, i2 = parse_block(lines, i2 + 1, None)
            out.append((h, t[1:], body, els))
            i = i2
        elif h == 'DEF':
            body, i2 = parse_block(lines, i + 1, None)
            out.append(('DEF', t[1:], body, None))
            i = i2
        else:
            out.append((h, t[1:], None, None))
            i += 1
    return out, i

class Brk(Exception): pass
class Cont(Exception): pass
class Ret(Exception):
    def __init__(s, v): s.v = v

procs = {}
globs = {}
lists = {}
out = []

class Frame:
    def __init__(s, is_global):
        s.locals = {}
        s.gnames = set()
        s.is_global = is_global

def read(fr, name):
    if fr.is_global or name in fr.gnames:
        return globs.get(name, 0)
    if name in fr.locals:
        return fr.locals[name]
    return globs.get(name, 0)

def write(fr, name, v):
    if fr.is_global or name in fr.gnames:
        globs[name] = v
    else:
        fr.locals[name] = v

def isnum(tok):
    try:
        int(tok); return True
    except ValueError:
        return False

def ev(toks, p, fr):
    tok = toks[p]
    if isnum(tok):
        return int(tok), p + 1
    if tok in BIN:
        a, p = ev(toks, p + 1, fr)
        b, p = ev(toks, p, fr)
        if tok == '+': r = a + b
        elif tok == '-': r = a - b
        elif tok == '*': r = a * b
        elif tok == '/': r = 0 if b == 0 else a // b
        elif tok == '%': r = 0 if b == 0 else a - (a // b) * b
        elif tok == '<': r = int(a < b)
        elif tok == '=': r = int(a == b)
        elif tok == 'AND': r = int(a != 0 and b != 0)
        elif tok == 'OR': r = int(a != 0 or b != 0)
        elif tok == 'MIN': r = min(a, b)
        elif tok == 'MAX': r = max(a, b)
        elif tok == 'POW':
            r = 0 if b < 0 else (1 if b == 0 else a ** b)
        return r, p
    if tok in UN:
        a, p = ev(toks, p + 1, fr)
        return (int(a == 0) if tok == 'NOT' else abs(a)), p
    if tok == 'NEXT':
        v = toks[p + 1]
        nv = read(fr, v) + 1
        write(fr, v, nv)
        return nv, p + 2
    if tok == 'LEN':
        return len(lists.get(toks[p + 1], [])), p + 2
    if tok == 'AT':
        L = lists.get(toks[p + 1], [])
        i, p = ev(toks, p + 2, fr)
        if i < 0: i += len(L)
        return (L[i] if 0 <= i < len(L) else 0), p
    if tok == 'CALL':
        f = toks[p + 1]
        p += 2
        params = procs[f][0] if f in procs else []
        args = []
        for _ in params:
            a, p = ev(toks, p, fr)
            args.append(a)
        if f not in procs:
            return 0, p
        params, body = procs[f]
        nf = Frame(False)
        for n, a in zip(params, args):
            nf.locals[n] = a
        try:
            run(body, nf)
        except Ret as r:
            return r.v, p
        return 0, p
    # bare variable
    return read(fr, tok), p + 1

def E(toks, fr):
    v, p = ev(toks, 0, fr)
    assert p == len(toks), (toks, p)
    return v

def run(block, fr):
    for (h, t, body, els) in block:
        if h == 'SET':
            v = E(t[1:], fr); write(fr, t[0], v)
        elif h == 'SETS':
            # SETS v w e f
            v, w = t[0], t[1]
            e, p = ev(t, 2, fr)
            f, p = ev(t, p, fr)
            assert p == len(t)
            write(fr, v, e); write(fr, w, f)
        elif h == 'PRINT':
            out.append(E(t, fr))
        elif h == 'PUSH':
            lists.setdefault(t[0], []).append(E(t[1:], fr))
        elif h == 'REPEAT':
            n = E(t, fr)
            for _ in range(max(n, 0)):
                try:
                    run(body, fr)
                except Cont:
                    continue
                except Brk:
                    break
        elif h == 'WHILE':
            while E(t, fr) != 0:
                try:
                    run(body, fr)
                except Cont:
                    continue
                except Brk:
                    break
        elif h == 'IF':
            if E(t, fr) != 0:
                run(body, fr)
            elif els is not None:
                run(els, fr)
        elif h == 'BREAK': raise Brk()
        elif h == 'CONTINUE': raise Cont()
        elif h == 'DEF':
            procs[t[0]] = (t[1:], body)
        elif h == 'RET':
            raise Ret(E(t, fr))
        elif h == 'GLOBAL':
            fr.gnames.add(t[0])
        else:
            raise Exception('unknown ' + h)

lines = [l.strip() for l in open(sys.argv[1]).read().splitlines() if l.strip()]
prog, _ = parse_block(lines, 0, None)
run(prog, Frame(True))
print(' '.join(map(str, out)))
