import sys, re
def tok(s): return s.replace('(', ' ( ').replace(')', ' ) ').split()
def parse(t, i):
    if t[i] == '(':
        i += 1
        h = t[i]
        if h == 'fn':
            i += 1  # '('
            assert t[i] == '('
            i += 1; ps = []
            while t[i] != ')': ps.append(t[i]); i += 1
            i += 1
            body, i = parse(t, i)
            assert t[i] == ')'
            return ('fn', ps, body), i + 1
        i += 1; args = []
        while t[i] != ')':
            a, i = parse(t, i); args.append(a)
        return (h, args), i + 1
    if re.fullmatch(r'-?\d+', t[i]): return ('int', int(t[i])), i + 1
    return ('name', t[i]), i + 1
class Fn:
    def __init__(s, ps, body, stmts=False): s.ps, s.body, s.stmts = ps, body, stmts
class Ret(Exception):
    def __init__(s, v): s.v = v
def run(src):
    out = []; glob = {}
    lines = [l.strip() for l in src.split('\n')]
    lines = [l for l in lines if l and not l.startswith('#')]
    def block(i, stops):
        body = []
        while i < len(lines) and lines[i].split()[0] not in stops:
            st, i = stmt(i); body.append(st)
        return body, i
    def stmt(i):
        t = lines[i].split(None, 1); h = t[0]
        if h == 'SET':
            name, rest = t[1].split(None, 1); e, _ = parse(tok(rest), 0); return ('SET', name, e), i + 1
        if h == 'PRINT': e, _ = parse(tok(t[1]), 0); return ('PRINT', e), i + 1
        if h == 'RET': e, _ = parse(tok(t[1]), 0); return ('RET', e), i + 1
        if h == 'GLOBAL': return ('GLOBAL', t[1]), i + 1
        if h == 'IF':
            e, _ = parse(tok(t[1]), 0); b1, j = block(i + 1, ('ELSE', 'END')); b2 = []
            if lines[j].split()[0] == 'ELSE': b2, j = block(j + 1, ('END',))
            return ('IF', e, b1, b2), j + 1
        if h == 'REPEAT':
            e, _ = parse(tok(t[1]), 0); b, j = block(i + 1, ('END',)); return ('REPEAT', e, b), j + 1
        if h == 'DEF':
            parts = t[1].split(); b, j = block(i + 1, ('END',)); return ('DEF', parts[0], parts[1:], b), j + 1
        raise Exception('bad ' + lines[i])
    prog, _ = block(0, ())
    def read(n, fr):
        if fr is not None:
            if n in fr['g']: return glob.get(n, 0)
            if n in fr['l']: return fr['l'][n]
        return glob.get(n, 0)
    def ev(e, fr):
        k = e[0]
        if k == 'int': return e[1]
        if k == 'name': return read(e[1], fr)
        if k == 'fn': return Fn(e[1], e[2])
        if k == 'if':
            c = ev(e[1][0], fr)
            return ev(e[1][1], fr) if c != 0 else ev(e[1][2], fr)
        if k == 'call':
            f = ev(e[1][0], fr); vals = [ev(a, fr) for a in e[1][1:]]
            return callf(f, vals)
        v = [ev(a, fr) for a in e[1]]
        if k == '+': return v[0] + v[1]
        if k == '-': return v[0] - v[1]
        if k == '*': return v[0] * v[1]
        if k == '/': return 0 if v[1] == 0 else v[0] // v[1]
        if k == '%': return 0 if v[1] == 0 else v[0] % v[1]
        if k == '<': return int(v[0] < v[1])
        if k == '=': return int(v[0] == v[1])
        raise Exception('op ' + k)
    def callf(f, vals):
        if not isinstance(f, Fn): return 0
        fr = {'l': dict(zip(f.ps, vals)), 'g': set()}
        if not f.stmts: return ev(f.body, fr)
        try: exs(f.body, fr)
        except Ret as r: return r.v
        return 0
    def exs(body, fr):
        for s in body:
            k = s[0]
            if k == 'SET':
                v = ev(s[2], fr)
                if fr is None or s[1] in fr['g']: glob[s[1]] = v
                else: fr['l'][s[1]] = v
            elif k == 'PRINT': out.append(ev(s[1], fr))
            elif k == 'RET': raise Ret(ev(s[1], fr))
            elif k == 'GLOBAL': fr['g'].add(s[1])
            elif k == 'IF': exs(s[2] if ev(s[1], fr) != 0 else s[3], fr)
            elif k == 'REPEAT':
                for _ in range(ev(s[1], fr)): exs(s[2], fr)
            elif k == 'DEF':
                f = Fn(s[2], s[3], True)
                if fr is None or s[1] in fr['g']: glob[s[1]] = f
                else: fr['l'][s[1]] = f
    exs(prog, None)
    return out
if __name__ == '__main__':
    print(' '.join(str(x) for x in run(open(sys.argv[1]).read())))
